import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { buildSalesSharePeriod, createSalesShareResolver, type SalesShareInputRow } from '@/lib/sales-share';

export const runtime = 'nodejs';

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Failed to load Othoba intelligence.';
}

async function fetchPaged(factory: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const pageSize = 1000;
  const rows: unknown[] = [];
  for (let from = 0; ; from += pageSize) {
    const response = await factory(from, from + pageSize - 1);
    if (response.error) throw response.error;
    const page = response.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function isPartialMonth(monthStart: string, periodEnd: string) {
  const start = new Date(`${monthStart}T00:00:00Z`);
  const expectedEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const actualEnd = new Date(`${periodEnd}T00:00:00Z`);
  return actualEnd.getUTCFullYear() !== expectedEnd.getUTCFullYear() || actualEnd.getUTCMonth() !== expectedEnd.getUTCMonth() || actualEnd.getUTCDate() !== expectedEnd.getUTCDate();
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const account = await supabase.from('accounts').select('id').eq('code', 'othoba').maybeSingle();
    if (account.error) throw account.error;
    if (!account.data?.id) throw new Error('Othoba account is missing from master accounts.');

    const [current, daily, monthly, snapshots, monthlySales, flags, flagSummary, mappings, products] = await Promise.all([
      supabase.from('v_othoba_current_basepacks').select('*').order('packsize').range(0, 999),
      supabase.from('v_othoba_daily_ola').select('*').order('stock_date', { ascending: false }).limit(62),
      supabase.from('v_othoba_monthly_ola').select('*').order('month_start', { ascending: false }).limit(12),
      supabase.from('v_othoba_sales_snapshot_summary').select('*').order('period_end', { ascending: false }).limit(24),
      supabase.from('v_othoba_monthly_sales_summary').select('*').order('month_start', { ascending: false }).limit(24),
      supabase.from('v_othoba_flags').select('*').order('priority').order('mtd_sold_qty', { ascending: false }).range(0, 999),
      supabase.from('v_othoba_flag_summary').select('*').order('stock_date', { ascending: false }).limit(1),
      supabase.from('product_account_ids').select('account_sku,product_id').eq('account_id', account.data.id).range(0, 999),
      supabase.from('products').select('id,name,brand,product_type').eq('status', 'active').range(0, 999),
    ]);
    for (const response of [current, daily, monthly, snapshots, monthlySales, flags, flagSummary, mappings, products]) if (response.error) throw response.error;

    const summaryRows = monthlySales.data ?? [];
    const oldestMonth = summaryRows.length ? String(summaryRows[summaryRows.length - 1].month_start) : '1900-01-01';
    const rawMonthly = await fetchPaged((from, to) => supabase
      .from('othoba_monthly_sales')
      .select('month_start,period_end,account_sku,item_name,sold_qty,total_amount')
      .gte('month_start', oldestMonth)
      .order('month_start', { ascending: false })
      .range(from, to));

    const resolveProduct = createSalesShareResolver(
      (mappings.data ?? []).map((row) => ({ account_sku: String(row.account_sku), product_id: String(row.product_id) })),
      (products.data ?? []).map((row) => ({ id: String(row.id), name: row.name, brand: row.brand, product_type: row.product_type })),
    );

    const rawRows = rawMonthly as Array<{ month_start: string; period_end: string; account_sku: string; item_name: string | null; sold_qty: number | string | null; total_amount: number | string | null }>;
    const monthlyMix = summaryRows.map((summary) => {
      const key = String(summary.month_start);
      const end = String(summary.month_end);
      const rows: SalesShareInputRow[] = rawRows
        .filter((row) => String(row.month_start) === key)
        .map((row) => ({ account_sku: row.account_sku, item_name: row.item_name, sold_qty: row.sold_qty, sales_value: row.total_amount }));
      return buildSalesSharePeriod(rows, resolveProduct, {
        key,
        label: monthLabel(key),
        period_start: key,
        period_end: end,
        is_partial: isPartialMonth(key, end),
      });
    });

    return NextResponse.json({
      current: current.data ?? [], daily: daily.data ?? [], monthly: monthly.data ?? [],
      salesSnapshots: snapshots.data ?? [], monthlySales: summaryRows,
      salesMix: { monthly: monthlyMix, formatDefinition: 'UBL master Product Type' },
      flags: flags.data ?? [], flagSummary: flagSummary.data?.[0] ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: errorText(error) }, { status: 500 });
  }
}
