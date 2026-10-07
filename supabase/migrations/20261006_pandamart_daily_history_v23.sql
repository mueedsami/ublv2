-- Pandamart V2.3: daily branch stock + daily sales + historical OLA

create table if not exists public.pandamart_branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 100,
  is_dc boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.pandamart_branches(code,name,sort_order,is_dc,active) values
  ('Bashundhara','Bashundhara',1,false,true),
  ('Dhanmondi','Dhanmondi',2,false,true),
  ('Gulshan_1','Gulshan 1',3,false,true),
  ('Gulshan_2','Gulshan 2',4,false,true),
  ('Uttara','Uttara',5,false,true),
  ('Mohammadpur','Mohammadpur',6,false,true),
  ('Mirpur_02','Mirpur 02',7,false,true),
  ('Mirpur_03','Mirpur 03',8,false,true),
  ('Chittagong_1','Chittagong 1',9,false,true),
  ('Wari','Wari',10,false,true),
  ('Rampura','Rampura',11,false,true),
  ('Sylhet_2','Sylhet 2',12,false,true),
  ('Mogbazar','Mogbazar',13,false,true),
  ('Khulna','Khulna',14,false,true),
  ('Rajshahi','Rajshahi',15,false,true),
  ('Lalbagh','Lalbagh',16,false,true),
  ('DC','Central DC',99,true,true)
on conflict(code) do update set
  name=excluded.name,
  sort_order=excluded.sort_order,
  is_dc=excluded.is_dc,
  active=excluded.active;

create table if not exists public.pandamart_stock_daily (
  stock_date date not null,
  account_sku text not null,
  branch_id uuid not null references public.pandamart_branches(id) on delete restrict,
  stock_qty numeric(18,4) not null default 0,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(stock_date, account_sku, branch_id)
);
create index if not exists idx_pandamart_stock_daily_sku_date
  on public.pandamart_stock_daily(account_sku, stock_date desc);
create index if not exists idx_pandamart_stock_daily_branch_date
  on public.pandamart_stock_daily(branch_id, stock_date desc);
create index if not exists idx_pandamart_stock_daily_upload
  on public.pandamart_stock_daily(source_upload_id);

create table if not exists public.pandamart_sales_daily (
  sale_date date not null,
  account_sku text not null,
  item_name text,
  gfv_local numeric(18,4) not null default 0,
  sold_qty numeric(18,4) not null default 0,
  source_upload_id uuid references public.stock_uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(sale_date, account_sku)
);
create index if not exists idx_pandamart_sales_daily_sku_date
  on public.pandamart_sales_daily(account_sku, sale_date desc);
create index if not exists idx_pandamart_sales_daily_date
  on public.pandamart_sales_daily(sale_date desc);
create index if not exists idx_pandamart_sales_daily_upload
  on public.pandamart_sales_daily(source_upload_id);

-- Frozen basepack x branch snapshot. Text metadata is copied at upload time so
-- historical OLA does not change when a future master file changes.
create table if not exists public.pandamart_basepack_daily (
  stock_date date not null,
  branch_id uuid not null references public.pandamart_branches(id) on delete restrict,
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
  primary key(stock_date, branch_id, packsize)
);
create index if not exists idx_pandamart_basepack_daily_date
  on public.pandamart_basepack_daily(stock_date desc);
create index if not exists idx_pandamart_basepack_daily_branch_date
  on public.pandamart_basepack_daily(branch_id, stock_date desc);
create index if not exists idx_pandamart_basepack_daily_basepack
  on public.pandamart_basepack_daily(basepack_id);
create index if not exists idx_pandamart_basepack_daily_upload
  on public.pandamart_basepack_daily(source_upload_id);

alter table public.pandamart_branches enable row level security;
alter table public.pandamart_stock_daily enable row level security;
alter table public.pandamart_sales_daily enable row level security;
alter table public.pandamart_basepack_daily enable row level security;

revoke all on public.pandamart_branches, public.pandamart_stock_daily,
  public.pandamart_sales_daily, public.pandamart_basepack_daily
