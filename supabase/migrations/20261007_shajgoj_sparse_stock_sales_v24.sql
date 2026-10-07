-- UBL Availability V2.4 — Shajgoj sparse stock + cumulative sales history
--
-- Shajgoj daily files are not guaranteed to arrive every calendar day.
-- We therefore preserve only observed stock dates and never forward-fill missing stock.
-- For a selected stock date X, the month-to-date sales column is cumulative from
-- day 1 through X-1. Historical completed month sheets are stored as cumulative
-- monthly sales snapshots but are not treated as dated stock/OLA observations.

begin;

create table if not exists public.shajgoj_stock_daily (
  stock_date date not null,
  account_sku text not null,
  item_name text,
  stock_qty numeric(18,4) not null default 0,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (stock_date, account_sku)
);
create index if not exists idx_shajgoj_stock_daily_sku_date
  on public.shajgoj_stock_daily(account_sku, stock_date desc);
create index if not exists idx_shajgoj_stock_daily_upload
  on public.shajgoj_stock_daily(source_upload_id);

create table if not exists public.shajgoj_sales_cumulative (
  period_start date not null,
  period_end date not null,
  account_sku text not null,
  item_name text,
  sold_qty numeric(18,4) not null default 0,
  sales_value numeric(18,4) not null default 0,
  source_sheet text not null,
  is_complete_month boolean not null default false,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (period_end, account_sku)
);
create index if not exists idx_shajgoj_sales_cumulative_sku_period
  on public.shajgoj_sales_cumulative(account_sku, period_end desc);
create index if not exists idx_shajgoj_sales_cumulative_month
  on public.shajgoj_sales_cumulative(period_start, period_end desc);
create index if not exists idx_shajgoj_sales_cumulative_upload
  on public.shajgoj_sales_cumulative(source_upload_id);

