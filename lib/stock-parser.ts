import {
  cellText,
  cellValue,
  findLikelyHeaderRow,
  headersForRow,
  isAvailableValue,
  loadWorkbook,
  normalizeHeader,
  parseNumber,
  rowObject,
  valueText,
} from './excel';
import type { ParsedStockRow, StockInspectResult } from './types';

const SKU_HINTS = [
  'account sku', 'sku', 'seller sku', 'sku id', 'product id', 'productid',
  'item id', 'item code', 'product code', 'code',
];
const STOCK_HINTS = [
  'current stock', 'stock qty', 'stock quantity', 'available stock', 'inventory',
  'store stock', 'stock', 'qty', 'quantity', 'ola',
];

const PANDAMART_STOCK_SHEET = 'Store Wise Stock T-1 Day';
const PANDAMART_IGNORED_COLUMNS = new Set(['date', 'sku', 'sku name', 'dc']);

export type StockParseConfig = {
  sheetName: string;
  headerRow: number;
  skuColumn: string;
  stockColumns: string[];
  mode: 'quantity' | 'availability';
};

export type ResolvedStockConfig = {
  config: StockParseConfig;
  snapshotDate: string | null;
  locked: boolean;
  profileName: string | null;
  note: string | null;
  excludedColumns: string[];
  excludedUnits: number;
};

function scoreColumn(name: string, hints: string[]) {
  const n = normalizeHeader(name);
  if (hints === STOCK_HINTS && /(stock value|sold|sales|run rate|amount|revenue)/.test(n)) return 0;
  const exact = hints.findIndex((h) => n === h);
  if (exact >= 0) return 1000 - exact;
  const partial = hints.findIndex((h) => n.includes(h));
  return partial >= 0 ? 500 - partial : 0;
}

function excelDateToIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000;
    return new Date(millis).toISOString().slice(0, 10);
  }

  const text = String(value ?? '').trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function headerIndexes(headers: string[]) {
  return new Map(headers.map((h, i) => [h, i + 1]));
}

async function resolvePandamartProfile(buffer: Buffer): Promise<ResolvedStockConfig> {
  const workbook = await loadWorkbook(buffer);
  const worksheet = workbook.getWorksheet(PANDAMART_STOCK_SHEET);
  if (!worksheet) {
    throw new Error(`Pandamart workbook must contain the sheet "${PANDAMART_STOCK_SHEET}".`);
  }

  const headerRow = findLikelyHeaderRow(worksheet);
  const columns = headersForRow(worksheet, headerRow);
  const byNormalized = new Map(columns.map((column) => [normalizeHeader(column), column]));
  const skuColumn = byNormalized.get('sku');
  const dateColumn = byNormalized.get('date');
  const dcColumn = byNormalized.get('dc');

  if (!skuColumn) throw new Error('Pandamart stock sheet is missing the required "sku" column.');
  if (!dateColumn) throw new Error('Pandamart stock sheet is missing the required "date" column.');

  // Pandamart OLA is based on customer-facing stores only. DC stock is replenishment stock,
  // so it must never make a basepack Available.
  const stockColumns = columns.filter((column) => {
    const normalized = normalizeHeader(column);
    if (PANDAMART_IGNORED_COLUMNS.has(normalized)) return false;
    if (/sold|sales|value|amount|revenue|gfv/.test(normalized)) return false;
    return true;
  });

  if (!stockColumns.length) throw new Error('No Pandamart store stock columns were detected.');

  const indexes = headerIndexes(columns);
  const dateIndex = indexes.get(dateColumn)!;
  const dcIndex = dcColumn ? indexes.get(dcColumn) : undefined;
  let snapshotDate: string | null = null;
  let dcUnits = 0;

  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    if (!snapshotDate) snapshotDate = excelDateToIso(cellValue(worksheet, r, dateIndex));
    if (dcIndex) dcUnits += Math.max(0, parseNumber(cellValue(worksheet, r, dcIndex)) ?? 0);
  }

  if (!snapshotDate) throw new Error('Could not determine the Pandamart T-1 stock date from the "date" column.');

  return {
    config: {
      sheetName: worksheet.name,
      headerRow,
      skuColumn,
      stockColumns,
      mode: 'quantity',
    },
    snapshotDate,
    locked: true,
    profileName: 'Pandamart store availability',
    note: `${stockColumns.length} customer-facing branch columns are preserved branch-wise. DC is stored separately for diagnostics/flags but excluded from OLA. Day-wise sales are imported from Last 30 Days Sales.`,
    excludedColumns: dcColumn ? [dcColumn] : [],
    excludedUnits: dcUnits,
  };
}


const MONTHS = [
  'january','february','march','april','may','june',
  'july','august','september','october','november','december',
] as const;
const MONTH_ALIASES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateParts(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid stock date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function previousIsoDate(value: string) {
  const { year, month, day } = dateParts(value);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function monthYearFromSheetName(name: string): { month: number; year: number | null } | null {
  const lower = name.toLowerCase();
  let month: number | null = null;
  for (const [alias, value] of Object.entries(MONTH_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(lower)) { month = value; break; }
  }
  if (!month) return null;
  const yearMatch = lower.match(/(?:,|\s)(20\d{2}|\d{2})(?:\D|$)/);
  let year: number | null = null;
  if (yearMatch) {
    const raw = Number(yearMatch[1]);
    year = raw < 100 ? 2000 + raw : raw;
  }
  return { month, year };
}

function monthFromText(text: string): number | null {
  const lower = text.toLowerCase();
  for (const [alias, value] of Object.entries(MONTH_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(lower)) return value;
  }
  return null;
}

function salesPeriodFromHeader(
  value: unknown,
  fallbackMonth: number,
  fallbackYear: number,
): { periodStart: string; periodEnd: string; explicitEnd: boolean; label: string } | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 30000 && value < 70000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    const month = d.getUTCMonth() + 1;
    const year = d.getUTCFullYear();
    if (month !== fallbackMonth || year !== fallbackYear) return null;
    return {
      periodStart: isoDate(fallbackYear, fallbackMonth, 1),
      periodEnd: isoDate(fallbackYear, fallbackMonth, daysInMonth(fallbackYear, fallbackMonth)),
      explicitEnd: false,
      label: `${MONTHS[fallbackMonth - 1]} full month`,
    };
  }

  const text = String(value ?? '').trim();
  if (!text) return null;
  const detectedMonth = monthFromText(text);
  if (detectedMonth !== fallbackMonth) return null;
  const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (nums.length < 2) return null;

  const startDay = nums[0] >= 1 && nums[0] <= 31 ? nums[0] : 1;
  const endDay = nums[1] >= 1 && nums[1] <= 31 ? nums[1] : daysInMonth(fallbackYear, fallbackMonth);
  return {
    periodStart: isoDate(fallbackYear, fallbackMonth, startDay),
    periodEnd: isoDate(fallbackYear, fallbackMonth, Math.min(endDay, daysInMonth(fallbackYear, fallbackMonth))),
    explicitEnd: true,
    label: text,
  };
}

