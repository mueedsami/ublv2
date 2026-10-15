import { normalizeSosText } from '@/lib/sos-keyword-parser';

export type SosAccountProductRow = {
  account_sku: string;
  product_id: string;
  basepack_id: string | null;
  product_name: string;
  brand: string | null;
  ubl_code?: string | null;
};

export type SosMasterProductRow = {
  id: string;
  basepack_id: string | null;
  name: string;
  brand: string | null;
};

export type SosTargetRow = {
  keyword_id: string;
  target_key: string;
  product_id: string | null;
  basepack_id: string | null;
  account_sku: string | null;
  target_name: string;
};

export type SosRawSearchHit = {
  sku: string;
  name: string;
  size?: string;
  price?: number | null;
  salePrice?: number | null;
  stockQty?: number | null;
  inStock?: boolean | null;
  url?: string;
  raw?: Record<string, unknown>;
};

export type SosClassifiedHit = {
  marketplace_sku: string;
  product_name: string;
  size: string;
  price: number | null;
  sale_price: number | null;
  stock_qty: number | null;
  in_stock: boolean | null;
  product_url: string;
  product_id: string;
  basepack_id: string;
  matched_brand: string;
  is_ubl: boolean;
  is_target: boolean;
  classification: 'target_ubl' | 'ubl_non_target' | 'competitor';
  ubl_match_method: 'account_sku' | 'exact_name' | 'strong_name' | 'none';
  ubl_match_score: number | null;
  matched_target_key: string;
  raw: Record<string, unknown>;
};

function cleanName(value: string): string {
  return normalizeSosText(value)
    .replace(/\b(get free|free|buy|bundle of\s*\d+|bundle|combo pack|twin pack|value pack|offer pack)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function packTokens(value: string): Set<string> {
  const text = String(value || '').toLowerCase();
  const matches = [
    ...(text.match(/\b\d+(?:\.\d+)?\s*(?:ml|ltr|l|gm|g|kg)\b/g) || []),
    ...(text.match(/\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:ml|l|g|kg)\b/g) || []),
  ];
  return new Set(matches.map((token) => token.replace(/\s+/g, '').replace(/gm/g, 'g').replace(/ltr/g, 'l')));
}

function chooseRepresentative<T extends { basepack_id: string | null; product_id?: string; id?: string; ubl_code?: string | null }>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => String(a.ubl_code || a.product_id || a.id || '').localeCompare(String(b.ubl_code || b.product_id || b.id || '')))[0];
}

function uniqueBasepack(rows: Array<{ basepack_id: string | null }>): boolean {
  const keys = new Set(rows.map((row) => row.basepack_id).filter(Boolean));
  return rows.length > 0 && keys.size === 1;
}

function strongNameMatch(sourceName: string, master: SosMasterProductRow[]): SosMasterProductRow | null {
  const sourceKey = cleanName(sourceName);
  if (!sourceKey) return null;
  const sourcePacks = packTokens(sourceName);
  const candidates: SosMasterProductRow[] = [];

  for (const row of master) {
    if (!row.basepack_id) continue;
    const candidateKey = cleanName(row.name);
    if (!candidateKey) continue;
    const contains = candidateKey.includes(sourceKey) || sourceKey.includes(candidateKey);
    if (!contains) continue;
    const candidatePacks = packTokens(row.name);
    const packOk = !sourcePacks.size || !candidatePacks.size || [...sourcePacks].some((token) => candidatePacks.has(token));
    if (!packOk) continue;
    if (Math.min(sourceKey.length, candidateKey.length) < 18) continue;
    candidates.push(row);
  }

  if (!candidates.length || !uniqueBasepack(candidates)) return null;
  return chooseRepresentative(candidates);
}

export function classifySosSearchHit(
  hit: SosRawSearchHit,
  keywordId: string,
  accountProducts: SosAccountProductRow[],
  masterProducts: SosMasterProductRow[],
  targets: SosTargetRow[],
): SosClassifiedHit {
  const skuKey = normalizeSosText(hit.sku);
  let matchedProductId = '';
  let matchedBasepackId = '';
  let matchedBrand = '';
  let matchMethod: SosClassifiedHit['ubl_match_method'] = 'none';
  let matchScore: number | null = null;

  if (skuKey) {
    const direct = accountProducts.filter((row) => normalizeSosText(row.account_sku) === skuKey);
    if (direct.length && uniqueBasepack(direct)) {
      const row = chooseRepresentative(direct);
      if (row) {
        matchedProductId = row.product_id;
        matchedBasepackId = row.basepack_id || '';
        matchedBrand = row.brand || '';
        matchMethod = 'account_sku';
        matchScore = 1;
      }
    }
  }

  if (!matchedBasepackId) {
    const nameKey = cleanName(hit.name);
    const exact = masterProducts.filter((row) => cleanName(row.name) === nameKey && row.basepack_id);
    if (nameKey && exact.length && uniqueBasepack(exact)) {
      const row = chooseRepresentative(exact);
      if (row) {
        matchedProductId = row.id;
        matchedBasepackId = row.basepack_id || '';
        matchedBrand = row.brand || '';
        matchMethod = 'exact_name';
        matchScore = 1;
      }
    }
  }

  if (!matchedBasepackId) {
    const row = strongNameMatch(hit.name, masterProducts);
    if (row) {
      matchedProductId = row.id;
      matchedBasepackId = row.basepack_id || '';
      matchedBrand = row.brand || '';
      matchMethod = 'strong_name';
      matchScore = 0.9;
    }
  }

  const keywordTargets = targets.filter((target) => target.keyword_id === keywordId);
  let matchedTarget: SosTargetRow | undefined;
  if (matchedBasepackId) {
    matchedTarget = keywordTargets.find((target) => target.basepack_id && target.basepack_id === matchedBasepackId);
  }
  if (!matchedTarget && skuKey) {
    matchedTarget = keywordTargets.find((target) => target.account_sku && normalizeSosText(target.account_sku) === skuKey);
  }

  const isUbl = Boolean(matchedBasepackId || matchedProductId);
  const isTarget = Boolean(isUbl && matchedTarget);
  const classification: SosClassifiedHit['classification'] = isTarget
    ? 'target_ubl'
    : isUbl
      ? 'ubl_non_target'
      : 'competitor';

  return {
    marketplace_sku: hit.sku || '',
    product_name: hit.name || '',
    size: hit.size || '',
    price: hit.price ?? null,
    sale_price: hit.salePrice ?? null,
    stock_qty: hit.stockQty ?? null,
    in_stock: hit.inStock ?? null,
    product_url: hit.url || '',
    product_id: matchedProductId,
    basepack_id: matchedBasepackId,
    matched_brand: matchedBrand,
    is_ubl: isUbl,
    is_target: isTarget,
    classification,
    ubl_match_method: matchMethod,
    ubl_match_score: matchScore,
    matched_target_key: matchedTarget?.target_key || '',
    raw: hit.raw || {},
  };
}