create table if not exists public.shajgoj_basepack_daily (
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
create index if not exists idx_shajgoj_basepack_daily_date
  on public.shajgoj_basepack_daily(stock_date desc);
create index if not exists idx_shajgoj_basepack_daily_basepack
  on public.shajgoj_basepack_daily(basepack_id);
create index if not exists idx_shajgoj_basepack_daily_upload
  on public.shajgoj_basepack_daily(source_upload_id);

alter table public.shajgoj_stock_daily enable row level security;
alter table public.shajgoj_sales_cumulative enable row level security;
alter table public.shajgoj_basepack_daily enable row level security;

revoke all on public.shajgoj_stock_daily, public.shajgoj_sales_cumulative,
  public.shajgoj_basepack_daily from anon, authenticated;
grant select,insert,update,delete on public.shajgoj_stock_daily, public.shajgoj_sales_cumulative,
  public.shajgoj_basepack_daily to service_role;

create or replace function public.commit_shajgoj_upload_v2(p_payload jsonb)
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
  v_mtd_start date;
  v_mtd_end date;
  v_mtd_sold numeric(18,4) := 0;
  v_mtd_value numeric(18,4) := 0;
begin
  select id into v_account_id
  from public.accounts
  where code='shajgoj' and active=true;

  if v_account_id is null then
    raise exception 'Shajgoj account is not configured';
  end if;

  v_snapshot_date := nullif(p_payload->>'snapshot_date','')::date;
  if v_snapshot_date is null then
    raise exception 'snapshot_date is required';
  end if;

  -- Historical backfills remain historical. An older date must never replace a
  -- newer current snapshot simply because it was uploaded later.
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
    coalesce(nullif(p_payload->>'file_name',''),'shajgoj.xlsx'),
    coalesce(nullif(p_payload->>'sheet_name',''),'Shajgoj stock dump'),
    'SKU',
    array['Total Stock QTY']::text[],
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

  -- Same-date re-upload corrects only that date. Other observed days remain.
  delete from public.shajgoj_stock_daily
  where stock_date=v_snapshot_date;

  insert into public.shajgoj_stock_daily(
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

  -- Each cumulative period has one canonical state. A repeated period is a
  -- correction/refresh, while different period_end values coexist as history.
  delete from public.shajgoj_sales_cumulative s
  where s.period_end in (
    select distinct x.period_end::date
    from jsonb_to_recordset(coalesce(p_payload->'sales_rows','[]'::jsonb))
      as x(period_end text)
    where nullif(x.period_end,'') is not null
  );

  insert into public.shajgoj_sales_cumulative(
    period_start,period_end,account_sku,item_name,sold_qty,sales_value,
    source_sheet,is_complete_month,source_upload_id,updated_at
  )
  select
    x.period_start::date,
    x.period_end::date,
    trim(x.account_sku),
    nullif(x.item_name,''),
    greatest(coalesce(x.sold_qty,0),0),
    greatest(coalesce(x.sales_value,0),0),
    coalesce(nullif(x.source_sheet,''),'Unknown sheet'),
    coalesce(x.is_complete_month,false),
    v_upload_id,
    now()
  from jsonb_to_recordset(coalesce(p_payload->'sales_rows','[]'::jsonb))
    as x(
      period_start text,
      period_end text,
      account_sku text,
      item_name text,
      sold_qty numeric,
      sales_value numeric,
      source_sheet text,
      is_complete_month boolean
    )
  where nullif(trim(x.account_sku),'') is not null
    and nullif(x.period_start,'') is not null
    and nullif(x.period_end,'') is not null;

  -- Freeze the basepack+filter metadata for this observed stock date so a later
  -- master revision cannot silently rewrite historical OLA.
  delete from public.shajgoj_basepack_daily
  where stock_date=v_snapshot_date;

  insert into public.shajgoj_basepack_daily(
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
  left join public.shajgoj_stock_daily sd
    on sd.stock_date=v_snapshot_date
   and sd.account_sku=i.account_sku
  group by
    m.basepack_id,m.packsize,m.brands,m.business_groups,m.categories,m.sub_categories,
    m.product_types,m.retail_types,m.variants,m.sku_count;

  select count(*)::integer,
         count(*) filter(where is_available)::integer
    into v_expected,v_available
  from public.shajgoj_basepack_daily
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

  update public.stock_uploads
  set matched_input_ids=v_matched,
      unmatched_input_ids=v_unmatched,
      expected_basepacks=v_expected,
      available_basepacks=v_available,
      availability_pct=v_pct
  where id=v_upload_id;

  v_mtd_start := date_trunc('month',v_snapshot_date)::date;
  v_mtd_end := v_snapshot_date - 1;

  select
    coalesce(sum(sold_qty),0),
    coalesce(sum(sales_value),0)
  into v_mtd_sold,v_mtd_value
  from public.shajgoj_sales_cumulative
  where period_start=v_mtd_start
    and period_end=v_mtd_end;

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
    'mtd_period_start',v_mtd_start,
    'mtd_period_end',v_mtd_end,
    'mtd_sold_qty',v_mtd_sold,
    'mtd_sales_value',v_mtd_value
  );
end;
$$;

revoke execute on function public.commit_shajgoj_upload_v2(jsonb) from public,anon,authenticated;
grant execute on function public.commit_shajgoj_upload_v2(jsonb) to service_role;

create or replace view public.v_shajgoj_daily_ola
with (security_invoker=true) as
select
  stock_date,
  count(*)::integer as expected_basepacks,
  count(*) filter(where is_available)::integer as available_basepacks,
  count(*) filter(where not is_available)::integer as unavailable_basepacks,
  round(100.0*count(*) filter(where is_available)/nullif(count(*),0),2) as ola_pct,
  coalesce(sum(stock_qty),0)::numeric(18,4) as total_stock
from public.shajgoj_basepack_daily
group by stock_date;

create or replace view public.v_shajgoj_monthly_ola
with (security_invoker=true) as
select
  date_trunc('month',stock_date)::date as month_start,
  count(*)::integer as days_with_data,
  round(avg(ola_pct),2) as avg_ola_pct,
  min(ola_pct) as min_ola_pct,
  max(ola_pct) as max_ola_pct,
  min(stock_date) as first_stock_date,
  max(stock_date) as last_stock_date
from public.v_shajgoj_daily_ola
group by date_trunc('month',stock_date)::date;

create or replace view public.v_shajgoj_current_basepacks
with (security_invoker=true) as
select d.*
from public.shajgoj_basepack_daily d
where d.stock_date=(
  select max(stock_date)
  from public.shajgoj_basepack_daily
);

create or replace view public.v_shajgoj_sales_snapshot_summary
with (security_invoker=true) as
select
  period_start,
  period_end,
  bool_or(is_complete_month) as is_complete_month,
  count(*)::integer as sku_rows,
  count(*) filter(where sold_qty>0)::integer as selling_skus,
  coalesce(sum(sold_qty),0)::numeric(18,4) as sold_qty,
  coalesce(sum(sales_value),0)::numeric(18,4) as sales_value
from public.shajgoj_sales_cumulative
group by period_start,period_end;

create or replace view public.v_shajgoj_monthly_sales
with (security_invoker=true) as
with ranked as (
  select
    s.*,
    row_number() over(
      partition by date_trunc('month',period_start)::date
      order by period_end desc
    ) as rn
  from public.v_shajgoj_sales_snapshot_summary s
)
select
  date_trunc('month',period_start)::date as month_start,
  period_start,
  period_end,
  is_complete_month,
  sku_rows,
  selling_skus,
  sold_qty,
  sales_value
from ranked
where rn=1;

revoke all on public.v_shajgoj_daily_ola, public.v_shajgoj_monthly_ola,
  public.v_shajgoj_current_basepacks, public.v_shajgoj_sales_snapshot_summary,
  public.v_shajgoj_monthly_sales from anon,authenticated;
grant select on public.v_shajgoj_daily_ola, public.v_shajgoj_monthly_ola,
  public.v_shajgoj_current_basepacks, public.v_shajgoj_sales_snapshot_summary,
  public.v_shajgoj_monthly_sales to service_role;

commit;
