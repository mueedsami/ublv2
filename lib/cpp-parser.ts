import { loadWorkbook, valueText, type SheetValue, type WorksheetData } from '@/lib/excel';

export type CppAccountCode = 'daraz' | 'shajgoj' | 'pandamart' | 'othoba' | 'arogga' | 'shwapno';

export type ParsedCppRow = {
  sourceSheet: string;
  rowNumber: number;
  sourceIdentifier: string;
  directAccountSku: string;
  sourcePacksize: string;
  productName: string;
  brand: string;
  category: string;
  expectedPrice: number;
  mrp: number | null;
  supportAmount: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  raw: Record<string, SheetValue>;
};

export type ParsedCppWorkbook = {
  profileName: string;
  profileNote: string;
  rows: ParsedCppRow[];
  warnings: string[];
  detectedSheets: string[];
  suggestedEffectiveFrom: string | null;
  suggestedEffectiveTo: string | null;
};

export type GenericCppMapping = {
  sheetName: string;
  headerRow: number;
  skuColumn: string;
  priceColumn: string;
  productNameColumn?: string;
  brandColumn?: string;
  categoryColumn?: string;
  mrpColumn?: string;
};

export type GenericCppSheetInspection = {
  name: string;
  headerRow: number;
  columns: string[];
  suggestedSkuColumn: string;
  suggestedPriceColumn: string;
  suggestedProductNameColumn: string;
  suggestedBrandColumn: string;
  suggestedCategoryColumn: string;
  suggestedMrpColumn: string;
  sampleRows: Record<string, SheetValue>[];
};

export type GenericCppInspection = {
  profileName: string;
  profileNote: string;
  sheets: GenericCppSheetInspection[];
};

