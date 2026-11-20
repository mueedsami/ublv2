import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const ACCOUNTS=['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno'];
type Row=Record<string,unknown>;
const str=(v:unknown)=>String(v??'').trim();
const lower=(v:unknown)=>str(v).toLowerCase();
async function readRows(kind:'observation'|'mapping'){
 const db=getSupabaseAdmin();const output:Row[]=[];
 for(let i=0;i<100000;i+=500){
  const q=kind==='observation'
   ?db.from('v_ola_scraped_latest').select('account_code,account_sku,basepack,branch,status,observed_at,source_product,stock_qty,product_url').in('account_code',ACCOUNTS).order('account_code').order('account_sku').range(i,i+499)
   :db.from('v_account_mappings').select('account_code,account_sku,packsize,product_name,brand,business_group,category,status').eq('status','active').in('account_code',ACCOUNTS).order('account_code').order('account_sku').range(i,i+499);
  const {data,error}=await q;if(error)throw error;
  output.push(...(data??[]) as Row[]);
  if(!data||data.length<500)return output;
 }
 throw new Error('Report exceeds 100000 rows; refusing incomplete results');
}
export async function GET(){
 try{
  const [observations,mappings]=await Promise.all([readRows('observation'),readRows('mapping')]);
  const mapped=new Map<string,Row>();const ambiguous=new Set<string>();
  for(const m of mappings){const sku=lower(m.account_sku);if(!sku)continue;const k=`${lower(m.account_code)}|${sku}`;
   if(mapped.has(k)){const prev=mapped.get(k)!;if(['brand','business_group','category','packsize'].some(x=>str(prev[x])!==str(m[x])))ambiguous.add(k)}else mapped.set(k,m);
  }
  let missing=0,unmapped=0,ambiguousCount=0;const rows=[];
  for(const o of observations){const account=lower(o.account_code),sku=lower(o.account_sku);if(!sku){missing++;continue;}
   const k=`${account}|${sku}`;if(ambiguous.has(k)){ambiguousCount++;continue;}
   const m=mapped.get(k);if(!m){unmapped++;continue;}
   const status=lower(o.status);rows.push({account,sku:str(o.account_sku),branch:str(o.branch)||'All',business_unit:str(m.business_group)||'Unclassified',brand:str(m.brand)||'Unclassified',category:str(m.category)||'Unclassified',product:str(m.product_name)||str(o.source_product)||'Unnamed',basepack:str(o.basepack)||str(m.packsize),status:status==='available'?'available':status==='unavailable'?'unavailable':'unknown',stock_qty:o.stock_qty??null,observed_at:str(o.observed_at),product_url:str(o.product_url)});
  }
  return NextResponse.json({rows,meta:{mapped_rows:rows.length,unmapped_rows:unmapped,ambiguous_mapping_rows:ambiguousCount,missing_sku_rows:missing,methodology:'Latest scraped OLA snapshot joined by exact normalized account SKU to active Master mappings. Available / (Available + OOS) is confirmed OLA; Unknown excluded. PandaMart may include one observation per SKU–branch. No historical brand trends are inferred.'}},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'OLA segments unavailable'},{status:500});}
}
