/** Pure, read-only aggregation of OLA scraper prices into exact-product comparisons. */
export type DBRow = Record<string, unknown>;
export type Severity = 'critical' | 'warning' | 'aligned' | 'insufficient';
export type BranchPrice = {
  branch: string; sku: string; price: number; observedAt: string; url: string; available: boolean | null;
};
export type PlatformPrice = {
  price: number | null; low: number | null; high: number | null;
  observedAt: string | null; stale: boolean; excludedReason: string | null; branchCount: number; listingCount: number;
  branchSpreadPct: number | null; branchPrices: BranchPrice[];
  deviationPct: number | null; url: string | null;
};
export type ProductComparison = {
  id: string; ublCode: string; name: string; brand: string; category: string;
  basepackId: string; packsize: string; platformPrices: Record<string, PlatformPrice>;
  minPrice: number | null; maxPrice: number | null; spreadPct: number | null;
  comparablePlatforms: number; severity: Severity;
};
export type BasepackComparison = {
  id: string; packsize: string; brand: string; category: string;
  products: ProductComparison[]; critical: number; warning: number;
  comparable: number; severity: Severity;
};
export type PriceMatrixData = {
  source: string; asOf: string | null; reportDate: string; freshnessHours: number; thresholdWarning: number;
  thresholdCritical: number; accounts: {code: string; name: string}[];
  basepacks: BasepackComparison[]; summary: {
    products: number; basepacks: number; critical: number; warning: number;
    aligned: number; insufficient: number; unmappedPriceRows: number; ambiguousPriceRows: number;
    observationsWithPrice: number; mappedPriceRows: number;
  };
};

const s = (v: unknown): string => String(v ?? '').trim();
const normal = (v: unknown): string => s(v).toLowerCase();
const numberOrNull = (v: unknown): number | null => {
  if (v == null || s(v) === '') return null;
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null;
};
const median = (values: number[]): number => {
  const vals = [...values].sort((a, b) => a - b);
  const middle = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[middle] : (vals[middle - 1] + vals[middle]) / 2;
};
const pctSpread = (values: number[]): number | null => {
  if (values.length < 2) return null;
  const smallest = Math.min(...values);
  return smallest > 0 ? ((Math.max(...values) - smallest) / smallest) * 100 : null;
};
const severity = (spread: number | null, warning: number, critical: number): Severity =>
  spread == null ? 'insufficient' : spread >= critical ? 'critical' : spread >= warning ? 'warning' : 'aligned';
const toDateMs = (value: string): number => {
  const ms = Date.parse(value); return Number.isFinite(ms) ? ms : 0;
};