function shajgojColumns(worksheet: import('./excel').WorksheetData, stockDate?: string) {
  const headerRow = findLikelyHeaderRow(worksheet);
  const labels = headersForRow(worksheet, headerRow);
  const rawHeaders = worksheet.rows[headerRow - 1] ?? [];
  const normalized = labels.map((v) => normalizeHeader(v));
  const skuIndex = normalized.findIndex((v) => v === 'sku');
  const nameIndex = normalized.findIndex((v) => v === 'name');
  const stockIndex = normalized.findIndex((v) => v === 'total stock qty') >= 0
    ? normalized.findIndex((v) => v === 'total stock qty')
    : normalized.findIndex((v) => v === 'stock' || v === 'total stock');
  const salesValueIndex = normalized.findIndex((v) => v === 'total sold' || v === 'total sale' || v === 'total sales');

  if (skuIndex < 0) throw new Error(`Shajgoj sheet "${worksheet.name}" is missing the SKU column.`);
  if (stockDate && stockIndex < 0) throw new Error(`Shajgoj sheet "${worksheet.name}" is missing Total Stock QTY.`);

  const selected = stockDate ? dateParts(stockDate) : null;
  const sheetInfo = monthYearFromSheetName(worksheet.name);
  const month = sheetInfo?.month ?? selected?.month ?? null;
  let year = sheetInfo?.year ?? selected?.year ?? null;

  if (!month) throw new Error(`Could not determine the month for Shajgoj sheet "${worksheet.name}".`);

  if (!year) {
    for (const raw of rawHeaders) {
      if (typeof raw === 'number' && raw > 30000 && raw < 70000) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000);
        if (d.getUTCMonth() + 1 === month) { year = d.getUTCFullYear(); break; }
      }
      const text = String(raw ?? '');
      if (monthFromText(text) !== month) continue;
      const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
      const yr = [...nums].reverse().find((n, reverseIndex) => n >= 2000 || (n >= 23 && n <= 99 && nums.length - 1 - reverseIndex >= 2));
      if (yr !== undefined) { year = yr < 100 ? 2000 + yr : yr; break; }
    }
  }
  if (!year) throw new Error(`Could not determine the year for Shajgoj sheet "${worksheet.name}".`);

  let soldQtyIndex = -1;
  let soldPeriod: ReturnType<typeof salesPeriodFromHeader> = null;
  for (let i = 0; i < rawHeaders.length; i++) {
    if (i === skuIndex || i === nameIndex || i === stockIndex || i === salesValueIndex) continue;
    const period = salesPeriodFromHeader(rawHeaders[i], month, year);
    if (period) { soldQtyIndex = i; soldPeriod = period; break; }
  }

  if (soldQtyIndex < 0 || !soldPeriod) {
    throw new Error(`Could not identify the cumulative sold-quantity column in Shajgoj sheet "${worksheet.name}".`);
  }

  return {
    headerRow,
    labels,
    skuIndex,
    nameIndex,
    stockIndex,
    soldQtyIndex,
    salesValueIndex,
    month,
    year,
    soldPeriod,
  };
}

function findShajgojCurrentSheet(workbook: import('./excel').WorkbookData, stockDate: string) {
  const { year, month } = dateParts(stockDate);
  const candidates = workbook.worksheets.filter((sheet) => {
    const info = monthYearFromSheetName(sheet.name);
    return info?.month === month && info.year === year && /stock dump/i.test(sheet.name);
  });
  if (!candidates.length) {
    throw new Error(`No Shajgoj stock-dump sheet was found for ${MONTHS[month - 1]} ${year}.`);
  }
  return candidates[0];
}

async function resolveShajgojProfile(buffer: Buffer, stockDate?: string): Promise<ResolvedStockConfig> {
  if (!stockDate) throw new Error('Select the Shajgoj stock date before inspecting the workbook.');
  const workbook = await loadWorkbook(buffer);
  const worksheet = findShajgojCurrentSheet(workbook, stockDate);
  const columns = shajgojColumns(worksheet, stockDate);
  const expectedSalesEnd = previousIsoDate(stockDate);
  if (columns.soldPeriod.explicitEnd && columns.soldPeriod.periodEnd !== expectedSalesEnd) {
    throw new Error(
      `Selected stock date ${stockDate} expects cumulative sales through ${expectedSalesEnd}, ` +
      `but the ${worksheet.name} sold-quantity column represents ${columns.soldPeriod.periodEnd}.`,
    );
  }
  return {
    config: {
      sheetName: worksheet.name,
      headerRow: columns.headerRow,
      skuColumn: columns.labels[columns.skuIndex],
      stockColumns: [columns.labels[columns.stockIndex]],
      mode: 'quantity',
    },
    snapshotDate: null,
    locked: true,
    profileName: 'Shajgoj stock + cumulative sales',
    note: `Stock uses ${columns.labels[columns.stockIndex]} for ${stockDate}. Cumulative sold quantity uses ${columns.labels[columns.soldQtyIndex]} for ${columns.soldPeriod.periodStart} → ${expectedSalesEnd}. Missing stock dates are never fabricated.`,
    excludedColumns: [],
    excludedUnits: 0,
  };
}

