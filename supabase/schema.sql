-- UBL Availability V2.1
-- Simple architecture: Master -> Daily Stock -> Basepack Availability
-- Packsize is the basepack. UBL Code is the SKU/product under that basepack.

begin;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  master_column text not null unique,
  sort_order integer not null default 100,
  active boolean not null default true
);

create table if not exists public.basepacks (
  id uuid primary key default gen_random_uuid(),
  packsize text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  basepack_id uuid not null references public.basepacks(id) on delete restrict,
  ubl_code text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active','inactive')),
  brand text,
  tp numeric(14,4),
  mrp numeric(14,4),
  sku_label text,
  weight_type text,
  weight numeric(14,4),
  business_group text,
  product_type text,
  retail_type text,
  category text,
  sub_category text,
  variant text,
  description text,
  highlights text,
  hero_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_basepack on public.products(basepack_id);
create index if not exists idx_products_business_group on public.products(business_group);
create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_sub_category on public.products(sub_category);
create index if not exists idx_products_brand on public.products(brand);
create index if not exists idx_products_product_type on public.products(product_type);
create index if not exists idx_products_retail_type on public.products(retail_type);
create index if not exists idx_products_variant on public.products(variant);

create table if not exists public.product_account_ids (
  product_id uuid not null references public.products(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  account_sku text not null,
  created_at timestamptz not null default now(),
  primary key (product_id, account_id, account_sku)
);

create index if not exists idx_product_account_ids_lookup on public.product_account_ids(account_id, account_sku);
create index if not exists idx_product_account_ids_product on public.product_account_ids(product_id, account_id);

create table if not exists public.master_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  sheet_name text,
  row_count integer not null,
  basepack_count integer not null default 0,
  active_count integer not null,
  inactive_count integer not null,
  mapping_count integer not null,
  imported_at timestamptz not null default now()
);

create table if not exists public.stock_uploads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  snapshot_date date not null,
  is_latest boolean not null default true,
  file_name text not null,
  sheet_name text not null,
  sku_column text not null,
  stock_columns text[] not null default '{}',
  stock_mode text not null default 'quantity' check (stock_mode in ('quantity','availability')),
  input_rows integer not null default 0,
  unique_skus integer not null default 0,
  duplicate_sku_rows integer not null default 0,
  total_units numeric(18,4) not null default 0,
  matched_input_ids integer not null default 0,
  unmatched_input_ids integer not null default 0,
  expected_basepacks integer not null default 0,
  available_basepacks integer not null default 0,
  availability_pct numeric(7,2),
  uploaded_at timestamptz not null default now()
);

create unique index if not exists uq_stock_upload_latest_per_account on public.stock_uploads(account_id) where is_latest=true;
create index if not exists idx_stock_uploads_account_date on public.stock_uploads(account_id,snapshot_date desc,uploaded_at desc);

create table if not exists public.stock_rows (
  upload_id uuid not null references public.stock_uploads(id) on delete cascade,
  account_sku text not null,
  stock_qty numeric(18,4) not null default 0,
  primary key (upload_id,account_sku)
);
create index if not exists idx_stock_rows_sku on public.stock_rows(account_sku);

insert into public.accounts(code,name,master_column,sort_order,active) values
  ('daraz','Daraz','Daraz',1,true),
  ('pandamart','Pandamart','Pandamart',2,true),
  ('shajgoj','Shajgoj','Shajgoj',3,true),
  ('cartup','Cartup','Cartup',4,true),
  ('othoba','Othoba','Othoba',5,true),
  ('foodi','Foodimart','Foodimart',6,true),
  ('chaldal','Chaldal','Chaldal',7,true),
  ('rokomari','Rokomari','Rokomari',8,true),
  ('ogerio','Ogerio','Ogerio',9,true),
  ('chardike','Chardike','Chardike',10,true),
  ('arogga','Arogga','Arogga',11,true),
  ('meenabazar','Meena Bazar','Meena Bazar',12,true),
  ('shwapno','Shwapno','Shwapno',13,true)
on conflict(code) do update set name=excluded.name,master_column=excluded.master_column,sort_order=excluded.sort_order,active=excluded.active;

create or replace function public.replace_master_v2(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_import_id uuid; v_product jsonb; v_product_id uuid; v_basepack_id uuid; v_packsize text;
  v_account_pair record; v_account_id uuid; v_account_sku text;
  v_rows integer:=0; v_active integer:=0; v_inactive integer:=0; v_mappings integer:=0; v_basepacks integer:=0;
begin
  if jsonb_typeof(coalesce(p_payload->'products','[]'::jsonb))<>'array' then raise exception 'products must be an array'; end if;
  v_rows:=jsonb_array_length(coalesce(p_payload->'products','[]'::jsonb));
  delete from public.product_account_ids where true;
  delete from public.products where true;
  delete from public.basepacks where true;

  for v_product in select value from jsonb_array_elements(coalesce(p_payload->'products','[]'::jsonb)) loop
    v_packsize:=nullif(trim(v_product->>'packsize'),'');
    if v_packsize is null then raise exception 'Packsize is required for UBL Code %',v_product->>'ubl_code'; end if;
    insert into public.basepacks(packsize) values(v_packsize)
      on conflict(packsize) do update set updated_at=now() returning id into v_basepack_id;

    insert into public.products(
      basepack_id,ubl_code,name,status,brand,tp,mrp,sku_label,weight_type,weight,business_group,
      product_type,retail_type,category,sub_category,variant,description,highlights,hero_image_url
    ) values(
      v_basepack_id,nullif(trim(v_product->>'ubl_code'),''),nullif(trim(v_product->>'name'),''),
      case when lower(coalesce(v_product->>'status','active'))='inactive' then 'inactive' else 'active' end,
      nullif(v_product->>'brand',''),nullif(v_product->>'tp','')::numeric,nullif(v_product->>'mrp','')::numeric,
      nullif(v_product->>'sku_label',''),nullif(v_product->>'weight_type',''),nullif(v_product->>'weight','')::numeric,
      nullif(v_product->>'business_group',''),nullif(v_product->>'product_type',''),nullif(v_product->>'retail_type',''),
      nullif(v_product->>'category',''),nullif(v_product->>'sub_category',''),nullif(v_product->>'variant',''),
      nullif(v_product->>'description',''),nullif(v_product->>'highlights',''),nullif(v_product->>'hero_image_url','')
    ) returning id into v_product_id;

    if lower(coalesce(v_product->>'status','active'))='inactive' then v_inactive:=v_inactive+1; else v_active:=v_active+1; end if;

    for v_account_pair in select key,value from jsonb_each(coalesce(v_product->'account_ids','{}'::jsonb)) loop
      select id into v_account_id from public.accounts where code=v_account_pair.key and active=true;
      if v_account_id is null or jsonb_typeof(v_account_pair.value)<>'array' then continue; end if;
      for v_account_sku in select value from jsonb_array_elements_text(v_account_pair.value) loop
        if nullif(trim(v_account_sku),'') is null then continue; end if;
        insert into public.product_account_ids(product_id,account_id,account_sku)
          values(v_product_id,v_account_id,trim(v_account_sku)) on conflict do nothing;
        v_mappings:=v_mappings+1;
      end loop;
    end loop;
  end loop;

  select count(*)::integer into v_basepacks from public.basepacks;
  insert into public.master_imports(file_name,sheet_name,row_count,basepack_count,active_count,inactive_count,mapping_count)
  values(coalesce(nullif(p_payload->>'file_name',''),'master.xlsx'),nullif(p_payload->>'sheet_name',''),v_rows,v_basepacks,v_active,v_inactive,v_mappings)
  returning id into v_import_id;

  return jsonb_build_object('success',true,'import_id',v_import_id,'products',v_rows,'basepacks',v_basepacks,'active',v_active,'inactive',v_inactive,'mappings',v_mappings);
end;
$$;

create or replace function public.commit_stock_upload_v2(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_account_id uuid; v_upload_id uuid; v_row jsonb;
  v_expected integer:=0; v_available integer:=0; v_matched integer:=0; v_unmatched integer:=0; v_pct numeric(7,2);
begin
  select id into v_account_id from public.accounts where code=p_payload->>'account_code' and active=true;
  if v_account_id is null then raise exception 'Unknown account_code: %',p_payload->>'account_code'; end if;
  if nullif(p_payload->>'snapshot_date','') is null then raise exception 'snapshot_date is required'; end if;
  if jsonb_typeof(coalesce(p_payload->'rows','[]'::jsonb))<>'array' then raise exception 'rows must be an array'; end if;

  update public.stock_uploads set is_latest=false where account_id=v_account_id and is_latest=true;
  insert into public.stock_uploads(account_id,snapshot_date,is_latest,file_name,sheet_name,sku_column,stock_columns,stock_mode,input_rows,unique_skus,duplicate_sku_rows,total_units)
  values(
    v_account_id,(p_payload->>'snapshot_date')::date,true,coalesce(nullif(p_payload->>'file_name',''),'stock.xlsx'),
    coalesce(nullif(p_payload->>'sheet_name',''),'Sheet1'),coalesce(nullif(p_payload->>'sku_column',''),'SKU'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'stock_columns','[]'::jsonb))),array[]::text[]),
    case when p_payload->>'stock_mode'='availability' then 'availability' else 'quantity' end,
    coalesce((p_payload->>'input_rows')::integer,0),jsonb_array_length(coalesce(p_payload->'rows','[]'::jsonb)),
    coalesce((p_payload->>'duplicate_sku_rows')::integer,0),coalesce((p_payload->>'total_units')::numeric,0)
  ) returning id into v_upload_id;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) loop
    if nullif(trim(v_row->>'account_sku'),'') is null then continue; end if;
    insert into public.stock_rows(upload_id,account_sku,stock_qty)
      values(v_upload_id,trim(v_row->>'account_sku'),greatest(coalesce((v_row->>'stock_qty')::numeric,0),0))
      on conflict(upload_id,account_sku) do update set stock_qty=excluded.stock_qty;
  end loop;

  select count(distinct p.basepack_id)::integer into v_expected
    from public.product_account_ids pai join public.products p on p.id=pai.product_id and p.status='active'
    where pai.account_id=v_account_id;
  select count(distinct p.basepack_id)::integer into v_available
    from public.product_account_ids pai join public.products p on p.id=pai.product_id and p.status='active'
    join public.stock_rows sr on sr.upload_id=v_upload_id and sr.account_sku=pai.account_sku and sr.stock_qty>0
    where pai.account_id=v_account_id;
  select count(*)::integer into v_matched from public.stock_rows sr where sr.upload_id=v_upload_id
    and exists(select 1 from public.product_account_ids pai where pai.account_id=v_account_id and pai.account_sku=sr.account_sku);
  select count(*)::integer into v_unmatched from public.stock_rows sr where sr.upload_id=v_upload_id
    and not exists(select 1 from public.product_account_ids pai where pai.account_id=v_account_id and pai.account_sku=sr.account_sku);
  v_pct:=case when v_expected>0 then round(100.0*v_available/v_expected,2) else null end;
  update public.stock_uploads set matched_input_ids=v_matched,unmatched_input_ids=v_unmatched,expected_basepacks=v_expected,available_basepacks=v_available,availability_pct=v_pct where id=v_upload_id;
  return jsonb_build_object('success',true,'upload_id',v_upload_id,'expected_basepacks',v_expected,'available_basepacks',v_available,'unavailable_basepacks',greatest(v_expected-v_available,0),'availability_pct',v_pct,'matched_input_ids',v_matched,'unmatched_input_ids',v_unmatched);
