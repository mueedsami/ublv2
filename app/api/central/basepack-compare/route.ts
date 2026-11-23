import {NextRequest,NextResponse} from 'next/server';
import {readPriorityWorkbook} from '@/lib/priority-ola-input';
import {loadBasepackWorkbook,parseBasepackReportQuery} from '@/lib/ola-basepack-report-data';
import {makeMultiSheetXlsx} from '@/lib/xlsx-writer';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

/** Pure read-only comparison: the priority file is used in-memory; no writes to Supabase. */
export async function POST(req:NextRequest){
 try{
  const form=await req.formData();
  const file=form.get('file');
  if(!file || typeof file==='string' || !file.name.toLowerCase().endsWith('.xlsx'))
   throw new Error('Upload an .xlsx with Account Name, SKU ID and Product Name.');
  if(file.size>6*1024*1024)throw new Error('Priority SKU workbook must be 6 MB or smaller.');
  const parsed=await readPriorityWorkbook(Buffer.from(await file.arrayBuffer()),file.name);
  const params=new URLSearchParams();
  for(const f of ['start','end']){const v=String(form.get(f)??'').trim();if(v)params.set(f,v);}
  const accountScope=String(form.get('accountScope')??'all');
  if(accountScope!=='all'&&accountScope!=='priority')throw new Error('Invalid account scope.');
  if(accountScope==='priority')params.set('accounts',[...new Set(parsed.items.map(i=>i.account))].join(','));
  const query=parseBasepackReportQuery(params);
  const {comparison,info}=await loadBasepackWorkbook(query,parsed.items,true);
  if(!comparison)throw new Error('Could not build basepack OLA comparison.');
  const mode=String(form.get('mode')??'preview');
  if(mode==='download'){
   const workbook=makeMultiSheetXlsx(comparison.sheets);
   return new NextResponse(new Uint8Array(workbook),{headers:{
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':`attachment; filename="UBL_Full_vs_Priority_Basepack_OLA_${query.start}_${query.end}.xlsx"`,
    'Cache-Control':'no-store',
   }});
  }
  if(mode!=='preview')throw new Error('Invalid report mode.');
  const priorityScope=comparison.sheets.find(s=>s.name==='Priority SKU Audit');
  const audits=(priorityScope?.rows??[]).map(r=>({account:String(r[0]??''),sku:String(r[1]??''),product:String(r[2]??''),basepack:String(r[3]??''),branch:String(r[4]??''),date:String(r[5]??''),status:String(r[7]??'')}));
  return NextResponse.json({start:query.start,end:query.end,uploaded:parsed.items.length,duplicatesRemoved:parsed.duplicates,
   overall:comparison.overall,accounts:comparison.accounts,branches:comparison.branches,daily:comparison.daily,
   basepacks:comparison.basepacks,dimensions:comparison.dimensions,audits,info,
   description:'Both OLA measures count observed mapped basepack-account-branch-day cells. Priority includes ONLY the uploaded account SKUs; both use the same dates and source observations.'
  },{headers:{'Cache-Control':'no-store'}});
 }catch(err){
  const error=err instanceof Error?err.message:'Failed to build basepack OLA comparison.';
  const bad=/upload|choose|invalid|unrecognized|required|row |date|period|too large|smaller|no account skus|range|62 days/i.test(error);
  return NextResponse.json({error},{status:bad?400:500,headers:{'Cache-Control':'no-store'}});
 }
}
