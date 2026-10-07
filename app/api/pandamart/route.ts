import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Failed to load Pandamart intelligence.';
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [latestBranches, dailySummary, monthly, sales, flags] = await Promise.all([
      supabase.from('v_pandamart_latest_branch_ola').select('*').order('sort_order'),
      supabase.from('v_pandamart_daily_summary').select('*').order('stock_date', { ascending: false }).limit(62),
      supabase.from('v_pandamart_monthly_ola').select('*').order('month_start', { ascending: false }).limit(12),
      supabase.from('v_pandamart_sales_30d').select('*').order('sold_qty_30d', { ascending: false }).limit(20),
      supabase.from('v_pandamart_flags').select('*').order('severity').limit(100),
    ]);
    for (const response of [latestBranches, dailySummary, monthly, sales, flags]) {
      if (response.error) throw response.error;
    }
    return NextResponse.json({
      latestBranches: latestBranches.data ?? [],
      latestSummary: dailySummary.data?.[0] ?? null,
      daily: dailySummary.data ?? [],
      monthly: monthly.data ?? [],
      topSales: sales.data ?? [],
      flags: flags.data ?? [],
    });
  } catch (error) {
    return NextResponse.json({ error: errorText(error) }, { status: 500 });
  }
}