from anon, authenticated;
grant select,insert,update,delete on public.pandamart_branches, public.pandamart_stock_daily,
  public.pandamart_sales_daily, public.pandamart_basepack_daily
to service_role;

create or replace function public.commit_pandamart_upload_v2(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id uuid;
  v_upload_id uuid;
  v_row jsonb;
  v_branch_id uuid;
  v_snapshot_date date;
  v_expected integer := 0;
  v_network_available integer := 0;
  v_network_pct numeric(7,2);
  v_available_cells integer := 0;
  v_total_cells integer := 0;
  v_branch_ola numeric(7,2);
  v_matched integer := 0;
  v_unmatched integer := 0;
  v_make_latest boolean := true;
begin
  select id into v_account_id from public.accounts where code='pandamart' and active=true;
  if v_account_id is null then raise exception 'Pandamart account is not configured'; end if;
  v_snapshot_date := nullif(p_payload->>'snapshot_date','')::date;
  if v_snapshot_date is null then raise exception 'snapshot_date is required'; end if;

  select not exists (
    select 1 from public.stock_uploads
    where account_id=v_account_id and is_latest=true and snapshot_date>v_snapshot_date
  ) into v_make_latest;

  if v_make_latest then
    update public.stock_uploads set is_latest=false
    where account_id=v_account_id and is_latest=true;
  end if;

  insert into public.stock_uploads(
    account_id,snapshot_date,is_latest,file_name,sheet_name,sku_column,stock_columns,stock_mode,
    input_rows,unique_skus,duplicate_sku_rows,total_units
  ) values (
    v_account_id,
    v_snapshot_date,
    v_make_latest,
    coalesce(nullif(p_payload->>'file_name',''),'pandamart.xlsx'),
    coalesce(nullif(p_payload->>'sheet_name',''),'Store Wise Stock T-1 Day'),
    'sku',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'stock_columns','[]'::jsonb))),array[]::text[]),
    'quantity',
    coalesce((p_payload->>'input_rows')::integer,0),
    jsonb_array_length(coalesce(p_payload->'rows','[]'::jsonb)),
    coalesce((p_payload->>'duplicate_sku_rows')::integer,0),
    coalesce((p_payload->>'total_units')::numeric,0)
  ) returning id into v_upload_id;

  -- Compatibility/current-account rows: customer-facing store total per SKU, DC excluded.
  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) loop
    if nullif(trim(v_row->>'account_sku'),'') is null then continue; end if;
    insert into public.stock_rows(upload_id,account_sku,stock_qty)
    values(v_upload_id,trim(v_row->>'account_sku'),greatest(coalesce((v_row->>'stock_qty')::numeric,0),0))
    on conflict(upload_id,account_sku) do update set stock_qty=excluded.stock_qty;
  end loop;

  -- A corrected upload for the same stock date replaces that exact day's raw stock snapshot.
  delete from public.pandamart_stock_daily where stock_date=v_snapshot_date;
  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'branch_stock','[]'::jsonb)) loop
    select id into v_branch_id from public.pandamart_branches
    where code=v_row->>'branch_code' and active=true;
    if v_branch_id is null or nullif(trim(v_row->>'account_sku'),'') is null then continue; end if;
    insert into public.pandamart_stock_daily(stock_date,account_sku,branch_id,stock_qty,source_upload_id)
    values(
      v_snapshot_date,
      trim(v_row->>'account_sku'),
      v_branch_id,
      greatest(coalesce((v_row->>'stock_qty')::numeric,0),0),
      v_upload_id
    );
  end loop;

  -- Rolling sales sheets overlap from one daily workbook to the next. Replace only the
  -- dates present in this workbook, then insert their latest values.
  delete from public.pandamart_sales_daily
  where sale_date in (
    select distinct nullif(x->>'sale_date','')::date
    from jsonb_array_elements(coalesce(p_payload->'sales','[]'::jsonb)) x
    where nullif(x->>'sale_date','') is not null
  );

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'sales','[]'::jsonb)) loop
    if nullif(trim(v_row->>'account_sku'),'') is null or nullif(v_row->>'sale_date','') is null then continue; end if;
    insert into public.pandamart_sales_daily(
      sale_date,account_sku,item_name,gfv_local,sold_qty,source_upload_id
    ) values (
      (v_row->>'sale_date')::date,
      trim(v_row->>'account_sku'),
      nullif(v_row->>'item_name',''),
      coalesce((v_row->>'gfv_local')::numeric,0),
      coalesce((v_row->>'sold_qty')::numeric,0),
      v_upload_id
    );
  end loop;

  -- Freeze the current master scope into a basepack x branch daily status snapshot.
  delete from public.pandamart_basepack_daily where stock_date=v_snapshot_date;

  insert into public.pandamart_basepack_daily(
    stock_date,branch_id,basepack_id,packsize,brands,business_groups,categories,sub_categories,
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
    select distinct basepack_id,account_sku from scope
  )
  select
    v_snapshot_date,
    br.id,
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
  cross join public.pandamart_branches br
  left join ids i on i.basepack_id=m.basepack_id
  left join public.pandamart_stock_daily sd
    on sd.stock_date=v_snapshot_date
   and sd.branch_id=br.id
   and sd.account_sku=i.account_sku
  where br.active=true and br.is_dc=false
  group by br.id,m.basepack_id,m.packsize,m.brands,m.business_groups,m.categories,m.sub_categories,
    m.product_types,m.retail_types,m.variants,m.sku_count;

  select count(distinct basepack_id)::integer into v_expected
  from public.pandamart_basepack_daily where stock_date=v_snapshot_date;

  select count(*) filter(where is_available)::integer, count(*)::integer
  into v_available_cells,v_total_cells
  from public.pandamart_basepack_daily where stock_date=v_snapshot_date;

  select count(*)::integer into v_network_available
  from (
    select packsize
    from public.pandamart_basepack_daily
    where stock_date=v_snapshot_date
    group by packsize
    having bool_or(is_available)
  ) q;

  v_branch_ola := case when v_total_cells>0 then round(100.0*v_available_cells/v_total_cells,2) else null end;
  v_network_pct := case when v_expected>0 then round(100.0*v_network_available/v_expected,2) else null end;

  select count(*)::integer into v_matched
  from public.stock_rows sr
  where sr.upload_id=v_upload_id
    and exists(select 1 from public.product_account_ids pai where pai.account_id=v_account_id and pai.account_sku=sr.account_sku);
  select count(*)::integer into v_unmatched
  from public.stock_rows sr
  where sr.upload_id=v_upload_id
    and not exists(select 1 from public.product_account_ids pai where pai.account_id=v_account_id and pai.account_sku=sr.account_sku);

  update public.stock_uploads
  set matched_input_ids=v_matched,
      unmatched_input_ids=v_unmatched,
      expected_basepacks=v_expected,
      available_basepacks=v_network_available,
      availability_pct=v_network_pct
  where id=v_upload_id;

  return jsonb_build_object(
    'success',true,
    'upload_id',v_upload_id,
    'stock_date',v_snapshot_date,
    'expected_basepacks',v_expected,
    'network_available_basepacks',v_network_available,
    'network_coverage_pct',v_network_pct,
    'available_branch_cells',v_available_cells,
    'total_branch_cells',v_total_cells,
    'branch_ola_pct',v_branch_ola,
    'matched_input_ids',v_matched,
    'unmatched_input_ids',v_unmatched,
    'sales_rows',jsonb_array_length(coalesce(p_payload->'sales','[]'::jsonb))
  );
