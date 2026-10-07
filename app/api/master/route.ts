import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [productsRes, mappingsRes, importRes] = await Promise.all([
      supabase.from('v_master_skus').select('*').order('ubl_code').range(0, 999),
      supabase.from('v_account_mappings').select('*').range(0, 4999),
      supabase.from('master_imports').select('*').order('imported_at', { ascending: false }).limit(1),
    ]);
    if (productsRes.error) throw productsRes.error;
    if (mappingsRes.error) throw mappingsRes.error;
    if (importRes.error) throw importRes.error;
    return NextResponse.json({ products: productsRes.data ?? [], mappings: mappingsRes.data ?? [], latestImport: importRes.data?.[0] ?? null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load master data.' }, { status: 500 });
  }
}
