import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  buildDailyMatrices, cleanLabel, normalizeKey,
  type DailyMatrix, type DailyObservation, type MatrixDimension,
} from '@/lib/central-daily-matrix';

const SUPPORTED_ACCOUNTS = new Set(['arogga', 'cartup', 'daraz', 'othoba', 'pandamart', 'shajgoj', 'shwapno', 'beauty_booth']);
const ZONE = 'Asia/Dhaka';
const dateInDhaka = (now: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
  return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`;
};
export const currentMonthDhaka = () => dateInDhaka(new Date()).slice(0, 7);
export const validMonth = (value: string) => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
export type DailyMatrixQuery = {
  month: string; accounts: string[]; businessGroup: string; category: string; subCategory: string;
  brand: string; basepack: string; search: string;
};
type Run = {run_id: string; account_code: string; run_status: string; observation_date: string; finished_at: string | null; started_at: string | null};
type Observation = {run_id: string; account_code: string; account_sku: string; branch: string | null; status: string; observed_at: string; basepack: string | null};
type Mapping = {account_code: string; account_sku: string; product_id: string | null; packsize: string | null; product_name: string | null; brand: string | null; business_group: string | null; category: string | null};
type Master = {id: string; brand: string | null; business_group: string | null; category: string | null; sub_category: string | null; product_type: string | null; packsize: string | null};

// PostgREST pagination is mandatory: a default 1000-row result silently truncates analytics.
async function paginate<T>(query: (offset: number, end: number) => PromiseLike<{data: T[] | null; error: {message: string} | null}>, max: number, context: string): Promise<T[]> {
  const results: T[] = [], pageSize = 500;
  for (let offset = 0; offset < max; offset += pageSize) {
    const {data, error} = await query(offset, offset + pageSize - 1);
    if (error) throw new Error(`${context}: ${error.message}`);
    const batch = data ?? [];
    results.push(...batch);
    if (batch.length < pageSize) return results;
  }
  throw new Error(`${context} exceeds ${max} rows; export cancelled rather than providing partial numbers`);
}
function filterMatches(value: string, filter: string) {
  return filter === 'all' || normalizeKey(value) === normalizeKey(filter);
}
export function getDailyMatrixQuery(params: URLSearchParams): DailyMatrixQuery {
  const month = params.get('month') || currentMonthDhaka();
  if (!validMonth(month)) throw new Error('Invalid month; use YYYY-MM');
  const selected = params.has('accounts') ? (params.get('accounts') ?? '').split(',').map(normalizeKey).filter(Boolean)
    : [...SUPPORTED_ACCOUNTS].filter(a => a !== 'beauty_booth');
  if (selected.some(a => !SUPPORTED_ACCOUNTS.has(a))) throw new Error('Invalid account selection');
  const read = (key: string) => (params.get(key) ?? 'all').trim().slice(0, 200) || 'all';
  return {month, accounts: [...new Set(selected)], businessGroup: read('businessGroup'), category: read('category'),
    subCategory: read('subCategory'), brand: read('brand'), basepack: read('basepack'), search: (params.get('search') ?? '').trim().slice(0, 200)};
}
export type DailyMatrixResult = {
  month: string; dates: string[]; matrices: Record<MatrixDimension, DailyMatrix>;
  meta: { selected_runs: number; selected_observations: number; mapped_observations: number; unknown_observations: number;
    unmapped_observations: number; ambiguous_mapping_observations: number; missing_sku_observations: number;
    methodology: string; warnings: string[] };
};
export async function getDailyMatrix(query: DailyMatrixQuery): Promise<DailyMatrixResult> {
  const [year, mm] = query.month.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, mm, 1)).toISOString().slice(0, 10);
  const today = dateInDhaka(new Date());
  const finalDay = query.month === today.slice(0, 7) ? Math.min(Number(today.slice(-2)), new Date(Date.UTC(year, mm, 0)).getUTCDate()) : new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const dates = query.month > today.slice(0, 7) ? [] : Array.from({length: finalDay}, (_, i) => `${query.month}-${String(i + 1).padStart(2, '0')}`);
  const empty = () => ({month: query.month, dates, matrices: buildDailyMatrices([], dates), meta: {selected_runs: 0, selected_observations: 0, mapped_observations: 0,
    unknown_observations: 0, unmapped_observations: 0, ambiguous_mapping_observations: 0, missing_sku_observations: 0,
    methodology: METHODOLOGY, warnings: [] as string[]}});
  if (!query.accounts.length || !dates.length) return empty();
  const db = getSupabaseAdmin();
  const [runs, mappings, master] = await Promise.all([
    paginate<Run>((at, end) => db.from('v_ola_scraped_run_metrics').select('run_id,account_code,run_status,observation_date,finished_at,started_at')
      .in('account_code', query.accounts).gte('observation_date', `${query.month}-01`).lt('observation_date', monthEnd)
      .order('observation_date', {ascending: false}).order('finished_at', {ascending: false}).range(at, end), 20000, 'Daily scraper runs'),
    paginate<Mapping>((at, end) => db.from('v_account_mappings').select('account_code,account_sku,product_id,packsize,product_name,brand,business_group,category')
      .eq('status', 'active').in('account_code', query.accounts).order('account_code').order('account_sku').range(at, end), 100000, 'Active SKU mapping'),
    paginate<Master>((at, end) => db.from('v_master_skus').select('id,brand,business_group,category,sub_category,product_type,packsize')
      .order('id').range(at, end), 100000, 'Master SKU metadata'),
  ]);
  const masterById = new Map(master.map(item => [String(item.id), item]));
  const best = new Map<string, Run>();
  for (const run of runs) {
    if (!dates.includes(run.observation_date) || !['success', 'partial'].includes(run.run_status)) continue;
    const key = `${run.account_code}|${run.observation_date}`;
    const prior = best.get(key);
    const time = (r: Run) => r.finished_at ?? r.started_at ?? '';
    if (!prior || (prior.run_status !== 'success' && run.run_status === 'success') || (prior.run_status === run.run_status && time(run) > time(prior))) best.set(key, run);
  }
  const selected = [...best.values()], byRun = new Map(selected.map(r => [r.run_id, r]));
  const bySku = new Map<string, Mapping>(), ambiguous = new Set<string>();
  for (const mapping of mappings) {
    const sku = normalizeKey(mapping.account_sku);
    if (!sku) continue;
    const key = `${normalizeKey(mapping.account_code)}|${sku}`;
    const old = bySku.get(key);
    if (!old) bySku.set(key, mapping);
    else if (['product_id', 'packsize', 'product_name', 'brand', 'business_group', 'category'].some(field =>
      normalizeKey(old[field as keyof Mapping]) !== normalizeKey(mapping[field as keyof Mapping]))) ambiguous.add(key);
  }
  const observations: Observation[] = [];
  const ids = selected.map(r => r.run_id);
  // Run-ID batches keep URL lengths bounded; a concurrency cap avoids overloading Supabase.
  for (let i = 0; i < ids.length; i += 120) {
    const batches = Array.from({length: Math.ceil(Math.min(120, ids.length - i) / 30)}, (_, j) => ids.slice(i + j * 30, i + j * 30 + 30));
    const pageGroups = await Promise.all(batches.map(batch => paginate<Observation>((at, end) =>
      db.from('ola_scrape_observations').select('run_id,account_code,account_sku,branch,status,observed_at,basepack')
        .in('run_id', batch).order('id').range(at, end), 200000, 'Daily OLA observations')));
    for (const group of pageGroups) observations.push(...group);
    if (observations.length > 450000) throw new Error('Daily OLA exceeds 450,000 observations. Select fewer accounts or a shorter period.');
  }
  const data: DailyObservation[] = [];
  let unknown = 0, unmapped = 0, ambiguousCount = 0, missingSku = 0;
  for (const row of observations) {
    const run = byRun.get(row.run_id);
    if (!run) continue;
    const account = normalizeKey(row.account_code), sku = normalizeKey(row.account_sku);
    if (!sku) { missingSku++; continue; }
    const key = `${account}|${sku}`;
    if (ambiguous.has(key)) { ambiguousCount++; continue; }
    const mapping = bySku.get(key);
    if (!mapping) { unmapped++; continue; }
    const product = masterById.get(String(mapping.product_id ?? ''));
    const businessGroup = cleanLabel(product?.business_group ?? mapping.business_group);
    const category = cleanLabel(product?.category ?? mapping.category);
    const brand = cleanLabel(product?.brand ?? mapping.brand);
    const basepack = cleanLabel(product?.packsize ?? mapping.packsize);
    const attributes = {subCategory: cleanLabel(product?.sub_category), format: cleanLabel(product?.product_type)};
    if (!filterMatches(businessGroup, query.businessGroup) || !filterMatches(category, query.category) ||
        !filterMatches(attributes.subCategory, query.subCategory) || !filterMatches(brand, query.brand) || !filterMatches(basepack, query.basepack)) continue;
    if (query.search && ![basepack, mapping.product_name, brand, businessGroup, category, attributes.subCategory, attributes.format, account, row.account_sku]
      .some(v => normalizeKey(v).includes(normalizeKey(query.search)))) continue;
    const status = row.status === 'available' ? 'available' : row.status === 'unavailable' ? 'unavailable' : 'unknown';
    if (status === 'unknown') unknown++;
    data.push({date: run.observation_date, account, sku, branch: row.branch || 'All', observedAt: row.observed_at,
      status, businessGroup, category, brand, format: attributes.format, subCategory: attributes.subCategory,
      basepack, product: cleanLabel(mapping.product_name)});
  }
  const warnings: string[] = [];
  if (ambiguousCount) warnings.push(`${ambiguousCount} observations have conflicting active SKU mappings and were excluded.`);
  if (unmapped) warnings.push(`${unmapped} observations have no active master SKU mapping and were excluded.`);
  if (query.accounts.includes('beauty_booth')) warnings.push('BeautyBooth catalog-only items without master SKU mappings cannot contribute to grouped OLA.');
  return {month: query.month, dates, matrices: buildDailyMatrices(data, dates),
    meta: {selected_runs: ids.length, selected_observations: observations.length, mapped_observations: data.length,
      unknown_observations: unknown, unmapped_observations: unmapped, ambiguous_mapping_observations: ambiguousCount,
      missing_sku_observations: missingSku, methodology: METHODOLOGY, warnings}};
}
const METHODOLOGY = 'One latest successful scraper run per account per Asia/Dhaka calendar day; latest partial only when successful is unavailable. Each account SKU × branch contributes at most one observation per day. Daily and MTD OLA = Available / (Available + OOS), weighted by valid mapped observations, not average of daily percentages. Unknown and missing dates are excluded from the denominator. PandaMart branches count separately. Duplicate/conflicting SKU mappings are excluded; grouping uses active master SKU metadata and Product Type as Format. Current availability status filtering is not applied to historical metrics.';