export async function parseShajgojWorkbook(
  buffer: Buffer,
  stockDate: string,
): Promise<import('./types').ShajgojParsedWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const currentSheet = findShajgojCurrentSheet(workbook, stockDate);
  const current = shajgojColumns(currentSheet, stockDate);
  const expectedSalesEnd = previousIsoDate(stockDate);
  const currentPeriodStart = isoDate(current.year, current.month, 1);

  if (current.soldPeriod.explicitEnd && current.soldPeriod.periodEnd !== expectedSalesEnd) {
    throw new Error(
      `Selected stock date ${stockDate} does not match the cumulative sales column ${current.labels[current.soldQtyIndex]}. ` +
      `Expected sales through ${expectedSalesEnd}.`,
    );
  }

  const stockAgg = new Map<string, { item_name: string | null; stock_qty: number }>();
  const currentSalesAgg = new Map<string, { item_name: string | null; sold_qty: number; sales_value: number }>();
  let stockInputRows = 0;
  let duplicateSkuRows = 0;

  for (let r = current.headerRow + 1; r <= currentSheet.rowCount; r++) {
    const sku = valueText(currentSheet.rows[r - 1]?.[current.skuIndex]).trim();
    if (!sku) continue;
    stockInputRows++;
    const itemName = current.nameIndex >= 0 ? valueText(currentSheet.rows[r - 1]?.[current.nameIndex]).trim() || null : null;
    const stockQty = Math.max(0, parseNumber(currentSheet.rows[r - 1]?.[current.stockIndex]) ?? 0);
    const soldQty = Math.max(0, parseNumber(currentSheet.rows[r - 1]?.[current.soldQtyIndex]) ?? 0);
    const salesValue = current.salesValueIndex >= 0
      ? Math.max(0, parseNumber(currentSheet.rows[r - 1]?.[current.salesValueIndex]) ?? 0)
      : 0;

    const prevStock = stockAgg.get(sku);
    if (prevStock) duplicateSkuRows++;
    stockAgg.set(sku, {
      item_name: prevStock?.item_name ?? itemName,
      stock_qty: (prevStock?.stock_qty ?? 0) + stockQty,
    });

    const prevSales = currentSalesAgg.get(sku);
    currentSalesAgg.set(sku, {
      item_name: prevSales?.item_name ?? itemName,
      sold_qty: (prevSales?.sold_qty ?? 0) + soldQty,
      sales_value: (prevSales?.sales_value ?? 0) + salesValue,
    });
  }

  const stockRows = [...stockAgg.entries()].map(([account_sku, row]) => ({ account_sku, ...row }));
  const networkRows = stockRows.map(({ account_sku, stock_qty }) => ({ account_sku, stock_qty }));
  const totalUnits = networkRows.reduce((sum, row) => sum + row.stock_qty, 0);

  const salesRows: import('./types').ShajgojSalesCumulativeRow[] = [];
  const periodSummaries: import('./types').ShajgojSalesPeriodSummary[] = [];

  const addPeriod = (
    sourceSheet: string,
    periodStart: string,
    periodEnd: string,
    isCompleteMonth: boolean,
    rows: Map<string, { item_name: string | null; sold_qty: number; sales_value: number }>,
  ) => {
    let soldQty = 0;
    let salesValue = 0;
    for (const [account_sku, row] of rows) {
      soldQty += row.sold_qty;
      salesValue += row.sales_value;
      salesRows.push({
        period_start: periodStart,
        period_end: periodEnd,
        account_sku,
        item_name: row.item_name,
        sold_qty: row.sold_qty,
        sales_value: row.sales_value,
        source_sheet: sourceSheet,
        is_complete_month: isCompleteMonth,
      });
    }
    periodSummaries.push({
      sourceSheet,
      periodStart,
      periodEnd,
      isCompleteMonth,
      skuCount: rows.size,
      soldQty,
      salesValue,
    });
  };

  addPeriod(currentSheet.name, currentPeriodStart, expectedSalesEnd, false, currentSalesAgg);

  // Backfill completed/partial historical month sheets from the same calendar year only.
  // This keeps the daily payload bounded while giving the dashboard the current year's monthly context.
  for (const sheet of workbook.worksheets) {
    if (sheet.name === currentSheet.name || !/stock dump/i.test(sheet.name)) continue;
    const info = monthYearFromSheetName(sheet.name);
    if (!info?.month || info.month >= current.month) continue;

    let cols: ReturnType<typeof shajgojColumns>;
    try { cols = shajgojColumns(sheet); } catch { continue; }
    if (cols.year !== current.year || cols.month !== info.month) continue;

    const monthStart = isoDate(cols.year, cols.month, 1);
    const monthEnd = cols.soldPeriod.explicitEnd
      ? cols.soldPeriod.periodEnd
      : isoDate(cols.year, cols.month, daysInMonth(cols.year, cols.month));
    const isComplete = Number(monthEnd.slice(-2)) === daysInMonth(cols.year, cols.month);
    const sales = new Map<string, { item_name: string | null; sold_qty: number; sales_value: number }>();

    for (let r = cols.headerRow + 1; r <= sheet.rowCount; r++) {
      const sku = valueText(sheet.rows[r - 1]?.[cols.skuIndex]).trim();
      if (!sku) continue;
      const itemName = cols.nameIndex >= 0 ? valueText(sheet.rows[r - 1]?.[cols.nameIndex]).trim() || null : null;
      const soldQty = Math.max(0, parseNumber(sheet.rows[r - 1]?.[cols.soldQtyIndex]) ?? 0);
      const salesValue = cols.salesValueIndex >= 0
        ? Math.max(0, parseNumber(sheet.rows[r - 1]?.[cols.salesValueIndex]) ?? 0)
        : 0;
      const prev = sales.get(sku);
      sales.set(sku, {
        item_name: prev?.item_name ?? itemName,
        sold_qty: (prev?.sold_qty ?? 0) + soldQty,
        sales_value: (prev?.sales_value ?? 0) + salesValue,
      });
    }
    addPeriod(sheet.name, monthStart, monthEnd, isComplete, sales);
  }

  const currentSalesPeriod = periodSummaries[0];
  const historicalSalesPeriods = periodSummaries.slice(1).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

  return {
    stockDate,
    currentSheet: currentSheet.name,
    skuColumn: current.labels[current.skuIndex],
    stockColumn: current.labels[current.stockIndex],
    soldQtyColumn: current.labels[current.soldQtyIndex],
    salesValueColumn: current.salesValueIndex >= 0 ? current.labels[current.salesValueIndex] : null,
    networkRows,
    stockRows,
    salesRows,
    currentSalesPeriod,
    historicalSalesPeriods,
    stockInputRows,
    duplicateSkuRows,
    totalUnits,
  };
}


function shiftIsoDate(value: string, days: number) {
  const { year, month, day } = dateParts(value);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function foodiColumns(worksheet: import('./excel').WorksheetData) {
  const headerRow = findLikelyHeaderRow(worksheet);
  const labels = headersForRow(worksheet, headerRow);
  const normalized = labels.map((v) => normalizeHeader(v));
  const skuIndex = normalized.findIndex((v) => v === 'sku');
  const nameIndex = normalized.findIndex((v) => v === 'product name' || v === 'name');
  const stockIndex = normalized.findIndex((v) => v === 'total stock');
  const soldIndex = normalized.findIndex((v) => v === '30 day sale qty' || v === '30 days sale qty' || v === '30 day sales qty');
  const tpIndex = normalized.findIndex((v) => v === 'tp');
  const mrpIndex = normalized.findIndex((v) => v === 'mrp');
  const sellingPriceIndex = normalized.findIndex((v) => v === 'selling price');

  if (skuIndex < 0) throw new Error(`Foodi sheet "${worksheet.name}" is missing the SKU column.`);
  if (stockIndex < 0) throw new Error(`Foodi sheet "${worksheet.name}" is missing Total Stock.`);
  if (soldIndex < 0) throw new Error(`Foodi sheet "${worksheet.name}" is missing 30 Day Sale Qty.`);

  return { headerRow, labels, skuIndex, nameIndex, stockIndex, soldIndex, tpIndex, mrpIndex, sellingPriceIndex };
}

function findFoodiSheet(workbook: import('./excel').WorkbookData) {
  for (const sheet of workbook.worksheets) {
    try {
      foodiColumns(sheet);
      return sheet;
    } catch {
      // Keep scanning; Foodi exports are normally single-sheet but this keeps the parser robust.
    }
  }
  throw new Error('No Foodi sheet with SKU, Total Stock, and 30 Day Sale Qty was found.');
}

async function resolveFoodiProfile(buffer: Buffer, stockDate?: string): Promise<ResolvedStockConfig> {
  if (!stockDate) throw new Error('Select the Foodi stock date before inspecting the workbook.');
  const workbook = await loadWorkbook(buffer);
  const worksheet = findFoodiSheet(workbook);
  const columns = foodiColumns(worksheet);
  const salesEnd = previousIsoDate(stockDate);
  const salesStart = shiftIsoDate(stockDate, -30);
  return {
    config: {
      sheetName: worksheet.name,
      headerRow: columns.headerRow,
      skuColumn: columns.labels[columns.skuIndex],
      stockColumns: [columns.labels[columns.stockIndex]],
      mode: 'quantity',
    },
    snapshotDate: null,
    locked: true,
    profileName: 'Foodi stock + rolling 30-day sales',
    note: `Stock uses ${columns.labels[columns.stockIndex]} for ${stockDate}. ${columns.labels[columns.soldIndex]} is stored as the rolling 30-day sales window ${salesStart} → ${salesEnd}. Missing stock dates are never fabricated.`,
    excludedColumns: [],
    excludedUnits: 0,
  };
}

export async function parseFoodiWorkbook(
  buffer: Buffer,
  stockDate: string,
): Promise<import('./types').FoodiParsedWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const worksheet = findFoodiSheet(workbook);
  const columns = foodiColumns(worksheet);
  const salesPeriodStart = shiftIsoDate(stockDate, -30);
  const salesPeriodEnd = previousIsoDate(stockDate);

  const stockAgg = new Map<string, { item_name: string | null; stock_qty: number }>();
  const salesAgg = new Map<string, {
    item_name: string | null;
    sold_qty: number;
    tp: number | null;
    mrp: number | null;
    selling_price: number | null;
  }>();
  let stockInputRows = 0;
  let duplicateSkuRows = 0;

  for (let r = columns.headerRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.rows[r - 1] ?? [];
    const sku = valueText(row[columns.skuIndex]).trim();
    if (!sku) continue;
    stockInputRows++;
    const itemName = columns.nameIndex >= 0 ? valueText(row[columns.nameIndex]).trim() || null : null;
    const stockQty = Math.max(0, parseNumber(row[columns.stockIndex]) ?? 0);
    const soldQty = Math.max(0, parseNumber(row[columns.soldIndex]) ?? 0);
    const tp = columns.tpIndex >= 0 ? parseNumber(row[columns.tpIndex]) : null;
    const mrp = columns.mrpIndex >= 0 ? parseNumber(row[columns.mrpIndex]) : null;
    const sellingPrice = columns.sellingPriceIndex >= 0 ? parseNumber(row[columns.sellingPriceIndex]) : null;

    const prevStock = stockAgg.get(sku);
    if (prevStock) duplicateSkuRows++;
    stockAgg.set(sku, {
      item_name: prevStock?.item_name ?? itemName,
      stock_qty: (prevStock?.stock_qty ?? 0) + stockQty,
    });

    const prevSales = salesAgg.get(sku);
    salesAgg.set(sku, {
      item_name: prevSales?.item_name ?? itemName,
      sold_qty: (prevSales?.sold_qty ?? 0) + soldQty,
      tp: prevSales?.tp ?? tp,
      mrp: prevSales?.mrp ?? mrp,
      selling_price: prevSales?.selling_price ?? sellingPrice,
    });
  }

  const stockRows = [...stockAgg.entries()].map(([account_sku, row]) => ({ account_sku, ...row }));
  const networkRows = stockRows.map(({ account_sku, stock_qty }) => ({ account_sku, stock_qty }));
  const salesRows = [...salesAgg.entries()].map(([account_sku, row]) => ({
    stock_date: stockDate,
    period_start: salesPeriodStart,
    period_end: salesPeriodEnd,
    account_sku,
    ...row,
  }));

  return {
    stockDate,
    currentSheet: worksheet.name,
    skuColumn: columns.labels[columns.skuIndex],
    stockColumn: columns.labels[columns.stockIndex],
    salesQtyColumn: columns.labels[columns.soldIndex],
    networkRows,
    stockRows,
    salesRows,
    stockInputRows,
    duplicateSkuRows,
    totalUnits: networkRows.reduce((sum, row) => sum + row.stock_qty, 0),
    salesPeriodStart,
    salesPeriodEnd,
    salesSkuCount: salesRows.length,
    sellingSkuCount: salesRows.filter((row) => row.sold_qty > 0).length,
    totalSoldQty: salesRows.reduce((sum, row) => sum + row.sold_qty, 0),
  };
}