end;
$$;

create or replace view public.v_master_skus with(security_invoker=true) as
select p.id,p.ubl_code,p.name,p.status,p.brand,p.tp,p.mrp,p.basepack_id,b.packsize,p.sku_label,p.weight_type,p.weight,
       p.business_group,p.product_type,p.retail_type,p.category,p.sub_category,p.variant,p.description,p.highlights,p.hero_image_url,p.created_at,p.updated_at
from public.products p join public.basepacks b on b.id=p.basepack_id;

create or replace view public.v_product_availability with(security_invoker=true) as
with latest as(select id,account_id,snapshot_date,uploaded_at from public.stock_uploads where is_latest=true)
select p.id as product_id,p.ubl_code,p.name as product_name,p.basepack_id,b.packsize,p.brand,p.business_group,p.category,p.sub_category,p.product_type,p.retail_type,p.variant,
       a.id as account_id,a.code as account_code,a.name as account_name,a.sort_order,
       string_agg(distinct pai.account_sku,' | ' order by pai.account_sku) as account_skus,l.snapshot_date,l.uploaded_at,
       case when l.id is null then null else coalesce(sum(sr.stock_qty),0) end as stock_qty,
       case when l.id is null then null else coalesce(bool_or(sr.stock_qty>0),false) end as is_available
from public.products p join public.basepacks b on b.id=p.basepack_id join public.product_account_ids pai on pai.product_id=p.id
join public.accounts a on a.id=pai.account_id and a.active=true left join latest l on l.account_id=a.id
left join public.stock_rows sr on sr.upload_id=l.id and sr.account_sku=pai.account_sku
where p.status='active'
group by p.id,p.ubl_code,p.name,p.basepack_id,b.packsize,p.brand,p.business_group,p.category,p.sub_category,p.product_type,p.retail_type,p.variant,a.id,a.code,a.name,a.sort_order,l.id,l.snapshot_date,l.uploaded_at;

create or replace view public.v_basepack_availability with(security_invoker=true) as
with latest as(select id,account_id,snapshot_date,uploaded_at from public.stock_uploads where is_latest=true),
basepack_meta as(
  select b.id as basepack_id,b.packsize,count(distinct p.id)::integer as sku_count,
    array_agg(distinct p.brand order by p.brand) filter(where p.brand is not null) as brands,
    array_agg(distinct p.business_group order by p.business_group) filter(where p.business_group is not null) as business_groups,
    array_agg(distinct p.category order by p.category) filter(where p.category is not null) as categories,
    array_agg(distinct p.sub_category order by p.sub_category) filter(where p.sub_category is not null) as sub_categories,
    array_agg(distinct p.product_type order by p.product_type) filter(where p.product_type is not null) as product_types,
    array_agg(distinct p.retail_type order by p.retail_type) filter(where p.retail_type is not null) as retail_types,
    array_agg(distinct p.variant order by p.variant) filter(where p.variant is not null) as variants
  from public.basepacks b join public.products p on p.basepack_id=b.id and p.status='active' group by b.id,b.packsize
),
basepack_account_ids as(
  select distinct p.basepack_id,pai.account_id,pai.account_sku from public.products p join public.product_account_ids pai on pai.product_id=p.id where p.status='active'
),
listed as(
  select basepack_id,account_id,string_agg(account_sku,' | ' order by account_sku) as account_skus from basepack_account_ids group by basepack_id,account_id
),
stock_rollup as(
  select bai.basepack_id,bai.account_id,l.id as upload_id,coalesce(sum(sr.stock_qty),0) as stock_qty,coalesce(bool_or(sr.stock_qty>0),false) as is_available
  from basepack_account_ids bai join latest l on l.account_id=bai.account_id left join public.stock_rows sr on sr.upload_id=l.id and sr.account_sku=bai.account_sku
  group by bai.basepack_id,bai.account_id,l.id
)
select m.basepack_id,m.packsize,m.sku_count,m.brands,m.business_groups,m.categories,m.sub_categories,m.product_types,m.retail_types,m.variants,
       a.id as account_id,a.code as account_code,a.name as account_name,a.sort_order,listed.account_skus,l.snapshot_date,l.uploaded_at,
       case when l.id is null then null else coalesce(sr.stock_qty,0) end as stock_qty,
       case when l.id is null then null else coalesce(sr.is_available,false) end as is_available
from listed join basepack_meta m on m.basepack_id=listed.basepack_id join public.accounts a on a.id=listed.account_id and a.active=true
left join latest l on l.account_id=a.id left join stock_rollup sr on sr.basepack_id=m.basepack_id and sr.account_id=a.id and sr.upload_id=l.id;

create or replace view public.v_account_availability_summary with(security_invoker=true) as
select a.id as account_id,a.code as account_code,a.name as account_name,a.sort_order,max(v.snapshot_date) as snapshot_date,max(v.uploaded_at) as uploaded_at,
       count(v.basepack_id)::integer as expected_basepacks,count(v.basepack_id) filter(where v.is_available=true)::integer as available_basepacks,
       case when max(v.snapshot_date) is null then null else (count(v.basepack_id)-count(v.basepack_id) filter(where v.is_available=true))::integer end as unavailable_basepacks,
       case when max(v.snapshot_date) is null or count(v.basepack_id)=0 then null else round(100.0*count(v.basepack_id) filter(where v.is_available=true)/count(v.basepack_id),2) end as availability_pct,
       case when max(v.snapshot_date) is null then null else coalesce(sum(v.stock_qty),0) end as total_stock
from public.accounts a left join public.v_basepack_availability v on v.account_id=a.id where a.active=true group by a.id,a.code,a.name,a.sort_order;

create or replace view public.v_account_mappings with(security_invoker=true) as
select a.code as account_code,a.name as account_name,p.id as product_id,p.basepack_id,b.packsize,p.ubl_code,p.name as product_name,p.status,p.brand,p.business_group,p.category,p.sub_category,p.product_type,p.retail_type,p.variant,pai.account_sku
from public.product_account_ids pai join public.accounts a on a.id=pai.account_id join public.products p on p.id=pai.product_id join public.basepacks b on b.id=p.basepack_id;

alter table public.accounts enable row level security;
alter table public.basepacks enable row level security;
alter table public.products enable row level security;
alter table public.product_account_ids enable row level security;
alter table public.master_imports enable row level security;
alter table public.stock_uploads enable row level security;
alter table public.stock_rows enable row level security;

revoke all on public.accounts,public.basepacks,public.products,public.product_account_ids,public.master_imports,public.stock_uploads,public.stock_rows from anon,authenticated;
revoke all on public.v_master_skus,public.v_product_availability,public.v_basepack_availability,public.v_account_availability_summary,public.v_account_mappings from anon,authenticated;
grant select,insert,update,delete on public.accounts,public.basepacks,public.products,public.product_account_ids,public.master_imports,public.stock_uploads,public.stock_rows to service_role;
grant select on public.v_master_skus,public.v_product_availability,public.v_basepack_availability,public.v_account_availability_summary,public.v_account_mappings to service_role;

revoke execute on function public.replace_master_v2(jsonb) from public,anon,authenticated;
revoke execute on function public.commit_stock_upload_v2(jsonb) from public,anon,authenticated;
grant execute on function public.replace_master_v2(jsonb) to service_role;
grant execute on function public.commit_stock_upload_v2(jsonb) to service_role;


-- Pandamart daily branch stock, sales, OLA history, and flags
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
commit;


-- ============================================================================
-- V2.4 Shajgoj sparse stock + cumulative sales history
-- ============================================================================
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

-- end Daraz v2.7

-- ============================================================
-- V2.8 CENTRAL AVAILABILITY
-- Source of truth: supabase/migrations/20261007_central_availability_v28.sql
-- ============================================================

