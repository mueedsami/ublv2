import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { matchSosTarget, type SosProductLookupRow } from '@/lib/sos-product-match';
import { parseSosKeywordWorkbook, type SosKeywordAccountCode } from '@/lib/sos-keyword-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED: SosKeywordAccountCode[] = ['pandamart', 'shajgoj', 'othoba', 'cartup'];

function isSupported(value: string): value is SosKeywordAccountCode {
  return SUPPORTED.includes(value as SosKeywordAccountCode);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const accountCode = String(form.get('account') || '').trim().toLowerCase();
    const previewOnly = String(form.get('preview') || '') === 'true';
    const confirmed = String(form.get('confirmed') || '') === 'true';
    const file = form.get('file');

    if (!isSupported(accountCode)) {
      return NextResponse.json({ error: `SoS keyword import is not configured for ${accountCode || 'this account'}.` }, { status: 400 });
    }
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an .xlsx keyword workbook.' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.xlsx')) return NextResponse.json({ error: 'Keyword import currently supports .xlsx files.' }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'Keyword workbook is too large. Maximum size is 15 MB.' }, { status: 400 });
    if (!previewOnly && !confirmed) return NextResponse.json({ error: 'Preview or confirmation is required.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseSosKeywordWorkbook(buffer, accountCode);
    if (!parsed.keywords.length) return NextResponse.json({ error: 'No keyword groups were found in this workbook.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: lookupRows, error: lookupError } = await supabase
      .from('v_sos_product_lookup')
      .select('*')
      .eq('account_code', accountCode)
      .limit(5000);
    if (lookupError) throw lookupError;
    const lookup = (lookupRows || []) as SosProductLookupRow[];

    let mappedTargetsTotal = 0;
    let fuzzyMatches = 0;
    let ambiguousTargets = 0;
    let unmappedTargets = 0;
    let searchTermsTotal = 0;
    let targetRowsTotal = 0;

    const keywords = parsed.keywords.map((keyword) => {
      searchTermsTotal += keyword.terms.length;
      targetRowsTotal += keyword.targets.length;
      const targets = keyword.targets.map((target) => {
        const matched = matchSosTarget(target, lookup);
        if (matched.accepted) mappedTargetsTotal += 1;
        if (matched.mapping_status === 'fuzzy_name' && matched.accepted) fuzzyMatches += 1;
        if (matched.mapping_status === 'ambiguous') ambiguousTargets += 1;
        if (matched.mapping_status === 'unmapped') unmappedTargets += 1;
        return matched;
      });
      return {
        keyword: keyword.keyword,
        normalized_key: keyword.normalizedKey,
        format: keyword.format,
        expected_target_count: keyword.expectedTargetCount,
        terms: keyword.terms.map((term) => ({
          search_term: term.searchTerm,
          normalized_term: term.normalizedTerm,
          is_primary: term.isPrimary,
          source_row: term.sourceRow,
        })),
        targets,
      };
    });

    const warnings = [...parsed.warnings];
    if (!lookup.length) warnings.push(`No active ${accountCode} marketplace mappings were found in the V2 master; target products cannot be auto-mapped.`);
    if (ambiguousTargets) warnings.push(`${ambiguousTargets} target product row(s) have an uncertain product-name match and were left unassigned for manual review.`);
    if (unmappedTargets) warnings.push(`${unmappedTargets} target product row(s) could not be mapped to the current ${accountCode} master and were left unassigned.`);

    const responseBase = {
      valid: true,
      accountCode,
      fileName: file.name,
      parserProfile: parsed.parserProfile,
      sheetName: parsed.sheetName,
      rowsTotal: parsed.rowsTotal,
      keywordCount: keywords.length,
      searchTermsTotal,
      targetRowsTotal,
      mappedTargetsTotal,
      unresolvedTargetsTotal: targetRowsTotal - mappedTargetsTotal,
      fuzzyMatches,
      warnings,
      keywords: keywords.map((keyword) => ({
        keyword: keyword.keyword,
        format: keyword.format,
        expectedTargetCount: keyword.expected_target_count,
        terms: keyword.terms.map((term) => term.search_term),
        targets: keyword.targets.map((target) => ({
          sourceSku: target.source_account_sku,
          sourceName: target.source_name,
          matchedSku: target.matched_account_sku,
          matchedName: target.matched_product_name,
          mappingStatus: target.mapping_status,
          matchScore: target.match_score,
          accepted: target.accepted,
        })),
      })),
    };

    if (previewOnly) return NextResponse.json(responseBase);

    const payload = {
      account_code: accountCode,
      source_file_name: file.name,
      parser_profile: parsed.parserProfile,
      rows_total: parsed.rowsTotal,
      search_terms_total: searchTermsTotal,
      target_rows_total: targetRowsTotal,
      mapped_targets_total: mappedTargetsTotal,
      warnings,
      keywords,
    };

    const { data: committed, error: commitError } = await supabase.rpc('commit_sos_keyword_import_v1', { payload });
    if (commitError) throw commitError;

    return NextResponse.json({ ...responseBase, committed: true, result: committed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SoS keyword import failed.';
    console.error('SoS keyword import failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