function canon(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cleanSku(value: unknown): string {
  let text = valueText(value);
  if (/^\d+\.0+$/.test(text)) text = text.split('.')[0];
  return text.replace(/_BD_/gi, '_BD-').replace(/\s+BD\s+/gi, '_BD-').replace(/\s+/g, '');
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').replace(/,/g, '').replace(/[^0-9.\-]/g, '').trim();
  if (!text || text === '-' || text === '.') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function excelDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.round(value) * 86400000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const text = valueText(value);
  if (!text) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function rawObject(headers: SheetValue[], row: SheetValue[]): Record<string, SheetValue> {
  const out: Record<string, SheetValue> = {};
  headers.forEach((header, index) => {
    out[valueText(header) || `Column ${index + 1}`] = row[index] ?? null;
  });
  return out;
}

function headerIndex(headers: SheetValue[], candidates: string[]): number {
  const map = new Map<string, number>();
  headers.forEach((header, index) => map.set(canon(header), index));
  for (const candidate of candidates) {
    const index = map.get(canon(candidate));
    if (index !== undefined) return index;
  }
  return -1;
}

function findHeaderRow(sheet: WorksheetData, requiredGroups: string[][]): { row: number; headers: SheetValue[] } | null {
  for (let r = 0; r < Math.min(sheet.rows.length, 12); r++) {
    const headers = sheet.rows[r] || [];
    const ok = requiredGroups.every((group) => headerIndex(headers, group) >= 0);
    if (ok) return { row: r, headers };
  }
  return null;
}

function monthFromFilename(fileName: string): { from: string; to: string } | null {
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const lower = fileName.toLowerCase();
  const monthName = Object.keys(months).find((name) => lower.includes(name));
  if (!monthName) return null;
  const yearMatch = lower.match(/(?:20)?(\d{2})(?!\d)/g)?.map((m) => Number(m.length === 2 ? `20${m}` : m)).find((y) => y >= 2020 && y <= 2100);
  const year = yearMatch || new Date().getFullYear();
  const month = months[monthName];
  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}


async function parseDarazAsync(buffer: Buffer, fileName: string): Promise<ParsedCppWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.worksheets.find((s) => /working\s*file/i.test(s.name)) || workbook.worksheets[0];
  const header = findHeaderRow(sheet, [
    ['Daraz sku', 'Daraz SKU', 'daraz_sku'],
    ['MRP'],
    ['October Backmargin', 'Backmargin', 'October BM'],
  ]);
  if (!header) throw new Error('Daraz CPP sheet must contain Daraz sku, MRP and October Backmargin columns.');

  const skuIdx = headerIndex(header.headers, ['Daraz sku', 'Daraz SKU', 'daraz_sku']);
  const nameIdx = headerIndex(header.headers, ['Product Name', 'Product Name ']);
  const brandIdx = headerIndex(header.headers, ['Brand Name', 'Brand']);
  const mrpIdx = headerIndex(header.headers, ['MRP']);
  const backmarginIdx = headerIndex(header.headers, ['October Backmargin', 'Backmargin', 'October BM']);
  const startIdx = headerIndex(header.headers, ['Start Date']);
  const endIdx = headerIndex(header.headers, ['End Date']);

  const rows: ParsedCppRow[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    const accountSku = cleanSku(cells[skuIdx]);
    if (!accountSku) continue;
    const mrp = numberValue(cells[mrpIdx]);
    const support = numberValue(cells[backmarginIdx]);
    if (mrp === null || support === null) {
      warnings.push(`${sheet.name} row ${r + 1}: skipped because MRP or October Backmargin is invalid.`);
      continue;
    }
    if (seen.has(accountSku)) {
      warnings.push(`${sheet.name} row ${r + 1}: duplicate Daraz SKU ${accountSku} skipped.`);
      continue;
    }
    seen.add(accountSku);
    const expectedPrice = Math.max(0, mrp - support);
    rows.push({
      sourceSheet: sheet.name,
      rowNumber: r + 1,
      sourceIdentifier: accountSku,
      directAccountSku: accountSku,
      sourcePacksize: '',
      productName: nameIdx >= 0 ? valueText(cells[nameIdx]) : '',
      brand: brandIdx >= 0 ? valueText(cells[brandIdx]) : '',
      category: '',
      expectedPrice,
      mrp,
      supportAmount: support,
      effectiveFrom: startIdx >= 0 ? excelDate(cells[startIdx]) : null,
      effectiveTo: endIdx >= 0 ? excelDate(cells[endIdx]) : null,
      raw: rawObject(header.headers, cells),
    });
  }

  const starts = rows.map((row) => row.effectiveFrom).filter(Boolean) as string[];
  const ends = rows.map((row) => row.effectiveTo).filter(Boolean) as string[];
  const inferred = monthFromFilename(fileName);
  return {
    profileName: 'Daraz CPP — MRP less October Backmargin',
    profileNote: 'Daraz expected CPP is calculated as MRP − October Backmargin for each Daraz SKU.',
    rows,
    warnings,
    detectedSheets: [sheet.name],
    suggestedEffectiveFrom: starts.sort()[0] || inferred?.from || null,
    suggestedEffectiveTo: ends.sort().at(-1) || inferred?.to || null,
  };
}

async function parseShajgojAsync(buffer: Buffer, fileName: string): Promise<ParsedCppWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.worksheets.find((s) => /all\s*sku\s*cpp\s*sku/i.test(s.name))
    || workbook.worksheets.find((s) => findHeaderRow(s, [['Packsize'], ['Selling Price']]))
    || workbook.worksheets[0];
  const header = findHeaderRow(sheet, [['Packsize'], ['Selling Price']]);
  if (!header) throw new Error('Shajgoj CPP sheet must contain Packsize and Selling Price columns.');

  const packIdx = headerIndex(header.headers, ['Packsize']);
  const nameIdx = headerIndex(header.headers, ['Sku Updated Perfect Name', 'Product Name', 'Name']);
  const brandIdx = headerIndex(header.headers, ['Brand(PH)(m.d.)', 'Brand']);
  const categoryIdx = headerIndex(header.headers, ['Category']);
  const mrpIdx = headerIndex(header.headers, ['MRP']);
  const sellingIdx = headerIndex(header.headers, ['Selling Price']);

  const rows: ParsedCppRow[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    const packsize = valueText(cells[packIdx]);
    if (!packsize) continue;
    const expectedPrice = numberValue(cells[sellingIdx]);
    if (expectedPrice === null) {
      warnings.push(`${sheet.name} row ${r + 1}: skipped because Selling Price is invalid.`);
      continue;
    }
    const key = canon(packsize);
    if (seen.has(key)) {
      warnings.push(`${sheet.name} row ${r + 1}: duplicate Packsize ${packsize} skipped.`);
      continue;
    }
    seen.add(key);
    rows.push({
      sourceSheet: sheet.name,
      rowNumber: r + 1,
      sourceIdentifier: packsize,
      directAccountSku: '',
      sourcePacksize: packsize,
      productName: nameIdx >= 0 ? valueText(cells[nameIdx]) : '',
      brand: brandIdx >= 0 ? valueText(cells[brandIdx]) : '',
      category: categoryIdx >= 0 ? valueText(cells[categoryIdx]) : '',
      expectedPrice,
      mrp: mrpIdx >= 0 ? numberValue(cells[mrpIdx]) : null,
      supportAmount: null,
      effectiveFrom: null,
      effectiveTo: null,
      raw: rawObject(header.headers, cells),
    });
  }

  const inferred = monthFromFilename(fileName);
  if (workbook.worksheets.some((s) => /vaseline\s*b1g1/i.test(s.name))) {
    warnings.push('Vaseline B1G1 Offer is an auxiliary offer sheet and is not imported into the base-SKU CPP set yet.');
  }
  if (workbook.worksheets.some((s) => /need\s*to\s*enlist/i.test(s.name))) {
    warnings.push('Need to enlistment is informational and is not imported into the active CPP target set.');
  }
  return {
    profileName: 'Shajgoj CPP — Selling Price',
    profileNote: 'Shajgoj expected CPP uses Selling Price. Marketplace SKU is resolved from the current master using Packsize/product matching.',
    rows,
    warnings,
    detectedSheets: [sheet.name],
    suggestedEffectiveFrom: inferred?.from || null,
    suggestedEffectiveTo: inferred?.to || null,
  };
}

