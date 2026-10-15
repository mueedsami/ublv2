import { loadWorkbook, valueText, type SheetValue, type WorksheetData } from '@/lib/excel';

export type SosKeywordAccountCode = 'pandamart' | 'shajgoj' | 'othoba' | 'cartup';

export type ParsedSosTarget = {
  rowNumber: number;
  sourceAccountSku: string;
  sourceName: string;
  sourceRow: Record<string, SheetValue>;
};

export type ParsedSosTerm = {
  searchTerm: string;
  normalizedTerm: string;
  isPrimary: boolean;
  sourceRow: Record<string, SheetValue>;
};

export type ParsedSosKeyword = {
  keyword: string;
  normalizedKey: string;
  format: string;
  expectedTargetCount: number | null;
  terms: ParsedSosTerm[];
  targets: ParsedSosTarget[];
};

export type ParsedSosKeywordWorkbook = {
  accountCode: SosKeywordAccountCode;
  parserProfile: string;
  sheetName: string;
  rowsTotal: number;
  keywords: ParsedSosKeyword[];
  warnings: string[];
};

function clean(value: unknown): string {
  return valueText(value).replace(/\s+/g, ' ').trim();
}

export function normalizeSosText(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function headerKey(value: unknown): string {
  return normalizeSosText(value).replace(/\s+/g, '');
}

function rawObject(headers: SheetValue[], row: SheetValue[]): Record<string, SheetValue> {
  const out: Record<string, SheetValue> = {};
  headers.forEach((header, index) => {
    out[clean(header) || `Column ${index + 1}`] = row[index] ?? null;
  });
  return out;
}

function headerIndex(headers: SheetValue[], candidates: string[]): number {
  const map = new Map<string, number>();
  headers.forEach((header, index) => map.set(headerKey(header), index));
  for (const candidate of candidates) {
    const found = map.get(headerKey(candidate));
    if (found !== undefined) return found;
  }
  return -1;
}

const MAIN_KEYWORD_HEADERS = ['Search Keyword', 'Main Keyword', 'Keyword'];
const ADDITIONAL_HEADERS = ['Additional Search Keyword', 'Additional Keyword', 'Search Terms', 'Additional Search Keywords'];
const LISTING_HEADERS = ['Search Listing', 'Listing Count', 'Target Count'];
const SKU_HEADERS = ['SKU ID', 'SKUs ID', 'SKUs Code', 'SKU Code', 'Prodcut ID', 'Product ID', 'Marketplace SKU'];
const NAME_HEADERS = ['SKU Perfect Name', 'SKU Name', 'Product Name', 'Perfect Name'];
const CATEGORY_HEADERS = ['Category', 'Format', 'Product Format'];

function findBestSheet(worksheets: WorksheetData[]): { sheet: WorksheetData; headerRow: number; headers: SheetValue[] } {
  let best: { sheet: WorksheetData; headerRow: number; headers: SheetValue[]; score: number } | null = null;

  for (const sheet of worksheets) {
    for (let r = 0; r < Math.min(sheet.rows.length, 12); r++) {
      const headers = sheet.rows[r] || [];
      const main = headerIndex(headers, MAIN_KEYWORD_HEADERS) >= 0;
      const additional = headerIndex(headers, ADDITIONAL_HEADERS) >= 0;
      const listing = headerIndex(headers, LISTING_HEADERS) >= 0;
      const sku = headerIndex(headers, SKU_HEADERS) >= 0;
      const name = headerIndex(headers, NAME_HEADERS) >= 0;
      const category = headerIndex(headers, CATEGORY_HEADERS) >= 0;
      if (!name || (!main && !additional)) continue;

      const score = (main ? 4 : 0) + (additional ? 5 : 0) + (listing ? 2 : 0) + (sku ? 2 : 0) + (name ? 3 : 0) + (category ? 1 : 0);
      if (!best || score > best.score) best = { sheet, headerRow: r, headers, score };
    }
  }

  if (!best) throw new Error('Could not find a supported SoS keyword table. Expected Search Keyword or Additional Search Keyword plus SKU/Product Name columns.');
  return best;
}

function splitTerms(value: unknown): string[] {
  const text = clean(value);
  if (!text) return [];
  return text
    .split(/[,;\n]+/)
    .map((part) => clean(part))
    .filter(Boolean);
}

function expandPrimaryTerms(value: unknown): string[] {
  const text = clean(value);
  if (!text) return [];
  if (/^tooth\s*\/\s*toothpaste$/i.test(text)) return ['Tooth', 'Toothpaste'];
  return [text];
}

function canonicalKeyword(value: string): string {
  const key = normalizeSosText(value);
  const aliases: Record<string, string> = {
    'body wash': 'Bodywash',
    bodywash: 'Bodywash',
    conditioner: 'Conditioner',
    detergent: 'Detergent',
    'detergent powder': 'Detergent',
    facewash: 'Facewash',
    'face wash': 'Facewash',
    dishwash: 'Dishwash',
    'dish wash': 'Dishwash',
    tooth: 'Toothpaste',
    toothpaste: 'Toothpaste',
    'tooth toothpaste': 'Toothpaste',
    handwash: 'Handwash',
    'hand wash': 'Handwash',
    lotion: 'Lotion',
    shampoo: 'Shampoo',
    toilet: 'Toilet',
    'toilet cleaner': 'Toilet',
    soap: 'Soap',
    'soap bar': 'Soap',
    'face cream': 'Face Cream',
  };
  return aliases[key] || clean(value);
}

function formatForKeyword(keyword: string): string {
  const key = normalizeSosText(keyword);
  const map: Record<string, string> = {
    bodywash: 'Body Wash',
    conditioner: 'Conditioner',
    detergent: 'Detergent Powder',
    facewash: 'Facewash',
    dishwash: 'Dish Wash',
    toothpaste: 'Toothpaste',
    handwash: 'Hand Wash',
    lotion: 'Lotion',
    shampoo: 'Shampoo',
    toilet: 'Toilet Cleaner',
    soap: 'Soap Bar',
    'face cream': 'Face Cream',
  };
  return map[key] || keyword;
}

function validSourceSku(value: unknown): string {
  const text = clean(value);
  if (!text || /^#(?:name|value|ref|n\/a|div\/0)[!?]?$/i.test(text)) return '';
  if (/^nan$/i.test(text)) return '';
  if (/^\d+\.0+$/.test(text)) return text.split('.')[0];
  return text;
}

function numericCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = clean(value);
  if (!text) return null;
  const n = Number(text.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

export async function parseSosKeywordWorkbook(
  buffer: Buffer,
  accountCode: SosKeywordAccountCode,
): Promise<ParsedSosKeywordWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const found = findBestSheet(workbook.worksheets);
  const { sheet, headerRow, headers } = found;
  const mainIdx = headerIndex(headers, MAIN_KEYWORD_HEADERS);
  const additionalIdx = headerIndex(headers, ADDITIONAL_HEADERS);
  const listingIdx = headerIndex(headers, LISTING_HEADERS);
  const skuIdx = headerIndex(headers, SKU_HEADERS);
  const nameIdx = headerIndex(headers, NAME_HEADERS);

  const warnings: string[] = [];
  const grouped = new Map<string, ParsedSosKeyword>();
  let current: ParsedSosKeyword | null = null;
  let rowsTotal = 0;

  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    if (!row.some((cell) => clean(cell))) continue;
    rowsTotal += 1;
    const sourceRow = rawObject(headers, row);
    const mainRaw = mainIdx >= 0 ? clean(row[mainIdx]) : '';
    const additionalRaw = additionalIdx >= 0 ? clean(row[additionalIdx]) : '';
    const listingRaw = listingIdx >= 0 ? row[listingIdx] : null;
    const hasNewGroup = Boolean(mainRaw || additionalRaw || clean(listingRaw));

    if (hasNewGroup) {
      const primaryTerms = mainRaw ? expandPrimaryTerms(mainRaw) : splitTerms(additionalRaw).slice(0, 1);
      if (primaryTerms.length) {
        const parent = canonicalKeyword(mainRaw || primaryTerms[0]);
        const normalizedKey = normalizeSosText(parent);
        if (!normalizedKey) continue;

        current = grouped.get(normalizedKey) || {
          keyword: parent,
          normalizedKey,
          format: formatForKeyword(parent),
          expectedTargetCount: numericCount(listingRaw),
          terms: [],
          targets: [],
        };
        if (current.expectedTargetCount === null) current.expectedTargetCount = numericCount(listingRaw);
        grouped.set(normalizedKey, current);

        const termValues = [...primaryTerms, ...splitTerms(additionalRaw)];
        const seenTerms = new Set(current.terms.map((term) => term.normalizedTerm));
        for (const term of termValues) {
          const normalizedTerm = normalizeSosText(term);
          if (!normalizedTerm || seenTerms.has(normalizedTerm)) continue;
          seenTerms.add(normalizedTerm);
          current.terms.push({
            searchTerm: term,
            normalizedTerm,
            isPrimary: primaryTerms.some((primary) => normalizeSosText(primary) === normalizedTerm),
            sourceRow,
          });
        }
      }
    }

    if (!current) continue;
    const sourceAccountSku = skuIdx >= 0 ? validSourceSku(row[skuIdx]) : '';
    const sourceName = nameIdx >= 0 ? clean(row[nameIdx]) : '';
    if (sourceAccountSku || sourceName) {
      const key = sourceAccountSku
        ? `sku:${normalizeSosText(sourceAccountSku)}`
        : `name:${normalizeSosText(sourceName)}`;
      const exists = current.targets.some((target) => {
        const other = target.sourceAccountSku
          ? `sku:${normalizeSosText(target.sourceAccountSku)}`
          : `name:${normalizeSosText(target.sourceName)}`;
        return other === key;
      });
      if (!exists) current.targets.push({ rowNumber: r + 1, sourceAccountSku, sourceName: sourceName || sourceAccountSku, sourceRow });
    }
  }

  const keywords = [...grouped.values()].filter((keyword) => keyword.terms.length > 0);
  for (const keyword of keywords) {
    if (keyword.expectedTargetCount !== null && keyword.targets.length !== keyword.expectedTargetCount) {
      warnings.push(`${keyword.keyword}: Search Listing says ${keyword.expectedTargetCount}, but ${keyword.targets.length} target product row(s) were parsed.`);
    }
  }
  if (accountCode === 'pandamart' && /sheet11/i.test(sheet.name)) {
    const invalidSkuCount = keywords.flatMap((keyword) => keyword.targets).filter((target) => !target.sourceAccountSku).length;
    if (invalidSkuCount) warnings.push(`${invalidSkuCount} Pandamart target row(s) have blank/error SKU codes in the source workbook; product-name matching will be used for those rows.`);
  }

  return {
    accountCode,
    parserProfile: `SoS keyword mapping — ${accountCode}`,
    sheetName: sheet.name,
    rowsTotal,
    keywords,
    warnings,
  };
}
