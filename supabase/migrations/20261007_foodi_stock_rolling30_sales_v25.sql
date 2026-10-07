-- UBL Availability V2.5 — Foodi observed stock + rolling 30-day sales
--
-- Foodi files contain the stock position for selected date X and a rolling
-- "30 Day Sale Qty" snapshot through X-1. Missing stock dates are not filled.
-- Each uploaded date freezes the active master/basepack scope for historical OLA.

begin;

create table if not exists public.foodi_stock_daily (
  stock_date date not null,
  account_sku text not null,
  item_name text,
  stock_qty numeric(18,4) not null default 0,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (stock_date, account_sku)
);
create index if not exists idx_foodi_stock_daily_sku_date
  on public.foodi_stock_daily(account_sku, stock_date desc);
create index if not exists idx_foodi_stock_daily_upload
  on public.foodi_stock_daily(source_upload_id);

create table if not exists public.foodi_sales_30d (
  stock_date date not null,
  period_start date not null,
  period_end date not null,
  account_sku text not null,
  item_name text,
  sold_qty numeric(18,4) not null default 0,
  tp numeric(18,4),
  mrp numeric(18,4),
  selling_price numeric(18,4),
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (stock_date, account_sku),
  check (period_end = stock_date - 1),
  check (period_start = stock_date - 30)
);
create index if not exists idx_foodi_sales_30d_sku_date
  on public.foodi_sales_30d(account_sku, stock_date desc);
create index if not exists idx_foodi_sales_30d_period
  on public.foodi_sales_30d(period_start, period_end);
create index if not exists idx_foodi_sales_30d_upload
  on public.foodi_sales_30d(source_upload_id);

create table if not exists public.foodi_basepack_daily (
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
  is_available boolean not null default false,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (stock_date, packsize)
);
create index if not exists idx_foodi_basepack_daily_date
  on public.foodi_basepack_daily(stock_date desc);
create index if not exists idx_foodi_basepack_daily_basepack
  on public.foodi_basepack_daily(basepack_id);
create index if not exists idx_foodi_basepack_daily_upload
  on public.foodi_basepack_daily(source_upload_id);

alter table public.foodi_stock_daily enable row level security;
alter table public.foodi_sales_30d enable row level security;
alter table public.foodi_basepack_daily enable row level security;

revoke all on public.foodi_stock_daily, public.foodi_sales_30d,
  public.foodi_basepack_daily from anon, authenticated;
grant select,insert,update,delete on public.foodi_stock_daily, public.foodi_sales_30d,
  public.foodi_basepack_daily to service_role;

