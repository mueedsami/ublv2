import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Failed to load Foodi intelligence.';
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [current, daily, monthly, sales30d] = await Promise.all([
      supabase.from('v_foodi_current_basepacks').select('*').order('packsize').range(0, 999),
      supabase.from('v_foodi_daily_ola').select('*').order('stock_date', { ascending: false }).limit(62),
      supabase.from('v_foodi_monthly_ola').select('*').order('month_start', { ascending: false }).limit(12),
      supabase.from('v_foodi_sales_30d_summary').select('*').order('stock_date', { ascending: false }).limit(62),
    ]);

    for (const response of [current, daily, monthly, sales30d]) {
      if (response.error) throw response.error;
    }

    return NextResponse.json({
      current: current.data ?? [],
      latestSummary: daily.data?.[0] ?? null,
      daily: daily.data ?? [],
      monthly: monthly.data ?? [],
      sales30d: sales30d.data ?? [],
    });
  } catch (error) {
    return NextResponse.json({ error: errorText(error) }, { status: 500 });
  }
}
