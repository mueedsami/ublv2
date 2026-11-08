import {NextResponse} from 'next/server';
import {createHash,timingSafeEqual} from 'node:crypto';
import {parseStandardTertiary} from '@/lib/tertiary-standard-parser';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
export const runtime='nodejs';
const MAX_BYTES=15*1024*1024;
function authorized(req:Request){const configured=process.env.URL_MAPPING_ADMIN_TOKEN||'';const supplied=req.headers.get('x-url-mapping-admin-token')||'';return configured.length>=16&&supplied.length===configured.length&&timingSafeEqual(Buffer.from(configured),Buffer.from(supplied));}
function errorMessage(e:unknown){return e instanceof Error?e.message:'Tertiary import failed';}
async function masterMappingSet(account:string):Promise<Set<string>>{
  const supabase=getSupabaseAdmin();const set=new Set<string>();
  for(let start=0;start<10000;start+=1000){
    const {data,error}=await supabase.from('v_account_mappings').select('account_sku').eq('account_code',account).eq('status','active').range(start,start+999);
    if(error)throw error;
    for(const row of data??[])if(row.account_sku!==null)set.add(String(row.account_sku));
    if((data??[]).length<1000)break;
  }
  return set;
}
export async function POST(request:Request){
 try{
  if(!authorized(request))return NextResponse.json({error:'Admin access required. Configure URL_MAPPING_ADMIN_TOKEN.'},{status:401});
  const form=await request.formData();const file=form.get('file');
  if(!(file instanceof File)||!/\.xlsx$/i.test(file.name))return NextResponse.json({error:'Upload the standardized .xlsx template.'},{status:400});
  if(file.size>MAX_BYTES)return NextResponse.json({error:'File exceeds 15MB.'},{status:413});
  const account=String(form.get('account')||'');const month=String(form.get('month')||'');const action=String(form.get('action')||'preview');
  const buffer=Buffer.from(await file.arrayBuffer());const parsed=await parseStandardTertiary(buffer,account,month);
  const hash=createHash('sha256').update(buffer).update('|'+account+'|'+month).digest('hex');
  const mappings=await masterMappingSet(account);
  const matched=parsed.rows.filter(r=>mappings.has(r.account_sku));
  const unmatched=parsed.rows.filter(r=>!mappings.has(r.account_sku));
  const canApprove=parsed.issues.length===0&&parsed.rows.length>0;
  if(action==='preview')return NextResponse.json({
   account,month,inputRows:parsed.inputRows,sourceSheets:parsed.sourceSheets,uniqueSkuCount:parsed.rows.length,
   duplicateCount:parsed.duplicateCount,quantityTotal:parsed.rows.reduce((n,r)=>n+r.sales_qty,0),
   revenueTotal:parsed.revenueCoverage?parsed.rows.reduce((n,r)=>n+(r.revenue??0),0):null,
   revenueCoverage:parsed.revenueCoverage,matchedCount:matched.length,unmatchedCount:unmatched.length,
   unmatchedPreview:unmatched.slice(0,100),preview:parsed.rows.slice(0,30).map(r=>({...r,mapped_to_master:mappings.has(r.account_sku)})),
   issues:parsed.issues,fileHash:hash,canApprove,
   note:'Unmatched SKUs are retained in ALL sales totals, history, and export. Mapping is never required for approval.'
  });
  if(action!=='commit'||form.get('fileHash')!==hash)return NextResponse.json({error:'Preview this exact workbook, account and month first.'},{status:409});
  if(!canApprove)return NextResponse.json({error:'Resolve invalid rows or repeated account SKU IDs. Unmatched SKU IDs are allowed.'},{status:422});
  const {data,error}=await getSupabaseAdmin().rpc('commit_tertiary_monthly_batch',{
   p_account:account,p_month:month,p_filename:file.name,p_sheets:parsed.sourceSheets,p_input_rows:parsed.inputRows,p_rows:parsed.rows
  });if(error)throw error;
  return NextResponse.json({result:data,matchedCount:matched.length,unmatchedCount:unmatched.length});
 }catch(e){return NextResponse.json({error:errorMessage(e)},{status:400});}
}