export function buildPriceMatrix(input: {
  accounts: DBRow[]; products: DBRow[]; basepacks: DBRow[];
  mappings: DBRow[]; observations: DBRow[]; latestObservation: string | null; reportDate?: string;
  accountCodes?: string[];
  warning?: number; critical?: number; freshnessHours?: number;
}): PriceMatrixData {
  const warning = input.warning ?? 10;
  const critical = input.critical ?? 20;
  const freshnessHours = input.freshnessHours ?? 72;
  const accountById = new Map(input.accounts.map(a => [s(a.id), {code: normal(a.code), name: s(a.name) || s(a.code)}]));
  const accountByCode = new Map([...accountById.values()].map(a => [a.code, a]));
  const basepackById = new Map(input.basepacks.map(p => [s(p.id), s(p.packsize)]));
  const products = new Map(input.products.filter(p => s(p.status) === 'active').map(p => [s(p.id), p]));
  const mapping = new Map<string, string>();
  const ambiguous = new Set<string>();
  const usedProducts = new Set<string>();
  for (const m of input.mappings) {
    const account = accountById.get(s(m.account_id));
    const sku = normal(m.account_sku);
    const pid = s(m.product_id);
    if (!account || !sku || !products.has(pid)) continue;
    const key = `${account.code}|${sku}`;
    const previous = mapping.get(key);
    if (previous && previous !== pid) ambiguous.add(key);
    else mapping.set(key, pid);
    usedProducts.add(pid);
  }
  const latest = Math.max(toDateMs(input.latestObservation || ''), Date.now());
  type PriceFact = Omit<BranchPrice,'price'> & {account: string; product: string; price: number | null};
  const factByKey = new Map<string, PriceFact>();
  let unmappedPriceRows = 0, ambiguousPriceRows = 0, mappedPriceRows = 0;
  for (const o of input.observations) {
    const amount = numberOrNull(o.price);
    const account = normal(o.account_code);
    const sku = normal(o.account_sku);
    const match = `${account}|${sku}`;
    if (ambiguous.has(match)) { if (amount !== null) ambiguousPriceRows++; continue; }
    const pid = mapping.get(match);
    if (!pid) { if (amount !== null) unmappedPriceRows++; continue; }
    if (amount !== null) mappedPriceRows++;
    const branch = s(o.branch) || 'All';
    const observedAt = s(o.observed_at);
    const key = `${account}|${pid}|${normal(branch)}|${sku}`;
    const previous = factByKey.get(key);
    if (!previous || toDateMs(previous.observedAt) < toDateMs(observedAt)) {
      factByKey.set(key, {account, product: pid, branch, sku: s(o.account_sku), price: amount,
        observedAt, url: s(o.product_url), available: typeof o.availability === 'boolean' ? o.availability : null});
    }
  }
  const factsByProduct = new Map<string, Map<string, BranchPrice[]>>();
  for (const fact of factByKey.values()) {
    if (fact.price === null) continue;
    let perAccount = factsByProduct.get(fact.product);
    if (!perAccount) { perAccount = new Map(); factsByProduct.set(fact.product, perAccount); }
    const current = perAccount.get(fact.account) || [];
    current.push(fact as BranchPrice); perAccount.set(fact.account, current);
  }
  const basepackGroups = new Map<string, BasepackComparison>();
  const totals = {critical: 0, warning: 0, aligned: 0, insufficient: 0};
  const observedAccounts = new Set((input.accountCodes ?? [...factByKey.values()].filter(f => f.price !== null).map(f => f.account)).map(normal));
  const accounts = [...accountByCode.values()].filter(a => a.code && observedAccounts.has(a.code)).sort((a,b)=>a.name.localeCompare(b.name));
  for (const pid of usedProducts) {
    const p = products.get(pid);
    if (!p) continue;
    const rawId = s(p.basepack_id);
    const basepackId = rawId || `unassigned:${pid}`;
    const packsize = basepackById.get(rawId) || s(p.name);
    const platformPrices: Record<string, PlatformPrice> = {};
    const comparable: {code: string; price: number}[] = [];
    const perAccount = factsByProduct.get(pid) || new Map<string, BranchPrice[]>();
    for (const {code} of accounts) {
      const branchPrices = [...(perAccount.get(code) || [])].sort((a,b)=>a.branch.localeCompare(b.branch));
      const recent = branchPrices.filter(x => latest > 0 && latest - toDateMs(x.observedAt) <= freshnessHours * 3600000 && toDateMs(x.observedAt) > 0);
      // Only currently available, sufficiently fresh products enter cross-platform alerts.
      // Prices of OOS products remain visible as evidence but are not comparable.
      const eligible = recent.filter(x => x.available === true);
      const selected = eligible.length ? eligible : recent.length ? recent : branchPrices;
      const prices = selected.map(x => x.price);
      const price = prices.length ? median(prices) : null;
      const observedAt = selected.reduce<string | null>((best,x) => !best || toDateMs(x.observedAt) > toDateMs(best) ? x.observedAt : best,null);
      const stale = !recent.length && price !== null;
      const excludedReason = !price ? null : stale ? 'Stale price' : !eligible.length ? 'OOS or stock unknown' : null;
      if (!excludedReason && price !== null) comparable.push({code, price});
      platformPrices[code] = {
        price, low: prices.length ? Math.min(...prices) : null,
        high: prices.length ? Math.max(...prices) : null,
        observedAt, stale, excludedReason, branchCount: new Set(selected.map(x => x.branch)).size,
        listingCount: selected.length, branchSpreadPct: pctSpread(prices),
        branchPrices: selected, deviationPct: null,
        url: selected.find(x => x.url)?.url || null,
      };
    }
    const spreadPct = pctSpread(comparable.map(p=>p.price));
    const med = comparable.length ? median(comparable.map(p => p.price)) : null;
    for (const {code,price} of comparable) {
      if (med !== null && med > 0) platformPrices[code].deviationPct = (price-med)/med*100;
    }
    const state = severity(spreadPct, warning, critical);
    totals[state]++;
    const item: ProductComparison = {
      id: pid, ublCode: s(p.ubl_code), name: s(p.name), brand: s(p.brand)||'Unclassified',
      category: s(p.category)||'Unclassified', basepackId, packsize, platformPrices,
      minPrice: comparable.length ? Math.min(...comparable.map(x=>x.price)) : null,
      maxPrice: comparable.length ? Math.max(...comparable.map(x=>x.price)) : null,
      spreadPct, comparablePlatforms: comparable.length, severity: state,
    };
    let bp = basepackGroups.get(basepackId);
    if (!bp) {
      bp = {id: basepackId, packsize, brand:item.brand, category:item.category, products:[],
        critical:0,warning:0,comparable:0,severity:'insufficient'};
      basepackGroups.set(basepackId,bp);
    }
    bp.products.push(item);
    if (state==='critical') bp.critical++;
    if (state==='warning') bp.warning++;
    if (state!=='insufficient') bp.comparable++;
  }
  const basepacks = [...basepackGroups.values()].map(bp => {
    bp.products.sort((a,b)=>a.name.localeCompare(b.name));
    bp.severity = bp.critical > 0 ? 'critical' : bp.warning > 0 ? 'warning' : bp.comparable > 0 ? 'aligned' : 'insufficient';
    return bp;
  }).sort((a,b) => ({critical:0,warning:1,aligned:2,insufficient:3}[a.severity] - {critical:0,warning:1,aligned:2,insufficient:3}[b.severity]) || a.packsize.localeCompare(b.packsize));
  return {
    source: 'ola_scrape_observations.price', asOf: input.latestObservation,
    reportDate:input.reportDate || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),
    freshnessHours, thresholdWarning:warning, thresholdCritical:critical,
    accounts, basepacks, summary: {
      products: usedProducts.size, basepacks: basepacks.length, ...totals,
      unmappedPriceRows, ambiguousPriceRows, observationsWithPrice:input.observations.length, mappedPriceRows,
    },
  };
}
