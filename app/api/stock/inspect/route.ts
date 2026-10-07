import { NextResponse } from 'next/server';
import { inspectStockWorkbook } from '@/lib/stock-parser';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const accountCode = String(form.get('accountCode') ?? '');
    const snapshotDate = String(form.get('snapshotDate') ?? '');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Stock file is required.' }, { status: 400 });
    const result = await inspectStockWorkbook(Buffer.from(await file.arrayBuffer()), accountCode, snapshotDate || undefined);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not inspect stock file.' }, { status: 400 });
  }
}
