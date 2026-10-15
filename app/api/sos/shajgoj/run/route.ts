import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  classifySosSearchHit,
  type SosAccountProductRow,
  type SosMasterProductRow,
  type SosRawSearchHit,
  type SosTargetRow,
} from '@/lib/sos-result-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ACCOUNT_CODE = 'shajgoj';
const SEARCH_URL = 'https://khoj.shajgoj.com/products';
const WORKER_VERSION = 'sos-v2.15.0-shajgoj';
const DEFAULT_TOP_N = 4;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Referer: 'https://shop.shajgoj.com/',
};

type KeywordTerm = {
  id: string;
  keyword_id: string;
  search_term: string;
};

type KeywordInfo = {
  id: string;
  keyword: string;
  format: string;
};

type SearchOutcome = {
  term: KeywordTerm;
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
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: HEADERS,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchShajgoj(
  term: KeywordTerm,
  topN: number,
  accountProducts: SosAccountProductRow[],
  masterProducts: SosMasterProductRow[],
  targets: SosTargetRow[],
): Promise<SearchOutcome> {
  const searchedAt = new Date().toISOString();
  try {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('s', term.search_term);
    url.searchParams.set('facet', 'true');
    url.searchParams.set('per_page', String(topN));
    const data = await fetchJsonWithTimeout(url.toString());
    const hits = Array.isArray(data?.hits) ? data.hits.slice(0, topN) : [];
    const totalFound = Number.isFinite(Number(data?.numFound)) ? Number(data.numFound) : hits.length;

    const results = hits.map((hit: any, index: number) => {
      const slug = String(hit?.slug || '').trim();
      const stockQty = numberOrNull(hit?.stock);
      const rawHit: SosRawSearchHit = {
        sku: String(hit?.product_sku || '').trim(),
        name: String(hit?.name || '').trim(),
        size: String(hit?.size || '').trim(),
        price: numberOrNull(hit?.price),
        salePrice: hit?.has_sale ? numberOrNull(hit?.sale_price) : null,
        stockQty,
        inStock: stockQty === null ? null : stockQty > 0,
        url: slug ? `https://shop.shajgoj.com/product/${slug}` : '',
        raw: typeof hit === 'object' && hit ? hit : {},
      };
      return {
        rank: index + 1,
        observed_at: searchedAt,
        ...classifySosSearchHit(rawHit, term.keyword_id, accountProducts, masterProducts, targets),
      };
    });

    return {
      term,
      searchedAt,
      status: 'ok',
      totalFound,
      errorMessage: '',
      results,
    };
  } catch (error) {
    return {
      term,
      searchedAt,
      status: 'error',
      totalFound: 0,
      errorMessage: error instanceof Error ? error.message : 'Unknown Shajgoj search error',
      results: [],
    };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker()));
  return output;
}

export async function POST(request: Request) {
  const started = new Date();
  try {
    let body: any = {};
    try { body = await request.json(); } catch { body = {}; }
    const requestedTopN = Number(body?.topN || DEFAULT_TOP_N);
    const topN = Number.isFinite(requestedTopN) ? Math.max(1, Math.min(10, Math.round(requestedTopN))) : DEFAULT_TOP_N;

    const supabase = getSupabaseAdmin();
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id,code,name')
      .eq('code', ACCOUNT_CODE)
      .eq('active', true)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: 'Shajgoj account is not configured.' }, { status: 404 });

    const { data: termsData, error: termsError } = await supabase
      .from('sos_keyword_terms')
      .select('id,keyword_id,search_term')
      .eq('account_id', account.id)
      .eq('active', true)
      .order('created_at');
    if (termsError) throw termsError;
    const terms = (termsData || []) as KeywordTerm[];
    if (!terms.length) {
      return NextResponse.json({ error: 'Import and confirm the Shajgoj keyword workbook in SoS → Keywords & Targets before running Phase 2.' }, { status: 400 });
    }

    const keywordIds = Array.from(new Set(terms.map((term) => term.keyword_id)));
    const { data: keywordData, error: keywordError } = await supabase
      .from('sos_keywords')
      .select('id,keyword,format')
      .in('id', keywordIds)
      .eq('active', true);
    if (keywordError) throw keywordError;
    const keywords = (keywordData || []) as KeywordInfo[];
    if (keywords.length !== keywordIds.length) {
      return NextResponse.json({ error: 'One or more active Shajgoj search terms point to an inactive keyword. Re-import the keyword workbook.' }, { status: 409 });
    }

    const [{ data: accountProductData, error: accountProductError }, { data: masterProductData, error: masterProductError }, { data: targetData, error: targetError }] = await Promise.all([
      supabase
        .from('v_sos_product_lookup')
        .select('account_sku,product_id,basepack_id,product_name,brand,ubl_code')
        .eq('account_code', ACCOUNT_CODE)
        .limit(5000),
      supabase
        .from('products')
        .select('id,basepack_id,name,brand')
        .eq('status', 'active')
        .not('basepack_id', 'is', null)
        .limit(5000),
      supabase
        .from('sos_keyword_targets')
        .select('keyword_id,target_key,product_id,basepack_id,account_sku,target_name')
        .eq('account_id', account.id)
        .eq('active', true)
        .in('keyword_id', keywordIds)
        .limit(5000),
    ]);
    if (accountProductError) throw accountProductError;
    if (masterProductError) throw masterProductError;
    if (targetError) throw targetError;

    const accountProducts = (accountProductData || []) as SosAccountProductRow[];
    const masterProducts = (masterProductData || []) as SosMasterProductRow[];
    const targets = (targetData || []) as SosTargetRow[];

    const outcomes = await mapWithConcurrency(terms, 4, (term) => searchShajgoj(term, topN, accountProducts, masterProducts, targets));
    const finished = new Date();
    const successful = outcomes.filter((outcome) => outcome.status === 'ok').length;
    const errors = outcomes.length - successful;
    const rowsObserved = outcomes.reduce((sum, outcome) => sum + outcome.results.length, 0);
    const status = errors === 0 ? 'success' : successful > 0 ? 'partial' : 'error';

    const payload = {
      account_code: ACCOUNT_CODE,
      run_date: dhakaDate(finished),
      top_n: topN,
      started_at: started.toISOString(),
      finished_at: finished.toISOString(),
      status,
      terms_expected: terms.length,
      terms_scraped: successful,
      rows_observed: rowsObserved,
      error_count: errors,
      source: 'web',
      worker_version: WORKER_VERSION,
      message: errors ? `${successful}/${terms.length} search terms completed; ${errors} failed.` : `${successful}/${terms.length} search terms completed.`,
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
        branch_code: 'all',
        branch_name: '',
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

    const classifications = outcomes.flatMap((outcome) => outcome.results).reduce<Record<string, number>>((acc, row) => {
      acc[row.classification] = (acc[row.classification] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: status !== 'error',
      runId,
      status,
      account: account.name,
      topN,
      termsExpected: terms.length,
      termsScraped: successful,
      errors,
      rowsObserved,
      classifications,
      failedTerms: outcomes.filter((outcome) => outcome.status === 'error').map((outcome) => ({ term: outcome.term.search_term, error: outcome.errorMessage })),
    }, { status: status === 'error' ? 502 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shajgoj SoS scrape failed.';
    console.error('Shajgoj SoS run failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
