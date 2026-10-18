import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { buildSalesSharePeriod, createSalesShareResolver, type SalesShareInputRow } from '@/lib/sales-share';

export const runtime = 'nodejs';

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Failed to load Pandamart intelligence.';
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

function addDays(value: string, days: number) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(value: string) { return `${value.slice(0, 7)}-01`; }
function dateLabel(value: string) { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)); }

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [account, latestSale] = await Promise.all([
      supabase.from('accounts').select('id').eq('code', 'pandamart').maybeSingle(),
      supabase.from('pandamart_sales_daily').select('sale_date').order('sale_date', { ascending: false }).limit(1),
    ]);
    if (account.error) throw account.error;
    if (latestSale.error) throw latestSale.error;
    if (!account.data?.id) throw new Error('Pandamart account is missing from master accounts.');

    const latestSaleDate = latestSale.data?.[0]?.sale_date ? String(latestSale.data[0].sale_date) : null;
    const start30 = latestSaleDate ? addDays(latestSaleDate, -29) : null;
    const startMtd = latestSaleDate ? monthStart(latestSaleDate) : null;

    const [latestBranches, dailySummary, monthly, sales, flags, mappings, products] = await Promise.all([
      supabase.from('v_pandamart_latest_branch_ola').select('*').order('sort_order'),
      supabase.from('v_pandamart_daily_summary').select('*').order('stock_date', { ascending: false }).limit(62),
      supabase.from('v_pandamart_monthly_ola').select('*').order('month_start', { ascending: false }).limit(12),
      supabase.from('v_pandamart_sales_30d').select('*').order('sold_qty_30d', { ascending: false }).limit(20),
      supabase.from('v_pandamart_flags').select('*').order('severity').limit(100),
      supabase.from('product_account_ids').select('account_sku,product_id').eq('account_id', account.data.id).range(0, 999),
      supabase.from('products').select('id,name,brand,product_type').eq('status', 'active').range(0, 999),
    ]);
    for (const response of [latestBranches, dailySummary, monthly, sales, flags, mappings, products]) if (response.error) throw response.error;

    let salesMixPeriods: ReturnType<typeof buildSalesSharePeriod>[] = [];
    if (latestSaleDate && start30 && startMtd) {
      const rawSales = await fetchPaged((from, to) => supabase
        .from('pandamart_sales_daily')
        .select('sale_date,account_sku,item_name,gfv_local,sold_qty')
        .gte('sale_date', start30)
        .lte('sale_date', latestSaleDate)
        .order('sale_date', { ascending: false })
        .range(from, to));

      const resolveProduct = createSalesShareResolver(
        (mappings.data ?? []).map((row) => ({ account_sku: String(row.account_sku), product_id: String(row.product_id) })),
        (products.data ?? []).map((row) => ({ id: String(row.id), name: row.name, brand: row.brand, product_type: row.product_type })),
      );
      const rows = rawSales as Array<{ sale_date: string; account_sku: string; item_name: string | null; gfv_local: number | string | null; sold_qty: number | string | null }>;
      const toInput = (input: typeof rows): SalesShareInputRow[] => input.map((row) => ({ account_sku: row.account_sku, item_name: row.item_name, sold_qty: row.sold_qty, sales_value: row.gfv_local }));

      salesMixPeriods = [
        buildSalesSharePeriod(toInput(rows.filter((row) => row.sale_date === latestSaleDate)), resolveProduct, {
          key: 'latest-day', label: `Latest day · ${dateLabel(latestSaleDate)}`, period_start: latestSaleDate, period_end: latestSaleDate, is_partial: false,
        }),
        buildSalesSharePeriod(toInput(rows.filter((row) => row.sale_date >= startMtd && row.sale_date <= latestSaleDate)), resolveProduct, {
          key: 'mtd', label: `MTD · ${dateLabel(startMtd)} – ${dateLabel(latestSaleDate)}`, period_start: startMtd, period_end: latestSaleDate, is_partial: true,
        }),
        buildSalesSharePeriod(toInput(rows), resolveProduct, {
          key: 'last-30d', label: `Last 30 days · ${dateLabel(start30)} – ${dateLabel(latestSaleDate)}`, period_start: start30, period_end: latestSaleDate, is_partial: false,
        }),
      ];
    }

    return NextResponse.json({
      latestBranches: latestBranches.data ?? [],
      latestSummary: dailySummary.data?.[0] ?? null,
      daily: dailySummary.data ?? [],
      monthly: monthly.data ?? [],
      topSales: sales.data ?? [],
      salesMix: { periods: salesMixPeriods, formatDefinition: 'UBL master Product Type', valueDefinition: 'Pandamart GFV (gfv_local)' },
      flags: flags.data ?? [],
    });
  } catch (error) {
    return NextResponse.json({ error: errorText(error) }, { status: 500 });
  }
}
