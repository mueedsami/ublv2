import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { inspectGenericCppWorkbook, parseCppReferenceWorkbook, type CppAccountCode, type GenericCppMapping, type ParsedCppRow } from '@/lib/cpp-parser';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SUPPORTED = new Set<CppAccountCode>(['daraz', 'shajgoj', 'pandamart', 'othoba', 'arogga', 'shwapno']);
const DIRECT_SKU_ACCOUNTS = new Set<CppAccountCode>(['daraz', 'pandamart', 'othoba', 'arogga', 'shwapno']);

type LookupRow = {
  account_id: string;
  account_code: string;
  account_sku: string;
  product_id: string;
  ubl_code: string;
  product_name: string;
  basepack_id: string;
  packsize: string;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
  business_group: string | null;
};

function cleanSku(value: unknown): string {
  let text = String(value ?? '').trim();
  if (/^\d+\.0+$/.test(text)) text = text.split('.')[0];
  return text.replace(/_BD_/gi, '_BD-').replace(/\s+BD\s+/gi, '_BD-').replace(/\s+/g, '');
}

function compact(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
}

function phrase(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bimported\b/g, ' ')
    .replace(/\bunilever\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sizeToken(value: unknown): string {
  const normalized = phrase(value).replace(/\s+/g, '');
  const matches = normalized.match(/(?:\d+x)?\d+(?:\.\d+)?(?:ml|kg|gm|g|l)\b/g);
  return matches?.at(-1) || '';
}

function dice(aRaw: unknown, bRaw: unknown): number {
  const a = phrase(aRaw).replace(/\s+/g, '');
  const b = phrase(bRaw).replace(/\s+/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = counts.get(gram) || 0;
    if (count > 0) {
      overlap++;
      counts.set(gram, count - 1);
    }
  }
  return (2 * overlap) / ((a.length - 1) + (b.length - 1));
}

function uniqueLookup(rows: LookupRow[]): LookupRow[] {
  const seen = new Set<string>();
  const out: LookupRow[] = [];
  for (const row of rows) {
    const key = `${row.account_sku}__${row.basepack_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function shajgojMatch(source: ParsedCppRow, lookup: LookupRow[]): { row: LookupRow | null; method: 'master_exact' | 'master_fuzzy' | 'unmapped'; score: number | null } {
  const packKey = compact(source.sourcePacksize);
  const exactPack = uniqueLookup(lookup.filter((row) => compact(row.packsize) === packKey));
  if (exactPack.length === 1) return { row: exactPack[0], method: 'master_exact', score: 1 };

  const nameKey = compact(source.productName);
  const exactName = uniqueLookup(lookup.filter((row) => compact(row.product_name) === nameKey));
  if (exactName.length === 1) return { row: exactName[0], method: 'master_exact', score: 1 };

  const srcSize = sizeToken(source.sourcePacksize || source.productName);
  const srcBrand = compact(source.brand);
  const candidates = uniqueLookup(lookup.filter((row) => {
    const candidateSize = sizeToken(row.packsize || row.product_name);
    if (srcSize && candidateSize && srcSize !== candidateSize) return false;
    if (srcBrand && row.brand && compact(row.brand) !== srcBrand) return false;
    return true;
  }));

  const scored = candidates.map((row) => {
    const packScore = dice(source.sourcePacksize, row.packsize);
    const nameScore = dice(source.productName, row.product_name);
    return { row, score: Math.max(packScore, nameScore) };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (best && best.score >= 0.76 && (!second || best.score - second.score >= 0.06)) {
    return { row: best.row, method: 'master_fuzzy', score: Number(best.score.toFixed(5)) };
  }
  return { row: null, method: 'unmapped', score: best ? Number(best.score.toFixed(5)) : null };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const accountCode = String(form.get('account') || '').trim().toLowerCase() as CppAccountCode;
    const preview = String(form.get('preview') || '') === 'true';
    const inspect = String(form.get('inspect') || '') === 'true';
    const confirmed = String(form.get('confirmed') || '') === 'true';
    const tolerancePercent = Number(form.get('tolerancePct') ?? 1);
    const tolerancePct = tolerancePercent / 100;
    const effectiveFromOverride = String(form.get('effectiveFrom') || '').trim();
    const effectiveToOverride = String(form.get('effectiveTo') || '').trim();

    if (!file) return NextResponse.json({ error: 'CPP Excel file is required.' }, { status: 400 });
    if (!SUPPORTED.has(accountCode)) return NextResponse.json({ error: 'CPP upload is not enabled for this account.' }, { status: 400 });
    if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
      return NextResponse.json({ error: 'Tolerance must be between 0% and 100%.' }, { status: 400 });
    }
    if (effectiveFromOverride && effectiveToOverride && effectiveToOverride < effectiveFromOverride) {
      return NextResponse.json({ error: 'Effective-to date cannot be earlier than effective-from date.' }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    if (inspect) {
      if (accountCode === 'daraz' || accountCode === 'shajgoj' || accountCode === 'arogga') {
        return NextResponse.json({ error: 'This account uses a fixed CPP workbook profile and does not require column mapping.' }, { status: 400 });
      }
      const inspection = await inspectGenericCppWorkbook(fileBuffer);
      if (!inspection.sheets.length) return NextResponse.json({ error: 'No usable worksheet/header row was found in the CPP workbook.' }, { status: 400 });
      return NextResponse.json(inspection);
    }

    const genericMapping: GenericCppMapping | undefined = DIRECT_SKU_ACCOUNTS.has(accountCode) && accountCode !== 'daraz' && accountCode !== 'arogga'
      ? {
          sheetName: String(form.get('sheetName') || '').trim(),
          headerRow: Number(form.get('headerRow') || 1),
          skuColumn: String(form.get('skuColumn') || '').trim(),
          priceColumn: String(form.get('priceColumn') || '').trim(),
          productNameColumn: String(form.get('productNameColumn') || '').trim(),
          brandColumn: String(form.get('brandColumn') || '').trim(),
          categoryColumn: String(form.get('categoryColumn') || '').trim(),
          mrpColumn: String(form.get('mrpColumn') || '').trim(),
        }
      : undefined;

    const parsed = await parseCppReferenceWorkbook(fileBuffer, accountCode, file.name, genericMapping);
    if (!parsed.rows.length) return NextResponse.json({ error: 'No valid CPP rows were found.', warnings: parsed.warnings }, { status: 400 });

    const db = getSupabaseAdmin();
    const { data: account, error: accountError } = await db.from('accounts').select('id,code,name').eq('code', accountCode).maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: `Account ${accountCode} was not found.` }, { status: 400 });

    const { data: lookupData, error: lookupError } = await db
      .from('v_cpp_master_lookup')
      .select('account_id,account_code,account_sku,product_id,ubl_code,product_name,basepack_id,packsize,brand,category,sub_category,business_group')
      .eq('account_code', accountCode);
    if (lookupError) throw lookupError;
    const lookup = (lookupData || []) as LookupRow[];

    const bySku = new Map<string, LookupRow[]>();
    for (const row of lookup) {
      const key = cleanSku(row.account_sku);
      const list = bySku.get(key) || [];
      list.push(row);
      bySku.set(key, list);
    }

    let mapped = 0;
    let scrapable = 0;
    let fuzzyMatches = 0;
    const commitRows = parsed.rows.map((source) => {
      let match: LookupRow | null = null;
      let mappingStatus: 'direct_mapped' | 'direct_unmapped' | 'master_exact' | 'master_fuzzy' | 'unmapped' = 'unmapped';
      let matchScore: number | null = null;
      let accountSku = source.directAccountSku;

      if (DIRECT_SKU_ACCOUNTS.has(accountCode)) {
        const direct = uniqueLookup(bySku.get(cleanSku(source.directAccountSku)) || []);
        match = direct[0] || null;
        mappingStatus = match ? 'direct_mapped' : 'direct_unmapped';
        matchScore = match ? 1 : null;
      } else {
        const resolved = shajgojMatch(source, lookup);
        match = resolved.row;
        mappingStatus = resolved.method;
        matchScore = resolved.score;
        accountSku = match?.account_sku || '';
        if (mappingStatus === 'master_fuzzy') fuzzyMatches++;
      }

      const canScrape = Boolean(accountSku);
      if (canScrape) scrapable++;
      if (match) mapped++;

      return {
        source_identifier: source.sourceIdentifier,
        account_sku: accountSku,
        product_id: match?.product_id || '',
        basepack_id: match?.basepack_id || '',
        source_packsize: source.sourcePacksize,
        product_name: source.productName || match?.product_name || '',
        brand: source.brand || match?.brand || '',
        category: source.category || match?.category || '',
        expected_price: Number(source.expectedPrice.toFixed(2)),
        mrp: source.mrp == null ? '' : Number(source.mrp.toFixed(2)),
        support_amount: source.supportAmount == null ? '' : Number(source.supportAmount.toFixed(2)),
        tolerance_pct: tolerancePct,
        mapping_status: mappingStatus,
        match_score: matchScore == null ? '' : matchScore,
        scrapable: canScrape,
        active: true,
        source_row: {
          sheet: source.sourceSheet,
          row: source.rowNumber,
          original_effective_from: source.effectiveFrom,
          original_effective_to: source.effectiveTo,
          match_method: mappingStatus,
          match_score: matchScore,
          raw: source.raw,
        },
      };
    });

    const effectiveFrom = effectiveFromOverride || parsed.suggestedEffectiveFrom || new Date().toISOString().slice(0, 10);
    const effectiveTo = effectiveToOverride || parsed.suggestedEffectiveTo || '';
    const unmapped = commitRows.length - mapped;
    const nonScrapable = commitRows.length - scrapable;
    const warnings = [...parsed.warnings];
    if (accountCode === 'shajgoj' && nonScrapable > 0) {
      warnings.push(`${nonScrapable} Shajgoj CPP rows could not be resolved to a marketplace SKU and will be stored as non-scrapable until mapped.`);
    }
    if (DIRECT_SKU_ACCOUNTS.has(accountCode) && unmapped > 0) {
      warnings.push(`${unmapped} ${account.name} marketplace SKUs are outside the current master, but remain scrapable because the CPP file contains the marketplace SKU/Product ID directly.`);
    }

    const payload = {
      preview: true,
      valid: commitRows.length > 0,
      account: { id: account.id, code: account.code, name: account.name },
      fileName: file.name,
      profileName: parsed.profileName,
      profileNote: parsed.profileNote,
      detectedSheets: parsed.detectedSheets,
      effectiveFrom,
      effectiveTo,
      tolerancePct,
      sourceRows: parsed.rows.length,
      targets: commitRows.length,
      scrapableTargets: scrapable,
      mappedToMaster: mapped,
      unmappedRows: unmapped,
      nonScrapableRows: nonScrapable,
      fuzzyMatches,
      warnings: Array.from(new Set(warnings)),
      sample: commitRows.slice(0, 20).map((row) => ({
        sourceIdentifier: row.source_identifier,
        accountSku: row.account_sku,
        productName: row.product_name,
        sourcePacksize: row.source_packsize,
        expectedPrice: row.expected_price,
        mrp: row.mrp,
        supportAmount: row.support_amount,
        mappingStatus: row.mapping_status,
        matchScore: row.match_score,
        scrapable: row.scrapable,
      })),
    };

    if (preview) return NextResponse.json(payload);
    if (!confirmed) return NextResponse.json({ error: 'Preview the CPP workbook before committing it.' }, { status: 400 });

    const { data: result, error: commitError } = await db.rpc('commit_cpp_reference_set_v2', {
      payload: {
        account_id: account.id,
        source_file_name: file.name,
        parser_profile: parsed.profileName,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        default_tolerance_pct: tolerancePct,
        rows: commitRows,
      },
    });
    if (commitError) throw commitError;

    return NextResponse.json({ success: true, result, ...payload, preview: false });
  } catch (error) {
    console.error('CPP reference upload failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'CPP reference upload failed.' }, { status: 500 });
  }
}
