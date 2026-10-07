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
