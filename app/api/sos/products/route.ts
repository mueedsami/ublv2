import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountCode = (searchParams.get('account') || '').trim().toLowerCase();
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    if (!accountCode) return NextResponse.json({ error: 'Account is required.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('v_sos_product_lookup')
      .select('account_code,account_sku,product_id,basepack_id,packsize,ubl_code,product_name,brand,category,sub_category,business_group,hero_image_url')
      .eq('account_code', accountCode)
      .not('basepack_id', 'is', null)
      .limit(5000);
    if (error) throw error;

    const deduped = new Map<string, any>();
    for (const row of data || []) {
      const key = `${row.account_sku || ''}|${row.basepack_id || row.product_id}`;
      if (!deduped.has(key)) deduped.set(key, row);
    }

    let rows = [...deduped.values()];
    if (q) {
      rows = rows.filter((row) => [row.product_name, row.account_sku, row.ubl_code, row.brand, row.packsize]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q));
    }

    return NextResponse.json({ products: rows.slice(0, 40), totalMatches: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load UBL products.';
    console.error('SoS product search failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
