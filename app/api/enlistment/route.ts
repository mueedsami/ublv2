import { NextResponse } from 'next/server';
import { getEnlistmentPanelData } from '@/lib/enlistment-data';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') || 1);
  const search = url.searchParams.get('search') || '';
  const account = url.searchParams.get('account') || 'all';
  const status = url.searchParams.get('status') || 'all';
  try {
    return NextResponse.json(await getEnlistmentPanelData({ page, search, account, status }));
  } catch (error) {
    console.error('Enlistment panel load failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load enlistment panel.' }, { status: 500 });
  }
}