/** Arogga commercial CPP profile. Only the base-SKU sheet represents active price targets. */
async function parseAroggaAsync(buffer: Buffer, fileName: string): Promise<ParsedCppWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.worksheets.find((s) => /all\s*sku\s*cpp\s*sku/i.test(s.name))
    || workbook.worksheets.find((s) => findHeaderRow(s, [['Arogga code'], ['Selling Price']]))
    || workbook.worksheets[0];
  const header = findHeaderRow(sheet, [['Arogga code'], ['Selling Price']]);
  if (!header) throw new Error('Arogga CPP workbook must contain Arogga code and Selling Price columns.');
  const skuIdx = headerIndex(header.headers, ['Arogga code']);
  const priceIdx = headerIndex(header.headers, ['Selling Price']);
  const nameIdx = headerIndex(header.headers, ['Sku Updated Perfect Name', 'Product Name']);
  const packIdx = headerIndex(header.headers, ['Packsize']);
  const brandIdx = headerIndex(header.headers, ['Brand(PH)(m.d.)', 'Brand']);
  const categoryIdx = headerIndex(header.headers, ['Category']);
  const mrpIdx = headerIndex(header.headers, ['MRP']);
  const rows: ParsedCppRow[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, { price: number; row: number }>();
  let missingCodes = 0;
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    if (!cells.some((cell) => valueText(cell))) continue;
    const code = cleanSku(cells[skuIdx]);
    if (!code) { missingCodes++; continue; }
    const expectedPrice = numberValue(cells[priceIdx]);
    if (expectedPrice === null || expectedPrice < 0) {
      warnings.push(`${sheet.name} row ${r + 1}: invalid Selling Price; skipped Arogga code ${code}.`);
      continue;
    }
    const prior = seen.get(code);
    if (prior) {
      warnings.push(`${sheet.name} row ${r + 1}: duplicate Arogga code ${code} (first at row ${prior.row})${Math.abs(prior.price - expectedPrice) > 0.005 ? ' with CONFLICTING selling price' : ''}; skipped. Review before activation.`);
      continue;
    }
    seen.set(code, { price: expectedPrice, row: r + 1 });
    rows.push({
      sourceSheet: sheet.name, rowNumber: r + 1, sourceIdentifier: code,
      directAccountSku: code,
      sourcePacksize: packIdx >= 0 ? valueText(cells[packIdx]) : '',
      productName: nameIdx >= 0 ? valueText(cells[nameIdx]) : '',
      brand: brandIdx >= 0 ? valueText(cells[brandIdx]) : '',
      category: categoryIdx >= 0 ? valueText(cells[categoryIdx]) : '',
      expectedPrice, mrp: mrpIdx >= 0 ? numberValue(cells[mrpIdx]) : null,
      supportAmount: null, effectiveFrom: null, effectiveTo: null,
      raw: rawObject(header.headers, cells),
    });
  }
  if (missingCodes) warnings.push(`${missingCodes} source rows have no Arogga code; excluded from scrapeable CPP targets (not matched by product name).`);
  for (const s of workbook.worksheets) {
    if (s.name !== sheet.name) warnings.push(`Worksheet "${s.name}" is auxiliary and was not included in active Arogga CPP targets.`);
  }
  const inferred = monthFromFilename(fileName);
  return {
    profileName: 'Arogga CPP — Arogga code + Selling Price',
    profileNote: 'Expected CPP comes from Selling Price; Arogga code is the authoritative marketplace identifier. Missing or duplicate codes are excluded. Offer and enlistment sheets are excluded.',
    rows, warnings, detectedSheets: [sheet.name],
    suggestedEffectiveFrom: inferred?.from || null,
    suggestedEffectiveTo: inferred?.to || null,
  };
}