end;
$$;

revoke execute on function public.commit_pandamart_upload_v2(jsonb) from public, anon, authenticated;
grant execute on function public.commit_pandamart_upload_v2(jsonb) to service_role;

create or replace view public.v_pandamart_daily_ola
with (security_invoker=true) as
with branch_rows as (
  select
    d.stock_date,
    'branch'::text as scope,
    b.code as branch_code,
    b.name as branch_name,
    b.sort_order,
    count(*)::integer as expected_basepacks,
    count(*) filter(where d.is_available)::integer as available_basepacks,
    count(*) filter(where not d.is_available)::integer as unavailable_basepacks,
    round(100.0*count(*) filter(where d.is_available)/nullif(count(*),0),2) as ola_pct
  from public.pandamart_basepack_daily d
  join public.pandamart_branches b on b.id=d.branch_id
  group by d.stock_date,b.code,b.name,b.sort_order
), overall_rows as (
  select
    d.stock_date,
    'overall'::text as scope,
    null::text as branch_code,
    'All branches'::text as branch_name,
    0 as sort_order,
    count(*)::integer as expected_basepacks,
    count(*) filter(where d.is_available)::integer as available_basepacks,
    count(*) filter(where not d.is_available)::integer as unavailable_basepacks,
    round(100.0*count(*) filter(where d.is_available)/nullif(count(*),0),2) as ola_pct
  from public.pandamart_basepack_daily d
  group by d.stock_date
)
select * from overall_rows
union all
select * from branch_rows;

