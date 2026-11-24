import {NextResponse} from 'next/server';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Row=Record<string,unknown>;
const ACCOUNTS=['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno'];
const s=(v:unknown)=>String(v??'').trim();
const norm=(v:unknown)=>s(v).toLowerCase();
async function pageAll(table:string,columns:string,active:boolean):Promise<Row[]>{
 const sb=getSupabaseAdmin();const all:Row[]=[];
 for(let offset=0;offset<30000;offset+=1000){
  let q=sb.from(table).select(columns).in('account_code',ACCOUNTS)
   .order('account_code').order('account_sku').range(offset,offset+999);
  if(active)q=q.eq('status','active');
  const {data,error}=await q;
  if(error)throw new Error(`${table}: ${error.message}`);
  const part:unknown=data??[];
  if(!Array.isArray(part))throw new Error(`${table}: unexpected response`);
  for(const row of part)if(row&&typeof row==='object'&&!Array.isArray(row))all.push(row as Row);
  if(part.length<1000)return all;
 }
 throw new Error(`${table} exceeds 30,000 rows; the report was not partially returned.`);
}
export async function GET(){
 try{
  const [obs,mappings]=await Promise.all([
   pageAll('v_ola_scraped_latest','account_code,account_sku,basepack,branch,status,observed_at,source_product,stock_qty,product_url',false),
   pageAll('v_account_mappings','account_code,account_sku,product_id,packsize,product_name,brand,business_group,category,status',true),
  ]);
  const index=new Map<string,Row>();const ambiguous=new Set<string>();
  for(const m of mappings){const code=norm(m.account_code),sku=norm(m.account_sku);if(!sku)continue;
   const key=`${code}|${sku}`,previous=index.get(key);
   if(previous&&s(previous.product_id)!==s(m.product_id))ambiguous.add(key);
   else if(!previous)index.set(key,m);
  }
  let missing=0,unmapped=0,conflicts=0;
  const rows:Row[]=[];
  for(const o of obs){const code=norm(o.account_code),sku=norm(o.account_sku);if(!sku){missing++;continue;}
   const key=`${code}|${sku}`;if(ambiguous.has(key)){conflicts++;continue;}
   const master=index.get(key);if(!master){unmapped++;continue;}
   const status=norm(o.status);
   rows.push({account:code,sku:s(o.account_sku),branch:s(o.branch)||'All',
    business_unit:s(master.business_group)||'Unclassified',brand:s(master.brand)||'Unclassified',
    category:s(master.category)||'Unclassified',product:s(master.product_name)||s(o.source_product)||'Unnamed',
    basepack:s(o.basepack)||s(master.packsize),status:status==='available'?'available':status==='unavailable'?'unavailable':'unknown',
    stock_qty:o.stock_qty??null,observed_at:s(o.observed_at),product_url:s(o.product_url)});
  }
  return NextResponse.json({rows,meta:{mapped_rows:rows.length,unmapped_rows:unmapped,ambiguous_mapping_rows:conflicts,
   missing_sku_rows:missing,methodology:'Latest per-account scrape from v_ola_scraped_latest, joined by exact account and SKU to active mappings. Unknown excluded from confirmed availability; PandaMart branches remain distinct.'}},
   {headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Segment intelligence unavailable'}, {status:503,headers:{'Cache-Control':'no-store'}})}
}
