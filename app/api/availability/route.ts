import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [summaryResponse, rowsResponse, pandaResponse] = await Promise.all([
      supabase.from('v_account_availability_summary').select('*').order('sort_order'),
      supabase.from('v_basepack_availability').select('*').order('packsize').range(0, 4999),
      supabase.from('v_pandamart_daily_summary').select('*').order('stock_date', { ascending: false }).limit(1),
    ]);
    if (summaryResponse.error) throw summaryResponse.error;
    if (rowsResponse.error) throw rowsResponse.error;
    if (pandaResponse.error) throw pandaResponse.error;

    const panda = pandaResponse.data?.[0] ?? null;
    const summary = (summaryResponse.data ?? []).map((row) => {
      if (row.account_code !== 'pandamart' || !panda) return { ...row, metric_type: 'basepack' };
      return {
        ...row,
        snapshot_date: panda.stock_date,
        expected_basepacks: panda.total_branch_cells,
        available_basepacks: panda.available_branch_cells,
        unavailable_basepacks: panda.unavailable_branch_cells,
        availability_pct: panda.branch_ola_pct,
        metric_type: 'branch_ola',
        network_coverage_pct: panda.network_coverage_pct,
        network_expected_basepacks: panda.expected_basepacks,
        network_available_basepacks: panda.network_available_basepacks,
      };
    });

    return NextResponse.json({ summary, rows: rowsResponse.data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load availability.' }, { status: 500 });
  }
}
