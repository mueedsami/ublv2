begin;

create table if not exists public.daraz_stock_daily (
  stock_date date not null,
  account_sku text not null,
  item_name text,
  stock_qty numeric(18,4) not null default 0,
  stock_valuation numeric(18,4) not null default 0,
  aging_60d_qty numeric(18,4) not null default 0,
  aging_valuation numeric(18,4) not null default 0,
  mrp numeric(18,4),
  sale_price numeric(18,4),
  tp numeric(18,4),
  gis numeric(18,4),
  gmv numeric(18,4),
  nmv numeric(18,4),
  nis numeric(18,4),
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (stock_date, account_sku)
);
create index if not exists idx_daraz_stock_sku_date on public.daraz_stock_daily(account_sku, stock_date desc);
create index if not exists idx_daraz_stock_upload on public.daraz_stock_daily(source_upload_id);

create table if not exists public.daraz_basepack_daily (
  stock_date date not null,
  basepack_id uuid references public.basepacks(id) on delete set null,
  packsize text not null,
  brands text[] not null default '{}',
  business_groups text[] not null default '{}',
  categories text[] not null default '{}',
  sub_categories text[] not null default '{}',
  product_types text[] not null default '{}',
  retail_types text[] not null default '{}',
  variants text[] not null default '{}',
  sku_count integer not null default 0,
  stock_qty numeric(18,4) not null default 0,
  stock_valuation numeric(18,4) not null default 0,
  is_available boolean not null default false,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (stock_date, packsize)
);
create index if not exists idx_daraz_basepack_date on public.daraz_basepack_daily(stock_date desc);
create index if not exists idx_daraz_basepack_basepack on public.daraz_basepack_daily(basepack_id);

alter table public.daraz_stock_daily enable row level security;
alter table public.daraz_basepack_daily enable row level security;
revoke all on public.daraz_stock_daily, public.daraz_basepack_daily from anon, authenticated;
grant select,insert,update,delete on public.daraz_stock_daily, public.daraz_basepack_daily to service_role;