create or replace function public.commit_foodi_upload_v2(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id uuid;
  v_upload_id uuid;
  v_snapshot_date date;
  v_make_latest boolean := true;
  v_expected integer := 0;
  v_available integer := 0;
  v_pct numeric(7,2);
  v_matched integer := 0;
  v_unmatched integer := 0;
  v_sales_start date;
  v_sales_end date;
  v_sales_skus integer := 0;
  v_selling_skus integer := 0;
  v_sold_qty numeric(18,4) := 0;
begin
  select id into v_account_id
  from public.accounts
  where code='foodi' and active=true;

  if v_account_id is null then
    raise exception 'Foodi account is not configured';
  end if;

  v_snapshot_date := nullif(p_payload->>'snapshot_date','')::date;
  if v_snapshot_date is null then
    raise exception 'snapshot_date is required';
  end if;
  v_sales_start := v_snapshot_date - 30;
  v_sales_end := v_snapshot_date - 1;

  select not exists (
    select 1
    from public.stock_uploads
    where account_id=v_account_id
      and is_latest=true
      and snapshot_date>v_snapshot_date
  ) into v_make_latest;

  if v_make_latest then
    update public.stock_uploads
    set is_latest=false
    where account_id=v_account_id and is_latest=true;
  end if;

  insert into public.stock_uploads(
    account_id,snapshot_date,is_latest,file_name,sheet_name,sku_column,stock_columns,stock_mode,
    input_rows,unique_skus,duplicate_sku_rows,total_units
  ) values (
    v_account_id,
    v_snapshot_date,
    v_make_latest,
    coalesce(nullif(p_payload->>'file_name',''),'foodi.xlsx'),
    coalesce(nullif(p_payload->>'sheet_name',''),'Sheet1'),
    'SKU',
    array['Total Stock']::text[],
    'quantity',
    coalesce((p_payload->>'input_rows')::integer,0),
    jsonb_array_length(coalesce(p_payload->'rows','[]'::jsonb)),
    coalesce((p_payload->>'duplicate_sku_rows')::integer,0),
    coalesce((p_payload->>'total_units')::numeric,0)
  ) returning id into v_upload_id;

  insert into public.stock_rows(upload_id,account_sku,stock_qty)
  select
    v_upload_id,
    trim(x.account_sku),
    greatest(coalesce(x.stock_qty,0),0)
  from jsonb_to_recordset(coalesce(p_payload->'rows','[]'::jsonb))
    as x(account_sku text, stock_qty numeric)
  where nullif(trim(x.account_sku),'') is not null
  on conflict(upload_id,account_sku)
  do update set stock_qty=excluded.stock_qty;

  delete from public.foodi_stock_daily
  where stock_date=v_snapshot_date;

  insert into public.foodi_stock_daily(
    stock_date,account_sku,item_name,stock_qty,source_upload_id,updated_at
  )
  select
    v_snapshot_date,
    trim(x.account_sku),
    nullif(x.item_name,''),
    greatest(coalesce(x.stock_qty,0),0),
    v_upload_id,
    now()
  from jsonb_to_recordset(coalesce(p_payload->'stock_rows','[]'::jsonb))
    as x(account_sku text, item_name text, stock_qty numeric)
  where nullif(trim(x.account_sku),'') is not null;

  delete from public.foodi_sales_30d
  where stock_date=v_snapshot_date;

  insert into public.foodi_sales_30d(
    stock_date,period_start,period_end,account_sku,item_name,sold_qty,tp,mrp,selling_price,
    source_upload_id,updated_at
  )
  select
    v_snapshot_date,
    v_sales_start,
    v_sales_end,
    trim(x.account_sku),
    nullif(x.item_name,''),
    greatest(coalesce(x.sold_qty,0),0),
    x.tp,
    x.mrp,
    x.selling_price,
    v_upload_id,
    now()
  from jsonb_to_recordset(coalesce(p_payload->'sales_rows','[]'::jsonb))
    as x(
      stock_date text,
      period_start text,
      period_end text,
      account_sku text,
      item_name text,
      sold_qty numeric,
      tp numeric,
      mrp numeric,
      selling_price numeric
    )
  where nullif(trim(x.account_sku),'') is not null;

  delete from public.foodi_basepack_daily
  where stock_date=v_snapshot_date;

  insert into public.foodi_basepack_daily(
    stock_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,
    product_types,retail_types,variants,sku_count,stock_qty,is_available,source_upload_id
  )
  with scope as (
    select distinct
      p.basepack_id,
      b.packsize,
      pai.account_sku,
      p.id as product_id,
      p.brand,
      p.business_group,
      p.category,
      p.sub_category,
      p.product_type,
      p.retail_type,
      p.variant
    from public.product_account_ids pai
    join public.products p on p.id=pai.product_id and p.status='active'
    join public.basepacks b on b.id=p.basepack_id
    where pai.account_id=v_account_id
  ),
  meta as (
    select
      basepack_id,
      packsize,
      count(distinct product_id)::integer as sku_count,
      coalesce(array_agg(distinct brand order by brand) filter(where brand is not null),array[]::text[]) as brands,
      coalesce(array_agg(distinct business_group order by business_group) filter(where business_group is not null),array[]::text[]) as business_groups,
      coalesce(array_agg(distinct category order by category) filter(where category is not null),array[]::text[]) as categories,
      coalesce(array_agg(distinct sub_category order by sub_category) filter(where sub_category is not null),array[]::text[]) as sub_categories,
      coalesce(array_agg(distinct product_type order by product_type) filter(where product_type is not null),array[]::text[]) as product_types,
      coalesce(array_agg(distinct retail_type order by retail_type) filter(where retail_type is not null),array[]::text[]) as retail_types,
      coalesce(array_agg(distinct variant order by variant) filter(where variant is not null),array[]::text[]) as variants
    from scope
    group by basepack_id,packsize
  ),
  ids as (
    select distinct basepack_id,account_sku
    from scope
  )
  select
    v_snapshot_date,
    m.basepack_id,
    m.packsize,
    m.brands,
    m.business_groups,
    m.categories,
    m.sub_categories,
    m.product_types,
    m.retail_types,
    m.variants,
    m.sku_count,
    coalesce(sum(sd.stock_qty),0),
    coalesce(bool_or(sd.stock_qty>0),false),
    v_upload_id
  from meta m
  left join ids i on i.basepack_id=m.basepack_id
  left join public.foodi_stock_daily sd
    on sd.stock_date=v_snapshot_date
   and sd.account_sku=i.account_sku
  group by
    m.basepack_id,m.packsize,m.brands,m.business_groups,m.categories,m.sub_categories,
    m.product_types,m.retail_types,m.variants,m.sku_count;

  select count(*)::integer,
         count(*) filter(where is_available)::integer
    into v_expected,v_available
  from public.foodi_basepack_daily
  where stock_date=v_snapshot_date;

  v_pct := case
    when v_expected>0 then round(100.0*v_available/v_expected,2)
    else null
  end;

  select count(*)::integer into v_matched
  from public.stock_rows sr
  where sr.upload_id=v_upload_id
    and exists (
      select 1
      from public.product_account_ids pai
      where pai.account_id=v_account_id
        and pai.account_sku=sr.account_sku
    );

  select count(*)::integer into v_unmatched
  from public.stock_rows sr
  where sr.upload_id=v_upload_id
    and not exists (
      select 1
      from public.product_account_ids pai
      where pai.account_id=v_account_id
        and pai.account_sku=sr.account_sku
    );

  select
    count(*)::integer,
    count(*) filter(where sold_qty>0)::integer,
    coalesce(sum(sold_qty),0)
  into v_sales_skus,v_selling_skus,v_sold_qty
  from public.foodi_sales_30d
  where stock_date=v_snapshot_date;

  update public.stock_uploads
  set matched_input_ids=v_matched,
      unmatched_input_ids=v_unmatched,
      expected_basepacks=v_expected,
      available_basepacks=v_available,
      availability_pct=v_pct
  where id=v_upload_id;

  return jsonb_build_object(
    'success',true,
    'upload_id',v_upload_id,
    'stock_date',v_snapshot_date,
    'is_latest',v_make_latest,
    'expected_basepacks',v_expected,
    'available_basepacks',v_available,
    'unavailable_basepacks',greatest(v_expected-v_available,0),
    'availability_pct',v_pct,
    'matched_input_ids',v_matched,
    'unmatched_input_ids',v_unmatched,
    'sales_period_start',v_sales_start,
    'sales_period_end',v_sales_end,
    'sales_skus',v_sales_skus,
    'selling_skus',v_selling_skus,
    'sold_qty_30d',v_sold_qty
  );
end;
$$;

revoke execute on function public.commit_foodi_upload_v2(jsonb) from public,anon,authenticated;
grant execute on function public.commit_foodi_upload_v2(jsonb) to service_role;

create or replace view public.v_foodi_daily_ola
with (security_invoker=true) as
select
  stock_date,
  count(*)::integer as expected_basepacks,
  count(*) filter(where is_available)::integer as available_basepacks,
  count(*) filter(where not is_available)::integer as unavailable_basepacks,
  round(100.0*count(*) filter(where is_available)/nullif(count(*),0),2) as ola_pct,
  coalesce(sum(stock_qty),0)::numeric(18,4) as total_stock
from public.foodi_basepack_daily
group by stock_date;

create or replace view public.v_foodi_monthly_ola
with (security_invoker=true) as
select
  date_trunc('month',stock_date)::date as month_start,
  count(*)::integer as days_with_data,
  round(avg(ola_pct),2) as avg_ola_pct,
  min(ola_pct) as min_ola_pct,
  max(ola_pct) as max_ola_pct,
  min(stock_date) as first_stock_date,
  max(stock_date) as last_stock_date
from public.v_foodi_daily_ola
group by date_trunc('month',stock_date)::date;

create or replace view public.v_foodi_sales_30d_summary
with (security_invoker=true) as
select
  stock_date,
  min(period_start) as period_start,
  max(period_end) as period_end,
  count(*)::integer as sku_rows,
  count(*) filter(where sold_qty>0)::integer as selling_skus,
  coalesce(sum(sold_qty),0)::numeric(18,4) as sold_qty
from public.foodi_sales_30d
group by stock_date;

create or replace view public.v_foodi_current_basepacks
with (security_invoker=true) as
with latest as (
  select max(stock_date) as stock_date
  from public.foodi_basepack_daily
),
sales_by_basepack as (
  select
    s.stock_date,
    p.basepack_id,
    coalesce(sum(s.sold_qty),0)::numeric(18,4) as sold_qty_30d
  from public.foodi_sales_30d s
  join public.accounts a on a.code='foodi'
  join public.product_account_ids pai
    on pai.account_id=a.id and pai.account_sku=s.account_sku
  join public.products p
    on p.id=pai.product_id and p.status='active'
  group by s.stock_date,p.basepack_id
)
select d.*, coalesce(sb.sold_qty_30d,0)::numeric(18,4) as sold_qty_30d
from public.foodi_basepack_daily d
join latest l on l.stock_date=d.stock_date
left join sales_by_basepack sb
  on sb.stock_date=d.stock_date and sb.basepack_id=d.basepack_id;

revoke all on public.v_foodi_daily_ola, public.v_foodi_monthly_ola,
  public.v_foodi_sales_30d_summary, public.v_foodi_current_basepacks
  from anon,authenticated;
grant select on public.v_foodi_daily_ola, public.v_foodi_monthly_ola,
  public.v_foodi_sales_30d_summary, public.v_foodi_current_basepacks
  to service_role;

commit;