create or replace view public.v_pandamart_monthly_ola
with (security_invoker=true) as
select
  date_trunc('month',stock_date)::date as month_start,
  count(*)::integer as days_with_data,
  round(avg(ola_pct),2) as avg_ola_pct,
  min(ola_pct) as min_ola_pct,
  max(ola_pct) as max_ola_pct,
  min(stock_date) as first_stock_date,
  max(stock_date) as last_stock_date
from public.v_pandamart_daily_ola
where scope='overall'
group by date_trunc('month',stock_date)::date;

create or replace view public.v_pandamart_latest_branch_ola
with (security_invoker=true) as
select d.*
from public.v_pandamart_daily_ola d
where d.stock_date=(select max(stock_date) from public.pandamart_basepack_daily);

create or replace view public.v_pandamart_sales_30d
with (security_invoker=true) as
with latest_date as (
  select max(sale_date) as max_date from public.pandamart_sales_daily
)
select
  s.account_sku,
  max(s.item_name) as item_name,
  sum(s.sold_qty)::numeric(18,4) as sold_qty_30d,
  sum(s.gfv_local)::numeric(18,4) as gfv_30d,
  min(s.sale_date) as first_sale_date,
  max(s.sale_date) as last_sale_date,
  count(distinct s.sale_date)::integer as days_present
from public.pandamart_sales_daily s
cross join latest_date l
where l.max_date is not null and s.sale_date between l.max_date-29 and l.max_date
group by s.account_sku;

revoke all on public.v_pandamart_daily_ola, public.v_pandamart_monthly_ola,
  public.v_pandamart_latest_branch_ola, public.v_pandamart_sales_30d
from anon,authenticated;
grant select on public.v_pandamart_daily_ola, public.v_pandamart_monthly_ola,
  public.v_pandamart_latest_branch_ola, public.v_pandamart_sales_30d
to service_role;
create or replace view public.v_pandamart_daily_summary
with (security_invoker=true) as
with daily_cells as (
  select
    stock_date,
    count(distinct branch_id)::integer as branch_count,
    count(distinct packsize)::integer as expected_basepacks,
    count(*)::integer as total_branch_cells,
    count(*) filter(where is_available)::integer as available_branch_cells
  from public.pandamart_basepack_daily
  group by stock_date
), network as (
  select
    stock_date,
    count(*)::integer as expected_basepacks,
    count(*) filter(where available_any)::integer as network_available_basepacks
  from (
    select stock_date, packsize, bool_or(is_available) as available_any
    from public.pandamart_basepack_daily
    group by stock_date, packsize
  ) x
  group by stock_date
)
select
  d.stock_date,
  d.branch_count,
  d.expected_basepacks,
  n.network_available_basepacks,
  (d.expected_basepacks - n.network_available_basepacks)::integer as network_unavailable_basepacks,
  round(100.0*n.network_available_basepacks/nullif(d.expected_basepacks,0),2) as network_coverage_pct,
  d.available_branch_cells,
  (d.total_branch_cells-d.available_branch_cells)::integer as unavailable_branch_cells,
  d.total_branch_cells,
  round(100.0*d.available_branch_cells/nullif(d.total_branch_cells,0),2) as branch_ola_pct
