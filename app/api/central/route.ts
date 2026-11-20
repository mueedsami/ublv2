import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAMES: Record<string, string> = {
  arogga: 'Arogga', cartup: 'Cartup', daraz: 'Daraz', othoba: 'Othoba',
  pandamart: 'PandaMart', shajgoj: 'Shajgoj', shwapno: 'Shwapno',
  ushop: 'Ushop', beauty_booth: 'BeautyBooth', foodi: 'Foodi',
};
const s = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => s(v).toLocaleLowerCase('en');
type DB = ReturnType<typeof getSupabaseAdmin>;
type Row = Record<string, unknown>;

// Full read-only pagination: no silent PostgREST 1000-row truncation.
async function readAll(db: DB, table: string, order: string, columns = '*', filters?: (q: any) => any): Promise<Row[]> {
  const result: Row[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    let query = db.from(table).select(columns);
    for (const field of order.split(',')) query = query.order(field.trim());
    if (filters) query = filters(query);
    query = query.range(offset, offset + pageSize - 1);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    result.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < pageSize) return result;
  }
  throw new Error(`${table} exceeded 100,000 rows. Refusing an incomplete availability report.`);
}
function derivedAccounts(rows: Row[]) {
  const grouped = new Map<string, { account_code: string; account_name: string; sort_order: number; observation_date: string | null }>();
  for (const row of rows) {
    const code = s(row.account_code);
    if (!code) continue;
    const old = grouped.get(code);
    const date = s(row.observation_date) || null;
    if (!old) grouped.set(code, {
      account_code: code, account_name: s(row.account_name) || NAMES[code] || code,
      sort_order: Number(row.sort_order ?? 999), observation_date: date,
    });
    else if (date && (!old.observation_date || date > old.observation_date)) old.observation_date = date;
  }
  return [...grouped.values()].sort((a, b) => a.sort_order - b.sort_order || a.account_name.localeCompare(b.account_name));
}

async function stockSnapshot(db: DB) {
  const rows = await readAll(db, 'v_central_availability_current', 'sort_order,packsize');
  if (!rows.length) return { rows, accounts: [] as Row[], source: 'stock', notice: 'The legacy stock snapshot view has no rows.' };
  let accounts: Row[];
  try { accounts = await readAll(db, 'v_central_account_ola_current', 'sort_order,account_code'); }
  catch { accounts = derivedAccounts(rows); }
  return { rows, accounts: accounts.length ? accounts : derivedAccounts(rows), source: 'stock', notice: '' };
}

// Uses the existing central scraped view when available. A missing/outdated
// accounts-summary view must never blank an otherwise populated dashboard.
// A number of UBL stores have legitimate partial runs, whereas
// v_ola_scraped_latest only includes successful runs. For that reason we
// independently fall back to the actual run/observation tables when needed.
// All access in this endpoint is SELECT-only.
async function latestRunObservations(db: DB): Promise<{observations: Row[]; runs: Row[]}> {
  const codes = Object.keys(NAMES).filter(code => code !== 'beauty_booth');
  const runs = (await Promise.all(codes.map(async account => {
    const {data, error} = await db.from('ola_scrape_runs')
      .select('id,account_code,status,started_at,finished_at')
      .eq('account_code', account).in('status', ['success', 'partial'])
      .order('finished_at', {ascending: false}).limit(15);
    if (error) throw new Error(`ola_scrape_runs (${account}): ${error.message}`);
    const candidates = (data ?? []) as Row[];
    // Prefer the newest successful run. If none of the recent runs succeeded,
    // use the newest partial; never interpret a failed run as OOS.
    return candidates.find(r => s(r.status) === 'success') ?? candidates[0] ?? null;
  }))).filter((row): row is Row => row !== null);
  if (!runs.length) return {observations: [], runs};
  const ids = runs.map(run => s(run.id));
  const observations: Row[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const block = await readAll(db, 'ola_scrape_observations', 'id',
      'run_id,account_code,account_sku,branch,status,stock_qty,observed_at', q => q.in('run_id', batch));
    observations.push(...block);
  }
  return {observations, runs};
}