function othobaSnapshotColumns(worksheet: import('./excel').WorksheetData) {
  const headerRow = findLikelyHeaderRow(worksheet);
  const labels = headersForRow(worksheet, headerRow);
  const normalized = labels.map((v) => normalizeHeader(v));
  const skuIndex = normalized.findIndex((v) => v === 'sku');
  const nameIndex = normalized.findIndex((v) => v === 'productname' || v === 'product name' || v === 'name');
  const stockIndex = normalized.findIndex((v) => v === 'current stock' || v === 'stock');
  const soldIndex = normalized.findIndex((v) => /^sold qty/.test(v));
  const runRateIndex = normalized.findIndex((v) => v === 'run rate');
  const mrpIndex = normalized.findIndex((v) => v === 'mrp');
  const tpIndex = normalized.findIndex((v) => v === 'tp');
  const stockValueIndex = normalized.findIndex((v) => v === 'stock value');
  const salesValueIndex = normalized.findIndex((v) => v === 'sales value');
  if (skuIndex < 0 || stockIndex < 0 || soldIndex < 0) {
    throw new Error(`Othoba sheet "${worksheet.name}" must contain SKU, stock, and Sold Qty columns.`);
  }
  return { headerRow, labels, normalized, skuIndex, nameIndex, stockIndex, soldIndex, runRateIndex, mrpIndex, tpIndex, stockValueIndex, salesValueIndex };
}

function othobaDetailedSalesColumns(worksheet: import('./excel').WorksheetData) {
  const headerRow = findLikelyHeaderRow(worksheet);
  const labels = headersForRow(worksheet, headerRow);
  const normalized = labels.map((v) => normalizeHeader(v));
  const skuIndex = normalized.findIndex((v) => v === 'sku');
  const nameIndex = normalized.findIndex((v) => v === 'product name' || v === 'productname' || v === 'name');
  const soldIndex = normalized.findIndex((v) => v === 'total qty' || /^total sold qty/.test(v));
  const totalProductCostIndex = normalized.findIndex((v) => v === 'total product cost');
  const totalAmountIndex = normalized.findIndex((v) => v === 'total amount');
  if (skuIndex < 0 || soldIndex < 0 || totalProductCostIndex < 0 || totalAmountIndex < 0) {
    throw new Error(`Othoba detailed sales sheet "${worksheet.name}" is missing required sales columns.`);
  }
  return { headerRow, labels, skuIndex, nameIndex, soldIndex, totalProductCostIndex, totalAmountIndex };
}

function othobaSalesPeriodFromHeader(label: string, year: number, month: number) {
  const nums = [...label.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n >= 1 && n <= 31);
  const startDay = nums[0] ?? 1;
  const endDay = nums[1] ?? nums[0] ?? daysInMonth(year, month);
  const boundedEnd = Math.min(endDay, daysInMonth(year, month));
  return {
    periodStart: isoDate(year, month, Math.max(1, startDay)),
    periodEnd: isoDate(year, month, boundedEnd),
    isCompleteMonth: startDay === 1 && boundedEnd === daysInMonth(year, month),
  };
}

function findOthobaCurrentSnapshotSheet(workbook: import('./excel').WorkbookData, stockDate: string) {
  const selected = dateParts(stockDate);
  for (const sheet of workbook.worksheets) {
    if (!/sales\s*&\s*stock\s*report/i.test(sheet.name)) continue;
    const info = monthYearFromSheetName(sheet.name);
    if (!info || info.month !== selected.month) continue;
    try { othobaSnapshotColumns(sheet); return sheet; } catch { /* scan next */ }
  }
  throw new Error(`No Othoba ${MONTHS[selected.month - 1]} Sales & Stock Report sheet was found.`);
}

async function resolveOthobaProfile(buffer: Buffer, stockDate?: string): Promise<ResolvedStockConfig> {
  if (!stockDate) throw new Error('Select the Othoba stock date before inspecting the workbook.');
  const workbook = await loadWorkbook(buffer);
  const worksheet = findOthobaCurrentSnapshotSheet(workbook, stockDate);
  const columns = othobaSnapshotColumns(worksheet);
  const selected = dateParts(stockDate);
  const period = othobaSalesPeriodFromHeader(columns.labels[columns.soldIndex], selected.year, selected.month);
  return {
    config: {
      sheetName: worksheet.name,
      headerRow: columns.headerRow,
      skuColumn: columns.labels[columns.skuIndex],
      stockColumns: [columns.labels[columns.stockIndex]],
      mode: 'quantity',
    },
    snapshotDate: null,
    locked: true,
    profileName: 'Othoba stock + MTD sales + monthly sales history',
    note: `Stock is taken from ${worksheet.name} for ${stockDate}. ${columns.labels[columns.soldIndex]} is stored for ${period.periodStart} → ${period.periodEnd}. Monthly Sales Report sheets are aggregated by SKU so duplicate price rows are not double-counted as separate products.`,
    excludedColumns: [],
    excludedUnits: 0,
  };
}