create or replace view public.v_central_availability_current
with (security_invoker = true)
as
with account_meta as (
  select code, name, sort_order from public.accounts
  where active = true and code in ('pandamart','shajgoj','foodi','othoba','daraz')
),
pandamart_latest as (select max(stock_date) as stock_date from public.pandamart_basepack_daily),
pandamart_current as (
  select 'pandamart'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,
    d.basepack_id,d.packsize,d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
    count(*)::integer as expected_units,count(*) filter(where d.is_available)::integer as available_units,
    round((count(*) filter(where d.is_available))::numeric/nullif(count(*),0),6) as availability_score,
    coalesce(sum(d.stock_qty),0)::numeric(18,4) as stock_qty,null::numeric(18,4) as stock_valuation
  from public.pandamart_basepack_daily d join pandamart_latest l on l.stock_date=d.stock_date join account_meta a on a.code='pandamart'
  group by a.name,a.sort_order,d.stock_date,d.basepack_id,d.packsize,d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants
),
shajgoj_current as (
  select 'shajgoj'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,d.basepack_id,d.packsize,d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
    1::integer as expected_units,case when d.is_available then 1 else 0 end::integer as available_units,case when d.is_available then 1::numeric else 0::numeric end as availability_score,d.stock_qty::numeric(18,4) as stock_qty,null::numeric(18,4) as stock_valuation
  from public.v_shajgoj_current_basepacks d join account_meta a on a.code='shajgoj'
),
foodi_current as (
  select 'foodi'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,d.basepack_id,d.packsize,d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
    1::integer as expected_units,case when d.is_available then 1 else 0 end::integer as available_units,case when d.is_available then 1::numeric else 0::numeric end as availability_score,d.stock_qty::numeric(18,4) as stock_qty,null::numeric(18,4) as stock_valuation
  from public.v_foodi_current_basepacks d join account_meta a on a.code='foodi'
),
othoba_current as (
  select 'othoba'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,d.basepack_id,d.packsize,d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
    1::integer as expected_units,case when d.is_available then 1 else 0 end::integer as available_units,case when d.is_available then 1::numeric else 0::numeric end as availability_score,d.stock_qty::numeric(18,4) as stock_qty,null::numeric(18,4) as stock_valuation
  from public.v_othoba_current_basepacks d join account_meta a on a.code='othoba'
),
daraz_current as (
  select 'daraz'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,d.basepack_id,d.packsize,d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
    1::integer as expected_units,case when d.is_available then 1 else 0 end::integer as available_units,case when d.is_available then 1::numeric else 0::numeric end as availability_score,d.stock_qty::numeric(18,4) as stock_qty,d.stock_valuation::numeric(18,4) as stock_valuation
  from public.v_daraz_current_basepacks d join account_meta a on a.code='daraz'
)
select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,expected_units,available_units,availability_score,(availability_score>0)::boolean as is_available,stock_qty,stock_valuation from pandamart_current
union all select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,expected_units,available_units,availability_score,(availability_score>0),stock_qty,stock_valuation from shajgoj_current
union all select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,expected_units,available_units,availability_score,(availability_score>0),stock_qty,stock_valuation from foodi_current
union all select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,expected_units,available_units,availability_score,(availability_score>0),stock_qty,stock_valuation from othoba_current
union all select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,expected_units,available_units,availability_score,(availability_score>0),stock_qty,stock_valuation from daraz_current;

create or replace view public.v_central_account_ola_current with (security_invoker=true) as
select account_code,max(account_name) as account_name,min(sort_order) as sort_order,max(observation_date) as observation_date,count(*)::integer as in_scope_basepacks,
  round(sum(availability_score),4) as available_equivalent_basepacks,count(*) filter(where availability_score=1)::integer as fully_available_basepacks,
  count(*) filter(where availability_score>0 and availability_score<1)::integer as partially_available_basepacks,count(*) filter(where availability_score=0)::integer as unavailable_basepacks,
  round(100*avg(availability_score),2) as ola_pct
from public.v_central_availability_current group by account_code;

create or replace view public.v_central_ola_current with (security_invoker=true) as
select count(*)::integer as valid_account_basepack_cells,count(distinct basepack_id)::integer as basepacks,count(distinct account_code)::integer as accounts,
  round(sum(availability_score),4) as available_equivalent_cells,round(100*avg(availability_score),2) as central_ola_pct
from public.v_central_availability_current;
-- UBL Availability V2.9 — Shajgoj account-specific flags

begin;

create or replace view public.v_shajgoj_flags
with (security_invoker = true)
as
with account_scope as (
  select distinct
    pai.account_sku,
    p.basepack_id,
    b.packsize,
    p.brand,
    p.business_group,
    p.category,
    p.sub_category
  from public.product_account_ids pai
  join public.accounts a on a.id = pai.account_id and a.code = 'shajgoj'
  join public.products p on p.id = pai.product_id and p.status = 'active'
  join public.basepacks b on b.id = p.basepack_id
), latest_date as (
  select max(stock_date) as stock_date from public.shajgoj_basepack_daily
), previous_date as (
  select max(stock_date) as stock_date
  from public.shajgoj_basepack_daily
  where stock_date < (select stock_date from latest_date)
), latest_sales_period as (
  select max(period_end) as period_end from public.shajgoj_sales_cumulative
), latest_sales as (
  select
    s.period_start,
    s.period_end,
    s.account_sku,
    s.sold_qty,
    s.sales_value,
    greatest((s.period_end - s.period_start + 1), 1)::numeric as period_days
  from public.shajgoj_sales_cumulative s
  where s.period_end = (select period_end from latest_sales_period)
), bp_scope as (
  select
    basepack_id,
    packsize,
    array_remove(array_agg(distinct brand), null) as brands,
    array_remove(array_agg(distinct business_group), null) as business_groups,
    array_remove(array_agg(distinct category), null) as categories,
    array_remove(array_agg(distinct sub_category), null) as sub_categories,
    array_agg(distinct account_sku) as account_skus
  from account_scope
  group by basepack_id, packsize
), current_bp as (
  select d.*
  from public.shajgoj_basepack_daily d
  join latest_date l on l.stock_date = d.stock_date
), previous_bp as (
  select d.*
  from public.shajgoj_basepack_daily d
  join previous_date p on p.stock_date = d.stock_date
), sales_bp as (
  select
    s.basepack_id,
    max(ls.period_start) as period_start,
    max(ls.period_end) as period_end,
    max(ls.period_days) as period_days,
    coalesce(sum(ls.sold_qty),0)::numeric(18,4) as sold_qty,
    coalesce(sum(ls.sales_value),0)::numeric(18,4) as sales_value
  from account_scope s
  left join latest_sales ls on ls.account_sku = s.account_sku
  group by s.basepack_id
), present_bp as (
  select
    s.basepack_id,
    count(sd.account_sku)::integer as present_sku_rows
  from account_scope s
  left join public.shajgoj_stock_daily sd
    on sd.account_sku = s.account_sku
   and sd.stock_date = (select stock_date from latest_date)
  group by s.basepack_id
), base as (
  select
    c.stock_date,
    s.basepack_id,
    s.packsize,
    s.brands,
    s.business_groups,
    s.categories,
    s.sub_categories,
    c.stock_qty::numeric(18,4) as stock_qty,
    c.is_available,
    p.stock_date as previous_stock_date,
    p.stock_qty::numeric(18,4) as previous_stock_qty,
    p.is_available as previous_is_available,
    sb.period_start,
    sb.period_end,
    sb.period_days,
    sb.sold_qty,
    sb.sales_value,
    coalesce(pb.present_sku_rows,0)::integer as present_sku_rows,
    case when coalesce(sb.sold_qty,0) > 0 and coalesce(sb.period_days,0) > 0
      then round(c.stock_qty / (sb.sold_qty / sb.period_days), 2)
      else null
    end::numeric(18,2) as days_of_cover
  from bp_scope s
  join current_bp c on c.basepack_id = s.basepack_id
  left join previous_bp p on p.basepack_id = s.basepack_id
  left join sales_bp sb on sb.basepack_id = s.basepack_id
  left join present_bp pb on pb.basepack_id = s.basepack_id
), flags as (
  select b.*, f.flag_type, f.severity, f.reason, f.priority
  from base b
  cross join lateral (
    values
      (
        'MISSING_FROM_LATEST_UPLOAD'::text,
        case when b.present_sku_rows = 0 then 'warning' end,
        case when b.present_sku_rows = 0 then 'Mapped Shajgoj basepack has no SKU row in the latest stock file.' end,
        20
      ),
      (
        'HIGH_SALES_OOS'::text,
        case when b.stock_qty = 0 and coalesce(b.sold_qty,0) >= 25 then 'critical' end,
        case when b.stock_qty = 0 and coalesce(b.sold_qty,0) >= 25 then 'Out of stock with high recent demand.' end,
        10
      ),
      (
        'OOS_WITH_DEMAND'::text,
        case when b.stock_qty = 0 and coalesce(b.sold_qty,0) > 0 and coalesce(b.sold_qty,0) < 25 then 'warning' end,
        case when b.stock_qty = 0 and coalesce(b.sold_qty,0) > 0 and coalesce(b.sold_qty,0) < 25 then 'Out of stock while recent sales are still present.' end,
        30
      ),
      (
        'OOS_NO_RECENT_SALES'::text,
        case when b.stock_qty = 0 and coalesce(b.sold_qty,0) = 0 then 'watch' end,
        case when b.stock_qty = 0 and coalesce(b.sold_qty,0) = 0 then 'Out of stock with no sales in the latest available sales period.' end,
        50
      ),
      (
        'LOW_DAYS_OF_COVER'::text,
        case when b.stock_qty > 0 and b.days_of_cover is not null and b.days_of_cover <= 7 then 'critical'
             when b.stock_qty > 0 and b.days_of_cover is not null and b.days_of_cover <= 14 then 'warning' end,
        case when b.stock_qty > 0 and b.days_of_cover is not null and b.days_of_cover <= 7 then 'Estimated stock cover is 7 days or less at the latest sales pace.'
             when b.stock_qty > 0 and b.days_of_cover is not null and b.days_of_cover <= 14 then 'Estimated stock cover is 14 days or less at the latest sales pace.' end,
        15
      ),
      (
        'NO_SALES_WITH_STOCK'::text,
        case when b.stock_qty > 0 and coalesce(b.sold_qty,0) = 0 then 'watch' end,
        case when b.stock_qty > 0 and coalesce(b.sold_qty,0) = 0 then 'Stock is available but no sales were recorded in the latest sales period.' end,
        60
      ),
      (
        'REPEATED_OOS'::text,
        case when b.stock_qty = 0 and b.previous_is_available = false then 'critical' end,
        case when b.stock_qty = 0 and b.previous_is_available = false then 'Basepack is out of stock in both the latest and previous observed stock dates.' end,
        5
      ),
      (
        'RECOVERED'::text,
        case when b.stock_qty > 0 and b.previous_is_available = false then 'positive' end,
        case when b.stock_qty > 0 and b.previous_is_available = false then 'Basepack recovered from out of stock on the previous observed date.' end,
        90
      )
  ) as f(flag_type,severity,reason,priority)
  where f.severity is not null
)
select
  stock_date,
  previous_stock_date,
  basepack_id,
  packsize,
  brands,
  business_groups,
  categories,
  sub_categories,
  stock_qty,
  previous_stock_qty,
  sold_qty,
  sales_value,
  period_start,
  period_end,
  days_of_cover,
  present_sku_rows,
  flag_type,
  severity,
  reason,
  priority
