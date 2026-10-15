import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const keywordId = String(body.keywordId || '').trim();
    const accountCode = String(body.accountCode || '').trim().toLowerCase();
    const productId = String(body.productId || '').trim();
    const basepackId = String(body.basepackId || '').trim();
    const accountSku = String(body.accountSku || '').trim();
    if (!keywordId || !accountCode || !productId || !basepackId || !accountSku) {
      return NextResponse.json({ error: 'Keyword, account and a mapped marketplace product are required.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id,code,name')
      .eq('code', accountCode)
      .eq('active', true)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: `Unknown account: ${accountCode}` }, { status: 404 });

    const { data: product, error: productError } = await supabase
      .from('v_sos_product_lookup')
      .select('product_id,basepack_id,account_sku,product_name')
      .eq('account_code', accountCode)
      .eq('product_id', productId)
      .eq('basepack_id', basepackId)
      .eq('account_sku', accountSku)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) return NextResponse.json({ error: 'That marketplace product is not present in the current V2 master.' }, { status: 400 });

    const { data: keyword, error: keywordError } = await supabase
      .from('sos_keywords')
      .select('id')
      .eq('id', keywordId)
      .eq('active', true)
      .maybeSingle();
    if (keywordError) throw keywordError;
    if (!keyword) return NextResponse.json({ error: 'Keyword was not found.' }, { status: 404 });

    const targetKey = `sku:${accountSku.toLowerCase()}`;
    const { data: existing, error: existingError } = await supabase
      .from('sos_keyword_targets')
      .select('id,target_name')
      .eq('keyword_id', keywordId)
      .eq('account_id', account.id)
      .eq('target_key', targetKey)
      .eq('active', true)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return NextResponse.json({ ok: true, target: existing, alreadyAssigned: true });

    const { data: inserted, error: insertError } = await supabase
      .from('sos_keyword_targets')
      .insert({
        keyword_id: keywordId,
        account_id: account.id,
        target_key: targetKey,
        product_id: product.product_id,
        basepack_id: product.basepack_id,
        account_sku: product.account_sku,
        target_name: product.product_name,
        assignment_source: 'manual',
        mapping_status: 'manual',
        active: true,
        source_row: {},
      })
      .select('id,product_id,basepack_id,account_sku,target_name,assignment_source')
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ ok: true, target: inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not assign target product.';
    console.error('SoS target assignment failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = (searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'Target id is required.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('sos_keyword_targets')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('active', true)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Target assignment was not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not remove target product.';
    console.error('SoS target removal failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
