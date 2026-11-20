import {NextRequest, NextResponse} from 'next/server';
import {getDailyMatrix, getDailyMatrixQuery} from '@/lib/central-daily-matrix-data';
import {MATRIX_DIMENSIONS, MATRIX_LABELS, olaPercent, type MatrixDimension} from '@/lib/central-daily-matrix';
import {makeMultiSheetXlsx, type XlsxCell} from '@/lib/xlsx-writer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query = getDailyMatrixQuery(params);
    const requested = params.get('dimension') ?? 'all';
    if (requested !== 'all' && !MATRIX_DIMENSIONS.includes(requested as MatrixDimension))
      return NextResponse.json({error:'Invalid grouping dimension'},{status:400});
    const report = await getDailyMatrix(query);
    if (params.get('format') !== 'xlsx') return NextResponse.json(report, {headers:{'Cache-Control':'no-store'}});
    const dimensions: MatrixDimension[] = requested === 'all' ? [...MATRIX_DIMENSIONS] : [requested as MatrixDimension];
    const sheets = dimensions.map(dimension => {
      const matrix = report.matrices[dimension];
      const headers = [MATRIX_LABELS[dimension], ...report.dates.map(date => `${date} (%)`), 'MTD OLA (%)', 'Available', 'OOS', 'Unknown', 'Valid Observations', 'Observed Days'];
      const row = (label: string, counts: Record<string, {available:number;unavailable:number;unknown:number}>, mtd: typeof matrix.total.mtd, observedDays: number): XlsxCell[] => [
        label, ...report.dates.map(date => counts[date] ? olaPercent(counts[date]) : null),
        olaPercent(mtd), mtd.available, mtd.unavailable, mtd.unknown,
        mtd.available + mtd.unavailable, observedDays,
      ];
      return {name:MATRIX_LABELS[dimension],headers,
        rows:[...matrix.rows.map(r => row(r.label,r.counts,r.mtd,r.observed_days)),
          row('TOTAL',matrix.total.counts,matrix.total.mtd,matrix.total.observed_days)]};
    });
    const bytes = makeMultiSheetXlsx(sheets);
    const disposition = `attachment; filename="UBL_Daily_OLA_Matrix_${query.month}_${requested}.xlsx"`;
    return new NextResponse(new Uint8Array(bytes), {status:200, headers:{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':disposition, 'Cache-Control':'no-store',
    }});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : 'Daily OLA matrix unavailable'},{status:500});
  }
}
