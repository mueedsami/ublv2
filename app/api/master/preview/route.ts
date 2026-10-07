import { NextResponse } from 'next/server';
import { parseMasterWorkbook } from '@/lib/master-parser';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Master file is required.' }, { status: 400 });
    const preview = await parseMasterWorkbook(Buffer.from(await file.arrayBuffer()));
    const { products: _products, ...safePreview } = preview;
    return NextResponse.json(safePreview);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not inspect master file.' }, { status: 400 });
  }
}
