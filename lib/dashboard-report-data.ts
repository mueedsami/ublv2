import { getSupabaseAdmin } from '@/lib/supabase-admin';

const REPORTING_ACCOUNTS = [
  { code: 'daraz', name: 'Daraz', order: 1 },
  { code: 'pandamart', name: 'Pandamart', order: 2 },
  { code: 'shajgoj', name: 'Shajgoj', order: 3 },
  { code: 'foodi', name: 'Foodi', order: 4 },
  { code: 'othoba', name: 'Othoba', order: 5 },
] as const;

type ProductRow = {
  id: string;
  basepack_id: string | null;
  ubl_code: string;
  name: string;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
  tp: number | string | null;
  mrp: number | string | null;
};

type MappingRow = {
  product_id: string;
  account_id: string;
  account_sku: string;
};

type AccountRow = { id: string; code: string; name: string; sort_order: number };

type TargetSku = {
  accountCode: string;
  accountName: string;
  accountSku: string;
  tp: number | null;
  productNames: string[];
  ublCodes: string[];
  productIds: string[];
};

export type DashboardMetricRow = {
  accountCode: string;
  accountName: string;
  mapped: boolean;
  mappedSkus: number;
  accountSkus: string[];
  productNames: string[];
  stockQty: number | null;
  stockValue: number | null;
  stockDate: string | null;
  salesQty: number | null;
  salesValue: number | null;
  salesPeriodStart: string | null;
  salesPeriodEnd: string | null;
  salesBasis: string;
  salesComparable: boolean;
  valuationComplete: boolean;
  note: string | null;
};

export type DashboardReport = {
  mode: 'basepack' | 'sku';
  monthStart: string;
  asOf: string;
  basepack: null | {
    id: string;
    packsize: string;
    productNames: string[];
    ublCodes: string[];
    brands: string[];
  };
  sku: null | {
    accountCode: string;
    accountSku: string;
    productNames: string[];
    ublCodes: string[];
    basepackId: string | null;
    packsize: string | null;
  };
  rows: DashboardMetricRow[];
  totals: {
    stockQty: number;
    stockValue: number;
    salesQty: number;
    salesValue: number;
    mappedAccounts: number;
    reportingAccounts: number;
    comparableSalesAccounts: number;
  };
};

const num = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const uniq = <T,>(values: T[]) => Array.from(new Set(values));

function valueFromRows(rows: any[], qtyKey: string, tpBySku: Map<string, number | null>) {
  let qty = 0;
  let value = 0;
  let complete = true;
  for (const row of rows) {
    const q = num(row[qtyKey]);
    qty += q;
    const tp = tpBySku.get(String(row.account_sku));
    if (q !== 0 && (tp === null || tp === undefined || !Number.isFinite(tp))) {
      complete = false;
      continue;
    }
    value += q * (tp ?? 0);
  }
  return { qty, value: complete ? value : null, complete };
}

