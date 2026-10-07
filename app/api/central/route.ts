import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [rowsResponse, accountResponse] = await Promise.all([
      supabase.from('v_central_availability_current').select('*').order('sort_order').order('packsize').range(0, 4999),
      supabase.from('v_central_account_ola_current').select('*').order('sort_order'),
    ]);

    if (rowsResponse.error) throw rowsResponse.error;
    if (accountResponse.error) throw accountResponse.error;
    return NextResponse.json({
      rows: rowsResponse.data ?? [],
      accounts: accountResponse.data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load central availability.' },
      { status: 500 },
    );
  }
}
