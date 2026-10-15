import { NextResponse } from 'next/server';
import { getEnlistmentPanelData } from '@/lib/enlistment-data';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await getEnlistmentPanelData());
  } catch (error) {
    console.error('Enlistment panel load failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load enlistment panel.' }, { status: 500 });
  }
}
