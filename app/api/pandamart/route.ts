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
      supabase.from('products').select('id,ubl_code,name,brand,category,product_type').eq('status', 'active').range(0, 999),
    ]);
    for (const response of [latestBranches, dailySummary, monthly, sales, flags, mappings, products]) if (response.error) throw response.error;

    let salesMixPeriods: ReturnType<typeof buildSalesSharePeriod>[] = [];
    // Item_Name is supplied by the Pandamart workbook's Last 30 Days Sales sheet.
    // Preserve it as a fallback for SKUs not present in the UBL master.
    const uploadedNames = new Map<string, string>();
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
      for (const row of rows) {
        const sku = String(row.account_sku).trim();
        const name = String(row.item_name ?? '').trim();
        if (sku && name && !uploadedNames.has(sku)) uploadedNames.set(sku, name);
      }
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

    // Read the most recent stored Pandamart stock snapshot. DC is a distinct
    // branch in this table; it is never included in customer-facing OLA.
    const latestStock = await supabase.from('pandamart_stock_daily')
      .select('stock_date').order('stock_date', { ascending: false }).limit(1);
    if (latestStock.error) throw latestStock.error;
    const gapStockDate = latestStock.data?.[0]?.stock_date ? String(latestStock.data[0].stock_date) : null;
    let dcGaps: Array<{
      stock_date: string; account_sku: string; ubl_code: string | null;
      product_name: string; brand: string | null; category: string | null;
      branch_code: string; branch_name: string; branch_stock: number;
      dc_stock: number | null; status: 'dc_available' | 'dc_empty' | 'dc_unknown';
      mapping_status: 'mapped' | 'unmapped';
    }> = [];
    if (gapStockDate) {
      const [branchResult, snapshotRows] = await Promise.all([
        supabase.from('pandamart_branches').select('id,code,name,is_dc,active,sort_order')
          .eq('active', true).order('sort_order'),
        fetchPaged((from, to) => supabase.from('pandamart_stock_daily')
          .select('account_sku,branch_id,stock_qty').eq('stock_date', gapStockDate)
          .order('account_sku').order('branch_id').range(from, to)),
      ]);
      if (branchResult.error) throw branchResult.error;
      const branchList = branchResult.data ?? [];
      const dcIds = new Set(branchList.filter((b) => b.is_dc).map((b) => String(b.id)));
      const branchById = new Map(branchList.filter((b) => !b.is_dc).map((b) => [String(b.id), b]));
      const dcBySku = new Map<string, number>();
      const observedDc = new Set<string>();
      const branchBySkuAndId = new Map<string, number>();
      for (const raw of snapshotRows) {
        const r = raw as { account_sku: string; branch_id: string; stock_qty: number | string | null };
        const sku = String(r.account_sku);
        const qty = Number(r.stock_qty ?? 0);
        if (dcIds.has(String(r.branch_id))) {
          dcBySku.set(sku, (dcBySku.get(sku) ?? 0) + qty);
          observedDc.add(sku);
        } else if (branchById.has(String(r.branch_id))) {
          const key = `${sku}::${r.branch_id}`;
          branchBySkuAndId.set(key, (branchBySkuAndId.get(key) ?? 0) + qty);
        }
      }
      // Search older uploaded sales rows too, because a stock SKU may have had
      // no sales in the latest 30-day window. The stock sheet itself contains
      // no product-name field in the current Pandamart parser.
      const missingNames = new Set([...branchBySkuAndId.keys()].map((key) => key.slice(0, key.lastIndexOf('::'))).filter((sku) => !uploadedNames.has(sku)));
      if (missingNames.size) {
        const historicalNames = await fetchPaged((from, to) => supabase
          .from('pandamart_sales_daily')
          .select('account_sku,item_name')
          .not('item_name', 'is', null)
          .order('sale_date', { ascending: false })
          .order('account_sku')
          .range(from, to));
        for (const raw of historicalNames) {
          const row = raw as { account_sku: string; item_name: string | null };
          const sku = String(row.account_sku).trim();
          const name = String(row.item_name ?? '').trim();
          if (missingNames.has(sku) && name && !uploadedNames.has(sku)) {
            uploadedNames.set(sku, name);
            missingNames.delete(sku);
          }
          if (!missingNames.size) break;
        }
      }
      const skuProduct = new Map<string, { ubl_code: string | null; name: string; brand: string | null; category: string | null }>();
      const productById = new Map((products.data ?? []).map((product) => [String(product.id), product]));
      for (const mapping of mappings.data ?? []) {
        const product = productById.get(String(mapping.product_id));
        if (!product) continue;
        const full = product as typeof product & { ubl_code?: string | null; category?: string | null };
        skuProduct.set(String(mapping.account_sku), {
          ubl_code: full.ubl_code ?? null, name: full.name ?? String(mapping.account_sku),
          brand: full.brand ?? null, category: full.category ?? null,
        });
      }
      for (const [key, qty] of branchBySkuAndId) {
        if (qty > 0) continue;
        const split = key.lastIndexOf('::');
        const sku = key.slice(0, split);
        const branch = branchById.get(key.slice(split + 2));
        if (!branch) continue;
        const product = skuProduct.get(sku);
        const dcStock = observedDc.has(sku) ? dcBySku.get(sku)! : null;
        dcGaps.push({
          stock_date: gapStockDate, account_sku: sku,
          ubl_code: product?.ubl_code ?? null, product_name: product?.name || uploadedNames.get(sku) || sku,
          brand: product?.brand ?? null, category: product?.category ?? null,
          branch_code: branch.code, branch_name: branch.name, branch_stock: qty,
          dc_stock: dcStock,
          status: dcStock === null ? 'dc_unknown' : dcStock > 0 ? 'dc_available' : 'dc_empty',
          mapping_status: product ? 'mapped' : 'unmapped',
        });
      }
      dcGaps.sort((a, b) => a.branch_name.localeCompare(b.branch_name) || a.product_name.localeCompare(b.product_name));
    }

    return NextResponse.json({
      latestBranches: latestBranches.data ?? [],
      dcGaps: { stockDate: gapStockDate, rows: dcGaps },
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
