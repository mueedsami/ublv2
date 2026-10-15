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
export const maxDuration = 180;

const ACCOUNT_CODE = 'othoba';
const ROOT_URL = 'https://othoba.com/';
const WORKER_VERSION = 'sos-v2.17.0-othoba';
const DEFAULT_TOP_N = 4;
const REQUEST_DELAY_MIN_MS = 900;
const REQUEST_DELAY_MAX_MS = 1500;

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'max-age=0',
};

type KeywordTerm = {
  id: string;
  keyword_id: string;
  search_term: string;
};

type SearchOutcome = {
  term: KeywordTerm;
  searchedAt: string;
  status: 'ok' | 'error';
  totalFound: number;
  errorMessage: string;
  results: Array<ReturnType<typeof classifySosSearchHit> & { rank: number; observed_at: string }>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs() {
  return Math.round(REQUEST_DELAY_MIN_MS + Math.random() * (REQUEST_DELAY_MAX_MS - REQUEST_DELAY_MIN_MS));
}

function dhakaDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ',
  };
  return value
    .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/gi, (token) => named[token.toLowerCase()] || token)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function priceNumber(value: string): number | null {
  const cleaned = stripTags(value).replace(/[^\d.,]/g, '').replace(/,/g, '');
  if (!cleaned) return null;
  const match = cleaned.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function classText(chunk: string, classToken: string): string {
  const escaped = classToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<[^>]+class=(?:"[^"]*\\b${escaped}\\b[^"]*"|'[^']*\\b${escaped}\\b[^']*')[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  return re.exec(chunk)?.[1] || '';
}

function lastItemBoxStart(html: string, beforeIndex: number): number {
  const windowStart = Math.max(0, beforeIndex - 12000);
  const prefix = html.slice(windowStart, beforeIndex);
  const re = /<div\b[^>]*class=(?:"[^"]*\bitem-box\b[^"]*"|'[^']*\bitem-box\b[^']*')[^>]*>/gi;
  let last = -1;
  for (const match of prefix.matchAll(re)) last = windowStart + (match.index || 0);
  return last >= 0 ? last : Math.max(0, beforeIndex - 2500);
}

function cardSku(chunk: string): string {
  const candidates = [
    /data-productid=["']([^"']+)["']/i,
    /data-product-id=["']([^"']+)["']/i,
    /data-product-sku=["']([^"']+)["']/i,
    /data-sku=["']([^"']+)["']/i,
  ];
  for (const re of candidates) {
    const raw = String(re.exec(chunk)?.[1] || '').trim();
    if (!raw) continue;
    if (/^\d+$/.test(raw)) return `UNFS${raw}`;
    return raw;
  }
  return '';
}

function parseOthobaHtml(html: string, topN: number): SosRawSearchHit[] {
  const h4Re = /<h4\b[^>]*class=(?:"[^"]*\bproduct-name\b[^"]*"|'[^']*\bproduct-name\b[^']*')[^>]*>([\s\S]*?)<\/h4>/gi;
  const matches = [...html.matchAll(h4Re)];
  const out: SosRawSearchHit[] = [];

  for (let i = 0; i < matches.length && out.length < topN; i++) {
    const match = matches[i];
    const inner = match[1] || '';
    const anchor = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
    if (!anchor) continue;
    const href = String(anchor[1] || anchor[2] || '').trim();
    const name = stripTags(anchor[3] || '');
    if (!name) continue;

    const idx = match.index || 0;
    const start = lastItemBoxStart(html, idx);
    const nextIndex = i + 1 < matches.length ? (matches[i + 1].index || html.length) : html.length;
    const end = Math.min(html.length, Math.max(nextIndex, idx + 3500), start + 14000);
    const chunk = html.slice(start, end);
    const actualPrice = priceNumber(classText(chunk, 'actual-price'));
    const oldPrice = priceNumber(classText(chunk, 'old-price'));
    const isOos = /out\s*of\s*stock/i.test(stripTags(chunk));

    out.push({
      sku: cardSku(chunk),
      name,
      price: actualPrice,
      salePrice: actualPrice,
      stockQty: null,
      inStock: isOos ? false : null,
      url: href.startsWith('/') ? `https://othoba.com${href}` : href,
      raw: { source: 'othoba-html-search', old_price: oldPrice },
    });
  }
  return out;
}

function cookieHeaderFromResponse(response: Response): string {
  const h = response.headers as Headers & { getSetCookie?: () => string[] };
  const rows = typeof h.getSetCookie === 'function'
    ? h.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  return rows.filter(Boolean).map((row) => row.split(';')[0]).join('; ');
}

async function warmSession(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(ROOT_URL, { headers: BASE_HEADERS, cache: 'no-store', signal: controller.signal });
    return cookieHeaderFromResponse(response);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSearchHtml(keyword: string, cookie: string): Promise<string> {
  const encoded = encodeURIComponent(keyword).replace(/%20/g, '+');
  const url = `https://othoba.com/ts/search/${encoded}?t=t&q=${encoded}`;
  let lastError = 'Unknown Othoba request error';

  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22000);
    try {
      const response = await fetch(url, {
        headers: {
          ...BASE_HEADERS,
          Referer: ROOT_URL,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after') || '');
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(12000, 1200 * (2 ** attempt));
        lastError = `HTTP ${response.status}`;
        await sleep(waitMs);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (!/<html|<!doctype/i.test(html.slice(0, 800))) throw new Error('Othoba returned a non-HTML response.');
      return html;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Othoba request failed';
      if (attempt < 3) await sleep(Math.min(8000, 1000 * (2 ** attempt)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}

async function searchOthoba(
  term: KeywordTerm,
  topN: number,
  cookie: string,
  accountProducts: SosAccountProductRow[],
  masterProducts: SosMasterProductRow[],
  targets: SosTargetRow[],
): Promise<SearchOutcome> {
  const searchedAt = new Date().toISOString();
  try {
    const html = await fetchSearchHtml(term.search_term, cookie);
    const hits = parseOthobaHtml(html, topN);
    const results = hits.map((rawHit, index) => ({
      rank: index + 1,
      observed_at: searchedAt,
      ...classifySosSearchHit(rawHit, term.keyword_id, accountProducts, masterProducts, targets),
    }));
    return { term, searchedAt, status: 'ok', totalFound: hits.length, errorMessage: '', results };
  } catch (error) {
    return {
      term,
      searchedAt,
      status: 'error',
      totalFound: 0,
      errorMessage: error instanceof Error ? error.message : 'Unknown Othoba search error',
      results: [],
    };
  }
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
      .from('accounts').select('id,code,name').eq('code', ACCOUNT_CODE).eq('active', true).maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: 'Othoba account is not configured.' }, { status: 404 });

    const { data: termsData, error: termsError } = await supabase
      .from('sos_keyword_terms').select('id,keyword_id,search_term')
      .eq('account_id', account.id).eq('active', true).order('created_at');
    if (termsError) throw termsError;
    const terms = (termsData || []) as KeywordTerm[];
    if (!terms.length) {
      return NextResponse.json({ error: 'Import and confirm Othoba Search Keyword.xlsx in SoS → Keywords & Targets before running Phase 4.' }, { status: 400 });
    }

    const keywordIds = Array.from(new Set(terms.map((term) => term.keyword_id)));
    const [{ data: accountProductData, error: accountProductError }, { data: masterProductData, error: masterProductError }, { data: targetData, error: targetError }] = await Promise.all([
      supabase.from('v_sos_product_lookup').select('account_sku,product_id,basepack_id,product_name,brand,ubl_code').eq('account_code', ACCOUNT_CODE).limit(5000),
      supabase.from('products').select('id,basepack_id,name,brand').eq('status', 'active').not('basepack_id', 'is', null).limit(5000),
      supabase.from('sos_keyword_targets').select('keyword_id,target_key,product_id,basepack_id,account_sku,target_name').eq('account_id', account.id).eq('active', true).in('keyword_id', keywordIds).limit(5000),
    ]);
    if (accountProductError) throw accountProductError;
    if (masterProductError) throw masterProductError;
    if (targetError) throw targetError;

    const accountProducts = (accountProductData || []) as SosAccountProductRow[];
    const masterProducts = (masterProductData || []) as SosMasterProductRow[];
    const targets = (targetData || []) as SosTargetRow[];
    const cookie = await warmSession();
    const outcomes: SearchOutcome[] = [];

    for (let i = 0; i < terms.length; i++) {
      outcomes.push(await searchOthoba(terms[i], topN, cookie, accountProducts, masterProducts, targets));
      if (i < terms.length - 1) await sleep(jitterMs());
    }

    const finished = new Date();
    const successful = outcomes.filter((row) => row.status === 'ok').length;
    const errors = outcomes.length - successful;
    const rowsObserved = outcomes.reduce((sum, row) => sum + row.results.length, 0);
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
      ok: status !== 'error', runId, status, account: account.name, topN,
      termsExpected: terms.length, termsScraped: successful, errors, rowsObserved, classifications,
      failedTerms: outcomes.filter((row) => row.status === 'error').map((row) => ({ term: row.term.search_term, error: row.errorMessage })),
    }, { status: status === 'error' ? 502 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Othoba SoS scrape failed.';
    console.error('Othoba SoS run failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
