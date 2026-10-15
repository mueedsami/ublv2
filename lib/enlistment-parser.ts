import { loadWorkbook, normalizeHeader, valueText, type SheetValue } from '@/lib/excel';

export type EnlistmentImportRow = {
  enlistment_key: string;
  source_row: number;
  sl: string;
  barcode: string;
  length_cm: string;
  depth_cm: string;
  height_cm: string;
  shelf_life_days: string;
  name: string;
  image_url: string;
  description: string;
  dept: string;
  category: string;
  sub_category: string;
  pcs_per_crm: string;
  tp: string;
  mrp: string;
  margin_source: string;
  cert_license: string;
  brand: string;
  supplier_name: string;
  country_of_origin: string;
  source_status: string;
  raw: Record<string, string>;
};

export type EnlistmentPreview = {
  rows: EnlistmentImportRow[];
  warnings: string[];
  sourceColumns: string[];
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function numberText(value: unknown): string {
  const raw = valueText(value).replace(/,/g, '');
  if (!raw) return '';
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : '';
}

function integerText(value: unknown): string {
  const raw = numberText(value);
  if (!raw) return '';
  return String(Math.round(Number(raw)));
}

function cleanBarcode(value: unknown): string {
  const raw = valueText(value).replace(/\.0+$/, '').trim();
  return raw === '0' ? '' : raw;
}

function keyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');
}

function makeKey(barcode: string, name: string): string {
  return barcode ? `barcode:${barcode.toLowerCase()}` : `name:${keyName(name)}`;
}

const aliases: Record<string, string[]> = {
  sl: ['sl', 'serial', 'serial no', 'serial number'],
  barcode: ['barcode', 'ean', 'ean13'],
  length: ['product dimensions length left to right in cm', 'product dimensions length left to right cm', 'length'],
  depth: ['product dimensions depth front to back in cm', 'product dimensions depth front to back cm', 'depth'],
  height: ['product dimensions height top to bottom in cm', 'product dimensions height top to bottom cm', 'height'],
  shelfLife: ['shelf life time day', 'shelf life days', 'shelf life'],
  name: ['name', 'product name', 'sku updated perfect name'],
  image: ['image link', 'image url', 'updated hero image', 'hero image'],
  description: ['product description features', 'product description detailed', 'product description', 'description'],
  dept: ['dept', 'department'],
  category: ['category', 'ubl cat'],
  subCategory: ['subcategory', 'sub category'],
  pcs: ['pcs per crm', 'pcs per ctn', 'pieces per carton'],
  tp: ['tp', 'trade price'],
  mrp: ['mrp'],
  margin: ['margin'],
  cert: ['cert licns', 'cert license', 'certificate license', 'certification'],
  brand: ['brand'],
  supplier: ['supplier name', 'supplier'],
  country: ['country of origin', 'origin'],
  status: ['status'],
  targetPlatforms: ['target platforms'],
  enlistedPlatforms: ['enlisted platforms'],
};

function normalizedAlias(value: string): string {
  return normalizeHeader(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function findColumn(headers: string[], names: string[]): number {
  const normalized = headers.map(normalizedAlias);
  const wanted = names.map(normalizedAlias);
  return normalized.findIndex((header) => wanted.includes(header));
}

function valueAt(row: SheetValue[] | string[], index: number): string {
  return index < 0 ? '' : valueText(row[index]);
}

function rowsToPreview(rows: (SheetValue[] | string[])[]): EnlistmentPreview {
  const warnings: string[] = [];
  const firstMeaningful = rows.findIndex((row) => row.some((cell) => valueText(cell)));
  if (firstMeaningful < 0) throw new Error('The enlistment file is empty.');

  const headers = rows[firstMeaningful].map((value) => valueText(value));
  const index = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, findColumn(headers, names)])) as Record<string, number>;
  if (index.name < 0) throw new Error('The enlistment file must contain a Name column.');

  if (index.targetPlatforms >= 0 || index.enlistedPlatforms >= 0) {
    warnings.push('Target Platforms and Enlisted Platforms were detected but intentionally ignored. Account selection and enlistment status are managed manually in the Enlistment Panel.');
  }
  if (index.status >= 0) {
    warnings.push('The source Status column is stored only as source reference. It does not set any account-level enlistment status.');
  }

  const output: EnlistmentImportRow[] = [];
  const seen = new Map<string, number>();

  for (let r = firstMeaningful + 1; r < rows.length; r++) {
    const source = rows[r];
    const name = valueAt(source, index.name).trim();
    if (!name) continue;
    const barcode = cleanBarcode(index.barcode < 0 ? '' : source[index.barcode]);
    const enlistmentKey = makeKey(barcode, name);
    const raw: Record<string, string> = {};
    headers.forEach((header, c) => {
      if (header) raw[header] = valueText(source[c]);
    });

    const item: EnlistmentImportRow = {
      enlistment_key: enlistmentKey,
      source_row: r + 1,
      sl: valueAt(source, index.sl),
      barcode,
      length_cm: numberText(index.length < 0 ? '' : source[index.length]),
      depth_cm: numberText(index.depth < 0 ? '' : source[index.depth]),
      height_cm: numberText(index.height < 0 ? '' : source[index.height]),
      shelf_life_days: integerText(index.shelfLife < 0 ? '' : source[index.shelfLife]),
      name,
      image_url: valueAt(source, index.image),
      description: valueAt(source, index.description),
      dept: valueAt(source, index.dept),
      category: valueAt(source, index.category),
      sub_category: valueAt(source, index.subCategory),
      pcs_per_crm: numberText(index.pcs < 0 ? '' : source[index.pcs]),
      tp: numberText(index.tp < 0 ? '' : source[index.tp]),
      mrp: numberText(index.mrp < 0 ? '' : source[index.mrp]),
      margin_source: valueAt(source, index.margin),
      cert_license: valueAt(source, index.cert),
      brand: valueAt(source, index.brand),
      supplier_name: valueAt(source, index.supplier),
      country_of_origin: valueAt(source, index.country),
      source_status: valueAt(source, index.status),
      raw,
    };

    const existingIndex = seen.get(enlistmentKey);
    if (existingIndex == null) {
      seen.set(enlistmentKey, output.length);
      output.push(item);
    } else {
      output[existingIndex] = item;
      warnings.push(`Duplicate product key ${enlistmentKey} found; the last occurrence was kept.`);
    }
  }

  if (!output.length) throw new Error('No product rows were found in the enlistment file.');
  return { rows: output, warnings: [...new Set(warnings)], sourceColumns: headers.filter(Boolean) };
}

export async function parseEnlistmentFile(file: File): Promise<EnlistmentPreview> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith('.csv')) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    return rowsToPreview(parseCsv(text));
  }

  if (name.endsWith('.xlsx')) {
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('No worksheet was found in the enlistment workbook.');
    return rowsToPreview(sheet.rows);
  }

  throw new Error('Upload a .csv or .xlsx enlistment file.');
}
