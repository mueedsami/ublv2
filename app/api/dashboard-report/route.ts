import { NextRequest, NextResponse } from 'next/server';
import { getDashboardReport } from '@/lib/dashboard-report-data';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get('month');
    const asOf = request.nextUrl.searchParams.get('asOf');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM.' }, { status: 400 });
    if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD.' }, { status: 400 });
    const report = await getDashboardReport({
      basepackId: request.nextUrl.searchParams.get('basepackId'),
      accountCode: request.nextUrl.searchParams.get('account'),
      accountSku: request.nextUrl.searchParams.get('sku'),
      monthStart: `${month}-01`,
      asOf,
    });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to build dashboard report.' }, { status: 500 });
  }
}