create or replace function public.commit_daraz_upload_v2(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_account_id uuid; v_upload_id uuid; v_date date; v_latest boolean;
  v_expected int; v_available int; v_pct numeric(7,2); v_matched int; v_unmatched int;
  v_matched_units numeric(18,4); v_matched_valuation numeric(18,4);
begin
  select id into v_account_id from public.accounts where code='daraz' and active=true;
  if v_account_id is null then raise exception 'Daraz account is not configured'; end if;
  v_date := nullif(p_payload->>'snapshot_date','')::date;
  if v_date is null then raise exception 'snapshot_date is required'; end if;

  select not exists(select 1 from public.stock_uploads where account_id=v_account_id and is_latest=true and snapshot_date>v_date) into v_latest;
  if v_latest then update public.stock_uploads set is_latest=false where account_id=v_account_id and is_latest=true; end if;

  insert into public.stock_uploads(account_id,snapshot_date,is_latest,file_name,sheet_name,sku_column,stock_columns,stock_mode,input_rows,unique_skus,duplicate_sku_rows,total_units)
  values(v_account_id,v_date,v_latest,coalesce(nullif(p_payload->>'file_name',''),'daraz.xlsx'),coalesce(nullif(p_payload->>'sheet_name',''),'Sheet1'),'daraz_sku',array['Total - Stock','Stock Valuation']::text[],'quantity',coalesce((p_payload->>'input_rows')::int,0),jsonb_array_length(coalesce(p_payload->'rows','[]'::jsonb)),coalesce((p_payload->>'duplicate_sku_rows')::int,0),coalesce((p_payload->>'total_units')::numeric,0)) returning id into v_upload_id;

  insert into public.stock_rows(upload_id,account_sku,stock_qty)
  select v_upload_id,trim(x.account_sku),greatest(coalesce(x.stock_qty,0),0)
  from jsonb_to_recordset(coalesce(p_payload->'rows','[]'::jsonb)) x(account_sku text,stock_qty numeric)
  where nullif(trim(x.account_sku),'') is not null
  on conflict(upload_id,account_sku) do update set stock_qty=excluded.stock_qty;

  delete from public.daraz_stock_daily where stock_date=v_date;
  insert into public.daraz_stock_daily(stock_date,account_sku,item_name,stock_qty,stock_valuation,aging_60d_qty,aging_valuation,mrp,sale_price,tp,gis,gmv,nmv,nis,source_upload_id,updated_at)
  select v_date,trim(x.account_sku),nullif(x.item_name,''),greatest(coalesce(x.stock_qty,0),0),greatest(coalesce(x.stock_valuation,0),0),greatest(coalesce(x.aging_60d_qty,0),0),greatest(coalesce(x.aging_valuation,0),0),x.mrp,x.sale_price,x.tp,x.gis,x.gmv,x.nmv,x.nis,v_upload_id,now()
  from jsonb_to_recordset(coalesce(p_payload->'stock_rows','[]'::jsonb)) x(account_sku text,item_name text,stock_qty numeric,stock_valuation numeric,aging_60d_qty numeric,aging_valuation numeric,mrp numeric,sale_price numeric,tp numeric,gis numeric,gmv numeric,nmv numeric,nis numeric)
  where nullif(trim(x.account_sku),'') is not null;

  delete from public.daraz_basepack_daily where stock_date=v_date;
  insert into public.daraz_basepack_daily(stock_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,sku_count,stock_qty,stock_valuation,is_available,source_upload_id)
  with scope as (
    select distinct p.basepack_id,b.packsize,pai.account_sku,p.id product_id,p.brand,p.business_group,p.category,p.sub_category,p.product_type,p.retail_type,p.variant
    from public.product_account_ids pai join public.products p on p.id=pai.product_id and p.status='active' join public.basepacks b on b.id=p.basepack_id
    where pai.account_id=v_account_id
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
    coalesce(sum(sd.stock_qty),0),coalesce(sum(sd.stock_valuation),0),coalesce(bool_or(sd.stock_qty>0),false),v_upload_id
  from meta m left join ids i on i.basepack_id=m.basepack_id left join public.daraz_stock_daily sd on sd.stock_date=v_date and sd.account_sku=i.account_sku
  group by m.basepack_id,m.packsize,m.brands,m.business_groups,m.categories,m.sub_categories,m.product_types,m.retail_types,m.variants,m.sku_count;

  select count(*)::int,count(*) filter(where is_available)::int into v_expected,v_available from public.daraz_basepack_daily where stock_date=v_date;
  v_pct := case when v_expected>0 then round(100.0*v_available/v_expected,2) end;

  select count(*)::int,coalesce(sum(sr.stock_qty),0)::numeric(18,4),coalesce(sum(ds.stock_valuation),0)::numeric(18,4)
  into v_matched,v_matched_units,v_matched_valuation
  from public.stock_rows sr join public.daraz_stock_daily ds on ds.stock_date=v_date and ds.account_sku=sr.account_sku
  where sr.upload_id=v_upload_id and exists(select 1 from public.product_account_ids pai join public.products p on p.id=pai.product_id and p.status='active' where pai.account_id=v_account_id and pai.account_sku=sr.account_sku);

  select count(*)::int into v_unmatched from public.stock_rows sr where sr.upload_id=v_upload_id and not exists(select 1 from public.product_account_ids pai join public.products p on p.id=pai.product_id and p.status='active' where pai.account_id=v_account_id and pai.account_sku=sr.account_sku);

  update public.stock_uploads set matched_input_ids=v_matched,unmatched_input_ids=v_unmatched,expected_basepacks=v_expected,available_basepacks=v_available,availability_pct=v_pct where id=v_upload_id;

  return jsonb_build_object('success',true,'upload_id',v_upload_id,'stock_date',v_date,'is_latest',v_latest,'normal_input_rows',coalesce((p_payload->>'normal_input_rows')::int,0),'ignored_non_normal_rows',coalesce((p_payload->>'ignored_non_normal_rows')::int,0),'expected_basepacks',v_expected,'available_basepacks',v_available,'unavailable_basepacks',greatest(v_expected-v_available,0),'availability_pct',v_pct,'matched_input_ids',v_matched,'unmatched_input_ids',v_unmatched,'matched_stock_units',v_matched_units,'matched_stock_valuation',v_matched_valuation);
end $$;
revoke execute on function public.commit_daraz_upload_v2(jsonb) from public,anon,authenticated;
grant execute on function public.commit_daraz_upload_v2(jsonb) to service_role;

create or replace view public.v_daraz_daily_ola with(security_invoker=true) as
select stock_date,count(*)::int expected_basepacks,count(*) filter(where is_available)::int available_basepacks,count(*) filter(where not is_available)::int unavailable_basepacks,round(100.0*count(*) filter(where is_available)/nullif(count(*),0),2) ola_pct,coalesce(sum(stock_qty),0)::numeric(18,4) total_stock,coalesce(sum(stock_valuation),0)::numeric(18,4) total_stock_valuation
from public.daraz_basepack_daily group by stock_date;

create or replace view public.v_daraz_monthly_ola with(security_invoker=true) as
select date_trunc('month',stock_date)::date month_start,count(*)::int days_with_data,round(avg(ola_pct),2) avg_ola_pct,min(ola_pct) min_ola_pct,max(ola_pct) max_ola_pct,min(stock_date) first_stock_date,max(stock_date) last_stock_date
from public.v_daraz_daily_ola group by date_trunc('month',stock_date)::date;

create or replace view public.v_daraz_stock_movement with(security_invoker=true) as
with mapped as (
  select distinct pai.account_sku from public.product_account_ids pai join public.accounts a on a.id=pai.account_id and a.code='daraz' join public.products p on p.id=pai.product_id and p.status='active'
), lagged as (
  select d.*,lag(d.stock_date) over(partition by d.account_sku order by d.stock_date) previous_stock_date,lag(d.stock_qty) over(partition by d.account_sku order by d.stock_date) previous_stock_qty,lag(d.stock_valuation) over(partition by d.account_sku order by d.stock_date) previous_stock_valuation
  from public.daraz_stock_daily d
)
select l.stock_date,l.previous_stock_date,case when l.previous_stock_date is null then null else (l.stock_date-l.previous_stock_date) end::int days_between_observations,l.account_sku,l.item_name,l.stock_qty,l.previous_stock_qty,case when l.previous_stock_qty is null then null else l.stock_qty-l.previous_stock_qty end::numeric(18,4) stock_change,case when l.previous_stock_qty is null then 0 else greatest(l.previous_stock_qty-l.stock_qty,0) end::numeric(18,4) estimated_depletion_qty,case when l.previous_stock_qty is null then 0 else greatest(l.stock_qty-l.previous_stock_qty,0) end::numeric(18,4) replenishment_qty,case when l.previous_stock_qty is null or l.previous_stock_qty=0 then 0 else round(greatest(l.previous_stock_qty-l.stock_qty,0)*(l.previous_stock_valuation/l.previous_stock_qty),4) end::numeric(18,4) estimated_depletion_value,l.stock_valuation,l.previous_stock_valuation,(m.account_sku is not null) is_mapped
from lagged l left join mapped m on m.account_sku=l.account_sku;

create or replace view public.v_daraz_daily_movement_summary with(security_invoker=true) as
select stock_date,min(previous_stock_date) previous_stock_date,max(days_between_observations) days_between_observations,count(*) filter(where is_mapped)::int mapped_skus,coalesce(sum(estimated_depletion_qty) filter(where is_mapped),0)::numeric(18,4) estimated_depletion_qty,coalesce(sum(estimated_depletion_value) filter(where is_mapped),0)::numeric(18,4) estimated_depletion_value,coalesce(sum(replenishment_qty) filter(where is_mapped),0)::numeric(18,4) replenishment_qty,coalesce(sum(stock_change) filter(where is_mapped),0)::numeric(18,4) net_stock_change
from public.v_daraz_stock_movement group by stock_date;

create or replace view public.v_daraz_current_basepacks with(security_invoker=true) as
with latest as (select max(stock_date) stock_date from public.daraz_basepack_daily), movement_bp as (
  select m.stock_date,p.basepack_id,sum(m.estimated_depletion_qty)::numeric(18,4) estimated_depletion_qty,sum(m.estimated_depletion_value)::numeric(18,4) estimated_depletion_value,sum(m.replenishment_qty)::numeric(18,4) replenishment_qty
  from public.v_daraz_stock_movement m join public.accounts a on a.code='daraz' join public.product_account_ids pai on pai.account_id=a.id and pai.account_sku=m.account_sku join public.products p on p.id=pai.product_id and p.status='active'
  where m.is_mapped group by m.stock_date,p.basepack_id
)
select d.*,coalesce(m.estimated_depletion_qty,0)::numeric(18,4) estimated_depletion_qty,coalesce(m.estimated_depletion_value,0)::numeric(18,4) estimated_depletion_value,coalesce(m.replenishment_qty,0)::numeric(18,4) replenishment_qty
from public.daraz_basepack_daily d join latest l on l.stock_date=d.stock_date left join movement_bp m on m.stock_date=d.stock_date and m.basepack_id=d.basepack_id;

revoke all on public.v_daraz_daily_ola,public.v_daraz_monthly_ola,public.v_daraz_stock_movement,public.v_daraz_daily_movement_summary,public.v_daraz_current_basepacks from anon,authenticated;
grant select on public.v_daraz_daily_ola,public.v_daraz_monthly_ola,public.v_daraz_stock_movement,public.v_daraz_daily_movement_summary,public.v_daraz_current_basepacks to service_role;

commit;