const GENERIC_ACCOUNT_NAMES: Record<CppAccountCode, string> = {
  daraz: 'Daraz',
  shajgoj: 'Shajgoj',
  pandamart: 'Pandamart',
  othoba: 'Othoba',
  arogga: 'Arogga',
  shwapno: 'Shwapno',
};

const GENERIC_SKU_HINTS = [
  'account sku', 'marketplace sku', 'sku', 'product id', 'productid', 'product code', 'item id',
  'article code', 'article', 'code', 'seller sku', 'site sku', 'othoba sku', 'pandamart sku',
  'arogga sku', 'shwapno sku',
];
const GENERIC_PRICE_HINTS = [
  'cpp', 'cpp price', 'target price', 'expected price', 'approved price', 'selling price',
  'offer price', 'promo price', 'promotional price', 'final price',
];
const GENERIC_NAME_HINTS = ['product name', 'item name', 'name', 'sku name', 'product'];
const GENERIC_BRAND_HINTS = ['brand', 'brand name'];
const GENERIC_CATEGORY_HINTS = ['category', 'ubl category', 'cat'];
const GENERIC_MRP_HINTS = ['mrp', 'original price', 'list price'];

function bestColumn(headers: SheetValue[], hints: string[]): string {
  const names = headers.map((h) => valueText(h)).filter(Boolean);
  for (const hint of hints) {
    const exact = names.find((name) => canon(name) === canon(hint));
    if (exact) return exact;
  }
  for (const hint of hints) {
    const partial = names.find((name) => canon(name).includes(canon(hint)) || canon(hint).includes(canon(name)));
    if (partial) return partial;
  }
  return '';
}

function genericHeaderRow(sheet: WorksheetData): { row: number; headers: SheetValue[] } | null {
  let best: { row: number; headers: SheetValue[]; score: number } | null = null;
  for (let r = 0; r < Math.min(sheet.rows.length, 20); r++) {
    const headers = sheet.rows[r] || [];
    const nonEmpty = headers.map((h) => valueText(h)).filter(Boolean).length;
    if (nonEmpty < 2) continue;
    const sku = bestColumn(headers, GENERIC_SKU_HINTS);
    const price = bestColumn(headers, GENERIC_PRICE_HINTS);
    const score = nonEmpty + (sku ? 40 : 0) + (price ? 40 : 0);
    if (!best || score > best.score) best = { row: r, headers, score };
  }
  return best ? { row: best.row, headers: best.headers } : null;
}

function columnIndexByName(headers: SheetValue[], name: string): number {
  const wanted = canon(name);
  if (!wanted) return -1;
  return headers.findIndex((header) => canon(header) === wanted);
}

function sampleRows(sheet: WorksheetData, headerRow: number, headers: SheetValue[]): Record<string, SheetValue>[] {
  const out: Record<string, SheetValue>[] = [];
  for (let r = headerRow + 1; r < sheet.rows.length && out.length < 4; r++) {
    const cells = sheet.rows[r] || [];
    if (!cells.some((cell) => valueText(cell))) continue;
    out.push(rawObject(headers, cells));
  }
  return out;
}

export async function inspectGenericCppWorkbook(buffer: Buffer): Promise<GenericCppInspection> {
  const workbook = await loadWorkbook(buffer);
  const sheets = workbook.worksheets.map((sheet) => {
    const header = genericHeaderRow(sheet);
    if (!header) return null;
    const columns = header.headers.map((h) => valueText(h)).filter(Boolean);
    if (!columns.length) return null;
    return {
      name: sheet.name,
      headerRow: header.row + 1,
      columns,
      suggestedSkuColumn: bestColumn(header.headers, GENERIC_SKU_HINTS),
      suggestedPriceColumn: bestColumn(header.headers, GENERIC_PRICE_HINTS),
      suggestedProductNameColumn: bestColumn(header.headers, GENERIC_NAME_HINTS),
      suggestedBrandColumn: bestColumn(header.headers, GENERIC_BRAND_HINTS),
      suggestedCategoryColumn: bestColumn(header.headers, GENERIC_CATEGORY_HINTS),
      suggestedMrpColumn: bestColumn(header.headers, GENERIC_MRP_HINTS),
      sampleRows: sampleRows(sheet, header.row, header.headers),
    } satisfies GenericCppSheetInspection;
  }).filter(Boolean) as GenericCppSheetInspection[];

  return {
    profileName: 'Direct-SKU CPP upload',
    profileNote: 'Choose the marketplace SKU/Product ID column and the approved CPP price column. No fuzzy SKU matching is used.',
    sheets,
  };
}

