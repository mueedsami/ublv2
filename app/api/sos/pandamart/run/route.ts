import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  classifySosSearchHit,
  type SosAccountProductRow,
  type SosMasterProductRow,
  type SosRawSearchHit,
  type SosTargetRow,
} from '@/lib/sos-result-match';
import { getPandamartSosBranches, type PandamartSosBranch } from '@/lib/pandamart-sos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ACCOUNT_CODE = 'pandamart';
const SEARCH_URL = 'https://bd.fd-api.com/api/v5/graphql';
const WORKER_VERSION = 'sos-v2.16.1-pandamart-rate-limit-safe';
const DEFAULT_TOP_N = 4;
const REQUEST_DELAY_MIN_MS = 400;
const REQUEST_DELAY_MAX_MS = 800;
const MAX_REQUEST_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 15000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
  Accept: 'application/json',
  'Content-Type': 'application/json;charset=UTF-8',
  'accept-language': 'en-US,en;q=0.5',
  Referer: 'https://www.foodpanda.com.bd/',
  Origin: 'https://www.foodpanda.com.bd',
  'apollographql-client-name': 'web',
  'apollographql-client-version': 'GROCERIES-MENU-MICROFRONTEND.26.10.0007',
  'perseus-client-id': '1771735600556.496036114264219763.2kr7g7xzen',
  'perseus-session-id': '1772997693938.887648781557212658.qn395k3baj',
  platform: 'web',
  'x-pd-language-id': '1',
  'x-requested-with': 'XMLHttpRequest',
};

const GRAPHQL_QUERY = `
  fragment ProductFields on Product {
    attributes(keys: $attributes) { key value }
    isAvailable
    name
    originalPrice
    price
    productID
    stockAmount
    vendorID
  }
  query getSearchProducts(
    $attributes: [String!]
    $brand: String!
    $config: String
    $userCode: String
    $globalEntityId: String
    $languageCode: String!
    $limit: Int!
    $locale: String!
    $offset: Int!
    $query: String!
    $vendors: [VendorInformation!]!
    $verticalTypes: [String!]!
  ) {
    searchProducts(input: {
      brand: $brand
      config: $config
      customerID: $userCode
      globalEntityID: $globalEntityId
      languageCode: $languageCode
      limit: $limit
      locale: $locale
      offset: $offset
      query: $query
      vendors: $vendors
      verticalTypes: $verticalTypes
    }) {
      itemCounts { total }
      products { items { payload { ...ProductFields } } }
    }
  }
`;

type KeywordTerm = {
  id: string;
  keyword_id: string;
  search_term: string;
};

type SearchOutcome = {
  term: KeywordTerm;
  branch: PandamartSosBranch;
  searchedAt: string;
  status: 'ok' | 'error';
  totalFound: number;
  errorMessage: string;
  results: Array<ReturnType<typeof classifySosSearchHit> & { rank: number; observed_at: string }>;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dhakaDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
}

function attributeValue(attributes: unknown, key: string): string {
  if (!Array.isArray(attributes)) return '';
  const hit = attributes.find((item: any) => String(item?.key || '').toLowerCase() === key.toLowerCase());
  return String(hit?.value ?? '').trim();
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, Math.min(dateMs - Date.now(), MAX_RETRY_DELAY_MS));
  return null;
}

function requestSpacingMs(): number {
  return REQUEST_DELAY_MIN_MS + Math.floor(Math.random() * (REQUEST_DELAY_MAX_MS - REQUEST_DELAY_MIN_MS + 1));
}