from daily_cells d
join network n using(stock_date);

create or replace view public.v_pandamart_monthly_ola
with (security_invoker=true) as
select
  date_trunc('month',stock_date)::date as month_start,
  count(*)::integer as days_with_data,
  round(avg(branch_ola_pct),2) as avg_ola_pct,
  min(branch_ola_pct) as min_ola_pct,
  max(branch_ola_pct) as max_ola_pct,
  min(stock_date) as first_stock_date,
  max(stock_date) as last_stock_date,
  round(avg(network_coverage_pct),2) as avg_network_coverage_pct
from public.v_pandamart_daily_summary
group by date_trunc('month',stock_date)::date;

create or replace view public.v_pandamart_flags
with (security_invoker=true) as
with panda as (
  select id as account_id from public.accounts where code='pandamart' and active=true
), latest_stock as (
  select max(stock_date) as stock_date from public.pandamart_stock_daily
), sales_bounds as (
  select max(sale_date) as max_date, min(sale_date) as min_date from public.pandamart_sales_daily
), sales_window as (
  select
    max_date,
    case when max_date is null then null else greatest(min_date, max_date-29) end as start_date,
    case when max_date is null then 0 else (max_date-greatest(min_date,max_date-29)+1) end::integer as history_days
  from sales_bounds
), scope as (
  select distinct
    p.basepack_id,
    b.packsize,
    pai.account_sku
  from public.product_account_ids pai
  join panda pa on pa.account_id=pai.account_id
  join public.products p on p.id=pai.product_id and p.status='active'
  join public.basepacks b on b.id=p.basepack_id
), stock as (
  select
    s.basepack_id,
    s.packsize,
    coalesce(sum(case when br.is_dc=false then sd.stock_qty else 0 end),0)::numeric(18,4) as store_stock,
    coalesce(sum(case when br.is_dc=true then sd.stock_qty else 0 end),0)::numeric(18,4) as dc_stock,
    count(distinct case when br.is_dc=false and sd.stock_qty>0 then br.id end)::integer as stocked_branches
  from scope s
  cross join latest_stock l
  left join public.pandamart_stock_daily sd
    on sd.stock_date=l.stock_date and sd.account_sku=s.account_sku
  left join public.pandamart_branches br on br.id=sd.branch_id
  group by s.basepack_id,s.packsize
), sales as (
  select
    s.basepack_id,
    coalesce(sum(case when sw.max_date is not null and d.sale_date between sw.start_date and sw.max_date then d.sold_qty else 0 end),0)::numeric(18,4) as sold_qty_30d,
    coalesce(sum(case when sw.max_date is not null and d.sale_date between sw.max_date-14 and sw.max_date then d.sold_qty else 0 end),0)::numeric(18,4) as recent_15d,
    coalesce(sum(case when sw.max_date is not null and d.sale_date between sw.max_date-29 and sw.max_date-15 then d.sold_qty else 0 end),0)::numeric(18,4) as prior_15d,
    max(sw.history_days)::integer as history_days
  from scope s
  cross join sales_window sw
  left join public.pandamart_sales_daily d on d.account_sku=s.account_sku
  group by s.basepack_id
), metrics as (
  select
    st.basepack_id,
    st.packsize,
    l.stock_date,
    st.store_stock,
    st.dc_stock,
    st.stocked_branches,
    coalesce(sa.sold_qty_30d,0) as sold_qty_30d,
    coalesce(sa.recent_15d,0) as recent_15d,
    coalesce(sa.prior_15d,0) as prior_15d,
    coalesce(sa.history_days,0) as history_days,
    case when coalesce(sa.history_days,0)>0 then coalesce(sa.sold_qty_30d,0)/sa.history_days else 0 end as daily_rate,
    case
      when coalesce(sa.sold_qty_30d,0)<=0 then null
      when st.store_stock<=0 then 0
      else st.store_stock/(coalesce(sa.sold_qty_30d,0)/nullif(sa.history_days,0))
    end as days_of_cover
  from stock st
  cross join latest_stock l
  left join sales sa on sa.basepack_id=st.basepack_id
  where l.stock_date is not null
), basepack_flags as (
  select
    'stockout_risk'::text as flag_type,
    case when store_stock<=0 or days_of_cover<=3 then 'critical' else 'warning' end::text as severity,
    'basepack'::text as entity_type,
    basepack_id::text as entity_key,
    packsize as entity_name,
    stock_date,
    jsonb_build_object('store_stock',store_stock,'dc_stock',dc_stock,'sold_qty_30d',sold_qty_30d,'history_days',history_days,'days_of_cover',round(days_of_cover,1),'stocked_branches',stocked_branches) as metrics,
    'Stockout risk'::text as title,
    case when store_stock<=0 then 'Recent sales exist but customer-facing branch stock is zero.'
         else 'Current customer-facing stock has 7 days of cover or less.' end::text as message
  from metrics
  where sold_qty_30d>0 and (store_stock<=0 or days_of_cover<=7)

  union all
  select
    'distribution_imbalance',
    case when stocked_branches<=1 then 'critical' else 'warning' end,
    'basepack',basepack_id::text,packsize,stock_date,
    jsonb_build_object('store_stock',store_stock,'dc_stock',dc_stock,'stocked_branches',stocked_branches,'sold_qty_30d',sold_qty_30d),
    'Distribution imbalance',
    'Stock is available in three or fewer customer-facing branches.'
  from metrics
  where store_stock>0 and stocked_branches<=3

  union all
  select
    'dc_stuck','critical','basepack',basepack_id::text,packsize,stock_date,
    jsonb_build_object('store_stock',store_stock,'dc_stock',dc_stock,'stocked_branches',stocked_branches,'sold_qty_30d',sold_qty_30d),
    'DC-stuck stock',
    'Stock exists in DC while all customer-facing branches are out of stock.'
  from metrics
  where dc_stock>0 and store_stock=0

  union all
  select
    'dead_stock',case when sold_qty_30d>0 then 'critical' else 'warning' end,
    'basepack',basepack_id::text,packsize,stock_date,
    jsonb_build_object('store_stock',store_stock,'dc_stock',dc_stock,'sold_qty_30d',sold_qty_30d,'history_days',history_days),
    'Zero network stock',
    'No stock exists in customer-facing branches or DC.'
  from metrics
  where store_stock=0 and dc_stock=0

  union all
  select
    'sales_decline',case when recent_15d<=prior_15d*0.5 then 'critical' else 'warning' end,
    'basepack',basepack_id::text,packsize,stock_date,
    jsonb_build_object('recent_15d',recent_15d,'prior_15d',prior_15d,'drop_pct',round(100.0*(prior_15d-recent_15d)/nullif(prior_15d,0),1),'history_days',history_days),
    'Sales decline',
    'Recent 15-day sales are at least 30% below the prior 15 days.'
  from metrics
  where history_days>=30 and prior_15d>0 and recent_15d < prior_15d*0.7
), store_flags as (
  select
    'store_health'::text as flag_type,
    case when ola_pct<50 then 'critical' else 'warning' end::text as severity,
    'branch'::text as entity_type,
    branch_code as entity_key,
    branch_name as entity_name,
    stock_date,
    jsonb_build_object('ola_pct',ola_pct,'available_basepacks',available_basepacks,'unavailable_basepacks',unavailable_basepacks,'expected_basepacks',expected_basepacks) as metrics,
    'Store health'::text as title,
    'Branch OLA is below 65%.'::text as message
  from public.v_pandamart_latest_branch_ola
  where scope='branch' and ola_pct<65
)
select * from basepack_flags
union all
select * from store_flags;

revoke all on public.v_pandamart_daily_summary, public.v_pandamart_flags from anon,authenticated;
grant select on public.v_pandamart_daily_summary, public.v_pandamart_flags to service_role;
