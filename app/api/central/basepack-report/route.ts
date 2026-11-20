import {NextRequest,NextResponse} from 'next/server';
import {loadBasepackWorkbook,parseBasepackReportQuery} from '@/lib/ola-basepack-report-data';
import {makeMultiSheetXlsx} from '@/lib/xlsx-writer';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

/** Download a read-only, multi-sheet basepack/account/branch OLA workbook. */
export async function GET(request:NextRequest){
  try{
    const query=parseBasepackReportQuery(request.nextUrl.searchParams);
    const {sheets}=await loadBasepackWorkbook(query);
    const result=makeMultiSheetXlsx(sheets);
    return new NextResponse(new Uint8Array(result),{headers:{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="UBL_Basepack_Account_OLA_${query.start}_${query.end}.xlsx"`,
      'Cache-Control':'no-store',
    }});
  }catch(error){
    const message=error instanceof Error?error.message:'Unable to generate basepack OLA report';
    const bad=/(choose|select|invalid|no successful|no ola observations|shorter date range|up to 62)/i.test(message);
    return NextResponse.json({error:message},{status:bad?400:500,headers:{'Cache-Control':'no-store'}});
  }
}