export async function parseOthobaWorkbook(
  buffer: Buffer,
  stockDate: string,
): Promise<import('./types').OthobaParsedWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const selected = dateParts(stockDate);
  const currentSheet = findOthobaCurrentSnapshotSheet(workbook, stockDate);
  const currentCols = othobaSnapshotColumns(currentSheet);

  const stockAgg = new Map<string, { item_name: string | null; stock_qty: number }>();
  let stockInputRows = 0;
  let duplicateSkuRows = 0;
  for (let r = currentCols.headerRow + 1; r <= currentSheet.rowCount; r++) {
    const row = currentSheet.rows[r - 1] ?? [];
    const sku = valueText(row[currentCols.skuIndex]).trim();
    if (!sku) continue;
    stockInputRows++;
    const itemName = currentCols.nameIndex >= 0 ? valueText(row[currentCols.nameIndex]).trim() || null : null;
    const stockQty = Math.max(0, parseNumber(row[currentCols.stockIndex]) ?? 0);
    const prev = stockAgg.get(sku);
    if (prev) duplicateSkuRows++;
    stockAgg.set(sku, { item_name: prev?.item_name ?? itemName, stock_qty: (prev?.stock_qty ?? 0) + stockQty });
  }

  const salesSnapshotRows: import('./types').OthobaSalesSnapshotRow[] = [];
  const salesPeriodSummaries: import('./types').OthobaPeriodSummary[] = [];
  for (const sheet of workbook.worksheets) {
    if (!/sales\s*&\s*stock\s*report/i.test(sheet.name)) continue;
    const info = monthYearFromSheetName(sheet.name);
    if (!info) continue;
    const year = info.year ?? selected.year;
    let cols: ReturnType<typeof othobaSnapshotColumns>;
    try { cols = othobaSnapshotColumns(sheet); } catch { continue; }
    const period = othobaSalesPeriodFromHeader(cols.labels[cols.soldIndex], year, info.month);
    const agg = new Map<string, import('./types').OthobaSalesSnapshotRow>();
    for (let r = cols.headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.rows[r - 1] ?? [];
      const sku = valueText(row[cols.skuIndex]).trim();
      if (!sku) continue;
      const itemName = cols.nameIndex >= 0 ? valueText(row[cols.nameIndex]).trim() || null : null;
      const prev = agg.get(sku);
      const sold = Math.max(0, parseNumber(row[cols.soldIndex]) ?? 0);
      const salesValue = cols.salesValueIndex >= 0 ? Math.max(0, parseNumber(row[cols.salesValueIndex]) ?? 0) : 0;
      agg.set(sku, {
        period_start: period.periodStart,
        period_end: period.periodEnd,
        account_sku: sku,
        item_name: prev?.item_name ?? itemName,
        sold_qty: (prev?.sold_qty ?? 0) + sold,
        run_rate: cols.runRateIndex >= 0 ? parseNumber(row[cols.runRateIndex]) : prev?.run_rate ?? null,
        mrp: cols.mrpIndex >= 0 ? parseNumber(row[cols.mrpIndex]) : prev?.mrp ?? null,
        tp: cols.tpIndex >= 0 ? parseNumber(row[cols.tpIndex]) : prev?.tp ?? null,
        stock_value: (prev?.stock_value ?? 0) + (cols.stockValueIndex >= 0 ? Math.max(0, parseNumber(row[cols.stockValueIndex]) ?? 0) : 0),
        sales_value: (prev?.sales_value ?? 0) + salesValue,
        source_sheet: sheet.name,
        is_complete_month: period.isCompleteMonth,
      });
    }
    const rows = [...agg.values()];
    salesSnapshotRows.push(...rows);
    salesPeriodSummaries.push({
      sourceSheet: sheet.name,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      isCompleteMonth: period.isCompleteMonth,
      skuCount: rows.length,
      soldQty: rows.reduce((n, x) => n + x.sold_qty, 0),
      salesValue: rows.reduce((n, x) => n + (x.sales_value ?? 0), 0),
    });
  }

  const monthlySalesRows: import('./types').OthobaMonthlySalesRow[] = [];
  const monthlySalesPeriods: import('./types').OthobaMonthlySalesSummary[] = [];
  for (const sheet of workbook.worksheets) {
    if (/sales\s*&\s*stock\s*report/i.test(sheet.name)) continue;
    if (!/sales\s*report/i.test(sheet.name)) continue;
    const month = monthFromText(sheet.name);
    if (!month) continue;
    let cols: ReturnType<typeof othobaDetailedSalesColumns>;
    try { cols = othobaDetailedSalesColumns(sheet); } catch { continue; }
    const monthStart = isoDate(selected.year, month, 1);
    const soldHeader = cols.labels[cols.soldIndex] ?? '';
    const headerMonth = monthFromText(soldHeader);
    const headerDays = [...soldHeader.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n >= 1 && n <= 31);
    const explicitEndDay = headerMonth === month && headerDays.length ? headerDays[0] : null;
    const monthEnd = isoDate(selected.year, month, explicitEndDay ?? daysInMonth(selected.year, month));
    const agg = new Map<string, import('./types').OthobaMonthlySalesRow>();
    for (let r = cols.headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.rows[r - 1] ?? [];
      const sku = valueText(row[cols.skuIndex]).trim();
      if (!sku) continue;
      const itemName = cols.nameIndex >= 0 ? valueText(row[cols.nameIndex]).trim() || null : null;
      const prev = agg.get(sku);
      agg.set(sku, {
        month_start: monthStart,
        month_end: monthEnd,
        account_sku: sku,
        item_name: prev?.item_name ?? itemName,
        sold_qty: (prev?.sold_qty ?? 0) + Math.max(0, parseNumber(row[cols.soldIndex]) ?? 0),
        total_product_cost: (prev?.total_product_cost ?? 0) + Math.max(0, parseNumber(row[cols.totalProductCostIndex]) ?? 0),
        total_amount: (prev?.total_amount ?? 0) + Math.max(0, parseNumber(row[cols.totalAmountIndex]) ?? 0),
        source_sheet: sheet.name,
      });
    }
    const rows = [...agg.values()];
    monthlySalesRows.push(...rows);
    monthlySalesPeriods.push({
      sourceSheet: sheet.name,
      monthStart,
      monthEnd,
      skuCount: rows.length,
      soldQty: rows.reduce((n, x) => n + x.sold_qty, 0),
      totalProductCost: rows.reduce((n, x) => n + x.total_product_cost, 0),
      totalAmount: rows.reduce((n, x) => n + x.total_amount, 0),
    });
  }

  const stockRows = [...stockAgg.entries()].map(([account_sku, row]) => ({ account_sku, ...row }));
  const networkRows = stockRows.map(({ account_sku, stock_qty }) => ({ account_sku, stock_qty }));
  const currentSalesPeriod = salesPeriodSummaries.find((x) => x.sourceSheet === currentSheet.name) ?? {
    sourceSheet: currentSheet.name,
    periodStart: isoDate(selected.year, selected.month, 1),
    periodEnd: previousIsoDate(stockDate),
    isCompleteMonth: false,
    skuCount: 0,
    soldQty: 0,
    salesValue: 0,
  };

  return {
    stockDate,
    currentSheet: currentSheet.name,
    skuColumn: currentCols.labels[currentCols.skuIndex],
    stockColumn: currentCols.labels[currentCols.stockIndex],
    salesQtyColumn: currentCols.labels[currentCols.soldIndex],
    networkRows,
    stockRows,
    salesSnapshotRows,
    monthlySalesRows,
    currentSalesPeriod,
    historicalSalesPeriods: salesPeriodSummaries.filter((x) => x.sourceSheet !== currentSheet.name).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
    monthlySalesPeriods: monthlySalesPeriods.sort((a, b) => b.monthStart.localeCompare(a.monthStart)),
    stockInputRows,
    duplicateSkuRows,
    totalUnits: networkRows.reduce((n, x) => n + x.stock_qty, 0),
  };
}