async function parseGenericDirectAsync(
  buffer: Buffer,
  fileName: string,
  accountCode: CppAccountCode,
  mapping: GenericCppMapping,
): Promise<ParsedCppWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.getWorksheet(mapping.sheetName);
  if (!sheet) throw new Error(`Worksheet ${mapping.sheetName} was not found.`);
  const headerRow = Math.max(1, Number(mapping.headerRow || 1)) - 1;
  const headers = sheet.rows[headerRow] || [];

  const skuIdx = columnIndexByName(headers, mapping.skuColumn);
  const priceIdx = columnIndexByName(headers, mapping.priceColumn);
  if (skuIdx < 0) throw new Error(`Marketplace SKU column "${mapping.skuColumn}" was not found in ${sheet.name}.`);
  if (priceIdx < 0) throw new Error(`CPP price column "${mapping.priceColumn}" was not found in ${sheet.name}.`);

  const nameIdx = mapping.productNameColumn ? columnIndexByName(headers, mapping.productNameColumn) : -1;
  const brandIdx = mapping.brandColumn ? columnIndexByName(headers, mapping.brandColumn) : -1;
  const categoryIdx = mapping.categoryColumn ? columnIndexByName(headers, mapping.categoryColumn) : -1;
  const mrpIdx = mapping.mrpColumn ? columnIndexByName(headers, mapping.mrpColumn) : -1;

  const rows: ParsedCppRow[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    const accountSku = cleanSku(cells[skuIdx]);
    if (!accountSku) continue;
    const expectedPrice = numberValue(cells[priceIdx]);
    if (expectedPrice === null || expectedPrice < 0) {
      warnings.push(`${sheet.name} row ${r + 1}: skipped because CPP price is invalid.`);
      continue;
    }
    if (seen.has(accountSku)) {
      warnings.push(`${sheet.name} row ${r + 1}: duplicate marketplace SKU ${accountSku} skipped.`);
      continue;
    }
    seen.add(accountSku);
    rows.push({
      sourceSheet: sheet.name,
      rowNumber: r + 1,
      sourceIdentifier: accountSku,
      directAccountSku: accountSku,
      sourcePacksize: '',
      productName: nameIdx >= 0 ? valueText(cells[nameIdx]) : '',
      brand: brandIdx >= 0 ? valueText(cells[brandIdx]) : '',
      category: categoryIdx >= 0 ? valueText(cells[categoryIdx]) : '',
      expectedPrice,
      mrp: mrpIdx >= 0 ? numberValue(cells[mrpIdx]) : null,
      supportAmount: null,
      effectiveFrom: null,
      effectiveTo: null,
      raw: rawObject(headers, cells),
    });
  }

  const inferred = monthFromFilename(fileName);
  const accountName = GENERIC_ACCOUNT_NAMES[accountCode];
  return {
    profileName: `${accountName} CPP — direct SKU + approved price`,
    profileNote: `Expected CPP uses "${mapping.priceColumn}". Marketplace SKU/Product ID is read directly from "${mapping.skuColumn}"; no fuzzy SKU matching is used.`,
    rows,
    warnings,
    detectedSheets: [sheet.name],
    suggestedEffectiveFrom: inferred?.from || null,
    suggestedEffectiveTo: inferred?.to || null,
  };
}

export async function parseCppReferenceWorkbook(
  buffer: Buffer,
  accountCode: CppAccountCode,
  fileName: string,
  genericMapping?: GenericCppMapping,
): Promise<ParsedCppWorkbook> {
  if (accountCode === 'daraz') return parseDarazAsync(buffer, fileName);
  if (accountCode === 'shajgoj') return parseShajgojAsync(buffer, fileName);
  if (accountCode === 'arogga') return parseAroggaAsync(buffer, fileName);
  if (!genericMapping) throw new Error(`Choose the worksheet, marketplace SKU column and CPP price column for ${GENERIC_ACCOUNT_NAMES[accountCode]}.`);
  return parseGenericDirectAsync(buffer, fileName, accountCode, genericMapping);
}
