import { normalizeSosText, type ParsedSosTarget } from '@/lib/sos-keyword-parser';

export type SosProductLookupRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_sku: string;
  product_id: string;
  basepack_id: string | null;
  packsize: string | null;
  ubl_code: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
  business_group: string | null;
  hero_image_url: string | null;
};

export type SosTargetMatch = {
  source_account_sku: string;
  source_name: string;
  matched_product_id: string;
  matched_basepack_id: string;
  matched_account_sku: string;
  matched_product_name: string;
  mapping_status: 'direct' | 'exact_name' | 'fuzzy_name' | 'unmapped' | 'ambiguous';
  match_score: number | null;
  accepted: boolean;
  source_row: Record<string, unknown>;
};

function cleanName(value: string): string {
  return normalizeSosText(value)
    .replace(/\b(get free|free|buy|bundle|combo pack|twin pack|value pack|offer pack)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function packTokens(value: string): Set<string> {
  const text = value.toLowerCase();
  const matches = [
    ...(text.match(/\b\d+(?:\.\d+)?\s*(?:ml|ltr|l|gm|g|kg)\b/g) || []),
    ...(text.match(/\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:ml|l|g|kg)\b/g) || []),
  ];
  return new Set(matches.map((token) => token.replace(/\s+/g, '').replace(/gm/g, 'g').replace(/ltr/g, 'l')));
}

function bigrams(value: string): string[] {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < 2) return text ? [text] : [];
  const out: string[] = [];
  for (let i = 0; i < text.length - 1; i++) out.push(text.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (!aa.length || !bb.length) return 0;
  const counts = new Map<string, number>();
  for (const gram of aa) counts.set(gram, (counts.get(gram) || 0) + 1);
  let overlap = 0;
  for (const gram of bb) {
    const left = counts.get(gram) || 0;
    if (left > 0) {
      overlap += 1;
      counts.set(gram, left - 1);
    }
  }
  return (2 * overlap) / (aa.length + bb.length);
}

function brandCompatible(source: string, row: SosProductLookupRow): boolean {
  const brand = normalizeSosText(row.brand || '');
  if (!brand) return true;
  const sourceKey = normalizeSosText(source);
  const brandTokens = brand.split(' ').filter((token) => token.length >= 3);
  if (!brandTokens.length) return true;
  return brandTokens.some((token) => sourceKey.includes(token));
}


function comparableAccountSku(value: string, accountCode: string): string {
  let key = normalizeSosText(value).replace(/\s+/g, '');
  if (accountCode === 'othoba') key = key.replace(/^unfs/, '');
  return key;
}

function chooseRepresentative(rows: SosProductLookupRow[]): SosProductLookupRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => a.ubl_code.localeCompare(b.ubl_code))[0];
}

export function matchSosTarget(target: ParsedSosTarget, lookup: SosProductLookupRow[]): SosTargetMatch {
  const blank: SosTargetMatch = {
    source_account_sku: target.sourceAccountSku,
    source_name: target.sourceName,
    matched_product_id: '',
    matched_basepack_id: '',
    matched_account_sku: '',
    matched_product_name: '',
    mapping_status: 'unmapped',
    match_score: null,
    accepted: false,
    source_row: target.sourceRow,
  };

  const accountCode = lookup[0]?.account_code || '';
  const skuKey = comparableAccountSku(target.sourceAccountSku, accountCode);
  if (skuKey) {
    const direct = lookup.filter((row) => comparableAccountSku(row.account_sku, accountCode) === skuKey);
    const basepacks = new Set(direct.map((row) => row.basepack_id).filter(Boolean));
    if (direct.length && basepacks.size <= 1) {
      const row = chooseRepresentative(direct)!;
      if (row.basepack_id) {
        return {
          ...blank,
          matched_product_id: row.product_id,
          matched_basepack_id: row.basepack_id,
          matched_account_sku: row.account_sku,
          matched_product_name: row.product_name,
          mapping_status: 'direct',
          match_score: 1,
          accepted: true,
        };
      }
    }
    if (basepacks.size > 1) return { ...blank, mapping_status: 'ambiguous' };
  }

  const sourceName = cleanName(target.sourceName);
  if (!sourceName) return blank;

  const exact = lookup.filter((row) => cleanName(row.product_name) === sourceName);
  const exactBasepacks = new Set(exact.map((row) => row.basepack_id).filter(Boolean));
  if (exact.length && exactBasepacks.size <= 1) {
    const row = chooseRepresentative(exact)!;
    if (row.basepack_id) {
      return {
        ...blank,
        matched_product_id: row.product_id,
        matched_basepack_id: row.basepack_id,
        matched_account_sku: row.account_sku,
        matched_product_name: row.product_name,
        mapping_status: 'exact_name',
        match_score: 1,
        accepted: true,
      };
    }
  }

  const sourcePacks = packTokens(target.sourceName);
  const scored = lookup
    .filter((row) => brandCompatible(target.sourceName, row))
    .map((row) => {
      const candidatePacks = packTokens(row.product_name);
      const packOk = !sourcePacks.size || !candidatePacks.size || [...sourcePacks].some((token) => candidatePacks.has(token));
      const score = packOk ? dice(sourceName, cleanName(row.product_name)) : 0;
      return { row, score, packOk };
    })
    .filter((item) => item.row.basepack_id && item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (!best) return blank;
  const margin = best.score - (second?.score || 0);
  const conservative = best.score >= 0.86 && margin >= 0.08 && best.packOk;
  if (!conservative) {
    return {
      ...blank,
      matched_product_id: best.row.product_id,
      matched_basepack_id: best.row.basepack_id || '',
      matched_account_sku: best.row.account_sku,
      matched_product_name: best.row.product_name,
      mapping_status: best.score >= 0.76 ? 'ambiguous' : 'unmapped',
      match_score: Number(best.score.toFixed(4)),
      accepted: false,
    };
  }

  return {
    ...blank,
    matched_product_id: best.row.product_id,
    matched_basepack_id: best.row.basepack_id || '',
    matched_account_sku: best.row.account_sku,
    matched_product_name: best.row.product_name,
    mapping_status: 'fuzzy_name',
    match_score: Number(best.score.toFixed(4)),
    accepted: true,
  };
}
