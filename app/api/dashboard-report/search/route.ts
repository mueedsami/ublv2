import { NextRequest, NextResponse } from 'next/server';
import { searchDashboardEntities } from '@/lib/dashboard-report-data';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get('mode') === 'sku' ? 'sku' : 'basepack';
    const q = request.nextUrl.searchParams.get('q') ?? '';
    const accountCode = request.nextUrl.searchParams.get('account');
    const results = await searchDashboardEntities({ mode, q, accountCode });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Search failed.' }, { status: 500 });
  }
}
