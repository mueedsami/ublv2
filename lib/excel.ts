import { inflateRawSync } from 'node:zlib';

export type SheetValue = string | number | boolean | null;

export type WorksheetData = {
  name: string;
  rows: SheetValue[][];
  rowCount: number;
  columnCount: number;
};

export type WorkbookData = {
  worksheets: WorksheetData[];
  getWorksheet: (name: string) => WorksheetData | undefined;
};

type ZipEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
};

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)')`));
  return decodeXml(match?.[1] ?? match?.[2] ?? '');
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('Invalid XLSX file: ZIP end-of-directory record was not found.');
}

function listZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  const eocd = findEocd(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  let offset = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Invalid XLSX file: malformed ZIP central directory.');
    }

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    entries.set(name, { name, compression, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Invalid XLSX file: malformed ZIP entry ${entry.name}.`);
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compression === 0) return Buffer.from(compressed);
  if (entry.compression === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported XLSX compression method ${entry.compression}.`);
}

function readXml(buffer: Buffer, entries: Map<string, ZipEntry>, path: string): string | null {
  const entry = entries.get(path);
  if (!entry) return null;
  return readZipEntry(buffer, entry).toString('utf8');
}

function normalizeZipPath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `${base}/${target}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml))) {
    const parts: string[] = [];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(siMatch[1]))) parts.push(decodeXml(tMatch[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

function columnIndexFromReference(reference: string): number {
  const letters = reference.match(/^([A-Z]+)/i)?.[1]?.toUpperCase() ?? '';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function parseCellValue(cellTag: string, body: string, sharedStrings: string[]): SheetValue {
  const type = attr(cellTag, 't');

  if (type === 'inlineStr') {
    const parts: string[] = [];
    const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let match: RegExpExecArray | null;
    while ((match = textRegex.exec(body))) parts.push(decodeXml(match[1]));
    return parts.join('');
  }

  const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  if (!valueMatch) return null;
  const raw = decodeXml(valueMatch[1]);

  if (type === 's') {
    const index = Number(raw);
    return Number.isInteger(index) ? (sharedStrings[index] ?? '') : '';
  }
  if (type === 'b') return raw === '1';
  if (type === 'str' || type === 'e') return raw;

  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

function parseWorksheet(name: string, xml: string, sharedStrings: string[]): WorksheetData {
  const rows: SheetValue[][] = [];
  let maxColumn = 0;
  let nextRowNumber = 1;
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml))) {
    const rowTag = rowMatch[1];
    const rowNumberRaw = attr(rowTag, 'r');
    const rowNumber = Number(rowNumberRaw) || nextRowNumber;
    nextRowNumber = rowNumber + 1;
    const row: SheetValue[] = [];

    const body = rowMatch[2];
    const cellRegex = /<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    let sequentialColumn = 0;

    while ((cellMatch = cellRegex.exec(body))) {
      const cellTag = cellMatch[1] ?? '';
      const cellBody = cellMatch[2] ?? '';
      const reference = attr(cellTag, 'r');
      const column = reference ? columnIndexFromReference(reference) : sequentialColumn;
      sequentialColumn = column + 1;
      row[column] = parseCellValue(cellTag, cellBody, sharedStrings);
      maxColumn = Math.max(maxColumn, column + 1);
    }

    while (rows.length < rowNumber - 1) rows.push([]);
    rows[rowNumber - 1] = row;
  }

  return {
    name,
    rows,
    rowCount: rows.length,
    columnCount: maxColumn,
  };
}

export async function loadWorkbook(buffer: Buffer): Promise<WorkbookData> {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('The uploaded file is not a valid .xlsx workbook.');
  }

  const entries = listZipEntries(buffer);
  const workbookXml = readXml(buffer, entries, 'xl/workbook.xml');
  const relationshipsXml = readXml(buffer, entries, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relationshipsXml) {
    throw new Error('Invalid XLSX workbook: workbook metadata is missing.');
  }

  const relationshipTargets = new Map<string, string>();
  const relRegex = /<Relationship\b([^>]*?)\/?>/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relationshipsXml))) {
    const id = attr(relMatch[1], 'Id');
    const target = attr(relMatch[1], 'Target');
    if (id && target) relationshipTargets.set(id, normalizeZipPath('xl', target));
  }

  const sharedStrings = parseSharedStrings(readXml(buffer, entries, 'xl/sharedStrings.xml'));
  const worksheets: WorksheetData[] = [];
  const sheetRegex = /<sheet\b([^>]*?)\/?>/g;
  let sheetMatch: RegExpExecArray | null;

  while ((sheetMatch = sheetRegex.exec(workbookXml))) {
    const sheetTag = sheetMatch[1];
    const name = attr(sheetTag, 'name');
    const relationshipId = attr(sheetTag, 'r:id');
    const path = relationshipTargets.get(relationshipId);
    if (!name || !path) continue;
    const xml = readXml(buffer, entries, path);
    if (!xml) continue;
    worksheets.push(parseWorksheet(name, xml, sharedStrings));
  }

  if (!worksheets.length) throw new Error('No worksheets were found in the uploaded workbook.');

  return {
    worksheets,
    getWorksheet: (name: string) => worksheets.find((sheet) => sheet.name === name),
  };
}

export function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function cellValue(worksheet: WorksheetData, rowNumber: number, columnNumber: number): SheetValue {
  if (rowNumber < 1 || columnNumber < 1) return null;
  return worksheet.rows[rowNumber - 1]?.[columnNumber - 1] ?? null;
}

export function cellText(worksheet: WorksheetData, rowNumber: number, columnNumber: number): string {
  return valueText(cellValue(worksheet, rowNumber, columnNumber));
}

export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).replace(/,/g, '').replace(/[৳$]/g, '').trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

export function isAvailableValue(value: unknown): boolean {
  const num = parseNumber(value);
  if (num !== null) return num > 0;
  const text = String(value ?? '').trim().toLowerCase();
  return ['yes', 'y', 'true', 'in stock', 'instock', 'available', 'active', '1'].includes(text);
}

export function findLikelyHeaderRow(worksheet: WorksheetData): number {
  const max = Math.min(20, worksheet.rowCount || 20);
  let bestRow = 1;
  let bestScore = -1;
  const skuHints = ['sku', 'product id', 'productid', 'seller sku', 'item id', 'product code', 'code'];
  const stockHints = ['current stock', 'stock qty', 'stock quantity', 'stock', 'inventory', 'available stock', 'quantity', 'qty', 'ola'];

  for (let r = 1; r <= max; r++) {
    const values = (worksheet.rows[r - 1] ?? []).map((value) => normalizeHeader(valueText(value)));
    const nonEmpty = values.filter(Boolean).length;
    const hasSku = values.some((v) => skuHints.some((hint) => v === hint || v.includes(hint)));
    const hasStock = values.some((v) => stockHints.some((hint) => v === hint || v.includes(hint)));
    const score = nonEmpty + (hasSku ? 20 : 0) + (hasStock ? 20 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
}

export function headersForRow(worksheet: WorksheetData, headerRow: number): string[] {
  const row = worksheet.rows[headerRow - 1] ?? [];
  const headers = Array.from({ length: worksheet.columnCount }, (_, index) => {
    return valueText(row[index]) || `Column ${index + 1}`;
  });

  while (headers.length) {
    const lastIndex = headers.length - 1;
    if (!headers[lastIndex].startsWith('Column ')) break;
    const hasAnyValue = worksheet.rows.some((r) => valueText(r[lastIndex]) !== '');
    if (hasAnyValue) break;
    headers.pop();
  }
  return headers;
}

export function rowObject(worksheet: WorksheetData, rowNumber: number, headers: string[]): Record<string, string | number | null> {
  const row = worksheet.rows[rowNumber - 1] ?? [];
  const out: Record<string, string | number | null> = {};
  headers.forEach((header, index) => {
    const value = row[index] ?? null;
    if (typeof value === 'number') out[header] = value;
    else {
      const text = valueText(value);
      out[header] = text || null;
    }
  });
  return out;
}
