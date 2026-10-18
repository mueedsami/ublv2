import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dhakaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load CPP report.';
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const account = (request.nextUrl.searchParams.get('account') || '').trim().toLowerCase();
    const today = dhakaDate();

    let targetsQ = supabase
      .from('v_cpp_live_targets')
      .select('reference_set_id,source_file_name,effective_from,effective_to,account_code,account_name,target_id,account_sku,ubl_code,basepack_name,product_name,brand,category,expected_price,mrp,tolerance_pct,mapping_status,scrapable')
      .order('account_code')
      .order('product_name')
      .range(0, 4999);

    let refsQ = supabase
      .from('v_cpp_reference_history')
      .select('*')
      .eq('status', 'live')
      .order('uploaded_at', { ascending: false })
      .range(0, 100);

    let runsQ = supabase
      .from('v_cpp_run_summary')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100);

    let latestQ = supabase
      .from('v_cpp_latest_checks')
      .select('*')
      .order('checked_at', { ascending: false })
      .range(0, 4999);

    let todayQ = supabase
      .from('v_cpp_price_checks')
      .select('*')
      .eq('is_current', true)
      .eq('run_date', today)
      .order('checked_at', { ascending: false })
      .range(0, 4999);

    if (account) {
      targetsQ = targetsQ.eq('account_code', account);
      refsQ = refsQ.eq('account_code', account);
      runsQ = runsQ.eq('account_code', account);
      latestQ = latestQ.eq('account_code', account);
      todayQ = todayQ.eq('account_code', account);
    }

    const [targets, refs, runs, latest, todayChecks] = await Promise.all([
      targetsQ, refsQ, runsQ, latestQ, todayQ,
    ]);

    for (const result of [targets, refs, runs, latest, todayChecks]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      today,
      targets: targets.data ?? [],
      references: refs.data ?? [],
      runs: runs.data ?? [],
      latest: latest.data ?? [],
      todayChecks: todayChecks.data ?? [],
    });
  } catch (error) {
    console.error('CPP report failed', error);
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}