from flags;

create or replace view public.v_shajgoj_flag_summary
with (security_invoker = true)
as
select
  stock_date,
  count(*)::integer as total_flags,
  count(*) filter (where severity='critical')::integer as critical_flags,
  count(*) filter (where severity='warning')::integer as warning_flags,
  count(*) filter (where severity='watch')::integer as watch_flags,
  count(*) filter (where severity='positive')::integer as positive_flags,
  count(distinct basepack_id)::integer as flagged_basepacks
from public.v_shajgoj_flags
group by stock_date;

revoke all on public.v_shajgoj_flags, public.v_shajgoj_flag_summary from anon, authenticated;
grant select on public.v_shajgoj_flags, public.v_shajgoj_flag_summary to service_role;

commit;
-- UBL Availability V2.10 — Othoba account-specific flags
begin;

create or replace view public.v_othoba_flags
with (security_invoker = true)
as
with latest_date as (
  select max(stock_date) as stock_date from public.othoba_basepack_daily
),
previous_date as (
  select max(stock_date) as stock_date
  from public.othoba_basepack_daily
  where stock_date < (select stock_date from latest_date)
),
account_scope as (
  select distinct pai.account_sku,p.basepack_id,b.packsize,p.brand,p.business_group,p.category,p.sub_category
  from public.product_account_ids pai
  join public.accounts a on a.id=pai.account_id and a.code='othoba'
  join public.products p on p.id=pai.product_id and p.status='active'
  join public.basepacks b on b.id=p.basepack_id
),
bp_scope as (
  select basepack_id,packsize,
    array_remove(array_agg(distinct brand),null) as brands,
    array_remove(array_agg(distinct business_group),null) as business_groups,
    array_remove(array_agg(distinct category),null) as categories,
    array_remove(array_agg(distinct sub_category),null) as sub_categories
  from account_scope
  group by basepack_id,packsize
),
current_bp as (
  select d.* from public.othoba_basepack_daily d
  join latest_date l on l.stock_date=d.stock_date
),
previous_bp as (
  select d.* from public.othoba_basepack_daily d
  join previous_date p on p.stock_date=d.stock_date
),
latest_snapshot as (
  select s.*
  from public.othoba_sales_snapshots s
  where s.period_end=(select stock_date-1 from latest_date)
),
snapshot_bp as (
  select sc.basepack_id,
    min(s.period_start) as period_start,
    max(s.period_end) as period_end,
    coalesce(sum(s.sold_qty),0)::numeric(18,4) as mtd_sold_qty,
    coalesce(sum(s.run_rate),0)::numeric(18,6) as run_rate,
    coalesce(sum(s.stock_value),0)::numeric(18,4) as stock_value,
    coalesce(sum(s.sales_value),0)::numeric(18,4) as sales_value
  from account_scope sc
  left join latest_snapshot s on s.account_sku=sc.account_sku
  group by sc.basepack_id
),
present_bp as (
  select sc.basepack_id,count(sd.account_sku)::integer as present_sku_rows
  from account_scope sc
  left join public.othoba_stock_daily sd
    on sd.account_sku=sc.account_sku and sd.stock_date=(select stock_date from latest_date)
  group by sc.basepack_id
),
current_month as (
  select date_trunc('month',(select stock_date from latest_date))::date as month_start
),
current_month_end as (
  select max(period_end) as period_end
  from public.othoba_monthly_sales
  where month_start=(select month_start from current_month)
),
current_month_sales_bp as (
  select sc.basepack_id,
    coalesce(sum(ms.sold_qty),0)::numeric(18,4) as sold_qty,
    max(ms.period_end) as period_end
  from account_scope sc
  left join public.othoba_monthly_sales ms
    on ms.account_sku=sc.account_sku and ms.month_start=(select month_start from current_month)
  group by sc.basepack_id
),
previous_month as (
  select max(month_start) as month_start
  from public.othoba_monthly_sales
  where month_start < (select month_start from current_month)
),
previous_month_sales_bp as (
  select sc.basepack_id,
    coalesce(sum(ms.sold_qty),0)::numeric(18,4) as sold_qty,
    max(ms.period_end) as period_end
  from account_scope sc
  left join public.othoba_monthly_sales ms
    on ms.account_sku=sc.account_sku and ms.month_start=(select month_start from previous_month)
  group by sc.basepack_id
),
base as (
  select
    c.stock_date,
    p.stock_date as previous_stock_date,
    s.basepack_id,s.packsize,s.brands,s.business_groups,s.categories,s.sub_categories,
    c.stock_qty::numeric(18,4) as stock_qty,
    p.stock_qty::numeric(18,4) as previous_stock_qty,
    c.is_available,
    p.is_available as previous_is_available,
    coalesce(sb.mtd_sold_qty,0)::numeric(18,4) as mtd_sold_qty,
    coalesce(sb.run_rate,0)::numeric(18,6) as run_rate,
    coalesce(sb.stock_value,0)::numeric(18,4) as stock_value,
    coalesce(sb.sales_value,0)::numeric(18,4) as sales_value,
    sb.period_start,sb.period_end,
    coalesce(pb.present_sku_rows,0)::integer as present_sku_rows,
    case when coalesce(sb.run_rate,0)>0 then round(c.stock_qty/sb.run_rate,2) else null end::numeric(18,2) as days_of_cover,
    coalesce(cm.sold_qty,0)::numeric(18,4) as current_month_sold_qty,
    cm.period_end as current_month_period_end,
    coalesce(pm.sold_qty,0)::numeric(18,4) as previous_month_sold_qty,
    pm.period_end as previous_month_period_end,
    case
      when cm.period_end is not null and (cm.period_end-(select month_start from current_month)+1)>0
      then round(cm.sold_qty/(cm.period_end-(select month_start from current_month)+1),4)
      else 0
    end::numeric(18,4) as current_month_daily_pace,
    case
      when pm.period_end is not null and (pm.period_end-(select month_start from previous_month)+1)>0
      then round(pm.sold_qty/(pm.period_end-(select month_start from previous_month)+1),4)
      else 0
    end::numeric(18,4) as previous_month_daily_pace
  from bp_scope s
  join current_bp c on c.basepack_id=s.basepack_id
  left join previous_bp p on p.basepack_id=s.basepack_id
  left join snapshot_bp sb on sb.basepack_id=s.basepack_id
  left join present_bp pb on pb.basepack_id=s.basepack_id
  left join current_month_sales_bp cm on cm.basepack_id=s.basepack_id
  left join previous_month_sales_bp pm on pm.basepack_id=s.basepack_id
),
flags as (
  select b.*,f.flag_type,f.severity,f.reason,f.priority
  from base b
  cross join lateral (values
    ('REPEATED_OOS'::text,
      case when b.stock_qty=0 and b.previous_is_available=false then 'critical' end,
      case when b.stock_qty=0 and b.previous_is_available=false then 'Basepack is out of stock in both the latest and previous Othoba observations.' end,5),
    ('HIGH_SALES_OOS'::text,
      case when b.stock_qty=0 and b.mtd_sold_qty>=5 then 'critical' end,
      case when b.stock_qty=0 and b.mtd_sold_qty>=5 then 'Out of stock despite strong month-to-date demand.' end,10),
    ('LOW_DAYS_OF_COVER'::text,
      case when b.stock_qty>0 and b.days_of_cover is not null and b.days_of_cover<=7 then 'critical'
           when b.stock_qty>0 and b.days_of_cover is not null and b.days_of_cover<=14 then 'warning' end,
      case when b.stock_qty>0 and b.days_of_cover is not null and b.days_of_cover<=7 then 'Estimated stock cover is 7 days or less at the current Othoba run rate.'
           when b.stock_qty>0 and b.days_of_cover is not null and b.days_of_cover<=14 then 'Estimated stock cover is 14 days or less at the current Othoba run rate.' end,15),
    ('MISSING_FROM_LATEST_UPLOAD'::text,
      case when b.present_sku_rows=0 then 'warning' end,
      case when b.present_sku_rows=0 then 'Mapped Othoba basepack has no SKU row in the latest stock file.' end,20),
    ('OOS_WITH_DEMAND'::text,
      case when b.stock_qty=0 and b.mtd_sold_qty>0 and b.mtd_sold_qty<5 then 'warning' end,
      case when b.stock_qty=0 and b.mtd_sold_qty>0 and b.mtd_sold_qty<5 then 'Out of stock while month-to-date demand is still present.' end,30),
    ('HIGH_VALUE_STAGNANT'::text,
      case when b.stock_qty>0 and b.mtd_sold_qty=0 and b.stock_value>=18000 then 'warning' end,
      case when b.stock_qty>0 and b.mtd_sold_qty=0 and b.stock_value>=18000 then 'High stock value is tied up with no month-to-date sales.' end,35),
    ('SALES_PACE_DROP'::text,
      case when b.previous_month_daily_pace>=0.5 and b.current_month_daily_pace < b.previous_month_daily_pace*0.5 then 'warning' end,
      case when b.previous_month_daily_pace>=0.5 and b.current_month_daily_pace < b.previous_month_daily_pace*0.5 then 'Current-month daily sales pace is less than half of the previous month.' end,40),
    ('OOS_NO_RECENT_SALES'::text,
      case when b.stock_qty=0 and b.mtd_sold_qty=0 then 'watch' end,
      case when b.stock_qty=0 and b.mtd_sold_qty=0 then 'Out of stock with no month-to-date sales in the latest snapshot.' end,50),
    ('NO_SALES_WITH_STOCK'::text,
      case when b.stock_qty>0 and b.mtd_sold_qty=0 and b.stock_value<18000 then 'watch' end,
      case when b.stock_qty>0 and b.mtd_sold_qty=0 and b.stock_value<18000 then 'Stock is available but no month-to-date sales were recorded.' end,60),
    ('OVERSTOCK_SLOW_MOVER'::text,
      case when b.stock_qty>0 and b.days_of_cover>=60 and b.stock_value>=8000 then 'watch' end,
      case when b.stock_qty>0 and b.days_of_cover>=60 and b.stock_value>=8000 then 'More than 60 days of stock cover with meaningful inventory value.' end,65),
    ('SALES_PACE_SURGE'::text,
      case when b.previous_month_daily_pace>=0.5 and b.current_month_daily_pace >= b.previous_month_daily_pace*1.5 and b.current_month_sold_qty>=5 then 'positive' end,
      case when b.previous_month_daily_pace>=0.5 and b.current_month_daily_pace >= b.previous_month_daily_pace*1.5 and b.current_month_sold_qty>=5 then 'Current-month daily sales pace is at least 50% above the previous month.' end,80),
    ('RECOVERED'::text,
      case when b.stock_qty>0 and b.previous_is_available=false then 'positive' end,
      case when b.stock_qty>0 and b.previous_is_available=false then 'Basepack recovered from out of stock on the previous observed date.' end,90)
  ) f(flag_type,severity,reason,priority)
  where f.severity is not null
)
select stock_date,previous_stock_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,
       stock_qty,previous_stock_qty,mtd_sold_qty,run_rate,days_of_cover,stock_value,sales_value,period_start,period_end,
       current_month_sold_qty,current_month_period_end,previous_month_sold_qty,previous_month_period_end,
       current_month_daily_pace,previous_month_daily_pace,present_sku_rows,flag_type,severity,reason,priority
