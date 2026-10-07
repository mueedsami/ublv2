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
