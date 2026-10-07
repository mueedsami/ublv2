import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Failed to load Shajgoj intelligence.';
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [current, daily, monthly, salesSnapshots, monthlySales, flags, flagSummary] = await Promise.all([
      supabase.from('v_shajgoj_current_basepacks').select('*').order('packsize').range(0, 999),
      supabase.from('v_shajgoj_daily_ola').select('*').order('stock_date', { ascending: false }).limit(62),
      supabase.from('v_shajgoj_monthly_ola').select('*').order('month_start', { ascending: false }).limit(12),
      supabase.from('v_shajgoj_sales_snapshot_summary').select('*').order('period_end', { ascending: false }).limit(62),
      supabase.from('v_shajgoj_monthly_sales').select('*').order('month_start', { ascending: false }).limit(12),
      supabase.from('v_shajgoj_flags').select('*').order('priority').order('sold_qty', { ascending: false }).range(0, 999),
      supabase.from('v_shajgoj_flag_summary').select('*').order('stock_date', { ascending: false }).limit(1),
    ]);

    for (const response of [current, daily, monthly, salesSnapshots, monthlySales, flags, flagSummary]) {
      if (response.error) throw response.error;
    }

    return NextResponse.json({
      current: current.data ?? [],
      latestSummary: daily.data?.[0] ?? null,
      daily: daily.data ?? [],
      monthly: monthly.data ?? [],
      salesSnapshots: salesSnapshots.data ?? [],
      monthlySales: monthlySales.data ?? [],
      flags: flags.data ?? [],
      flagSummary: flagSummary.data?.[0] ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: errorText(error) }, { status: 500 });
  }
}
