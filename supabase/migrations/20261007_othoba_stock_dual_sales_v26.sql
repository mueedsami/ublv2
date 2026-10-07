-- UBL Availability V2.6 — Othoba stock + operational sales snapshots + detailed sales reports
begin;

create table if not exists public.othoba_stock_daily (
  stock_date date not null,
  account_sku text not null,
  item_name text,
  stock_qty numeric(18,4) not null default 0,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (stock_date, account_sku)
);
create index if not exists idx_othoba_stock_sku_date on public.othoba_stock_daily(account_sku, stock_date desc);

create table if not exists public.othoba_sales_snapshots (
  period_start date not null,
  period_end date not null,
  account_sku text not null,
  item_name text,
  sold_qty numeric(18,4) not null default 0,
  run_rate numeric(18,6),
  mrp numeric(18,4),
  tp numeric(18,4),
  stock_value numeric(18,4),
  sales_value numeric(18,4),
  source_sheet text not null,
  is_complete_month boolean not null default false,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (source_sheet, period_end, account_sku)
);
create index if not exists idx_othoba_sales_snapshots_period on public.othoba_sales_snapshots(period_end desc, account_sku);

create table if not exists public.othoba_monthly_sales (
  month_start date not null,
  period_end date not null,
  account_sku text not null,
  item_name text,
  sold_qty numeric(18,4) not null default 0,
  total_product_cost numeric(18,4) not null default 0,
  total_amount numeric(18,4) not null default 0,
  source_sheet text not null,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (month_start, account_sku)
);
create index if not exists idx_othoba_monthly_sales_period on public.othoba_monthly_sales(month_start desc, account_sku);

create table if not exists public.othoba_basepack_daily (
  stock_date date not null,
  basepack_id uuid references public.basepacks(id) on delete set null,
  packsize text not null,
  brands text[] not null default '{}', business_groups text[] not null default '{}', categories text[] not null default '{}',
  sub_categories text[] not null default '{}', product_types text[] not null default '{}', retail_types text[] not null default '{}', variants text[] not null default '{}',
  sku_count integer not null default 0,
  stock_qty numeric(18,4) not null default 0,
  is_available boolean not null default false,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (stock_date, packsize)
);
create index if not exists idx_othoba_basepack_date on public.othoba_basepack_daily(stock_date desc);

alter table public.othoba_stock_daily enable row level security;
alter table public.othoba_sales_snapshots enable row level security;
alter table public.othoba_monthly_sales enable row level security;
alter table public.othoba_basepack_daily enable row level security;
revoke all on public.othoba_stock_daily, public.othoba_sales_snapshots, public.othoba_monthly_sales, public.othoba_basepack_daily from anon, authenticated;
grant select,insert,update,delete on public.othoba_stock_daily, public.othoba_sales_snapshots, public.othoba_monthly_sales, public.othoba_basepack_daily to service_role;