function buildScrapedRows(observations: Row[], mappings: Row[], master: Row[]) {
  const products = new Map(master.map(p => [s(p.id), p]));
  const bySku = new Map<string, Row>();
  const ambiguous = new Set<string>();
  for (const m of mappings) {
    const key = `${norm(m.account_code)}|${norm(m.account_sku)}`;
    if (!norm(m.account_sku)) continue;
    const old = bySku.get(key);
    if (!old) bySku.set(key, m);
    // A duplicated same-SKU mapping with contradictory product identity is unsafe.
    else if (s(old.product_id) !== s(m.product_id) || s(old.packsize) !== s(m.packsize)) ambiguous.add(key);
  }
  type Group = {code:string;basepack:string;packsize:string;fields:Record<string,Set<string>>;
    branches:Map<string,Map<string,{status:string;qty:number;time:string}>>;lastDate:string};
  const groups = new Map<string, Group>();
  let unmapped = 0, ambiguousRows = 0, unknown = 0;
  for (const o of observations) {
    const code = norm(o.account_code), sku = norm(o.account_sku);
    const key = `${code}|${sku}`;
    if (ambiguous.has(key)) {ambiguousRows++;continue;}
    const mapping = bySku.get(key);
    if (!mapping) {unmapped++;continue;}
    const p = products.get(s(mapping.product_id));
    const packsize = s(p?.packsize) || s(mapping.packsize);
    if (!packsize) {unmapped++;continue;}
    const basepack = s(p?.basepack_id) || s(mapping.basepack_id) || packsize;
    const groupKey = `${code}|${basepack}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {code, basepack, packsize, fields:{}, branches:new Map(), lastDate:''};
      groups.set(groupKey, group);
    }
    for (const [column, value] of Object.entries({
      brands: p?.brand ?? mapping.brand, business_groups: p?.business_group ?? mapping.business_group,
      categories: p?.category ?? mapping.category, sub_categories: p?.sub_category ?? mapping.sub_category,
      product_types: p?.product_type ?? mapping.product_type,
      retail_types: p?.retail_type ?? mapping.retail_type, variants: p?.variant ?? mapping.variant,
    })) {
      const label = s(value);
      if (label) (group.fields[column] ??= new Set()).add(label);
    }
    const branch = code === 'pandamart' ? s(o.branch) || 'All' : 'All';
    const observed = s(o.observed_at);
    const status = norm(o.status);
    if (status !== 'available' && status !== 'unavailable') unknown++;
    const branchSkus = group.branches.get(branch) ?? new Map<string,{status:string;qty:number;time:string}>();
    const previous = branchSkus.get(sku);
    if (!previous || observed >= previous.time) branchSkus.set(sku, {
      status, qty: Number(o.stock_qty ?? 0), time:observed,
    });
    group.branches.set(branch, branchSkus);
    if (observed.slice(0,10) > group.lastDate) group.lastDate = observed.slice(0,10);
  }
  const rows: Row[] = [];
  for (const group of groups.values()) {
    const branches = [...group.branches.values()].map(skus => {
      const checks = [...skus.values()];
      const known = checks.filter(row => row.status === 'available' || row.status === 'unavailable');
      const status = known.some(row => row.status === 'available') ? 'available'
        : known.some(row => row.status === 'unavailable') ? 'unavailable' : 'unknown';
      return {status, qty: checks.reduce((total,row) => total+row.qty,0)};
    });
    const measured = branches.filter(b => b.status !== 'unknown');
    const available = measured.filter(b => b.status === 'available').length;
    const f = (column:string) => [...(group.fields[column] ?? [])];
    rows.push({account_code:group.code, account_name:NAMES[group.code] || group.code,
      sort_order:999, observation_date:group.lastDate, basepack_id:group.basepack,
      packsize:group.packsize, brands:f('brands'), business_groups:f('business_groups'),
      categories:f('categories'), sub_categories:f('sub_categories'),
      product_types:f('product_types'), retail_types:f('retail_types'), variants:f('variants'),
      expected_units:branches.length, available_units:available,
      availability_score:measured.length ? available/measured.length : null,
      is_available:measured.length ? available > 0 : null,
      stock_qty:measured.reduce((sum,b)=>sum+b.qty,0), stock_valuation:null,
    });
  }
  return {rows, diagnostics:{observations:observations.length, mappedBasepacks:rows.length,
    unmappedObservations:unmapped, conflictingMappingObservations:ambiguousRows, unknownObservations:unknown}};
}

async function scrapedSnapshot(db: DB) {
  const notes: string[] = [];
  try {
    const rows = await readAll(db, 'v_ola_scraped_central', 'sort_order,packsize');
    if (rows.some(r=>r.availability_score !== null && r.availability_score !== undefined)) {
      let accounts: Row[] = [];
      try {accounts = await readAll(db, 'v_ola_scraped_central_accounts', 'sort_order,account_code');}
      catch (e) { notes.push(`Account summary view: ${e instanceof Error?e.message:String(e)}`); }
      return {rows, accounts: accounts.length ? accounts : derivedAccounts(rows), source:'scraped',
        notice:notes.join(' '), diagnostics:{method:'scraped_view', mappedBasepacks:rows.length}};
    }
    notes.push(`Central scraped view has ${rows.length} rows but no measured availability.`);
  } catch(e) {notes.push(`Central scraped view: ${e instanceof Error?e.message:String(e)}`);}

  // When the central view is empty, match the latest scraped SKU observations
  // using active account SKU mappings and master product metadata.
  const [mappings,master] = await Promise.all([
    readAll(db,'v_account_mappings','account_code,account_sku,product_id',
      'account_code,account_sku,product_id,basepack_id,packsize,product_name,brand,business_group,category,sub_category,product_type,retail_type,variant,status',
      q=>q.eq('status','active')),
    readAll(db,'v_master_skus','id',
      'id,basepack_id,packsize,brand,business_group,category,sub_category,product_type,retail_type,variant'),
  ]);
  try {
    const observations = await readAll(db,'v_ola_scraped_latest','account_code,account_sku,branch',
      'account_code,account_sku,branch,status,stock_qty,observed_at');
    const result = buildScrapedRows(observations,mappings,master);
    if (result.rows.some(r=>r.availability_score !== null)) return {
      rows:result.rows, accounts:derivedAccounts(result.rows), source:'scraped',
      notice:'Read-only mapped-SKU fallback used. '+notes.join(' '),
      diagnostics:{method:'latest_scraped_view',...result.diagnostics},
    };
    notes.push(`Latest successful scraped view: ${observations.length} SKU rows, ${result.rows.length} mapped basepacks.`);
  } catch (e) {notes.push(`Latest scraped view: ${e instanceof Error?e.message:String(e)}`);}

  // Critical fallback for accounts whose latest run is 'partial': those runs
  // are intentionally excluded from v_ola_scraped_latest and can cause an
  // otherwise fully populated database to appear blank in Central Availability.
  const raw = await latestRunObservations(db);
  const result = buildScrapedRows(raw.observations,mappings,master);
  return {rows:result.rows, accounts:derivedAccounts(result.rows), source:'scraped',
    notice:`Read-only latest-run fallback used. ${notes.join(' ')}`,
    diagnostics:{method:'latest_run_observations',runs:raw.runs.length,...result.diagnostics,
      activeMappings:mappings.length,masterSkus:master.length},
  };
}

export async function GET(request: NextRequest) {
  const explicitly = request.nextUrl.searchParams.get('source');
  if (explicitly && !['stock', 'scraped'].includes(explicitly))
    return NextResponse.json({ error: 'source must be stock or scraped' }, { status: 400 });
  const envPreference = process.env.OLA_DATA_SOURCE === 'stock' ? 'stock' : 'scraped';
  const primary = explicitly ?? envPreference;
  const secondary = primary === 'stock' ? 'scraped' : 'stock';
  const errors: string[] = [];
  try {
    const db = getSupabaseAdmin();
    let unmeasured: Awaited<ReturnType<typeof stockSnapshot>> | Awaited<ReturnType<typeof scrapedSnapshot>> | null = null;
    for (const source of explicitly ? [primary] : [primary, secondary]) {
      try {
        const snapshot = source === 'scraped' ? await scrapedSnapshot(db) : await stockSnapshot(db);
        const hasMeasuredData = snapshot.rows.some(row => row.availability_score != null && Number.isFinite(Number(row.availability_score)));
        if (hasMeasuredData) return NextResponse.json({...snapshot,warnings:errors}, {headers:{'Cache-Control':'no-store'}});
        if (snapshot.rows.length) {
          unmeasured ??= snapshot;
          errors.push(`${source} has ${snapshot.rows.length} basepacks but no valid measured availability scores.`);
        } else {
          errors.push(`${source} returned no mapped availability rows${snapshot.notice ? ` (${snapshot.notice})` : ''}${'diagnostics' in snapshot ? ` (${JSON.stringify(snapshot.diagnostics)})` : ''}`);
        }
      } catch (e) {errors.push(`${source}: ${e instanceof Error ? e.message : String(e)}`);}
    }
    if (unmeasured) return NextResponse.json({...unmeasured,warnings:errors,
      notice:`${unmeasured.notice ?? ''} Data exists, but all latest statuses are Unknown; no OLA percentage can be calculated.`,
    },{headers:{'Cache-Control':'no-store'}});
    return NextResponse.json({error:'No Central Availability data could be loaded. '+errors.join(' | '),
      rows:[],accounts:[],warnings:errors},{status:503});
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Central availability database connection failed.' }, { status: 500 });
  }
}
