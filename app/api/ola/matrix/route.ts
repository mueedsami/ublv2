import {NextRequest,NextResponse} from 'next/server';
import {loadMonthlyBasepackMatrix,parseMatrixMonth} from '@/lib/ola-monthly-basepack-matrix';
import {makeMultiSheetXlsx,type XlsxCell} from '@/lib/xlsx-writer';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(req:NextRequest){
  try{
    const month=parseMatrixMonth(req.nextUrl.searchParams.get('month'));
    const format=req.nextUrl.searchParams.get('format')??'json';
    if(!['json','xlsx'].includes(format))return NextResponse.json({error:'format must be json or xlsx'},{status:400});
    const report=await loadMonthlyBasepackMatrix(month);
    if(format==='json')return NextResponse.json(report,{headers:{'Cache-Control':'no-store'}});

    const accounts=report.accounts;
    const ratio=(v:number|null)=>v===null?null:v/100;
    const matrixHeaders=['Date',...accounts.map(a=>a.label),'Overall OLA'];
    const matrixRows:XlsxCell[][]=report.rows.map(row=>[
      row.date,...accounts.map(a=>ratio(row.cells[a.code].ola)),ratio(row.overall.ola),
    ]);
    matrixRows.push(['Monthly avg',...accounts.map(a=>ratio(a.avgOla)),ratio(report.overall.avgDailyOla)]);
    const detailRows:XlsxCell[][]=[];
    for(const row of report.rows)for(const a of accounts){
      const cell=row.cells[a.code];
      detailRows.push([row.date,a.label,cell.runStatus??'No run',cell.available,cell.oos,cell.unknown,cell.valid,ratio(cell.ola),cell.branches,cell.skus]);
    }
    const notes:XlsxCell[][]=[
      ['Reporting month',month],
      ['Data source','ola_scrape_observations, v_ola_scraped_run_metrics, v_account_mappings (SELECT only)'],
      ['Calculation','Daily basepack OLA = available account/branch/basepack units / (available + OOS units)'],
      ['Grouping','Each account SKU maps to its master basepack. Multiple mapped SKUs in a basepack count as one unit.'],
      ['Availability rule','Any available mapped SKU makes its basepack available; otherwise OOS if at least one SKU is OOS; otherwise unknown.'],
      ['PandaMart','Each store branch/basepack counts as a distinct unit for PandaMart network OLA.'],
      ['Missing days','Blank means no valid measured basepacks; missing days are not zero.'],
      ['Partial runs','When no success exists for the date, use latest partial; incomplete catalog may affect measured coverage.'],
      ['Monthly average','Unweighted arithmetic average of observed valid daily percentages.'],
      ['Overall column','Weighted daily total of available/(available+OOS) basepack units across mapped accounts.'],
      ['Mapping caveat','Current active mappings are applied to historical observations; mappings may have changed historically.'],
      ['Unmapped catalog accounts','Displayed as blank until their retailer SKUs are mapped to master basepacks.'],
      ['Runs selected',report.diagnostics.runs],
      ['Observations fetched',report.diagnostics.observations],
      ['Unique mapped account/branch/basepack/SKU/day observations',report.diagnostics.mappedObservations],
      ['Unmatched raw SKU observations',report.diagnostics.unmatchedObservations],
      ['Ambiguous mapping observations excluded',report.diagnostics.ambiguousObservations],
    ];
    const buffer=makeMultiSheetXlsx([
      {name:'OLA Matrix',headers:matrixHeaders,rows:matrixRows,percentColumns:Array.from({length:accounts.length+1},(_,i)=>i+1),freezeColumns:1},
      {name:'Daily Account Counts',headers:['Date','Account','Run status','Available basepacks','OOS basepacks','Unknown basepacks','Valid basepacks','OLA %','Branches','Observed SKUs'],rows:detailRows,percentColumns:[7],freezeColumns:2},
      {name:'Methodology',headers:['Field','Explanation'],rows:notes,freezeColumns:1},
    ]);
    return new NextResponse(new Uint8Array(buffer),{headers:{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="UBL_Basepack_OLA_Matrix_${month}.xlsx"`,
      'Cache-Control':'no-store',
    }});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Unable to generate monthly OLA matrix'},{status:500});}
}