function darazColumns(worksheet: import('./excel').WorksheetData) {
  const headerRow = findLikelyHeaderRow(worksheet);
  const labels = headersForRow(worksheet, headerRow);
  const normalized = labels.map((v) => normalizeHeader(v));
  const skuIndex = normalized.findIndex((v) => v === 'daraz sku' || v === 'daraz_sku');
  const nameIndex = normalized.findIndex((v) => v === 'product name' || v === 'product_name');
  const statusIndex = normalized.findIndex((v) => v === 'sku status details' || v === 'sku_status_details');
  const stockIndex = normalized.findIndex((v) => v === 'total stock' || v === 'total - stock');
  const valuationIndex = normalized.findIndex((v) => v === 'stock valuation');
  const agingQtyIndex = normalized.findIndex((v) => v === 'aging 60d+');
  const agingValuationIndex = normalized.findIndex((v) => v === 'aging valuation');
  const mrpIndex = normalized.findIndex((v) => v === 'mrp');
  const salePriceIndex = normalized.findIndex((v) => v === 'sale price');
  const tpIndex = normalized.findIndex((v) => v === 'tp');
  const gisIndex = normalized.findIndex((v) => v === 'gis');
  const gmvIndex = normalized.findIndex((v) => v === 'gmv');
  const nmvIndex = normalized.findIndex((v) => v === 'nmv');
  const nisIndex = normalized.findIndex((v) => v === 'nis');

  if (skuIndex < 0) throw new Error(`Daraz sheet "${worksheet.name}" is missing daraz_sku.`);
  if (stockIndex < 0) throw new Error(`Daraz sheet "${worksheet.name}" is missing Total - Stock.`);
  if (valuationIndex < 0) throw new Error(`Daraz sheet "${worksheet.name}" is missing Stock Valuation.`);

  return { headerRow, labels, skuIndex, nameIndex, statusIndex, stockIndex, valuationIndex, agingQtyIndex, agingValuationIndex, mrpIndex, salePriceIndex, tpIndex, gisIndex, gmvIndex, nmvIndex, nisIndex };
}

function findDarazSheet(workbook: import('./excel').WorkbookData) {
  for (const sheet of workbook.worksheets) {
    try { darazColumns(sheet); return sheet; } catch { /* scan next */ }
  }
  throw new Error('No Daraz sheet with daraz_sku, Total - Stock and Stock Valuation was found.');
}

async function resolveDarazProfile(buffer: Buffer, stockDate?: string): Promise<ResolvedStockConfig> {
  if (!stockDate) throw new Error('Select the Daraz stock date before inspecting the workbook.');
  const workbook = await loadWorkbook(buffer);
  const worksheet = findDarazSheet(workbook);
  const columns = darazColumns(worksheet);
  const hasStatusColumn = columns.statusIndex >= 0;
  return {
    config: {
      sheetName: worksheet.name,
      headerRow: columns.headerRow,
      skuColumn: columns.labels[columns.skuIndex],
      stockColumns: [columns.labels[columns.stockIndex]],
      mode: 'quantity',
    },
    snapshotDate: null,
    locked: true,
    profileName: hasStatusColumn ? 'Daraz mapped Normal-SKU stock + movement' : 'Daraz compact DOD stock + movement',
    note: hasStatusColumn
      ? `Only rows where ${columns.labels[columns.statusIndex]} = Normal are imported. ${columns.labels[columns.stockIndex]} and ${columns.labels[columns.valuationIndex]} are stored for ${stockDate}. OLA and movement KPIs use only Daraz IDs present in the active master. Stock decreases are labelled implied depletion, not confirmed sales.`
      : `This Daraz DOD export does not include sku_status_details. All SKU rows are ingested as raw observations, while OLA and movement KPIs remain restricted to Daraz IDs present in the active master. Non-master rows therefore cannot change OLA or mapped movement KPIs. ${columns.labels[columns.stockIndex]} and ${columns.labels[columns.valuationIndex]} are stored for ${stockDate}.`,
    excludedColumns: hasStatusColumn ? ['Non-Normal SKU rows'] : [],
    excludedUnits: 0,
  };
}

export async function parseDarazWorkbook(buffer: Buffer, stockDate: string): Promise<import('./types').DarazParsedWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const worksheet = findDarazSheet(workbook);
  const c = darazColumns(worksheet);
  const agg = new Map<string, import('./types').DarazStockRow>();
  let stockInputRows = 0;
  let normalInputRows = 0;
  let ignoredNonNormalRows = 0;
  let duplicateSkuRows = 0;

  for (let r = c.headerRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.rows[r - 1] ?? [];
    const sku = valueText(row[c.skuIndex]).trim();
    if (!sku) continue;
    stockInputRows++;
    if (c.statusIndex >= 0) {
      const status = valueText(row[c.statusIndex]).trim().toLowerCase();
      if (status !== 'normal') { ignoredNonNormalRows++; continue; }
    }
    // Compact Daraz DOD exports may omit sku_status_details entirely. In that case
    // keep the raw observation and let the active V2 master remain the business/KPI scope.
    normalInputRows++;
    const itemName = c.nameIndex >= 0 ? valueText(row[c.nameIndex]).trim() || null : null;
    const item: import('./types').DarazStockRow = {
      account_sku: sku,
      item_name: itemName,
      stock_qty: Math.max(0, parseNumber(row[c.stockIndex]) ?? 0),
      stock_valuation: Math.max(0, parseNumber(row[c.valuationIndex]) ?? 0),
      aging_60d_qty: c.agingQtyIndex >= 0 ? Math.max(0, parseNumber(row[c.agingQtyIndex]) ?? 0) : 0,
      aging_valuation: c.agingValuationIndex >= 0 ? Math.max(0, parseNumber(row[c.agingValuationIndex]) ?? 0) : 0,
      mrp: c.mrpIndex >= 0 ? parseNumber(row[c.mrpIndex]) : null,
      sale_price: c.salePriceIndex >= 0 ? parseNumber(row[c.salePriceIndex]) : null,
      tp: c.tpIndex >= 0 ? parseNumber(row[c.tpIndex]) : null,
      gis: c.gisIndex >= 0 ? parseNumber(row[c.gisIndex]) : null,
      gmv: c.gmvIndex >= 0 ? parseNumber(row[c.gmvIndex]) : null,
      nmv: c.nmvIndex >= 0 ? parseNumber(row[c.nmvIndex]) : null,
      nis: c.nisIndex >= 0 ? parseNumber(row[c.nisIndex]) : null,
    };
    const prev = agg.get(sku);
    if (prev) duplicateSkuRows++;
    if (!prev) agg.set(sku, item);
    else agg.set(sku, {
      ...prev,
      stock_qty: prev.stock_qty + item.stock_qty,
      stock_valuation: prev.stock_valuation + item.stock_valuation,
      aging_60d_qty: prev.aging_60d_qty + item.aging_60d_qty,
      aging_valuation: prev.aging_valuation + item.aging_valuation,
    });
  }

  const stockRows = [...agg.values()];
  const networkRows = stockRows.map(({ account_sku, stock_qty }) => ({ account_sku, stock_qty }));
  return {
    stockDate,
    currentSheet: worksheet.name,
    skuColumn: c.labels[c.skuIndex],
    stockColumn: c.labels[c.stockIndex],
    valuationColumn: c.labels[c.valuationIndex],
    statusColumn: c.statusIndex >= 0 ? c.labels[c.statusIndex] : 'Not provided — active master controls KPI scope',
    networkRows,
    stockRows,
    stockInputRows,
    normalInputRows,
    ignoredNonNormalRows,
    duplicateSkuRows,
    totalUnits: stockRows.reduce((n, x) => n + x.stock_qty, 0),
    totalStockValuation: stockRows.reduce((n, x) => n + x.stock_valuation, 0),
  };
}