async function postGraphql(body: Record<string, unknown>, timeoutMs = 18000): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(SEARCH_URL, {
        method: 'POST', headers: HEADERS, body: JSON.stringify(body), cache: 'no-store', signal: controller.signal,
      });

      if (response.status === 429) {
        const retryMs = retryAfterMs(response.headers.get('retry-after'))
          ?? Math.min(MAX_RETRY_DELAY_MS, (1000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 1000));
        lastError = new Error(`HTTP 429 (rate limited; attempt ${attempt}/${MAX_REQUEST_ATTEMPTS})`);
        if (attempt < MAX_REQUEST_ATTEMPTS) {
          await sleep(retryMs);
          continue;
        }
        throw lastError;
      }

      if (response.status >= 500 && attempt < MAX_REQUEST_ATTEMPTS) {
        lastError = new Error(`HTTP ${response.status}`);
        await sleep(Math.min(MAX_RETRY_DELAY_MS, 750 * (2 ** (attempt - 1))));
        continue;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const alreadyWaitedFor429 = message.includes('HTTP 429');
      if (attempt < MAX_REQUEST_ATTEMPTS && !alreadyWaitedFor429) {
        await sleep(Math.min(MAX_RETRY_DELAY_MS, 600 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 500)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Pandamart GraphQL request failed.');
}

async function searchPandamart(
  term: KeywordTerm,
  branch: PandamartSosBranch,
  topN: number,
  accountProducts: SosAccountProductRow[],
  masterProducts: SosMasterProductRow[],
  targets: SosTargetRow[],
): Promise<SearchOutcome> {
  const searchedAt = new Date().toISOString();
  const variables = {
    attributes: ['baseContentValue', 'baseUnit', 'freshnessGuaranteeInDays', 'maximumSalesQuantity', 'minPriceLastMonth', 'pricePerBaseUnit', 'sku', 'nutri_grade', 'sugar_level'],
    brand: 'fp',
    config: null,
    globalEntityId: 'FP_BD',
    languageCode: 'en',
    limit: topN,
    locale: 'en_BD',
    offset: 0,
    query: term.search_term,
    vendors: [{ id: branch.vendorId }],
    verticalTypes: ['darkstores'],
  };

  try {
    const data = await postGraphql({ query: GRAPHQL_QUERY, variables });
    const errors = Array.isArray(data?.errors) ? data.errors : [];
    if (errors.length) {
      const message = String(errors[0]?.message || errors[0] || 'Pandamart GraphQL error');
      if (message.toLowerCase().includes('null')) {
        return { term, branch, searchedAt, status: 'ok', totalFound: 0, errorMessage: '', results: [] };
      }
      throw new Error(message);
    }

    const searchProducts = data?.data?.searchProducts || {};
    const items = Array.isArray(searchProducts?.products?.items) ? searchProducts.products.items.slice(0, topN) : [];
    const totalFound = Number.isFinite(Number(searchProducts?.itemCounts?.total)) ? Number(searchProducts.itemCounts.total) : items.length;

    const results = items.map((item: any, index: number) => {
      const product = item?.payload || {};
      const productId = String(product?.productID || '').trim();
      const sku = attributeValue(product?.attributes, 'sku') || productId;
      const currentPrice = numberOrNull(product?.price);
      const originalPrice = numberOrNull(product?.originalPrice);
      const stockQty = numberOrNull(product?.stockAmount);
      const rawHit: SosRawSearchHit = {
        sku,
        name: String(product?.name || '').trim(),
        size: attributeValue(product?.attributes, 'baseContentValue'),
        price: originalPrice ?? currentPrice,
        salePrice: originalPrice !== null && currentPrice !== null && currentPrice < originalPrice ? currentPrice : null,
        stockQty,
        inStock: typeof product?.isAvailable === 'boolean' ? product.isAvailable : (stockQty === null ? null : stockQty > 0),
        url: productId ? `https://www.foodpanda.com.bd/darkstore/${branch.vendorId}/${branch.vendorSlug}/product/${productId}` : '',
        raw: {
          productID: productId,
          vendorID: product?.vendorID || branch.vendorId,
          isAvailable: product?.isAvailable ?? null,
          price: product?.price ?? null,
          originalPrice: product?.originalPrice ?? null,
          stockAmount: product?.stockAmount ?? null,
          attributes: Array.isArray(product?.attributes) ? product.attributes : [],
        },
      };
      return {
        rank: index + 1,
        observed_at: searchedAt,
        ...classifySosSearchHit(rawHit, term.keyword_id, accountProducts, masterProducts, targets),
      };
    });

    return { term, branch, searchedAt, status: 'ok', totalFound, errorMessage: '', results };
  } catch (error) {
    return {
      term, branch, searchedAt, status: 'error', totalFound: 0,
      errorMessage: error instanceof Error ? error.message : 'Unknown Pandamart search error', results: [],
    };
  }
}

async function runPacedSearches(
  tasks: Array<{ branch: PandamartSosBranch; term: KeywordTerm }>,
  topN: number,
  accountProducts: SosAccountProductRow[],
  masterProducts: SosMasterProductRow[],
  targets: SosTargetRow[],
): Promise<SearchOutcome[]> {
  const output: SearchOutcome[] = [];

  // Deliberately sequential. The proven standalone Pandamart scraper uses one
  // request at a time with a 0.4-0.8s gap; parallel requests trigger HTTP 429.
  for (let index = 0; index < tasks.length; index += 1) {
    const { branch, term } = tasks[index];
    const outcome = await searchPandamart(term, branch, topN, accountProducts, masterProducts, targets);
    output.push(outcome);

    if (index < tasks.length - 1) {
      // If Pandamart still exhausted all 429 retries, give the endpoint a longer
      // cooldown before continuing instead of immediately hammering the next term.
      if (outcome.status === 'error' && outcome.errorMessage.includes('HTTP 429')) {
        await sleep(10000);
      } else {
        await sleep(requestSpacingMs());
      }
    }
  }

  return output;
}

export async function POST(request: Request) {
  const started = new Date();
  try {
    let body: any = {};
    try { body = await request.json(); } catch { body = {}; }
    const requestedTopN = Number(body?.topN || DEFAULT_TOP_N);
    const topN = Number.isFinite(requestedTopN) ? Math.max(1, Math.min(10, Math.round(requestedTopN))) : DEFAULT_TOP_N;
    const branches = getPandamartSosBranches(body?.branchCodes);

    const supabase = getSupabaseAdmin();
    const { data: account, error: accountError } = await supabase
      .from('accounts').select('id,code,name').eq('code', ACCOUNT_CODE).eq('active', true).maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: 'Pandamart account is not configured.' }, { status: 404 });

    const { data: termsData, error: termsError } = await supabase
      .from('sos_keyword_terms').select('id,keyword_id,search_term')
      .eq('account_id', account.id).eq('active', true).order('created_at');
    if (termsError) throw termsError;
    const terms = (termsData || []) as KeywordTerm[];
    if (!terms.length) {
      return NextResponse.json({ error: 'Import and confirm the Pandamart keyword workbook in SoS → Keywords & Targets before running Phase 3.' }, { status: 400 });
    }

    const keywordIds = Array.from(new Set(terms.map((term) => term.keyword_id)));
    const [{ data: accountProductData, error: accountProductError }, { data: masterProductData, error: masterProductError }, { data: targetData, error: targetError }] = await Promise.all([
      supabase.from('v_sos_product_lookup').select('account_sku,product_id,basepack_id,product_name,brand,ubl_code').eq('account_code', ACCOUNT_CODE).limit(5000),
      supabase.from('products').select('id,basepack_id,name,brand').eq('status', 'active').not('basepack_id', 'is', null).limit(5000),
      supabase.from('sos_keyword_targets').select('keyword_id,target_key,product_id,basepack_id,account_sku,target_name')
        .eq('account_id', account.id).eq('active', true).in('keyword_id', keywordIds).limit(5000),
    ]);
    if (accountProductError) throw accountProductError;
    if (masterProductError) throw masterProductError;
    if (targetError) throw targetError;

    const accountProducts = (accountProductData || []) as SosAccountProductRow[];
    const masterProducts = (masterProductData || []) as SosMasterProductRow[];
    const targets = (targetData || []) as SosTargetRow[];

    // Match the proven standalone scraper order: for each keyword/search term,
    // walk branches one by one. This spreads requests across vendor IDs instead
    // of sending long bursts to the same branch.
    const tasks = terms.flatMap((term) => branches.map((branch) => ({ branch, term })));

    const outcomes = await runPacedSearches(tasks, topN, accountProducts, masterProducts, targets);

    const finished = new Date();
    const successful = outcomes.filter((outcome) => outcome.status === 'ok').length;
    const errors = outcomes.length - successful;
    const rowsObserved = outcomes.reduce((sum, outcome) => sum + outcome.results.length, 0);
    const status = errors === 0 ? 'success' : successful > 0 ? 'partial' : 'error';
    const branchLabel = branches.map((branch) => branch.name).join(', ');

    const payload = {
      account_code: ACCOUNT_CODE,
      run_date: dhakaDate(finished),
      top_n: topN,
      started_at: started.toISOString(),
      finished_at: finished.toISOString(),
      status,
      terms_expected: tasks.length,
      terms_scraped: successful,
      rows_observed: rowsObserved,
      error_count: errors,
      source: 'web:pandamart',
      worker_version: WORKER_VERSION,
      message: `${successful}/${tasks.length} branch × search-term checks completed across ${branches.length} branch(es): ${branchLabel}.${errors ? ` ${errors} failed.` : ''}`,
      targets: targets.map((target) => ({
        keyword_id: target.keyword_id,
        target_key: target.target_key,
        product_id: target.product_id || '',
        basepack_id: target.basepack_id || '',
        account_sku: target.account_sku || '',
        target_name: target.target_name,
      })),
      term_runs: outcomes.map((outcome) => ({
        keyword_id: outcome.term.keyword_id,
        term_id: outcome.term.id,
        searched_term: outcome.term.search_term,
        branch_code: outcome.branch.code,
        branch_name: outcome.branch.name,
        status: outcome.status,
        total_found: outcome.totalFound,
        results_saved: outcome.results.length,
        searched_at: outcome.searchedAt,
        error_message: outcome.errorMessage,
        results: outcome.results,
      })),
    };

    const { data: runId, error: commitError } = await supabase.rpc('commit_sos_run_v1', { payload });
    if (commitError) throw commitError;

    return NextResponse.json({
      runId,
      status,
      branches: branches.map(({ code, name }) => ({ code, name })),
      branchCount: branches.length,
      searchTerms: terms.length,
      termsExpected: tasks.length,
      termsScraped: successful,
      rowsObserved,
      errors,
      elapsedSeconds: Math.round((finished.getTime() - started.getTime()) / 100) / 10,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pandamart SoS scrape failed.';
    console.error('Pandamart SoS scrape failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
