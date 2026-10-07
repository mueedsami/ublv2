-- UBL Availability V2.8 — Central availability normalization across the five completed accounts

begin;

create or replace view public.v_central_availability_current
with (security_invoker = true)
as
with account_meta as (
  select code, name, sort_order
  from public.accounts
  where active = true
    and code in ('pandamart','shajgoj','foodi','othoba','daraz')
),
pandamart_latest as (
  select max(stock_date) as stock_date from public.pandamart_basepack_daily
),
pandamart_current as (
  select
    'pandamart'::text as account_code,
    a.name as account_name,
    a.sort_order,
    d.stock_date as observation_date,
    d.basepack_id,
    d.packsize,
    d.brands,
    d.business_groups,
    d.categories,
    d.sub_categories,
    d.product_types,
    d.retail_types,
    d.variants,
    count(*)::integer as expected_units,
    count(*) filter (where d.is_available)::integer as available_units,
    round((count(*) filter (where d.is_available))::numeric / nullif(count(*),0), 6) as availability_score,
    coalesce(sum(d.stock_qty),0)::numeric(18,4) as stock_qty,
    null::numeric(18,4) as stock_valuation
  from public.pandamart_basepack_daily d
  join pandamart_latest l on l.stock_date = d.stock_date
  join account_meta a on a.code = 'pandamart'
  group by a.name,a.sort_order,d.stock_date,d.basepack_id,d.packsize,
           d.brands,d.business_groups,d.categories,d.sub_categories,
           d.product_types,d.retail_types,d.variants
),
shajgoj_current as (
  select 'shajgoj'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,d.basepack_id,d.packsize,
         d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
         1::integer as expected_units,case when d.is_available then 1 else 0 end::integer as available_units,
         case when d.is_available then 1::numeric else 0::numeric end as availability_score,
         d.stock_qty::numeric(18,4) as stock_qty,null::numeric(18,4) as stock_valuation
  from public.v_shajgoj_current_basepacks d join account_meta a on a.code='shajgoj'
),
foodi_current as (
  select 'foodi'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,d.basepack_id,d.packsize,
         d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
         1::integer as expected_units,case when d.is_available then 1 else 0 end::integer as available_units,
         case when d.is_available then 1::numeric else 0::numeric end as availability_score,
         d.stock_qty::numeric(18,4) as stock_qty,null::numeric(18,4) as stock_valuation
  from public.v_foodi_current_basepacks d join account_meta a on a.code='foodi'
),
othoba_current as (
  select 'othoba'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,d.basepack_id,d.packsize,
         d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
         1::integer as expected_units,case when d.is_available then 1 else 0 end::integer as available_units,
         case when d.is_available then 1::numeric else 0::numeric end as availability_score,
         d.stock_qty::numeric(18,4) as stock_qty,null::numeric(18,4) as stock_valuation
  from public.v_othoba_current_basepacks d join account_meta a on a.code='othoba'
),
daraz_current as (
  select 'daraz'::text as account_code,a.name as account_name,a.sort_order,d.stock_date as observation_date,d.basepack_id,d.packsize,
         d.brands,d.business_groups,d.categories,d.sub_categories,d.product_types,d.retail_types,d.variants,
         1::integer as expected_units,case when d.is_available then 1 else 0 end::integer as available_units,
         case when d.is_available then 1::numeric else 0::numeric end as availability_score,
         d.stock_qty::numeric(18,4) as stock_qty,d.stock_valuation::numeric(18,4) as stock_valuation
  from public.v_daraz_current_basepacks d join account_meta a on a.code='daraz'
)
select account_code,account_name,sort_order,observation_date,basepack_id,packsize,
       brands,business_groups,categories,sub_categories,product_types,retail_types,variants,
       expected_units,available_units,availability_score,
       (availability_score > 0)::boolean as is_available,
       stock_qty,stock_valuation
from pandamart_current
union all
select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,
       expected_units,available_units,availability_score,(availability_score > 0),stock_qty,stock_valuation
from shajgoj_current
union all
select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,
       expected_units,available_units,availability_score,(availability_score > 0),stock_qty,stock_valuation
from foodi_current
union all
select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,
       expected_units,available_units,availability_score,(availability_score > 0),stock_qty,stock_valuation
from othoba_current
union all
select account_code,account_name,sort_order,observation_date,basepack_id,packsize,brands,business_groups,categories,sub_categories,product_types,retail_types,variants,
       expected_units,available_units,availability_score,(availability_score > 0),stock_qty,stock_valuation
from daraz_current;

create or replace view public.v_central_account_ola_current
with (security_invoker = true)
as
select
  account_code,
  max(account_name) as account_name,
  min(sort_order) as sort_order,
  max(observation_date) as observation_date,
  count(*)::integer as in_scope_basepacks,
  round(sum(availability_score),4) as available_equivalent_basepacks,
  count(*) filter (where availability_score = 1)::integer as fully_available_basepacks,
  count(*) filter (where availability_score > 0 and availability_score < 1)::integer as partially_available_basepacks,
  count(*) filter (where availability_score = 0)::integer as unavailable_basepacks,
  round(100 * avg(availability_score),2) as ola_pct
from public.v_central_availability_current
group by account_code;

create or replace view public.v_central_ola_current
with (security_invoker = true)
as
select
  count(*)::integer as valid_account_basepack_cells,
  count(distinct basepack_id)::integer as basepacks,
  count(distinct account_code)::integer as accounts,
  round(sum(availability_score),4) as available_equivalent_cells,
  round(100 * avg(availability_score),2) as central_ola_pct
from public.v_central_availability_current;

revoke all on public.v_central_availability_current,
              public.v_central_account_ola_current,
              public.v_central_ola_current
from anon, authenticated;
grant select on public.v_central_availability_current,
                public.v_central_account_ola_current,
                public.v_central_ola_current
to service_role;

commit;
