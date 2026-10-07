import { ACCOUNTS } from './accounts';
import { cellText, loadWorkbook, normalizeHeader, parseNumber, type WorksheetData } from './excel';
import type { MasterPreview, MasterProduct } from './types';

const REQUIRED = ['ubl code', 'sku updated perfect name'];

function splitAccountIds(value: string): string[] {
  const raw = value.trim();
  if (!raw || ['-', 'n/a', 'na', 'null'].includes(raw.toLowerCase())) return [];

  const simpleParts = raw.split(/[\n,;|]+/g).map((v) => v.trim()).filter(Boolean);
  const expanded: string[] = [];

  for (const part of simpleParts) {
    if (/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(part) && !part.toLowerCase().startsWith('http')) {
      expanded.push(...part.split('/').map((v) => v.trim()).filter(Boolean));
    } else {
      expanded.push(part);
    }
  }

  return [...new Set(expanded)];
}

function columnIndexMap(worksheet: WorksheetData, rowNumber: number) {
  const map = new Map<string, number>();
  const max = worksheet.columnCount;
  for (let c = 1; c <= max; c++) {
    const text = cellText(worksheet, rowNumber, c);
    if (text) map.set(normalizeHeader(text), c);
  }
  return map;
}

function getByHeader(worksheet: WorksheetData, rowNumber: number, map: Map<string, number>, names: string[]) {
  for (const name of names) {
    const idx = map.get(normalizeHeader(name));
    if (idx) return cellText(worksheet, rowNumber, idx);
  }
  return '';
}

export async function parseMasterWorkbook(buffer: Buffer): Promise<MasterPreview> {
  const workbook = await loadWorkbook(buffer);
  let worksheet: WorksheetData | undefined;
  let headerRow = 1;
  let headerMap: Map<string, number> | undefined;

  for (const ws of workbook.worksheets) {
    const maxScan = Math.min(10, ws.rowCount || 10);
    for (let r = 1; r <= maxScan; r++) {
      const map = columnIndexMap(ws, r);
      if (REQUIRED.every((h) => map.has(h))) {
        worksheet = ws;
        headerRow = r;
        headerMap = map;
        break;
      }
    }
    if (worksheet) break;
  }

  if (!worksheet || !headerMap) {
    throw new Error('Could not find a sheet containing both "UBL Code" and "Sku Updated Perfect Name".');
  }

  const accountHeaderIndex = new Map<string, number>();
  for (const account of ACCOUNTS) {
    const idx = headerMap.get(normalizeHeader(account.masterColumn));
    if (idx) accountHeaderIndex.set(account.code, idx);
  }

  const products: MasterProduct[] = [];
  const accountCounts: Record<string, number> = Object.fromEntries(ACCOUNTS.map((a) => [a.code, 0]));
  const duplicateTracker = new Map<string, number>();

  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    const ublCode = getByHeader(worksheet, r, headerMap, ['UBL Code']);
    if (!ublCode) continue;

    const name = getByHeader(worksheet, r, headerMap, ['Sku Updated Perfect Name', 'SKU Name', 'Product Name']);
    if (!name) continue;

    const packsize = getByHeader(worksheet, r, headerMap, ['Packsize']);
    if (!packsize) throw new Error(`Packsize is required for UBL Code ${ublCode}.`);

    const rawStatus = getByHeader(worksheet, r, headerMap, ['Status']);
    const status: 'active' | 'inactive' = rawStatus.toLowerCase() === 'inactive' ? 'inactive' : 'active';

    const accountIds: Record<string, string[]> = {};
    for (const account of ACCOUNTS) {
      const idx = accountHeaderIndex.get(account.code);
      if (!idx) {
        accountIds[account.code] = [];
        continue;
      }
      const ids = splitAccountIds(cellText(worksheet, r, idx));
      accountIds[account.code] = ids;
      accountCounts[account.code] += ids.length;
      for (const id of ids) {
        const key = `${account.code}::${id}`;
        duplicateTracker.set(key, (duplicateTracker.get(key) ?? 0) + 1);
      }
    }

    products.push({
      ubl_code: ublCode,
      name,
      status,
      brand: getByHeader(worksheet, r, headerMap, ['Brand']) || null,
      tp: parseNumber(getByHeader(worksheet, r, headerMap, ['TP'])),
      mrp: parseNumber(getByHeader(worksheet, r, headerMap, ['MRP'])),
      packsize,
      sku_label: getByHeader(worksheet, r, headerMap, ['SKU']) || null,
      weight_type: getByHeader(worksheet, r, headerMap, ['TYPE OF WEIGHT', 'Weight Type']) || null,
      weight: parseNumber(getByHeader(worksheet, r, headerMap, ['WEIGHT', 'Weight'])),
      business_group: getByHeader(worksheet, r, headerMap, ['BUSINESS GROUP', 'Business Group']) || null,
      product_type: getByHeader(worksheet, r, headerMap, ['Type']) || null,
      retail_type: getByHeader(worksheet, r, headerMap, ['Retail Type']) || null,
      category: getByHeader(worksheet, r, headerMap, ['UBL CAT', 'Category']) || null,
      sub_category: getByHeader(worksheet, r, headerMap, ['Sub Category']) || null,
      variant: getByHeader(worksheet, r, headerMap, ['VARIANT', 'Variant']) || null,
      description: getByHeader(worksheet, r, headerMap, ['Description']) || null,
      highlights: getByHeader(worksheet, r, headerMap, ['Highlights']) || null,
      hero_image_url: getByHeader(worksheet, r, headerMap, ['Updated Hero Image', 'Hero Image']) || null,
      account_ids: accountIds,
    });
  }

  if (!products.length) throw new Error('No master product rows were found.');

  const duplicateAccountIds = [...duplicateTracker.values()].filter((count) => count > 1).length;
  return {
    sheetName: worksheet.name,
    rowCount: products.length,
    activeCount: products.filter((p) => p.status === 'active').length,
    inactiveCount: products.filter((p) => p.status === 'inactive').length,
    basepackCount: new Set(products.map((p) => p.packsize).filter(Boolean)).size,
    mappingCount: Object.values(accountCounts).reduce((a, b) => a + b, 0),
    duplicateAccountIds,
    accountCounts,
    products,
  };
}
