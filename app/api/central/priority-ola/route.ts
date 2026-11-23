import {NextRequest,NextResponse} from 'next/server';
import {readPriorityWorkbook} from '@/lib/priority-ola-input';
import {loadBasepackWorkbook,parseBasepackReportQuery} from '@/lib/ola-basepack-report-data';
import {makeMultiSheetXlsx} from '@/lib/xlsx-writer';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

const number=(value:unknown)=>Number(value??0)||0;

/** On-demand report. Upload is parsed in memory and is never written to Supabase or local disk. */
export async function POST(req:NextRequest){
 try{
  const form=await req.formData();
  const file=form.get('file');
  if(!file||typeof file==='string')throw new Error('Choose a priority SKU Excel file (.xlsx).');
  if(!file.name.toLowerCase().endsWith('.xlsx'))throw new Error('Upload a .xlsx file with Account Name, SKU ID and Product Name.');
  if(file.size>6*1024*1024)throw new Error('Priority SKU Excel file must be smaller than 6 MB.');
  const parsed=await readPriorityWorkbook(Buffer.from(await file.arrayBuffer()),file.name);
  const params=new URLSearchParams();
  const start=String(form.get('start')??'').trim(),end=String(form.get('end')??'').trim();
  if(start)params.set('start',start);if(end)params.set('end',end);
  params.set('accounts',[...new Set(parsed.items.map(r=>r.account))].join(','));
  const query=parseBasepackReportQuery(params);
  const {sheets,info}=await loadBasepackWorkbook(query,parsed.items);
  const priority=sheets.find(x=>x.name==='Priority SKU Scope');
  const observedPairs=new Set((priority?.rows??[])
    .filter(row=>String(row[7]??'').toLowerCase()!=='no ola observation for period' && Number(row[6])>0)
    .map(row=>`${String(row[0]).toLowerCase()}|${String(row[1]).toLowerCase()}`));
  const missing=(priority?.rows??[]).filter(r=>!r[5]).length;
  const dashboard=sheets.find(x=>x.name==='Dashboard')?.rows??[];
  const rows=dashboard.map(r=>({account:String(r[0]??''),branch:String(r[1]??''),date:String(r[2]??''),
    basepacks:number(r[3]),available:number(r[4]),oos:number(r[5]),unknown:number(r[6]),
    ola:number(r[4])+number(r[5])>0?number(r[4])/(number(r[4])+number(r[5])):null,
    observedDays:number(r[8]),averageDailyOla:r[9]==null?null:Number(r[9])}));
  const totals=rows.reduce((a,r)=>({available:a.available+r.available,oos:a.oos+r.oos,unknown:a.unknown+r.unknown}),{available:0,oos:0,unknown:0});
  const accountSet=[...new Set(parsed.items.map(r=>r.account))].sort();
  const accountSummary=accountSet.map(account=>{
    const scoped=rows.filter(r=>r.account.toLowerCase().replaceAll(' ','_')===account||
      (account==='pandamart'&&r.account.toLowerCase()==='pandamart')||
      (account==='beauty_booth'&&r.account.toLowerCase().replaceAll(' ','')==='beautybooth'));
    const available=scoped.reduce((s,r)=>s+r.available,0),oos=scoped.reduce((s,r)=>s+r.oos,0),unknown=scoped.reduce((s,r)=>s+r.unknown,0);
    return {account,prioritySkus:parsed.items.filter(i=>i.account===account).length,
      branches:scoped.length,available,oos,unknown,ola:available+oos?available/(available+oos):null};
  });
  const priorityDetails=(priority?.rows??[]).map(r=>({account:String(r[0]??''),sku:String(r[1]??''),
    productName:String(r[2]??''),basepack:String(r[3]??''),branch:String(r[4]??''),
    latestDate:String(r[5]??''),observedDays:number(r[6]),status:String(r[7]??'')}));
  const mode=String(form.get('mode')??'preview');
  if(mode==='download'){
    const report=makeMultiSheetXlsx(sheets);
    return new NextResponse(new Uint8Array(report),{headers:{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="UBL_Priority_Basepack_OLA_${query.start}_${query.end}.xlsx"`,
      'Cache-Control':'no-store',
    }});
  }
  return NextResponse.json({
    filename:parsed.filename,start:query.start,end:query.end,
    uploaded:parsed.items.length,duplicatesRemoved:parsed.duplicates,ignoredEmptyRows:parsed.ignoredRows,
    observedPrioritySkus:observedPairs.size,notObservedPrioritySkus:parsed.items.length-observedPairs.size,
    unmatchedOrNoObservation:missing,ola:totals.available+totals.oos?totals.available/(totals.available+totals.oos):null,
    ...totals,accountSummary,branches:rows,priorityDetails,info,
    message:'Available and OOS are basepack/branch counts from the latest observed day per branch. Missing and Unknown do not become OOS. Only uploaded SKUs are counted.',
  },{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  const error=e instanceof Error?e.message:'Failed to load priority OLA report.';
  const bad=/upload|choose|invalid|unrecognized|required|row |account|date|period|exceed|shorter|missing|too large|No OLA/i.test(error);
  return NextResponse.json({error},{status:bad?400:500,headers:{'Cache-Control':'no-store'}});
 }
}
