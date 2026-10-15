import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { PANDAMART_SOS_BRANCHES } from '@/lib/pandamart-sos';

export const dynamic = 'force-dynamic';

const ACCOUNT_CODE = 'pandamart';

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedRunId = (searchParams.get('runId') || '').trim();
    const supabase = getSupabaseAdmin();

    const { data: account, error: accountError } = await supabase
      .from('accounts').select('id,code,name').eq('code', ACCOUNT_CODE).eq('active', true).maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: 'Pandamart account is not configured.' }, { status: 404 });

    const [{ data: latestImport, error: latestImportError }, { data: allBranches, error: branchError }] = await Promise.all([
      supabase.from('sos_keyword_imports')
        .select('id,keywords_total,search_terms_total,target_rows_total,mapped_targets_total,imported_at')
        .eq('account_id', account.id).order('imported_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('pandamart_branches').select('code,name,sort_order,is_dc,active').eq('active', true).order('sort_order'),
    ]);
    if (latestImportError) throw latestImportError;
    if (branchError) throw branchError;

    let unresolvedTargets = 0;
    if (latestImport) {
      const { count, error: unresolvedError } = await supabase
        .from('sos_import_target_candidates').select('id', { count: 'exact', head: true })
        .eq('import_id', latestImport.id).eq('accepted', false);
      if (unresolvedError) throw unresolvedError;
      unresolvedTargets = count || 0;
    }

    const configuredCodes = new Set(PANDAMART_SOS_BRANCHES.map((branch) => branch.code));
    const pendingBranches = (allBranches || [])
      .filter((branch: any) => !branch.is_dc && !configuredCodes.has(branch.code))
      .map((branch: any) => ({ code: branch.code, name: branch.name }));

    const { data: runs, error: runsError } = await supabase
      .from('sos_runs')
      .select('id,run_date,top_n,started_at,finished_at,status,terms_expected,terms_scraped,rows_observed,error_count,source,worker_version,message')
      .eq('account_id', account.id).order('started_at', { ascending: false }).limit(25);
    if (runsError) throw runsError;

    if (!runs?.length) {
      return NextResponse.json({
        account,
        configuration: {
          latestImport,
          unresolvedTargets,
          configuredBranches: PANDAMART_SOS_BRANCHES.map(({ code, name }) => ({ code, name })),
          pendingBranches,
        },
        runs: [], run: null, summary: null, keywordMetrics: [], termMetrics: [], results: [], targets: [],
      });
    }

    let selectedRun: any = (requestedRunId ? runs.find((run) => run.id === requestedRunId) : null) || runs[0];
    if (requestedRunId && !runs.some((run) => run.id === requestedRunId)) {
      const { data: requested, error: requestedError } = await supabase
        .from('sos_runs')
        .select('id,run_date,top_n,started_at,finished_at,status,terms_expected,terms_scraped,rows_observed,error_count,source,worker_version,message,account_id')
        .eq('id', requestedRunId).eq('account_id', account.id).maybeSingle();
      if (requestedError) throw requestedError;
      if (!requested) return NextResponse.json({ error: 'SoS run was not found.' }, { status: 404 });
      selectedRun = requested;
    }

    const runId = selectedRun.id;
    const [{ data: keywordMetrics, error: keywordError }, { data: termMetrics, error: termError }, { data: results, error: resultError }, { data: runTargets, error: targetError }] = await Promise.all([
      supabase.from('v_sos_keyword_metrics').select('*').eq('run_id', runId).order('format').order('keyword'),
      supabase.from('v_sos_term_metrics').select('*').eq('run_id', runId).order('branch_name').order('searched_term'),
      supabase.from('sos_search_results')
        .select('id,run_id,keyword_id,term_id,branch_code,branch_name,searched_term,rank,marketplace_sku,product_name,size,price,sale_price,stock_qty,in_stock,product_url,product_id,basepack_id,matched_brand,is_ubl,is_target,classification,ubl_match_method,ubl_match_score,matched_target_key,observed_at')
        .eq('run_id', runId).order('branch_name').order('searched_term').order('rank'),
      supabase.from('sos_run_targets').select('id,keyword_id,target_key,product_id,basepack_id,account_sku,target_name').eq('run_id', runId).order('target_name'),
    ]);
    if (keywordError) throw keywordError;
    if (termError) throw termError;
    if (resultError) throw resultError;
    if (targetError) throw targetError;

    const keywordRows = keywordMetrics || [];
    const topSlots = keywordRows.reduce((sum, row) => sum + toNumber(row.top_slots), 0);
    const ublCount = keywordRows.reduce((sum, row) => sum + toNumber(row.ubl_count), 0);
    const targetHits = keywordRows.reduce((sum, row) => sum + toNumber(row.target_hits), 0);
    const targetOpportunities = keywordRows.reduce((sum, row) => sum + toNumber(row.target_opportunities), 0);
    const nonTargetUbl = keywordRows.reduce((sum, row) => sum + toNumber(row.non_target_ubl_count), 0);
    const competitors = keywordRows.reduce((sum, row) => sum + toNumber(row.competitor_count), 0);

    return NextResponse.json({
      account,
      configuration: {
        latestImport,
        unresolvedTargets,
        configuredBranches: PANDAMART_SOS_BRANCHES.map(({ code, name }) => ({ code, name })),
        pendingBranches,
      },
      runs,
      run: selectedRun,
      summary: {
        ublSos: topSlots ? ublCount / topSlots : null,
        targetAchievement: targetOpportunities ? targetHits / targetOpportunities : null,
        topSlots, ublCount, targetHits, targetOpportunities, nonTargetUbl, competitors,
        termsScraped: selectedRun.terms_scraped, termsExpected: selectedRun.terms_expected, errors: selectedRun.error_count,
      },
      keywordMetrics: keywordRows,
      termMetrics: termMetrics || [],
      results: results || [],
      targets: runTargets || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load Pandamart SoS report.';
    console.error('Pandamart SoS report load failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
