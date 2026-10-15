import { NextRequest, NextResponse } from 'next/server';
import { buildAccountExport, exportBuffer } from '@/lib/enlistment-data';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'account';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const accountCode = String(body.accountCode || '').toLowerCase();
    const productIds = Array.isArray(body.productIds) ? body.productIds.map(String) : [];
    const fileType = body.fileType === 'csv' ? 'csv' : 'xlsx';
    if (!accountCode) throw new Error('Choose an account.');
    if (!productIds.length) throw new Error('Select at least one product to export.');

    const supabase = getSupabaseAdmin();
    const { data: account, error: accountError } = await supabase.from('accounts').select('id,code,name').eq('code', accountCode).eq('active', true).maybeSingle();
    if (accountError) throw accountError;
    if (!account) throw new Error('The selected account is not active.');

    const { data: targets, error: targetError } = await supabase
      .from('enlistment_targets')
      .select('*')
      .eq('account_id', account.id)
      .eq('selected', true)
      .in('enlistment_id', productIds);
    if (targetError) throw targetError;
    if (!targets?.length) throw new Error(`None of the selected products are targeted for ${account.name}.`);

    const targetProductIds = targets.map((row: any) => row.enlistment_id);
    const { data: products, error: productError } = await supabase.from('enlistment_products').select('*').in('id', targetProductIds).eq('active', true);
    if (productError) throw productError;
    const productById = new Map((products || []).map((row: any) => [row.id, row]));
    const items = targets
      .map((target: any) => ({ product: productById.get(target.enlistment_id), target }))
      .filter((item: any) => item.product);
    if (!items.length) throw new Error('No active selected products were available for export.');

    const build = buildAccountExport(account.code, items as any);
    const output = exportBuffer(account.name, build, fileType);
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${safeFilePart(account.name)}_Enlistment_${date}.${output.extension}`;
    const statusSnapshot = Object.fromEntries(targets.map((row: any) => [row.enlistment_id, row.status]));
    const { error: logError } = await supabase.from('enlistment_exports').insert({
      account_id: account.id,
      export_format: build.format,
      file_name: fileName,
      row_count: items.length,
      product_ids: items.map((item: any) => item.product.id),
      status_snapshot: statusSnapshot,
    });
    if (logError) throw logError;

    return new NextResponse(output.buffer, {
      status: 200,
      headers: {
        'Content-Type': output.contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Enlistment-Rows': String(items.length),
        'X-Enlistment-Format': build.format,
      },
    });
  } catch (error) {
    console.error('Enlistment export failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to export enlistment file.' }, { status: 400 });
  }
}
