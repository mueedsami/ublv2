import { NextRequest, NextResponse } from 'next/server';
import { addAccountsToProducts, setProductAccounts, updateEnlistmentTarget, setEnlistmentProductVisibility, setMatchingEnlistmentProductVisibility } from '@/lib/enlistment-data';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === 'set-selection') {
      if (!body.productId || !Array.isArray(body.accountCodes)) throw new Error('productId and accountCodes are required.');
      await setProductAccounts(String(body.productId), body.accountCodes.map(String));
    } else if (body.action === 'add-accounts') {
      if (!Array.isArray(body.productIds) || !Array.isArray(body.accountCodes)) throw new Error('productIds and accountCodes are required.');
      await addAccountsToProducts(body.productIds.map(String), body.accountCodes.map(String));
    } else if (body.action === 'update-target') {
      if (!body.targetId) throw new Error('targetId is required.');
      await updateEnlistmentTarget({
        targetId: String(body.targetId),
        status: body.status == null ? undefined : String(body.status),
        accountFields: body.accountFields && typeof body.accountFields === 'object' ? body.accountFields : undefined,
        notes: body.notes == null ? undefined : String(body.notes),
      });
    } else if (body.action === 'set-matching-product-visibility') {
      if (typeof body.visible !== 'boolean' || !body.filters || typeof body.filters !== 'object') throw new Error('Filters and visible are required.');
      const count = Number(body.expectedCount);
      const updated = await setMatchingEnlistmentProductVisibility({
        search: String(body.filters.search || '').slice(0, 120),
        account: String(body.filters.account || 'all'),
        status: String(body.filters.status || 'all'),
        visibility: body.filters.visibility === 'hidden' ? 'hidden' : 'visible',
      }, body.visible, count);
      return NextResponse.json({ ok: true, updated });
    } else if (body.action === 'set-product-visibility') {
      if (!Array.isArray(body.productIds) || typeof body.visible !== 'boolean') throw new Error('productIds and visible are required.');
      await setEnlistmentProductVisibility(body.productIds, body.visible);
    } else throw new Error('Unsupported enlistment target action.');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Enlistment target update failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update enlistment target.' }, { status: 400 });
  }
}