export async function resolveAccountStockConfig(
  buffer: Buffer,
  accountCode: string,
  fallback: StockParseConfig,
  requestedSnapshotDate?: string,
): Promise<ResolvedStockConfig> {
  if (accountCode === 'daraz') return resolveDarazProfile(buffer, requestedSnapshotDate);
  if (accountCode === 'pandamart') return resolvePandamartProfile(buffer);
  if (accountCode === 'shajgoj') return resolveShajgojProfile(buffer, requestedSnapshotDate);
  if (accountCode === 'foodi') return resolveFoodiProfile(buffer, requestedSnapshotDate);
  if (accountCode === 'othoba') return resolveOthobaProfile(buffer, requestedSnapshotDate);
  return {
    config: fallback,
    snapshotDate: null,
    locked: false,
    profileName: null,
    note: null,
    excludedColumns: [],
    excludedUnits: 0,
  };
}

export async function inspectStockWorkbook(buffer: Buffer, accountCode?: string, requestedSnapshotDate?: string): Promise<StockInspectResult> {
  if (accountCode === 'daraz') {
    const profile = await resolveDarazProfile(buffer, requestedSnapshotDate);
    const workbook = await loadWorkbook(buffer);
    const worksheet = workbook.getWorksheet(profile.config.sheetName)!;
    const columns = headersForRow(worksheet, profile.config.headerRow);
    const sampleRows = [];
    for (let r = profile.config.headerRow + 1; r <= Math.min(worksheet.rowCount, profile.config.headerRow + 5); r++) sampleRows.push(rowObject(worksheet, r, columns));
    return { sheets: [{
      name: worksheet.name, headerRow: profile.config.headerRow, columns,
      suggestedSkuColumn: profile.config.skuColumn, suggestedStockColumns: profile.config.stockColumns, sampleRows,
      suggestedSnapshotDate: null, locked: true, profileName: profile.profileName, note: profile.note,
      excludedColumns: profile.excludedColumns, excludedUnits: 0,
    }] };
  }

  if (accountCode === 'pandamart') {
    const profile = await resolvePandamartProfile(buffer);
    const workbook = await loadWorkbook(buffer);
    const worksheet = workbook.getWorksheet(profile.config.sheetName)!;
    const columns = headersForRow(worksheet, profile.config.headerRow);
    const sampleRows = [];
    for (let r = profile.config.headerRow + 1; r <= Math.min(worksheet.rowCount, profile.config.headerRow + 5); r++) {
      sampleRows.push(rowObject(worksheet, r, columns));
    }

    return {
      sheets: [{
        name: worksheet.name,
        headerRow: profile.config.headerRow,
        columns,
        suggestedSkuColumn: profile.config.skuColumn,
        suggestedStockColumns: profile.config.stockColumns,
        sampleRows,
        suggestedSnapshotDate: profile.snapshotDate,
        locked: true,
        profileName: profile.profileName,
        note: profile.note,
        excludedColumns: profile.excludedColumns,
        excludedUnits: profile.excludedUnits,
      }],
    };
  }

  if (accountCode === 'shajgoj') {
    const profile = await resolveShajgojProfile(buffer, requestedSnapshotDate);
    const workbook = await loadWorkbook(buffer);
    const worksheet = workbook.getWorksheet(profile.config.sheetName)!;
    const columns = headersForRow(worksheet, profile.config.headerRow);
    const sampleRows = [];
    for (let r = profile.config.headerRow + 1; r <= Math.min(worksheet.rowCount, profile.config.headerRow + 5); r++) {
      sampleRows.push(rowObject(worksheet, r, columns));
    }
    return {
      sheets: [{
        name: worksheet.name,
        headerRow: profile.config.headerRow,
        columns,
        suggestedSkuColumn: profile.config.skuColumn,
        suggestedStockColumns: profile.config.stockColumns,
        sampleRows,
        suggestedSnapshotDate: null,
        locked: true,
        profileName: profile.profileName,
        note: profile.note,
        excludedColumns: profile.excludedColumns,
        excludedUnits: 0,
      }],
    };
  }


  if (accountCode === 'othoba') {
    const profile = await resolveOthobaProfile(buffer, requestedSnapshotDate);
    const workbook = await loadWorkbook(buffer);
    const worksheet = workbook.getWorksheet(profile.config.sheetName)!;
    const columns = headersForRow(worksheet, profile.config.headerRow);
    const sampleRows = [];
    for (let r = profile.config.headerRow + 1; r <= Math.min(worksheet.rowCount, profile.config.headerRow + 5); r++) {
      sampleRows.push(rowObject(worksheet, r, columns));
    }
    return { sheets: [{
      name: worksheet.name,
      headerRow: profile.config.headerRow,
      columns,
      suggestedSkuColumn: profile.config.skuColumn,
      suggestedStockColumns: profile.config.stockColumns,
      sampleRows,
      suggestedSnapshotDate: null,
      locked: true,
      profileName: profile.profileName,
      note: profile.note,
      excludedColumns: [],
      excludedUnits: 0,
    }] };
  }

  if (accountCode === 'foodi') {
    const profile = await resolveFoodiProfile(buffer, requestedSnapshotDate);
    const workbook = await loadWorkbook(buffer);
    const worksheet = workbook.getWorksheet(profile.config.sheetName)!;
    const columns = headersForRow(worksheet, profile.config.headerRow);
    const sampleRows = [];
    for (let r = profile.config.headerRow + 1; r <= Math.min(worksheet.rowCount, profile.config.headerRow + 5); r++) {
      sampleRows.push(rowObject(worksheet, r, columns));
    }
    return {
      sheets: [{
        name: worksheet.name,
        headerRow: profile.config.headerRow,
        columns,
        suggestedSkuColumn: profile.config.skuColumn,
        suggestedStockColumns: profile.config.stockColumns,
        sampleRows,
        suggestedSnapshotDate: null,
        locked: true,
        profileName: profile.profileName,
        note: profile.note,
        excludedColumns: [],
        excludedUnits: 0,
      }],
    };
  }

  const workbook = await loadWorkbook(buffer);
  const sheets = workbook.worksheets.map((worksheet) => {
    const headerRow = findLikelyHeaderRow(worksheet);
    const columns = headersForRow(worksheet, headerRow);
    const suggestedSkuColumn = [...columns]
      .sort((a, b) => scoreColumn(b, SKU_HINTS) - scoreColumn(a, SKU_HINTS))
      .find((c) => scoreColumn(c, SKU_HINTS) > 0) ?? null;
    const suggestedStockColumns = [...columns]
      .filter((c) => scoreColumn(c, STOCK_HINTS) > 0 && c !== suggestedSkuColumn)
      .sort((a, b) => scoreColumn(b, STOCK_HINTS) - scoreColumn(a, STOCK_HINTS))
      .slice(0, 3);

    const sampleRows = [];
    for (let r = headerRow + 1; r <= Math.min(worksheet.rowCount, headerRow + 5); r++) {
      sampleRows.push(rowObject(worksheet, r, columns));
    }

    return {
      name: worksheet.name,
      headerRow,
      columns,
      suggestedSkuColumn,
      suggestedStockColumns,
      sampleRows,
      suggestedSnapshotDate: null,
      locked: false,
      profileName: null,
      note: null,
      excludedColumns: [],
      excludedUnits: 0,
    };
  });
  return { sheets };
}

