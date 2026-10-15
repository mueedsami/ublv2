import { NextRequest, NextResponse } from 'next/server';
import { addAccountsToProducts, setProductAccounts, updateEnlistmentTarget } from '@/lib/enlistment-data';

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
    } else throw new Error('Unsupported enlistment target action.');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Enlistment target update failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update enlistment target.' }, { status: 400 });
  }
}
