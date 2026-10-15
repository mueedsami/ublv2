import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountCode = (searchParams.get('account') || '').trim().toLowerCase();
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const supabase = getSupabaseAdmin();

    let accountId = '';
    let accountName = '';
    if (accountCode) {
      const { data: account, error } = await supabase
        .from('accounts')
        .select('id,code,name')
        .eq('code', accountCode)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      if (!account) return NextResponse.json({ error: `Unknown account: ${accountCode}` }, { status: 404 });
      accountId = account.id;
      accountName = account.name;
    }

    let termsQuery = supabase
      .from('sos_keyword_terms')
      .select('id,keyword_id,account_id,search_term,normalized_term,is_primary,created_at')
      .eq('active', true)
      .order('search_term');
    if (accountId) termsQuery = termsQuery.eq('account_id', accountId);
    const { data: terms, error: termsError } = await termsQuery;
    if (termsError) throw termsError;

    let targetQuery = supabase
      .from('sos_keyword_targets')
      .select('id,keyword_id,account_id,product_id,basepack_id,account_sku,target_name,assignment_source,match_score,created_at')
      .eq('active', true)
      .order('target_name');
    if (accountId) targetQuery = targetQuery.eq('account_id', accountId);
    const { data: targets, error: targetsError } = await targetQuery;
    if (targetsError) throw targetsError;

    let unresolvedCandidates: any[] = [];
    if (accountId) {
      const { data: latestImport, error: latestImportError } = await supabase
        .from('sos_keyword_imports')
        .select('id')
        .eq('account_id', accountId)
        .order('imported_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestImportError) throw latestImportError;
      if (latestImport) {
        const { data: candidates, error: candidateError } = await supabase
          .from('sos_import_target_candidates')
          .select('id,keyword_id,source_account_sku,source_name,matched_account_sku,mapping_status,match_score')
          .eq('import_id', latestImport.id)
          .eq('accepted', false)
          .order('source_name');
        if (candidateError) throw candidateError;
        unresolvedCandidates = candidates || [];
      }
    }

    const keywordIds = Array.from(new Set((terms || []).map((row) => row.keyword_id)));
    if (!keywordIds.length) {
      return NextResponse.json({ account: accountCode ? { code: accountCode, name: accountName } : null, keywords: [], totals: { keywords: 0, terms: 0, targets: 0 } });
    }

    const { data: keywords, error: keywordError } = await supabase
      .from('sos_keywords')
      .select('id,keyword,normalized_key,format,active,updated_at')
      .in('id', keywordIds)
      .eq('active', true)
      .order('format')
      .order('keyword');
    if (keywordError) throw keywordError;

    const termMap = new Map<string, typeof terms>();
    for (const term of terms || []) {
      const list = termMap.get(term.keyword_id) || [];
      list.push(term);
      termMap.set(term.keyword_id, list);
    }
    const targetMap = new Map<string, typeof targets>();
    for (const target of targets || []) {
      const list = targetMap.get(target.keyword_id) || [];
      list.push(target);
      targetMap.set(target.keyword_id, list);
    }
    const unresolvedMap = new Map<string, any[]>();
    for (const candidate of unresolvedCandidates) {
      const list = unresolvedMap.get(candidate.keyword_id) || [];
      list.push(candidate);
      unresolvedMap.set(candidate.keyword_id, list);
    }

    let rows = (keywords || []).map((keyword) => ({
      id: keyword.id,
      keyword: keyword.keyword,
      normalizedKey: keyword.normalized_key,
      format: keyword.format,
      updatedAt: keyword.updated_at,
      terms: (termMap.get(keyword.id) || []).map((term) => ({
        id: term.id,
        searchTerm: term.search_term,
        isPrimary: term.is_primary,
      })),
      targets: (targetMap.get(keyword.id) || []).map((target) => ({
        id: target.id,
        productId: target.product_id,
        basepackId: target.basepack_id,
        accountSku: target.account_sku,
        targetName: target.target_name,
        assignmentSource: target.assignment_source,
        matchScore: target.match_score,
      })),
      unresolvedTargets: (unresolvedMap.get(keyword.id) || []).map((candidate) => ({
        id: candidate.id,
        sourceSku: candidate.source_account_sku,
        sourceName: candidate.source_name,
        suggestedSku: candidate.matched_account_sku,
        mappingStatus: candidate.mapping_status,
        matchScore: candidate.match_score,
      })),
    }));

    if (q) {
      rows = rows.filter((row) => {
        const haystack = [row.keyword, row.format, ...row.terms.map((term) => term.searchTerm), ...row.targets.map((target) => `${target.targetName} ${target.accountSku || ''}`), ...row.unresolvedTargets.map((target) => `${target.sourceName} ${target.sourceSku || ''}`)]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return NextResponse.json({
      account: accountCode ? { code: accountCode, name: accountName } : null,
      keywords: rows,
      totals: {
        keywords: rows.length,
        terms: rows.reduce((sum, row) => sum + row.terms.length, 0),
        targets: rows.reduce((sum, row) => sum + row.targets.length, 0),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load SoS keywords.';
    console.error('SoS keyword load failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