export async function parseStockWorkbook(
  buffer: Buffer,
  config: StockParseConfig,
): Promise<{ rows: ParsedStockRow[]; rowCount: number; duplicateSkuRows: number; totalUnits: number }> {
  if (!config.stockColumns.length) throw new Error('Select at least one stock/availability column.');

  const workbook = await loadWorkbook(buffer);
  const worksheet = workbook.getWorksheet(config.sheetName);
  if (!worksheet) throw new Error(`Sheet "${config.sheetName}" was not found.`);

  const headers = headersForRow(worksheet, config.headerRow);
  const indexes = headerIndexes(headers);
  const skuIndex = indexes.get(config.skuColumn);
  const stockIndexes = config.stockColumns.map((c) => indexes.get(c)).filter((v): v is number => Boolean(v));
  if (!skuIndex) throw new Error('Selected SKU column was not found.');
  if (!stockIndexes.length) throw new Error('Selected stock columns were not found.');

  const aggregated = new Map<string, number>();
  let inputRows = 0;
  let duplicateSkuRows = 0;

  for (let r = config.headerRow + 1; r <= worksheet.rowCount; r++) {
    const sku = cellText(worksheet, r, skuIndex).trim();
    if (!sku) continue;
    inputRows++;

    let qty = 0;
    if (config.mode === 'availability') {
      qty = stockIndexes.some((idx) => isAvailableValue(cellValue(worksheet, r, idx))) ? 1 : 0;
    } else {
      for (const idx of stockIndexes) {
        qty += Math.max(0, parseNumber(cellValue(worksheet, r, idx)) ?? 0);
      }
    }

    if (aggregated.has(sku)) duplicateSkuRows++;
    if (config.mode === 'availability') aggregated.set(sku, Math.max(aggregated.get(sku) ?? 0, qty));
    else aggregated.set(sku, (aggregated.get(sku) ?? 0) + qty);
  }

  const rows = [...aggregated.entries()].map(([account_sku, stock_qty]) => ({ account_sku, stock_qty }));
  const totalUnits = rows.reduce((sum, row) => sum + row.stock_qty, 0);
  return { rows, rowCount: inputRows, duplicateSkuRows, totalUnits };
}

export async function parsePandamartWorkbook(buffer: Buffer): Promise<import('./types').PandamartParsedWorkbook> {
  const workbook = await loadWorkbook(buffer);
  const stockSheet = workbook.getWorksheet(PANDAMART_STOCK_SHEET);
  if (!stockSheet) throw new Error(`Pandamart workbook must contain the sheet "${PANDAMART_STOCK_SHEET}".`);

  const headerRow = findLikelyHeaderRow(stockSheet);
  const columns = headersForRow(stockSheet, headerRow);
  const indexes = headerIndexes(columns);
  const skuColumn = columns.find((c) => normalizeHeader(c) === 'sku');
  const dateColumn = columns.find((c) => normalizeHeader(c) === 'date');
  const dcColumn = columns.find((c) => normalizeHeader(c) === 'dc');
  if (!skuColumn || !dateColumn) throw new Error('Pandamart stock sheet must contain date and sku columns.');

  const branchCodes = columns.filter((column) => {
    const n = normalizeHeader(column);
    if (PANDAMART_IGNORED_COLUMNS.has(n)) return false;
    if (/sold|sales|value|amount|revenue|gfv/.test(n)) return false;
    return true;
  });
  if (!branchCodes.length) throw new Error('No Pandamart branch columns were found.');

  const skuIndex = indexes.get(skuColumn)!;
  const dateIndex = indexes.get(dateColumn)!;
  const dcIndex = dcColumn ? indexes.get(dcColumn) : undefined;
  const branchIndexes = branchCodes.map((code) => ({ code, index: indexes.get(code)! }));

  let stockDate: string | null = null;
  let stockInputRows = 0;
  let duplicateSkuRows = 0;
  let storeUnits = 0;
  let dcUnits = 0;
  const network = new Map<string, number>();
  const branchStockRows: import('./types').PandamartBranchStockRow[] = [];

  for (let r = headerRow + 1; r <= stockSheet.rowCount; r++) {
    const sku = cellText(stockSheet, r, skuIndex).trim();
    if (!sku) continue;
    stockInputRows++;
    if (!stockDate) stockDate = excelDateToIso(cellValue(stockSheet, r, dateIndex));

    let customerStock = 0;
    for (const branch of branchIndexes) {
      const qty = Math.max(0, parseNumber(cellValue(stockSheet, r, branch.index)) ?? 0);
      customerStock += qty;
      branchStockRows.push({ account_sku: sku, branch_code: branch.code, stock_qty: qty });
    }
    if (dcIndex) {
      const qty = Math.max(0, parseNumber(cellValue(stockSheet, r, dcIndex)) ?? 0);
      dcUnits += qty;
      branchStockRows.push({ account_sku: sku, branch_code: dcColumn!, stock_qty: qty });
    }

    storeUnits += customerStock;
    if (network.has(sku)) duplicateSkuRows++;
    network.set(sku, (network.get(sku) ?? 0) + customerStock);
  }
  if (!stockDate) throw new Error('Could not determine the Pandamart stock date.');

  const networkRows = [...network.entries()].map(([account_sku, stock_qty]) => ({ account_sku, stock_qty }));

  const salesSheet = workbook.getWorksheet('Last 30 Days Sales');
  const salesRows: import('./types').PandamartSalesRow[] = [];
  const salesSkuSet = new Set<string>();
  let totalSoldQty = 0;
  let totalGfv = 0;
  let salesDateStart: string | null = null;
  let salesDateEnd: string | null = null;

  if (salesSheet) {
    const salesHeaderRow = findLikelyHeaderRow(salesSheet);
    const salesColumns = headersForRow(salesSheet, salesHeaderRow);
    const salesIndexes = headerIndexes(salesColumns);
    const find = (name: string) => salesColumns.find((c) => normalizeHeader(c) === normalizeHeader(name));
    const saleDateCol = find('Date');
    const itemIdCol = find('Item_Id');
    const itemNameCol = find('Item_Name');
    const gfvCol = find('gfv_local');
    const soldCol = find('sold_qty');

    if (saleDateCol && itemIdCol && soldCol) {
      for (let r = salesHeaderRow + 1; r <= salesSheet.rowCount; r++) {
        const accountSku = cellText(salesSheet, r, salesIndexes.get(itemIdCol)!).trim();
        const saleDate = excelDateToIso(cellValue(salesSheet, r, salesIndexes.get(saleDateCol)!));
        if (!accountSku || !saleDate) continue;
        const soldQty = Math.max(0, parseNumber(cellValue(salesSheet, r, salesIndexes.get(soldCol)!)) ?? 0);
        const gfv = gfvCol ? Math.max(0, parseNumber(cellValue(salesSheet, r, salesIndexes.get(gfvCol)!)) ?? 0) : 0;
        const itemName = itemNameCol ? cellText(salesSheet, r, salesIndexes.get(itemNameCol)!).trim() || null : null;
        salesRows.push({ sale_date: saleDate, account_sku: accountSku, item_name: itemName, gfv_local: gfv, sold_qty: soldQty });
        salesSkuSet.add(accountSku);
        totalSoldQty += soldQty;
        totalGfv += gfv;
        if (!salesDateStart || saleDate < salesDateStart) salesDateStart = saleDate;
        if (!salesDateEnd || saleDate > salesDateEnd) salesDateEnd = saleDate;
      }
    }
  }

  return {
    stockDate,
    networkRows,
    branchStockRows,
    salesRows,
    stockInputRows,
    duplicateSkuRows,
    storeUnits,
    dcUnits,
    salesDateStart,
    salesDateEnd,
    salesSkuCount: salesSkuSet.size,
    totalSoldQty,
    totalGfv,
    branchCodes,
  };
}