from flags;

create or replace view public.v_othoba_flag_summary
with (security_invoker = true)
as
select stock_date,
  count(*)::integer as total_flags,
  count(*) filter(where severity='critical')::integer as critical_flags,
  count(*) filter(where severity='warning')::integer as warning_flags,
  count(*) filter(where severity='watch')::integer as watch_flags,
  count(*) filter(where severity='positive')::integer as positive_flags,
  count(distinct basepack_id)::integer as flagged_basepacks
from public.v_othoba_flags
group by stock_date;

revoke all on public.v_othoba_flags,public.v_othoba_flag_summary from anon,authenticated;
grant select on public.v_othoba_flags,public.v_othoba_flag_summary to service_role;

commit;

-- ============================================================
-- V2.13 — CPP reference uploader
-- ============================================================
-- UBL Availability V2.13 — versioned CPP reference uploader

begin;

create table if not exists public.cpp_reference_sets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_file_name text not null,
  parser_profile text not null,
  effective_from date not null,
  effective_to date,
  status text not null default 'live' check (status in ('live','replaced','closed')),
  default_tolerance_pct numeric(10,6) not null default 0.01 check (default_tolerance_pct >= 0 and default_tolerance_pct <= 1),
  rows_total integer not null default 0,
  rows_scrapable integer not null default 0,
  rows_mapped integer not null default 0,
  rows_unmapped integer not null default 0,
  uploaded_at timestamptz not null default now()
);

create unique index if not exists uq_cpp_reference_sets_live_account
  on public.cpp_reference_sets(account_id)
  where status='live';

create index if not exists idx_cpp_reference_sets_account_date
  on public.cpp_reference_sets(account_id,effective_from desc,uploaded_at desc);