function monthEnd(monthStart: string) {
  const [y, m] = monthStart.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function clampAsOf(monthStart: string, asOf: string) {
  const end = monthEnd(monthStart);
  if (asOf < monthStart) return monthStart;
  if (asOf > end) return end;
  return asOf;
}

async function latestDate(
  table: string,
  dateColumn: string,
  skuColumn: string,
  skus: string[],
  monthStart: string,
  asOf: string,
) {
  if (!skus.length) return null;
  const s = getSupabaseAdmin();
  const { data, error } = await s
    .from(table)
    .select(dateColumn)
    .in(skuColumn, skus)
    .gte(dateColumn, monthStart)
    .lte(dateColumn, asOf)
    .order(dateColumn, { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.[dateColumn] ? String(data[0][dateColumn]) : null;
}

async function darazMetrics(targets: TargetSku[], monthStart: string, asOf: string): Promise<Partial<DashboardMetricRow>> {
  const skus = targets.map((x) => x.accountSku);
  if (!skus.length) return { salesBasis: 'GIS MTD from Daraz DOD', salesComparable: true };
  const stockDate = await latestDate('daraz_stock_daily', 'stock_date', 'account_sku', skus, monthStart, asOf);
  if (!stockDate) return { stockDate: null, salesBasis: 'GIS MTD from Daraz DOD', salesComparable: true, note: 'No Daraz DOD snapshot in the selected month.' };
  const s = getSupabaseAdmin();
  const { data, error } = await s.from('daraz_stock_daily').select('account_sku,stock_qty,gis').eq('stock_date', stockDate).in('account_sku', skus).range(0, 4999);
  if (error) throw error;
  const rows = data ?? [];
  const tp = new Map(targets.map((x) => [x.accountSku, x.tp]));
  const stock = valueFromRows(rows, 'stock_qty', tp);
  const sales = valueFromRows(rows, 'gis', tp);
  return {
    stockQty: stock.qty,
    stockValue: stock.value,
    stockDate,
    salesQty: sales.qty,
    salesValue: sales.value,
    salesPeriodStart: monthStart,
    salesPeriodEnd: stockDate,
    salesBasis: 'GIS MTD from latest Daraz DOD snapshot',
    salesComparable: true,
    valuationComplete: stock.complete && sales.complete,
  };
}

async function pandamartMetrics(targets: TargetSku[], monthStart: string, asOf: string): Promise<Partial<DashboardMetricRow>> {
  const skus = targets.map((x) => x.accountSku);
  if (!skus.length) return { salesBasis: 'Calendar-month daily sales', salesComparable: true };
  const s = getSupabaseAdmin();
  const stockDate = await latestDate('pandamart_stock_daily', 'stock_date', 'account_sku', skus, monthStart, asOf);
  const [stockResp, salesResp] = await Promise.all([
    stockDate
      ? s.from('pandamart_stock_daily').select('account_sku,stock_qty').eq('stock_date', stockDate).in('account_sku', skus).range(0, 9999)
      : Promise.resolve({ data: [], error: null } as any),
    s.from('pandamart_sales_daily').select('account_sku,sale_date,sold_qty').in('account_sku', skus).gte('sale_date', monthStart).lte('sale_date', asOf).range(0, 9999),
  ]);
  if (stockResp.error) throw stockResp.error;
  if (salesResp.error) throw salesResp.error;
  const tp = new Map(targets.map((x) => [x.accountSku, x.tp]));
  const stock = valueFromRows(stockResp.data ?? [], 'stock_qty', tp);
  const salesRows = salesResp.data ?? [];
  const sales = valueFromRows(salesRows, 'sold_qty', tp);
  const salesEnd = salesRows.length ? salesRows.reduce((m: string, r: any) => String(r.sale_date) > m ? String(r.sale_date) : m, monthStart) : null;
  return {
    stockQty: stockDate ? stock.qty : null,
    stockValue: stockDate ? stock.value : null,
    stockDate,
    salesQty: sales.qty,
    salesValue: sales.value,
    salesPeriodStart: monthStart,
    salesPeriodEnd: salesEnd,
    salesBasis: 'Sum of daily sold quantity × TP',
    salesComparable: true,
    valuationComplete: stock.complete && sales.complete,
  };
}

function latestRowsPerSku(rows: any[], dateKey: string) {
  const out = new Map<string, any>();
  for (const row of rows) {
    const sku = String(row.account_sku);
    const previous = out.get(sku);
    if (!previous || String(row[dateKey]) > String(previous[dateKey])) out.set(sku, row);
  }
  return [...out.values()];
}

async function shajgojMetrics(targets: TargetSku[], monthStart: string, asOf: string): Promise<Partial<DashboardMetricRow>> {
  const skus = targets.map((x) => x.accountSku);
  if (!skus.length) return { salesBasis: 'Monthly cumulative sales', salesComparable: true };
  const s = getSupabaseAdmin();
  const stockDate = await latestDate('shajgoj_stock_daily', 'stock_date', 'account_sku', skus, monthStart, asOf);
  const [stockResp, salesResp] = await Promise.all([
    stockDate
      ? s.from('shajgoj_stock_daily').select('account_sku,stock_qty').eq('stock_date', stockDate).in('account_sku', skus).range(0, 4999)
      : Promise.resolve({ data: [], error: null } as any),
    s.from('shajgoj_sales_cumulative').select('account_sku,period_start,period_end,sold_qty').eq('period_start', monthStart).in('account_sku', skus).lte('period_end', asOf).order('period_end', { ascending: false }).range(0, 4999),
  ]);
  if (stockResp.error) throw stockResp.error;
  if (salesResp.error) throw salesResp.error;
  const tp = new Map(targets.map((x) => [x.accountSku, x.tp]));
  const stock = valueFromRows(stockResp.data ?? [], 'stock_qty', tp);
  const salesRows = latestRowsPerSku(salesResp.data ?? [], 'period_end');
  const sales = valueFromRows(salesRows, 'sold_qty', tp);
  const salesEnd = salesRows.length ? salesRows.reduce((m: string, r: any) => String(r.period_end) > m ? String(r.period_end) : m, monthStart) : null;
  return {
    stockQty: stockDate ? stock.qty : null,
    stockValue: stockDate ? stock.value : null,
    stockDate,
    salesQty: salesRows.length ? sales.qty : null,
    salesValue: salesRows.length ? sales.value : null,
    salesPeriodStart: salesRows.length ? monthStart : null,
    salesPeriodEnd: salesEnd,
    salesBasis: 'Latest cumulative month-to-date sold quantity × TP',
    salesComparable: true,
    valuationComplete: stock.complete && sales.complete,
  };
}

async function othobaMetrics(targets: TargetSku[], monthStart: string, asOf: string): Promise<Partial<DashboardMetricRow>> {
  const skus = targets.map((x) => x.accountSku);
  if (!skus.length) return { salesBasis: 'Monthly cumulative sales', salesComparable: true };
  const s = getSupabaseAdmin();
  const stockDate = await latestDate('othoba_stock_daily', 'stock_date', 'account_sku', skus, monthStart, asOf);
  const [stockResp, salesResp] = await Promise.all([
    stockDate
      ? s.from('othoba_stock_daily').select('account_sku,stock_qty').eq('stock_date', stockDate).in('account_sku', skus).range(0, 4999)
      : Promise.resolve({ data: [], error: null } as any),
    s.from('othoba_monthly_sales').select('account_sku,month_start,period_end,sold_qty').eq('month_start', monthStart).in('account_sku', skus).lte('period_end', asOf).order('period_end', { ascending: false }).range(0, 4999),
  ]);
  if (stockResp.error) throw stockResp.error;
  if (salesResp.error) throw salesResp.error;
  const tp = new Map(targets.map((x) => [x.accountSku, x.tp]));
  const stock = valueFromRows(stockResp.data ?? [], 'stock_qty', tp);
  const salesRows = latestRowsPerSku(salesResp.data ?? [], 'period_end');
  const sales = valueFromRows(salesRows, 'sold_qty', tp);
  const salesEnd = salesRows.length ? salesRows.reduce((m: string, r: any) => String(r.period_end) > m ? String(r.period_end) : m, monthStart) : null;
  return {
    stockQty: stockDate ? stock.qty : null,
    stockValue: stockDate ? stock.value : null,
    stockDate,
    salesQty: salesRows.length ? sales.qty : null,
    salesValue: salesRows.length ? sales.value : null,
    salesPeriodStart: salesRows.length ? monthStart : null,
    salesPeriodEnd: salesEnd,
    salesBasis: 'Latest cumulative month-to-date sold quantity × TP',
    salesComparable: true,
    valuationComplete: stock.complete && sales.complete,
  };
}

async function foodiMetrics(targets: TargetSku[], monthStart: string, asOf: string): Promise<Partial<DashboardMetricRow>> {
  const skus = targets.map((x) => x.accountSku);
  if (!skus.length) return { salesBasis: 'Rolling 30-day sales', salesComparable: false };
  const s = getSupabaseAdmin();
  const stockDate = await latestDate('foodi_stock_daily', 'stock_date', 'account_sku', skus, monthStart, asOf);
  const [stockResp, salesResp] = await Promise.all([
    stockDate
      ? s.from('foodi_stock_daily').select('account_sku,stock_qty').eq('stock_date', stockDate).in('account_sku', skus).range(0, 4999)
      : Promise.resolve({ data: [], error: null } as any),
    s.from('foodi_sales_30d').select('account_sku,period_start,period_end,sold_qty').in('account_sku', skus).lte('period_end', asOf).gte('period_end', monthStart).order('period_end', { ascending: false }).range(0, 4999),
  ]);
  if (stockResp.error) throw stockResp.error;
  if (salesResp.error) throw salesResp.error;
  const tp = new Map(targets.map((x) => [x.accountSku, x.tp]));
  const stock = valueFromRows(stockResp.data ?? [], 'stock_qty', tp);
  const salesRows = latestRowsPerSku(salesResp.data ?? [], 'period_end');
  const sales = valueFromRows(salesRows, 'sold_qty', tp);
  const starts = salesRows.map((x: any) => String(x.period_start)).filter(Boolean).sort();
  const ends = salesRows.map((x: any) => String(x.period_end)).filter(Boolean).sort();
  const exactMonth = salesRows.length > 0 && starts.every((x) => x === monthStart);
  return {
    stockQty: stockDate ? stock.qty : null,
    stockValue: stockDate ? stock.value : null,
    stockDate,
    salesQty: salesRows.length ? sales.qty : null,
    salesValue: salesRows.length ? sales.value : null,
    salesPeriodStart: starts[0] ?? null,
    salesPeriodEnd: ends.at(-1) ?? null,
    salesBasis: exactMonth ? 'Month-to-date sold quantity × TP' : 'Rolling 30-day sold quantity × TP',
    salesComparable: exactMonth,
    valuationComplete: stock.complete && sales.complete,
    note: exactMonth ? null : 'Foodi source is rolling 30-day sales, so it is shown but excluded from calendar-month sales totals.',
  };
}

async function metricsForAccount(code: string, targets: TargetSku[], monthStart: string, asOf: string) {
  if (code === 'daraz') return darazMetrics(targets, monthStart, asOf);
  if (code === 'pandamart') return pandamartMetrics(targets, monthStart, asOf);
  if (code === 'shajgoj') return shajgojMetrics(targets, monthStart, asOf);
  if (code === 'foodi') return foodiMetrics(targets, monthStart, asOf);
  if (code === 'othoba') return othobaMetrics(targets, monthStart, asOf);
  return { salesBasis: 'No reporting adapter', salesComparable: false };
}

async function loadBasepackTargets(basepackId: string) {
  const s = getSupabaseAdmin();
  const { data: products, error: productError } = await s
    .from('products')
    .select('id,basepack_id,ubl_code,name,brand,category,sub_category,tp,mrp')
    .eq('basepack_id', basepackId)
    .eq('status', 'active')
    .range(0, 999);
  if (productError) throw productError;
  const p = (products ?? []) as ProductRow[];
  const ids = p.map((x) => x.id);
  const [{ data: basepack, error: bpError }, mappingsResp, accountsResp] = await Promise.all([
    s.from('basepacks').select('id,packsize').eq('id', basepackId).maybeSingle(),
    ids.length
      ? s.from('product_account_ids').select('product_id,account_id,account_sku').in('product_id', ids).range(0, 4999)
      : Promise.resolve({ data: [], error: null } as any),
    s.from('accounts').select('id,code,name,sort_order').in('code', REPORTING_ACCOUNTS.map((x) => x.code)).range(0, 100),
  ]);
  if (bpError) throw bpError;
  if (mappingsResp.error) throw mappingsResp.error;
  if (accountsResp.error) throw accountsResp.error;
  if (!basepack) throw new Error('Basepack not found.');
  return { products: p, mappings: (mappingsResp.data ?? []) as MappingRow[], accounts: (accountsResp.data ?? []) as AccountRow[], basepack };
}

async function loadSkuTargets(accountCode: string, accountSku: string) {
  const s = getSupabaseAdmin();
  const { data: account, error: accountError } = await s.from('accounts').select('id,code,name,sort_order').eq('code', accountCode).maybeSingle();
  if (accountError) throw accountError;
  if (!account) throw new Error('Account not found.');
  const { data: mappings, error: mappingError } = await s
    .from('product_account_ids')
    .select('product_id,account_id,account_sku')
    .eq('account_id', account.id)
    .eq('account_sku', accountSku)
    .range(0, 100);
  if (mappingError) throw mappingError;
  if (!mappings?.length) throw new Error('Marketplace SKU is not mapped in the V2 master.');
  const ids = uniq(mappings.map((x: any) => String(x.product_id)));
  const { data: products, error: productError } = await s.from('products').select('id,basepack_id,ubl_code,name,brand,category,sub_category,tp,mrp').in('id', ids).range(0, 100);
  if (productError) throw productError;
  const p = (products ?? []) as ProductRow[];
  const basepackId = p.find((x) => x.basepack_id)?.basepack_id ?? null;
  let basepack: any = null;
  if (basepackId) {
    const response = await s.from('basepacks').select('id,packsize').eq('id', basepackId).maybeSingle();
    if (response.error) throw response.error;
    basepack = response.data;
  }
  return { products: p, mappings: mappings as MappingRow[], accounts: [account as AccountRow], basepack };
}

function buildTargetSkus(products: ProductRow[], mappings: MappingRow[], accounts: AccountRow[]) {
  const productById = new Map(products.map((x) => [x.id, x]));
  const accountById = new Map(accounts.map((x) => [x.id, x]));
  const grouped = new Map<string, TargetSku>();
  for (const mapping of mappings) {
    const account = accountById.get(mapping.account_id);
    const product = productById.get(mapping.product_id);
    if (!account || !product || !REPORTING_ACCOUNTS.some((x) => x.code === account.code)) continue;
    const key = `${account.code}::${mapping.account_sku}`;
    const existing = grouped.get(key);
    const productTp = product.tp == null ? null : num(product.tp);
    if (!existing) {
      grouped.set(key, {
        accountCode: account.code,
        accountName: account.name,
        accountSku: mapping.account_sku,
        tp: productTp,
        productNames: [product.name],
        ublCodes: [product.ubl_code],
        productIds: [product.id],
      });
    } else {
      existing.productNames = uniq([...existing.productNames, product.name]);
      existing.ublCodes = uniq([...existing.ublCodes, product.ubl_code]);
      existing.productIds = uniq([...existing.productIds, product.id]);
      if (existing.tp == null && productTp != null) existing.tp = productTp;
    }
  }
  return [...grouped.values()];
}

export async function getDashboardReport(params: {
  basepackId?: string | null;
  accountCode?: string | null;
  accountSku?: string | null;
  monthStart: string;
  asOf: string;
}): Promise<DashboardReport> {
  const monthStart = `${params.monthStart.slice(0, 7)}-01`;
  const asOf = clampAsOf(monthStart, params.asOf);
  const mode = params.basepackId ? 'basepack' : 'sku';
  if (mode === 'basepack' && !params.basepackId) throw new Error('basepackId is required.');
  if (mode === 'sku' && (!params.accountCode || !params.accountSku)) throw new Error('accountCode and accountSku are required.');

  const loaded = mode === 'basepack'
    ? await loadBasepackTargets(params.basepackId!)
    : await loadSkuTargets(params.accountCode!, params.accountSku!);

  const targetSkus = buildTargetSkus(loaded.products, loaded.mappings, loaded.accounts);
  const accountList = mode === 'basepack'
    ? REPORTING_ACCOUNTS.map((x) => ({ code: x.code, name: loaded.accounts.find((a) => a.code === x.code)?.name ?? x.name }))
    : [{ code: params.accountCode!, name: loaded.accounts[0]?.name ?? params.accountCode! }];

  const rows = await Promise.all(accountList.map(async (account) => {
    const targets = targetSkus.filter((x) => x.accountCode === account.code);
    const metric = await metricsForAccount(account.code, targets, monthStart, asOf);
    return {
      accountCode: account.code,
      accountName: account.name,
      mapped: targets.length > 0,
      mappedSkus: targets.length,
      accountSkus: targets.map((x) => x.accountSku),
      productNames: uniq(targets.flatMap((x) => x.productNames)),
      stockQty: metric.stockQty ?? null,
      stockValue: metric.stockValue ?? null,
      stockDate: metric.stockDate ?? null,
      salesQty: metric.salesQty ?? null,
      salesValue: metric.salesValue ?? null,
      salesPeriodStart: metric.salesPeriodStart ?? null,
      salesPeriodEnd: metric.salesPeriodEnd ?? null,
      salesBasis: metric.salesBasis ?? '—',
      salesComparable: metric.salesComparable ?? false,
      valuationComplete: metric.valuationComplete ?? targets.every((x) => x.tp != null),
      note: targets.length ? (metric.note ?? null) : 'No marketplace SKU is mapped to this basepack in the current V2 master.',
    } satisfies DashboardMetricRow;
  }));

  const comparableRows = rows.filter((x) => x.salesComparable && x.mapped);
  const stockRows = rows.filter((x) => x.mapped);
  const totals = {
    stockQty: stockRows.reduce((sum, x) => sum + (x.stockQty ?? 0), 0),
    stockValue: stockRows.reduce((sum, x) => sum + (x.stockValue ?? 0), 0),
    salesQty: comparableRows.reduce((sum, x) => sum + (x.salesQty ?? 0), 0),
    salesValue: comparableRows.reduce((sum, x) => sum + (x.salesValue ?? 0), 0),
    mappedAccounts: rows.filter((x) => x.mapped).length,
    reportingAccounts: rows.length,
    comparableSalesAccounts: comparableRows.length,
  };

  return {
    mode,
    monthStart,
    asOf,
    basepack: loaded.basepack ? {
      id: String(loaded.basepack.id),
      packsize: String(loaded.basepack.packsize),
      productNames: uniq(loaded.products.map((x) => x.name)),
      ublCodes: uniq(loaded.products.map((x) => x.ubl_code)),
      brands: uniq(loaded.products.map((x) => x.brand).filter(Boolean) as string[]),
    } : null,
    sku: mode === 'sku' ? {
      accountCode: params.accountCode!,
      accountSku: params.accountSku!,
      productNames: uniq(loaded.products.map((x) => x.name)),
      ublCodes: uniq(loaded.products.map((x) => x.ubl_code)),
      basepackId: loaded.products.find((x) => x.basepack_id)?.basepack_id ?? null,
      packsize: loaded.basepack?.packsize ? String(loaded.basepack.packsize) : null,
    } : null,
    rows,
    totals,
  };
}

export async function searchDashboardEntities(params: { mode: 'basepack' | 'sku'; q: string; accountCode?: string | null }) {
  const q = params.q.trim();
  if (q.length < 2) return [];
  const s = getSupabaseAdmin();

  if (params.mode === 'basepack') {
    const [byName, byCode, byBrand, byPack] = await Promise.all([
      s.from('products').select('id,basepack_id,ubl_code,name,brand').eq('status', 'active').ilike('name', `%${q}%`).limit(30),
      s.from('products').select('id,basepack_id,ubl_code,name,brand').eq('status', 'active').ilike('ubl_code', `%${q}%`).limit(20),
      s.from('products').select('id,basepack_id,ubl_code,name,brand').eq('status', 'active').ilike('brand', `%${q}%`).limit(20),
      s.from('basepacks').select('id,packsize').ilike('packsize', `%${q}%`).limit(20),
    ]);
    for (const response of [byName, byCode, byBrand, byPack]) if (response.error) throw response.error;
    const productRows = [...(byName.data ?? []), ...(byCode.data ?? []), ...(byBrand.data ?? [])] as any[];
    const ids = uniq([
      ...productRows.map((x) => x.basepack_id).filter(Boolean),
      ...(byPack.data ?? []).map((x: any) => x.id),
    ]);
    if (!ids.length) return [];
    const [bpResp, pResp] = await Promise.all([
      s.from('basepacks').select('id,packsize').in('id', ids).range(0, 100),
      s.from('products').select('basepack_id,ubl_code,name,brand').eq('status', 'active').in('basepack_id', ids).range(0, 999),
    ]);
    if (bpResp.error) throw bpResp.error;
    if (pResp.error) throw pResp.error;
    const productsByBp = new Map<string, any[]>();
    for (const p of pResp.data ?? []) {
      const list = productsByBp.get(String(p.basepack_id)) ?? [];
      list.push(p);
      productsByBp.set(String(p.basepack_id), list);
    }
    return (bpResp.data ?? []).map((bp: any) => {
      const products = productsByBp.get(String(bp.id)) ?? [];
      return {
        type: 'basepack',
        id: String(bp.id),
        label: products[0]?.name ?? String(bp.packsize),
        secondary: String(bp.packsize),
        brand: uniq(products.map((x) => x.brand).filter(Boolean)).join(' · '),
        code: uniq(products.map((x) => x.ubl_code).filter(Boolean)).join(' · '),
      };
    }).slice(0, 30);
  }

  if (!params.accountCode) throw new Error('Account is required for SKU search.');
  const { data: account, error: accountError } = await s.from('accounts').select('id,code,name').eq('code', params.accountCode).maybeSingle();
  if (accountError) throw accountError;
  if (!account) return [];

  const [skuResp, nameResp] = await Promise.all([
    s.from('product_account_ids').select('product_id,account_sku').eq('account_id', account.id).ilike('account_sku', `%${q}%`).limit(30),
    s.from('products').select('id').eq('status', 'active').ilike('name', `%${q}%`).limit(30),
  ]);
  if (skuResp.error) throw skuResp.error;
  if (nameResp.error) throw nameResp.error;
  const nameProductIds = (nameResp.data ?? []).map((x: any) => String(x.id));
  let nameMappings: any[] = [];
  if (nameProductIds.length) {
    const response = await s.from('product_account_ids').select('product_id,account_sku').eq('account_id', account.id).in('product_id', nameProductIds).limit(50);
    if (response.error) throw response.error;
    nameMappings = response.data ?? [];
  }
  const mappings = [...(skuResp.data ?? []), ...nameMappings];
  const deduped = new Map<string, any>();
  for (const row of mappings) deduped.set(String(row.account_sku), row);
  const productIds = uniq([...deduped.values()].map((x) => String(x.product_id)));
  if (!productIds.length) return [];
  const { data: products, error: productError } = await s.from('products').select('id,basepack_id,ubl_code,name,brand').in('id', productIds).range(0, 200);
  if (productError) throw productError;
  const productById = new Map((products ?? []).map((x: any) => [String(x.id), x]));
  return [...deduped.values()].map((mapping) => {
    const p = productById.get(String(mapping.product_id)) as any;
    return {
      type: 'sku',
      id: String(mapping.account_sku),
      label: p?.name ?? String(mapping.account_sku),
      secondary: String(mapping.account_sku),
      brand: p?.brand ?? '',
      code: p?.ubl_code ?? '',
      basepackId: p?.basepack_id ?? null,
      accountCode: params.accountCode,
    };
  }).slice(0, 30);
}