create or replace function public.commit_othoba_upload_v2(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 v_account_id uuid; v_upload_id uuid; v_date date; v_latest boolean; v_expected int; v_available int; v_pct numeric(7,2); v_matched int; v_unmatched int;
begin
 select id into v_account_id from public.accounts where code='othoba' and active=true;
 if v_account_id is null then raise exception 'Othoba account is not configured'; end if;
 v_date:=nullif(p_payload->>'snapshot_date','')::date; if v_date is null then raise exception 'snapshot_date is required'; end if;
 select not exists(select 1 from public.stock_uploads where account_id=v_account_id and is_latest=true and snapshot_date>v_date) into v_latest;
 if v_latest then update public.stock_uploads set is_latest=false where account_id=v_account_id and is_latest=true; end if;
 insert into public.stock_uploads(account_id,snapshot_date,is_latest,file_name,sheet_name,sku_column,stock_columns,stock_mode,input_rows,unique_skus,duplicate_sku_rows,total_units)
 values(v_account_id,v_date,v_latest,coalesce(p_payload->>'file_name','othoba.xlsx'),coalesce(p_payload->>'sheet_name',''), 'Sku',array['Current Stock']::text[],'quantity',coalesce((p_payload->>'input_rows')::int,0),jsonb_array_length(coalesce(p_payload->'rows','[]'::jsonb)),coalesce((p_payload->>'duplicate_sku_rows')::int,0),coalesce((p_payload->>'total_units')::numeric,0)) returning id into v_upload_id;

 insert into public.stock_rows(upload_id,account_sku,stock_qty)
 select v_upload_id,trim(x.account_sku),greatest(coalesce(x.stock_qty,0),0)
 from jsonb_to_recordset(coalesce(p_payload->'rows','[]'::jsonb)) x(account_sku text,stock_qty numeric)
 where nullif(trim(x.account_sku),'') is not null on conflict(upload_id,account_sku) do update set stock_qty=excluded.stock_qty;

 delete from public.othoba_stock_daily where stock_date=v_date;
 insert into public.othoba_stock_daily(stock_date,account_sku,item_name,stock_qty,source_upload_id,updated_at)
 select v_date,trim(x.account_sku),nullif(x.item_name,''),greatest(coalesce(x.stock_qty,0),0),v_upload_id,now()
 from jsonb_to_recordset(coalesce(p_payload->'stock_rows','[]'::jsonb)) x(account_sku text,item_name text,stock_qty numeric)
 where nullif(trim(x.account_sku),'') is not null;

 delete from public.othoba_sales_snapshots s where exists (
   select 1 from jsonb_to_recordset(coalesce(p_payload->'sales_snapshot_rows','[]'::jsonb)) x(period_end date,source_sheet text)
   where x.period_end=s.period_end and x.source_sheet=s.source_sheet
 );
 insert into public.othoba_sales_snapshots(period_start,period_end,account_sku,item_name,sold_qty,run_rate,mrp,tp,stock_value,sales_value,source_sheet,is_complete_month,source_upload_id,updated_at)
 select x.period_start,x.period_end,trim(x.account_sku),nullif(x.item_name,''),greatest(coalesce(x.sold_qty,0),0),x.run_rate,x.mrp,x.tp,x.stock_value,x.sales_value,x.source_sheet,coalesce(x.is_complete_month,false),v_upload_id,now()
 from jsonb_to_recordset(coalesce(p_payload->'sales_snapshot_rows','[]'::jsonb)) x(period_start date,period_end date,account_sku text,item_name text,sold_qty numeric,run_rate numeric,mrp numeric,tp numeric,stock_value numeric,sales_value numeric,source_sheet text,is_complete_month boolean)
 where nullif(trim(x.account_sku),'') is not null;

 delete from public.othoba_monthly_sales m where exists (
   select 1 from jsonb_to_recordset(coalesce(p_payload->'monthly_sales_rows','[]'::jsonb)) x(month_start date)
   where x.month_start=m.month_start
 );
 insert into public.othoba_monthly_sales(month_start,period_end,account_sku,item_name,sold_qty,total_product_cost,total_amount,source_sheet,source_upload_id,updated_at)
 select x.month_start,x.month_end,trim(x.account_sku),nullif(x.item_name,''),greatest(coalesce(x.sold_qty,0),0),greatest(coalesce(x.total_product_cost,0),0),greatest(coalesce(x.total_amount,0),0),x.source_sheet,v_upload_id,now()
 from jsonb_to_recordset(coalesce(p_payload->'monthly_sales_rows','[]'::jsonb)) x(month_start date,month_end date,account_sku text,item_name text,sold_qty numeric,total_product_cost numeric,total_amount numeric,source_sheet text)
 where nullif(trim(x.account_sku),'') is not null;

 delete from public.othoba_basepack_daily where stock_date=v_date;
 insert into public.othoba_basepack_daily(stock_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,sku_count,stock_qty,is_available,source_upload_id)
 with scope as (
  select distinct p.basepack_id,b.packsize,pai.account_sku,p.id product_id,p.brand,p.business_group,p.category,p.sub_category,p.product_type,p.retail_type,p.variant
  from public.product_account_ids pai join public.products p on p.id=pai.product_id and p.status='active' join public.basepacks b on b.id=p.basepack_id where pai.account_id=v_account_id
 ), meta as (
  select basepack_id,packsize,count(distinct product_id)::int sku_count,
   coalesce(array_agg(distinct brand order by brand) filter(where brand is not null),array[]::text[]) brands,
   coalesce(array_agg(distinct business_group order by business_group) filter(where business_group is not null),array[]::text[]) business_groups,
   coalesce(array_agg(distinct category order by category) filter(where category is not null),array[]::text[]) categories,
   coalesce(array_agg(distinct sub_category order by sub_category) filter(where sub_category is not null),array[]::text[]) sub_categories,
   coalesce(array_agg(distinct product_type order by product_type) filter(where product_type is not null),array[]::text[]) product_types,
   coalesce(array_agg(distinct retail_type order by retail_type) filter(where retail_type is not null),array[]::text[]) retail_types,
   coalesce(array_agg(distinct variant order by variant) filter(where variant is not null),array[]::text[]) variants
  from scope group by basepack_id,packsize
 ), ids as (select distinct basepack_id,account_sku from scope)
 select v_date,m.basepack_id,m.packsize,m.brands,m.business_groups,m.categories,m.sub_categories,m.product_types,m.retail_types,m.variants,m.sku_count,
  coalesce(sum(sd.stock_qty),0),coalesce(bool_or(sd.stock_qty>0),false),v_upload_id
 from meta m left join ids i on i.basepack_id=m.basepack_id left join public.othoba_stock_daily sd on sd.stock_date=v_date and sd.account_sku=i.account_sku
 group by m.basepack_id,m.packsize,m.brands,m.business_groups,m.categories,m.sub_categories,m.product_types,m.retail_types,m.variants,m.sku_count;

 select count(*)::int,count(*) filter(where is_available)::int into v_expected,v_available from public.othoba_basepack_daily where stock_date=v_date;
 v_pct:=case when v_expected>0 then round(100.0*v_available/v_expected,2) end;
 select count(*)::int into v_matched from public.stock_rows sr where sr.upload_id=v_upload_id and exists(select 1 from public.product_account_ids pai where pai.account_id=v_account_id and pai.account_sku=sr.account_sku);
 select count(*)::int into v_unmatched from public.stock_rows sr where sr.upload_id=v_upload_id and not exists(select 1 from public.product_account_ids pai where pai.account_id=v_account_id and pai.account_sku=sr.account_sku);
 update public.stock_uploads set matched_input_ids=v_matched,unmatched_input_ids=v_unmatched,expected_basepacks=v_expected,available_basepacks=v_available,availability_pct=v_pct where id=v_upload_id;
 return jsonb_build_object('success',true,'upload_id',v_upload_id,'stock_date',v_date,'expected_basepacks',v_expected,'available_basepacks',v_available,'unavailable_basepacks',greatest(v_expected-v_available,0),'availability_pct',v_pct,'matched_input_ids',v_matched,'unmatched_input_ids',v_unmatched);
end $$;
revoke execute on function public.commit_othoba_upload_v2(jsonb) from public,anon,authenticated;
grant execute on function public.commit_othoba_upload_v2(jsonb) to service_role;

create or replace view public.v_othoba_daily_ola with(security_invoker=true) as
select stock_date,count(*)::int expected_basepacks,count(*) filter(where is_available)::int available_basepacks,count(*) filter(where not is_available)::int unavailable_basepacks,
 round(100.0*count(*) filter(where is_available)/nullif(count(*),0),2) ola_pct,coalesce(sum(stock_qty),0)::numeric(18,4) total_stock
from public.othoba_basepack_daily group by stock_date;
create or replace view public.v_othoba_monthly_ola with(security_invoker=true) as
select date_trunc('month',stock_date)::date month_start,count(*)::int days_with_data,round(avg(ola_pct),2) avg_ola_pct,min(ola_pct) min_ola_pct,max(ola_pct) max_ola_pct,min(stock_date) first_stock_date,max(stock_date) last_stock_date
from public.v_othoba_daily_ola group by date_trunc('month',stock_date)::date;
create or replace view public.v_othoba_sales_snapshot_summary with(security_invoker=true) as
select period_start,period_end,source_sheet,bool_and(is_complete_month) is_complete_month,count(*)::int sku_rows,coalesce(sum(sold_qty),0)::numeric(18,4) sold_qty,coalesce(sum(sales_value),0)::numeric(18,4) sales_value
from public.othoba_sales_snapshots group by period_start,period_end,source_sheet;
create or replace view public.v_othoba_monthly_sales_summary with(security_invoker=true) as
select month_start,max(period_end) month_end,max(source_sheet) source_sheet,count(*)::int sku_rows,coalesce(sum(sold_qty),0)::numeric(18,4) sold_qty,coalesce(sum(total_product_cost),0)::numeric(18,4) total_product_cost,coalesce(sum(total_amount),0)::numeric(18,4) total_amount
from public.othoba_monthly_sales group by month_start;
create or replace view public.v_othoba_current_basepacks with(security_invoker=true) as
with latest as (select max(stock_date) stock_date from public.othoba_basepack_daily),
 mtd as (
  select s.period_end,p.basepack_id,sum(s.sold_qty)::numeric(18,4) sold_qty
  from public.othoba_sales_snapshots s join public.accounts a on a.code='othoba' join public.product_account_ids pai on pai.account_id=a.id and pai.account_sku=s.account_sku join public.products p on p.id=pai.product_id and p.status='active'
  group by s.period_end,p.basepack_id
 ), mon as (
  select ms.month_start,p.basepack_id,sum(ms.sold_qty)::numeric(18,4) sold_qty
  from public.othoba_monthly_sales ms join public.accounts a on a.code='othoba' join public.product_account_ids pai on pai.account_id=a.id and pai.account_sku=ms.account_sku join public.products p on p.id=pai.product_id and p.status='active'
  group by ms.month_start,p.basepack_id
 )
select d.*,coalesce(mtd.sold_qty,0)::numeric(18,4) mtd_sold_qty,coalesce(mon.sold_qty,0)::numeric(18,4) monthly_sold_qty
from public.othoba_basepack_daily d join latest l on l.stock_date=d.stock_date
left join mtd on mtd.period_end=d.stock_date-1 and mtd.basepack_id=d.basepack_id
left join mon on mon.month_start=date_trunc('month',d.stock_date)::date and mon.basepack_id=d.basepack_id;

revoke all on public.v_othoba_daily_ola,public.v_othoba_monthly_ola,public.v_othoba_sales_snapshot_summary,public.v_othoba_monthly_sales_summary,public.v_othoba_current_basepacks from anon,authenticated;
grant select on public.v_othoba_daily_ola,public.v_othoba_monthly_ola,public.v_othoba_sales_snapshot_summary,public.v_othoba_monthly_sales_summary,public.v_othoba_current_basepacks to service_role;
commit;