create table if not exists public.cpp_targets (
  id uuid primary key default gen_random_uuid(),
  reference_set_id uuid not null references public.cpp_reference_sets(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_identifier text not null,
  account_sku text,
  product_id uuid references public.products(id) on delete set null,
  basepack_id uuid references public.basepacks(id) on delete set null,
  source_packsize text,
  product_name text,
  brand text,
  category text,
  expected_price numeric(14,2) not null check (expected_price >= 0),
  mrp numeric(14,2),
  support_amount numeric(14,2),
  tolerance_pct numeric(10,6) not null default 0.01 check (tolerance_pct >= 0 and tolerance_pct <= 1),
  mapping_status text not null default 'unmapped'
    check (mapping_status in ('direct_mapped','direct_unmapped','master_exact','master_fuzzy','unmapped')),
  match_score numeric(8,5),
  scrapable boolean not null default false,
  active boolean not null default true,
  source_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_cpp_target_reference_source
  on public.cpp_targets(reference_set_id,source_identifier);

create index if not exists idx_cpp_targets_account_sku
  on public.cpp_targets(account_id,account_sku)
  where active=true and scrapable=true and account_sku is not null;

create index if not exists idx_cpp_targets_reference
  on public.cpp_targets(reference_set_id,active);

create or replace view public.v_cpp_master_lookup
with (security_invoker=true)
as
select
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  pai.account_sku,
  p.id as product_id,
  p.ubl_code,
  p.name as product_name,
  p.basepack_id,
  b.packsize,
  p.brand,
  p.category,
  p.sub_category,
  p.business_group
from public.product_account_ids pai
join public.accounts a on a.id=pai.account_id and a.active=true
join public.products p on p.id=pai.product_id and p.status='active'
join public.basepacks b on b.id=p.basepack_id;

create or replace function public.commit_cpp_reference_set_v2(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id uuid := (payload->>'account_id')::uuid;
  v_file text := payload->>'source_file_name';
  v_profile text := payload->>'parser_profile';
  v_from date := (payload->>'effective_from')::date;
  v_to date := nullif(payload->>'effective_to','')::date;
  v_tol numeric := coalesce(nullif(payload->>'default_tolerance_pct','')::numeric,0.01);
  v_rows jsonb := coalesce(payload->'rows','[]'::jsonb);
  v_row jsonb;
  v_set_id uuid;
  v_total integer := 0;
  v_scrapable integer := 0;
  v_mapped integer := 0;
  v_unmapped integer := 0;
begin
  if v_account_id is null then raise exception 'account_id is required'; end if;
  if coalesce(v_file,'')='' then raise exception 'source_file_name is required'; end if;
  if coalesce(v_profile,'')='' then raise exception 'parser_profile is required'; end if;
  if v_from is null then raise exception 'effective_from is required'; end if;
  if v_to is not null and v_to < v_from then raise exception 'effective_to cannot be earlier than effective_from'; end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows)=0 then
    raise exception 'CPP reference requires at least one row';
  end if;

  update public.cpp_reference_sets
  set status='replaced',
      effective_to=case
        when effective_from < v_from then v_from - 1
        else coalesce(effective_to,v_from)
      end
  where account_id=v_account_id and status='live';

  insert into public.cpp_reference_sets(
    account_id,source_file_name,parser_profile,effective_from,effective_to,status,default_tolerance_pct
  ) values (
    v_account_id,v_file,v_profile,v_from,v_to,'live',v_tol
  ) returning id into v_set_id;

  for v_row in select * from jsonb_array_elements(v_rows)
  loop
    insert into public.cpp_targets(
      reference_set_id,account_id,source_identifier,account_sku,product_id,basepack_id,
      source_packsize,product_name,brand,category,expected_price,mrp,support_amount,
      tolerance_pct,mapping_status,match_score,scrapable,active,source_row
    ) values (
      v_set_id,
      v_account_id,
      btrim(v_row->>'source_identifier'),
      nullif(btrim(v_row->>'account_sku'),''),
      nullif(v_row->>'product_id','')::uuid,
      nullif(v_row->>'basepack_id','')::uuid,
      nullif(v_row->>'source_packsize',''),
      nullif(v_row->>'product_name',''),
      nullif(v_row->>'brand',''),
      nullif(v_row->>'category',''),
      (v_row->>'expected_price')::numeric,
      nullif(v_row->>'mrp','')::numeric,
      nullif(v_row->>'support_amount','')::numeric,
      coalesce(nullif(v_row->>'tolerance_pct','')::numeric,v_tol),
      coalesce(nullif(v_row->>'mapping_status',''),'unmapped'),
      nullif(v_row->>'match_score','')::numeric,
      coalesce((v_row->>'scrapable')::boolean,false),
      coalesce((v_row->>'active')::boolean,true),
      coalesce(v_row->'source_row','{}'::jsonb)
    );
    v_total := v_total + 1;
    if coalesce((v_row->>'scrapable')::boolean,false) then v_scrapable := v_scrapable + 1; end if;
    if nullif(v_row->>'basepack_id','') is not null or nullif(v_row->>'product_id','') is not null then
      v_mapped := v_mapped + 1;
    else
      v_unmapped := v_unmapped + 1;
    end if;
  end loop;

  update public.cpp_reference_sets
  set rows_total=v_total,rows_scrapable=v_scrapable,rows_mapped=v_mapped,rows_unmapped=v_unmapped
  where id=v_set_id;

  return jsonb_build_object(
    'reference_set_id',v_set_id,
    'rows_total',v_total,
    'rows_scrapable',v_scrapable,
    'rows_mapped',v_mapped,
    'rows_unmapped',v_unmapped,
    'effective_from',v_from,
    'effective_to',v_to
  );
end;
$$;

revoke execute on function public.commit_cpp_reference_set_v2(jsonb) from public,anon,authenticated;
grant execute on function public.commit_cpp_reference_set_v2(jsonb) to service_role;

create or replace view public.v_cpp_live_targets
with (security_invoker=true)
as
select
  rs.id as reference_set_id,
  rs.source_file_name,
  rs.parser_profile,
  rs.effective_from,
  rs.effective_to,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  t.id as target_id,
  t.source_identifier,
  t.account_sku,
  t.product_id,
  p.ubl_code,
  t.basepack_id,
  b.packsize as basepack_name,
  t.source_packsize,
  coalesce(t.product_name,p.name) as product_name,
  coalesce(t.brand,p.brand) as brand,
  coalesce(t.category,p.category) as category,
  t.expected_price,
  t.mrp,
  t.support_amount,
  t.tolerance_pct,
  t.mapping_status,
  t.match_score,
  t.scrapable,
  t.active
from public.cpp_targets t
join public.cpp_reference_sets rs on rs.id=t.reference_set_id and rs.status='live'
join public.accounts a on a.id=t.account_id
left join public.products p on p.id=t.product_id
left join public.basepacks b on b.id=t.basepack_id
where t.active=true;

create or replace view public.v_cpp_scrapable_targets
with (security_invoker=true)
as
select *
from public.v_cpp_live_targets
where scrapable=true and account_sku is not null;

create or replace view public.v_cpp_reference_history
with (security_invoker=true)
as
select
  rs.id as reference_set_id,
  a.code as account_code,
  a.name as account_name,
  rs.source_file_name,
  rs.parser_profile,
  rs.effective_from,
  rs.effective_to,
  rs.status,
  rs.default_tolerance_pct,
  rs.rows_total,
  rs.rows_scrapable,
  rs.rows_mapped,
  rs.rows_unmapped,
  rs.uploaded_at
from public.cpp_reference_sets rs
join public.accounts a on a.id=rs.account_id;

alter table public.cpp_reference_sets enable row level security;
alter table public.cpp_targets enable row level security;

revoke all on public.cpp_reference_sets,public.cpp_targets,
              public.v_cpp_master_lookup,public.v_cpp_live_targets,
              public.v_cpp_scrapable_targets,public.v_cpp_reference_history
from anon,authenticated;

grant select,insert,update,delete on public.cpp_reference_sets,public.cpp_targets to service_role;
grant select on public.v_cpp_master_lookup,public.v_cpp_live_targets,
                public.v_cpp_scrapable_targets,public.v_cpp_reference_history
to service_role;

commit;

-- V2.13.1 / V2.13.2 hardening
alter function public.commit_cpp_reference_set_v2(jsonb) security invoker;
revoke execute on function public.commit_cpp_reference_set_v2(jsonb) from public, anon, authenticated;
grant execute on function public.commit_cpp_reference_set_v2(jsonb) to service_role;
alter table public.cpp_reference_sets
  drop constraint if exists cpp_reference_sets_effective_dates_check;
alter table public.cpp_reference_sets
  add constraint cpp_reference_sets_effective_dates_check
  check (effective_to is null or effective_to >= effective_from);

-- ============================================================
-- V2.12 — scraper runtime / current master targets
-- ============================================================
begin;

create table if not exists public.scraper_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  run_date date not null default (timezone('Asia/Dhaka', now())::date),
  checkpoint text not null check (checkpoint in ('am','pm','manual')),
  revision integer not null default 1 check (revision >= 1),
  is_current boolean not null default true,
  supersedes_run_id uuid references public.scraper_runs(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  rows_expected integer not null default 0,
  rows_observed integer not null default 0,
  error_count integer not null default 0,
  worker_version text,
  source text not null default 'cpp_scraper_worker',
  message text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_scraper_runs_current_slot
  on public.scraper_runs(account_id, run_date, checkpoint)
  where is_current = true;

create index if not exists idx_scraper_runs_account_date
  on public.scraper_runs(account_id, run_date desc, checkpoint, revision desc);

create table if not exists public.scraper_price_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.scraper_runs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  observed_at timestamptz not null default now(),
  account_sku text not null,
  branch_code text not null default '',
  branch_name text,
  product_name text,
  live_price numeric(14,2),
  original_price numeric(14,2),
  in_stock boolean,
  scrape_status text not null default 'ok',
  product_url text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(run_id, account_sku, branch_code)
);

create index if not exists idx_scraper_observations_lookup
  on public.scraper_price_observations(account_id, account_sku, observed_at desc);

create index if not exists idx_scraper_observations_run
  on public.scraper_price_observations(run_id);

create or replace view public.v_scraper_latest_observations
with (security_invoker = true)
as
select distinct on (o.account_id, o.account_sku, o.branch_code)
  a.code as account_code,
  a.name as account_name,
  r.run_date,
  r.checkpoint,
  r.revision,
  r.status as run_status,
  o.run_id,
  o.observed_at,
  o.account_sku,
  o.branch_code,
  o.branch_name,
  o.product_name,
  o.live_price,
  o.original_price,
  o.in_stock,
  o.scrape_status,
  o.product_url,
  o.raw
from public.scraper_price_observations o
join public.scraper_runs r on r.id=o.run_id and r.is_current=true
join public.accounts a on a.id=o.account_id
order by o.account_id, o.account_sku, o.branch_code, o.observed_at desc, r.revision desc;

alter table public.scraper_runs enable row level security;
alter table public.scraper_price_observations enable row level security;

revoke all on public.scraper_runs, public.scraper_price_observations,
              public.v_scraper_latest_observations
from anon, authenticated;

grant select, insert, update, delete on public.scraper_runs,
                                      public.scraper_price_observations
to service_role;
grant select on public.v_scraper_latest_observations to service_role;

commit;
begin;

create or replace view public.v_scraper_master_targets
with (security_invoker = true)
as
select
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  pai.account_sku,
  p.id as product_id,
  p.ubl_code,
  p.basepack_id,
  b.packsize as basepack_name,
  p.brand,
  p.business_group,
  p.category,
  p.sub_category
from public.product_account_ids pai
join public.accounts a on a.id=pai.account_id and a.active=true
join public.products p on p.id=pai.product_id and p.status='active'
join public.basepacks b on b.id=p.basepack_id
where a.code in ('daraz','pandamart','shajgoj','foodi','othoba');

revoke all on public.v_scraper_master_targets from anon, authenticated;
grant select on public.v_scraper_master_targets to service_role;

commit;

-- ============================================================
-- V2.14 SoS Phase 1: Keyword Library + Target Product Assignment
-- Source migration: 20261014_sos_phase1_keywords_targets_v214.sql
-- ============================================================
-- SoS Phase 1 foundation: keyword library, account search terms, target assignments.

create table if not exists public.sos_keyword_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_file_name text not null,
  parser_profile text not null,
  rows_total integer not null default 0 check (rows_total >= 0),
  keywords_total integer not null default 0 check (keywords_total >= 0),
  search_terms_total integer not null default 0 check (search_terms_total >= 0),
  target_rows_total integer not null default 0 check (target_rows_total >= 0),
  mapped_targets_total integer not null default 0 check (mapped_targets_total >= 0),
  warnings jsonb not null default '[]'::jsonb,
  imported_at timestamptz not null default now()
);

create table if not exists public.sos_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  normalized_key text not null unique,
  format text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sos_keyword_terms (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.sos_keywords(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  search_term text not null,
  normalized_term text not null,
  is_primary boolean not null default false,
  source_import_id uuid references public.sos_keyword_imports(id) on delete set null,
  active boolean not null default true,
  source_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists sos_keyword_terms_current_uq
  on public.sos_keyword_terms(account_id, normalized_term)
  where active;
create index if not exists sos_keyword_terms_keyword_idx
  on public.sos_keyword_terms(keyword_id, account_id) where active;

create table if not exists public.sos_keyword_targets (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.sos_keywords(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  target_key text not null,
  product_id uuid references public.products(id) on delete set null,
  basepack_id uuid references public.basepacks(id) on delete set null,
  account_sku text,
  target_name text not null,
  assignment_source text not null default 'manual' check (assignment_source in ('manual','import')),
  source_import_id uuid references public.sos_keyword_imports(id) on delete set null,
  mapping_status text not null default 'mapped' check (mapping_status in ('mapped','manual')),
  match_score numeric(6,4),
  active boolean not null default true,
  source_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sos_keyword_targets_current_uq
  on public.sos_keyword_targets(keyword_id, account_id, target_key)
  where active;
create index if not exists sos_keyword_targets_account_idx
  on public.sos_keyword_targets(account_id, keyword_id) where active;

create table if not exists public.sos_import_target_candidates (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.sos_keyword_imports(id) on delete cascade,
  keyword_id uuid not null references public.sos_keywords(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_account_sku text,
  source_name text not null,
  matched_product_id uuid references public.products(id) on delete set null,
  matched_basepack_id uuid references public.basepacks(id) on delete set null,
  matched_account_sku text,
  mapping_status text not null check (mapping_status in ('direct','exact_name','fuzzy_name','unmapped','ambiguous')),
  match_score numeric(6,4),
  accepted boolean not null default false,
  source_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sos_import_target_candidates_import_idx
  on public.sos_import_target_candidates(import_id, keyword_id);

create index if not exists sos_keyword_imports_account_idx on public.sos_keyword_imports(account_id);
create index if not exists sos_keyword_terms_import_idx on public.sos_keyword_terms(source_import_id);
create index if not exists sos_keyword_targets_product_idx on public.sos_keyword_targets(product_id);
create index if not exists sos_keyword_targets_basepack_idx on public.sos_keyword_targets(basepack_id);
create index if not exists sos_keyword_targets_import_idx on public.sos_keyword_targets(source_import_id);
create index if not exists sos_import_target_candidates_keyword_idx on public.sos_import_target_candidates(keyword_id);
create index if not exists sos_import_target_candidates_account_idx on public.sos_import_target_candidates(account_id);
create index if not exists sos_import_target_candidates_product_idx on public.sos_import_target_candidates(matched_product_id);
create index if not exists sos_import_target_candidates_basepack_idx on public.sos_import_target_candidates(matched_basepack_id);

alter table public.sos_keyword_imports enable row level security;
alter table public.sos_keywords enable row level security;
alter table public.sos_keyword_terms enable row level security;
alter table public.sos_keyword_targets enable row level security;
alter table public.sos_import_target_candidates enable row level security;

revoke all on public.sos_keyword_imports from anon, authenticated;
revoke all on public.sos_keywords from anon, authenticated;
revoke all on public.sos_keyword_terms from anon, authenticated;
revoke all on public.sos_keyword_targets from anon, authenticated;
revoke all on public.sos_import_target_candidates from anon, authenticated;

grant select, insert, update, delete on public.sos_keyword_imports to service_role;
grant select, insert, update, delete on public.sos_keywords to service_role;
grant select, insert, update, delete on public.sos_keyword_terms to service_role;
grant select, insert, update, delete on public.sos_keyword_targets to service_role;
grant select, insert, update, delete on public.sos_import_target_candidates to service_role;

create or replace view public.v_sos_product_lookup
with (security_invoker = true)
as
select distinct on (a.code, pai.account_sku, coalesce(p.basepack_id, p.id))
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  pai.account_sku,
  p.id as product_id,
  p.basepack_id,
  b.packsize,
  p.ubl_code,
  p.name as product_name,
  p.brand,
  p.category,
  p.sub_category,
  p.business_group,
  p.hero_image_url
from public.product_account_ids pai
join public.accounts a on a.id = pai.account_id
join public.products p on p.id = pai.product_id
left join public.basepacks b on b.id = p.basepack_id
where p.status = 'active' and a.active
order by a.code, pai.account_sku, coalesce(p.basepack_id, p.id), p.ubl_code;

revoke all on public.v_sos_product_lookup from anon, authenticated;
grant select on public.v_sos_product_lookup to service_role;

create or replace function public.commit_sos_keyword_import_v1(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_code text := lower(trim(payload->>'account_code'));
  v_import_id uuid;
  v_kw jsonb;
  v_term jsonb;
  v_target jsonb;
  v_keyword_id uuid;
  v_target_key text;
  v_mapped integer := 0;
  v_terms integer := 0;
  v_targets integer := 0;
begin
  select id into v_account_id from public.accounts where code = v_account_code and active limit 1;
  if v_account_id is null then
    raise exception 'Unknown or inactive account: %', v_account_code;
  end if;

  insert into public.sos_keyword_imports(
    account_id, source_file_name, parser_profile, rows_total, keywords_total,
    search_terms_total, target_rows_total, mapped_targets_total, warnings
  ) values (
    v_account_id,
    coalesce(payload->>'source_file_name','unknown.xlsx'),
    coalesce(payload->>'parser_profile','SoS keyword import'),
    coalesce((payload->>'rows_total')::integer,0),
    jsonb_array_length(coalesce(payload->'keywords','[]'::jsonb)),
    coalesce((payload->>'search_terms_total')::integer,0),
    coalesce((payload->>'target_rows_total')::integer,0),
    coalesce((payload->>'mapped_targets_total')::integer,0),
    coalesce(payload->'warnings','[]'::jsonb)
  ) returning id into v_import_id;

  -- The uploaded workbook is the current source of search terms for this account.
  update public.sos_keyword_terms set active = false
  where account_id = v_account_id and active;

  -- Imported target assignments are refreshed from the workbook. Manual assignments survive.
  update public.sos_keyword_targets set active = false, updated_at = now()
  where account_id = v_account_id and active and assignment_source = 'import';

  for v_kw in select * from jsonb_array_elements(coalesce(payload->'keywords','[]'::jsonb)) loop
    insert into public.sos_keywords(keyword, normalized_key, format, active, updated_at)
    values (
      trim(v_kw->>'keyword'),
      trim(v_kw->>'normalized_key'),
      coalesce(nullif(trim(v_kw->>'format'),''), trim(v_kw->>'keyword')),
      true,
      now()
    )
    on conflict (normalized_key) do update set
      keyword = excluded.keyword,
      format = case when excluded.format <> '' then excluded.format else public.sos_keywords.format end,
      active = true,
      updated_at = now()
    returning id into v_keyword_id;

    for v_term in select * from jsonb_array_elements(coalesce(v_kw->'terms','[]'::jsonb)) loop
      insert into public.sos_keyword_terms(
        keyword_id, account_id, search_term, normalized_term, is_primary,
        source_import_id, active, source_row
      ) values (
        v_keyword_id, v_account_id,
        trim(v_term->>'search_term'), trim(v_term->>'normalized_term'),
        coalesce((v_term->>'is_primary')::boolean,false),
        v_import_id, true, coalesce(v_term->'source_row','{}'::jsonb)
      );
      v_terms := v_terms + 1;
    end loop;

    for v_target in select * from jsonb_array_elements(coalesce(v_kw->'targets','[]'::jsonb)) loop
      v_targets := v_targets + 1;
      insert into public.sos_import_target_candidates(
        import_id, keyword_id, account_id, source_account_sku, source_name,
        matched_product_id, matched_basepack_id, matched_account_sku,
        mapping_status, match_score, accepted, source_row
      ) values (
        v_import_id, v_keyword_id, v_account_id,
        nullif(trim(v_target->>'source_account_sku'),''),
        coalesce(nullif(trim(v_target->>'source_name'),''),'Unnamed target'),
        nullif(v_target->>'matched_product_id','')::uuid,
        nullif(v_target->>'matched_basepack_id','')::uuid,
        nullif(trim(v_target->>'matched_account_sku'),''),
        coalesce(nullif(v_target->>'mapping_status',''),'unmapped'),
        nullif(v_target->>'match_score','')::numeric,
        coalesce((v_target->>'accepted')::boolean,false),
        coalesce(v_target->'source_row','{}'::jsonb)
      );

      if coalesce((v_target->>'accepted')::boolean,false)
         and nullif(v_target->>'matched_basepack_id','') is not null then
        v_target_key := case
          when nullif(trim(v_target->>'matched_account_sku'),'') is not null
            then 'sku:' || lower(trim(v_target->>'matched_account_sku'))
          else 'basepack:' || (v_target->>'matched_basepack_id')
        end;

        insert into public.sos_keyword_targets(
          keyword_id, account_id, target_key, product_id, basepack_id, account_sku,
          target_name, assignment_source, source_import_id, mapping_status,
          match_score, active, source_row, updated_at
        ) values (
          v_keyword_id, v_account_id, v_target_key,
          nullif(v_target->>'matched_product_id','')::uuid,
          nullif(v_target->>'matched_basepack_id','')::uuid,
          nullif(trim(v_target->>'matched_account_sku'),''),
          coalesce(nullif(trim(v_target->>'source_name'),''),'UBL target'),
          'import', v_import_id, 'mapped',
          nullif(v_target->>'match_score','')::numeric,
          true, coalesce(v_target->'source_row','{}'::jsonb), now()
        )
        on conflict (keyword_id, account_id, target_key) where active
        do update set
          product_id = excluded.product_id,
          basepack_id = excluded.basepack_id,
          account_sku = excluded.account_sku,
          target_name = excluded.target_name,
          source_import_id = excluded.source_import_id,
          match_score = excluded.match_score,
          source_row = excluded.source_row,
          updated_at = now();

        v_mapped := v_mapped + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'import_id', v_import_id,
    'account_code', v_account_code,
    'keywords', jsonb_array_length(coalesce(payload->'keywords','[]'::jsonb)),
    'search_terms', v_terms,
    'target_rows', v_targets,
    'mapped_targets', v_mapped
  );
end;
$$;

revoke all on function public.commit_sos_keyword_import_v1(jsonb) from public, anon, authenticated;
grant execute on function public.commit_sos_keyword_import_v1(jsonb) to service_role;

-- ============================================================
-- SoS Phase 2 (v2.15): run history + classified search results
-- Full canonical DDL lives in migrations/20261014_sos_phase2_shajgoj_v215.sql
-- ============================================================
-- SoS Phase 2: generic run/result foundation + Shajgoj reporting views.
-- Tables remain backend/service-role only, following the rest of the internal V2 app.

create table if not exists public.sos_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  run_date date not null,
  top_n integer not null default 4 check (top_n between 1 and 20),
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('success','partial','error')),
  terms_expected integer not null default 0 check (terms_expected >= 0),
  terms_scraped integer not null default 0 check (terms_scraped >= 0),
  rows_observed integer not null default 0 check (rows_observed >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  source text not null default 'web',
  worker_version text not null default 'sos-v2.15.0',
  message text,
  created_at timestamptz not null default now()
);
create index if not exists sos_runs_account_started_idx on public.sos_runs(account_id, started_at desc);

create table if not exists public.sos_run_targets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.sos_runs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  keyword_id uuid not null references public.sos_keywords(id) on delete cascade,
  target_key text not null,
  product_id uuid references public.products(id) on delete set null,
  basepack_id uuid references public.basepacks(id) on delete set null,
  account_sku text,
  target_name text not null,
  created_at timestamptz not null default now(),
  unique(run_id, keyword_id, target_key)
);
create index if not exists sos_run_targets_run_keyword_idx on public.sos_run_targets(run_id, keyword_id);
create index if not exists sos_run_targets_basepack_idx on public.sos_run_targets(basepack_id);
create index if not exists sos_run_targets_account_idx on public.sos_run_targets(account_id);
create index if not exists sos_run_targets_keyword_idx on public.sos_run_targets(keyword_id);
create index if not exists sos_run_targets_product_idx on public.sos_run_targets(product_id);

create table if not exists public.sos_term_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.sos_runs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  keyword_id uuid not null references public.sos_keywords(id) on delete cascade,
  term_id uuid not null references public.sos_keyword_terms(id) on delete cascade,
  searched_term text not null,
  branch_code text not null default 'all',
  branch_name text,
  status text not null check (status in ('ok','error')),
  total_found integer not null default 0 check (total_found >= 0),
  results_saved integer not null default 0 check (results_saved >= 0),
  searched_at timestamptz not null,
  error_message text,
  created_at timestamptz not null default now(),
  unique(run_id, term_id, branch_code)
);
create index if not exists sos_term_runs_run_idx on public.sos_term_runs(run_id);
create index if not exists sos_term_runs_keyword_idx on public.sos_term_runs(keyword_id);
create index if not exists sos_term_runs_account_idx on public.sos_term_runs(account_id);
create index if not exists sos_term_runs_term_idx on public.sos_term_runs(term_id);

create table if not exists public.sos_search_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.sos_runs(id) on delete cascade,
  term_run_id uuid not null references public.sos_term_runs(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  keyword_id uuid not null references public.sos_keywords(id) on delete cascade,
  term_id uuid not null references public.sos_keyword_terms(id) on delete cascade,
  branch_code text not null default 'all',
  branch_name text,
  searched_term text not null,
  rank integer not null check (rank >= 1),
  marketplace_sku text,
  product_name text not null,
  size text,
  price numeric,
  sale_price numeric,
  stock_qty numeric,
  in_stock boolean,
  product_url text,
  product_id uuid references public.products(id) on delete set null,
  basepack_id uuid references public.basepacks(id) on delete set null,
  matched_brand text,
  is_ubl boolean not null default false,
  is_target boolean not null default false,
  classification text not null check (classification in ('target_ubl','ubl_non_target','competitor')),
  ubl_match_method text not null default 'none',
  ubl_match_score numeric(6,4),
  matched_target_key text,
  matched_target_id uuid references public.sos_run_targets(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(run_id, term_id, branch_code, rank)
);
create index if not exists sos_search_results_run_idx on public.sos_search_results(run_id);
create index if not exists sos_search_results_keyword_idx on public.sos_search_results(keyword_id);
create index if not exists sos_search_results_classification_idx on public.sos_search_results(run_id, classification);
create index if not exists sos_search_results_basepack_idx on public.sos_search_results(basepack_id);
create index if not exists sos_search_results_target_idx on public.sos_search_results(matched_target_id);
create index if not exists sos_search_results_account_idx on public.sos_search_results(account_id);
create index if not exists sos_search_results_product_idx on public.sos_search_results(product_id);
create index if not exists sos_search_results_term_idx on public.sos_search_results(term_id);
create index if not exists sos_search_results_term_run_idx on public.sos_search_results(term_run_id);

alter table public.sos_runs enable row level security;
alter table public.sos_run_targets enable row level security;
alter table public.sos_term_runs enable row level security;
alter table public.sos_search_results enable row level security;
revoke all on public.sos_runs from anon, authenticated;
revoke all on public.sos_run_targets from anon, authenticated;
revoke all on public.sos_term_runs from anon, authenticated;
revoke all on public.sos_search_results from anon, authenticated;
grant select, insert, update, delete on public.sos_runs to service_role;
grant select, insert, update, delete on public.sos_run_targets to service_role;
grant select, insert, update, delete on public.sos_term_runs to service_role;
grant select, insert, update, delete on public.sos_search_results to service_role;

create or replace view public.v_sos_term_metrics with (security_invoker = true) as
select
  tr.run_id, tr.account_id, tr.keyword_id, tr.term_id, tr.searched_term,
  tr.branch_code, tr.branch_name, tr.status, tr.total_found, tr.results_saved,
  r.top_n,
  case when tr.status = 'ok' then r.top_n else null end as top_slots,
  case when tr.status = 'ok' then count(sr.id) filter (where sr.rank <= r.top_n) else null end as results_found,
  case when tr.status = 'ok' then count(sr.id) filter (where sr.rank <= r.top_n and sr.is_ubl) else null end as ubl_count,
  case when tr.status = 'ok' then count(sr.id) filter (where sr.rank <= r.top_n and sr.classification = 'ubl_non_target') else null end as non_target_ubl_count,
  case when tr.status = 'ok' then count(sr.id) filter (where sr.rank <= r.top_n and sr.classification = 'competitor') else null end as competitor_count,
  case when tr.status = 'ok' then count(distinct sr.matched_target_id) filter (where sr.rank <= r.top_n and sr.matched_target_id is not null) else null end as target_hits,
  (select count(*) from public.sos_run_targets rt where rt.run_id = tr.run_id and rt.keyword_id = tr.keyword_id) as assigned_targets,
  case when tr.status = 'ok'
       then (count(sr.id) filter (where sr.rank <= r.top_n and sr.is_ubl))::numeric / nullif(r.top_n, 0)
       else null end as ubl_sos,
  case when tr.status = 'ok'
       then (count(distinct sr.matched_target_id) filter (where sr.rank <= r.top_n and sr.matched_target_id is not null))::numeric
            / nullif((select count(*) from public.sos_run_targets rt where rt.run_id = tr.run_id and rt.keyword_id = tr.keyword_id), 0)
       else null end as target_achievement
from public.sos_term_runs tr
join public.sos_runs r on r.id = tr.run_id
left join public.sos_search_results sr on sr.term_run_id = tr.id
group by tr.id, tr.run_id, tr.account_id, tr.keyword_id, tr.term_id, tr.searched_term,
         tr.branch_code, tr.branch_name, tr.status, tr.total_found, tr.results_saved, r.top_n;

create or replace view public.v_sos_keyword_metrics with (security_invoker = true) as
select
  tm.run_id, tm.account_id, tm.keyword_id, k.format, k.keyword,
  count(*) as terms_attempted,
  count(*) filter (where tm.status = 'ok') as terms_scraped,
  count(*) filter (where tm.status = 'error') as terms_failed,
  sum(tm.top_slots) filter (where tm.status = 'ok') as top_slots,
  sum(tm.results_found) filter (where tm.status = 'ok') as results_found,
  sum(tm.ubl_count) filter (where tm.status = 'ok') as ubl_count,
  sum(tm.non_target_ubl_count) filter (where tm.status = 'ok') as non_target_ubl_count,
  sum(tm.competitor_count) filter (where tm.status = 'ok') as competitor_count,
  sum(tm.target_hits) filter (where tm.status = 'ok') as target_hits,
  sum(tm.assigned_targets) filter (where tm.status = 'ok') as target_opportunities,
  case when sum(tm.top_slots) filter (where tm.status = 'ok') > 0
       then (sum(tm.ubl_count) filter (where tm.status = 'ok'))::numeric / nullif(sum(tm.top_slots) filter (where tm.status = 'ok'), 0)
       else null end as ubl_sos,
  case when sum(tm.assigned_targets) filter (where tm.status = 'ok') > 0
       then (sum(tm.target_hits) filter (where tm.status = 'ok'))::numeric / nullif(sum(tm.assigned_targets) filter (where tm.status = 'ok'), 0)
       else null end as target_achievement
from public.v_sos_term_metrics tm
join public.sos_keywords k on k.id = tm.keyword_id
group by tm.run_id, tm.account_id, tm.keyword_id, k.format, k.keyword;

revoke all on public.v_sos_term_metrics from anon, authenticated;
revoke all on public.v_sos_keyword_metrics from anon, authenticated;
grant select on public.v_sos_term_metrics to service_role;
grant select on public.v_sos_keyword_metrics to service_role;

create or replace function public.commit_sos_run_v1(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_code text := lower(trim(payload->>'account_code'));
  v_run_id uuid;
  v_target jsonb;
  v_term jsonb;
  v_result jsonb;
  v_term_run_id uuid;
  v_target_id uuid;
begin
  select id into v_account_id from public.accounts where code = v_account_code and active limit 1;
  if v_account_id is null then raise exception 'Unknown or inactive account: %', v_account_code; end if;

  insert into public.sos_runs(
    account_id, run_date, top_n, started_at, finished_at, status,
    terms_expected, terms_scraped, rows_observed, error_count,
    source, worker_version, message
  ) values (
    v_account_id, (payload->>'run_date')::date, coalesce((payload->>'top_n')::integer, 4),
    (payload->>'started_at')::timestamptz, (payload->>'finished_at')::timestamptz,
    payload->>'status', coalesce((payload->>'terms_expected')::integer,0),
    coalesce((payload->>'terms_scraped')::integer,0), coalesce((payload->>'rows_observed')::integer,0),
    coalesce((payload->>'error_count')::integer,0), coalesce(nullif(payload->>'source',''),'web'),
    coalesce(nullif(payload->>'worker_version',''),'sos-v2.15.0'), nullif(payload->>'message','')
  ) returning id into v_run_id;

  for v_target in select * from jsonb_array_elements(coalesce(payload->'targets','[]'::jsonb)) loop
    insert into public.sos_run_targets(
      run_id, account_id, keyword_id, target_key, product_id, basepack_id, account_sku, target_name
    ) values (
      v_run_id, v_account_id, (v_target->>'keyword_id')::uuid, v_target->>'target_key',
      nullif(v_target->>'product_id','')::uuid, nullif(v_target->>'basepack_id','')::uuid,
      nullif(v_target->>'account_sku',''), v_target->>'target_name'
    );
  end loop;

  for v_term in select * from jsonb_array_elements(coalesce(payload->'term_runs','[]'::jsonb)) loop
    insert into public.sos_term_runs(
      run_id, account_id, keyword_id, term_id, searched_term, branch_code, branch_name,
      status, total_found, results_saved, searched_at, error_message
    ) values (
      v_run_id, v_account_id, (v_term->>'keyword_id')::uuid, (v_term->>'term_id')::uuid,
      v_term->>'searched_term', coalesce(nullif(v_term->>'branch_code',''),'all'), nullif(v_term->>'branch_name',''),
      v_term->>'status', coalesce((v_term->>'total_found')::integer,0), coalesce((v_term->>'results_saved')::integer,0),
      (v_term->>'searched_at')::timestamptz, nullif(v_term->>'error_message','')
    ) returning id into v_term_run_id;

    for v_result in select * from jsonb_array_elements(coalesce(v_term->'results','[]'::jsonb)) loop
      v_target_id := null;
      if nullif(v_result->>'matched_target_key','') is not null then
        select id into v_target_id from public.sos_run_targets
        where run_id = v_run_id and keyword_id = (v_term->>'keyword_id')::uuid
          and target_key = v_result->>'matched_target_key'
        limit 1;
      end if;

      insert into public.sos_search_results(
        run_id, term_run_id, account_id, keyword_id, term_id, branch_code, branch_name,
        searched_term, rank, marketplace_sku, product_name, size, price, sale_price,
        stock_qty, in_stock, product_url, product_id, basepack_id, matched_brand,
        is_ubl, is_target, classification, ubl_match_method, ubl_match_score,
        matched_target_key, matched_target_id, raw, observed_at
      ) values (
        v_run_id, v_term_run_id, v_account_id, (v_term->>'keyword_id')::uuid, (v_term->>'term_id')::uuid,
        coalesce(nullif(v_term->>'branch_code',''),'all'), nullif(v_term->>'branch_name',''),
        v_term->>'searched_term', (v_result->>'rank')::integer, nullif(v_result->>'marketplace_sku',''),
        v_result->>'product_name', nullif(v_result->>'size',''), nullif(v_result->>'price','')::numeric,
        nullif(v_result->>'sale_price','')::numeric, nullif(v_result->>'stock_qty','')::numeric,
        nullif(v_result->>'in_stock','')::boolean, nullif(v_result->>'product_url',''),
        nullif(v_result->>'product_id','')::uuid, nullif(v_result->>'basepack_id','')::uuid,
        nullif(v_result->>'matched_brand',''), coalesce((v_result->>'is_ubl')::boolean,false),
        coalesce((v_result->>'is_target')::boolean,false), v_result->>'classification',
        coalesce(nullif(v_result->>'ubl_match_method',''),'none'), nullif(v_result->>'ubl_match_score','')::numeric,
        nullif(v_result->>'matched_target_key',''), v_target_id, coalesce(v_result->'raw','{}'::jsonb),
        (v_result->>'observed_at')::timestamptz
      );
    end loop;
  end loop;

  return v_run_id;
end;
$$;
revoke all on function public.commit_sos_run_v1(jsonb) from public, anon, authenticated;
grant execute on function public.commit_sos_run_v1(jsonb) to service_role;
