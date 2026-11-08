import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_ROWS = 5000;
const ACCOUNT_RE = /^[a-z][a-z0-9_]{1,30}$/;
const ALLOWED: Record<string, string[]> = {shajgoj:['shop.shajgoj.com']};
function authorized(req:NextRequest){
  const token=process.env.URL_MAPPING_ADMIN_TOKEN;
  return !!token && token.length>=16 && req.headers.get('x-url-mapping-admin-token')===token;
}
function normalizeSku(value:unknown){return String(value??'').trim();}
function cleanURL(value:unknown, account:string){
  const raw=String(value??'').trim();
  if(raw.length>2048 || /\s/.test(raw)) throw new Error('Invalid URL');
  let url:URL;try{url=new URL(raw);}catch{throw new Error('Invalid URL');}
  if(url.protocol!=='https:' || url.username || url.password || url.port || !url.hostname || url.hash || url.hostname.endsWith('.local'))throw new Error('Only valid HTTPS product URLs are permitted');
  if(ALLOWED[account] && !ALLOWED[account].includes(url.hostname.toLowerCase()))throw new Error(`URL host must be ${ALLOWED[account].join(', ')}`);
  return url.toString();
}
async function fetchAll(table:'v_account_mappings'|'ola_account_url_mappings',account:string){
  const db=getSupabaseAdmin();const all:Record<string,unknown>[]=[];
  for(let start=0;start<20000;start+=500){
    const q=table==='v_account_mappings'?
      db.from(table).select('account_code,account_sku,packsize,product_name,status').eq('account_code',account).eq('status','active').range(start,start+499):
      db.from(table).select('account_code,account_sku,product_url,updated_at').eq('account_code',account).range(start,start+499);
    const {data,error}=await q;
    if(error)throw error;
    all.push(...(data??[]));if(!data || data.length<500)return all;
  }
  throw new Error('Pagination safety limit reached');
}
function errorResponse(error:unknown){return NextResponse.json({error:error instanceof Error?error.message:'Request failed'},{status:400});}
export async function GET(req:NextRequest){
  if(!authorized(req))return NextResponse.json({error:'Admin access required; configure URL_MAPPING_ADMIN_TOKEN'},{status:401});
  try{
    const account=(req.nextUrl.searchParams.get('account')||'shajgoj').trim().toLowerCase();
    if(!ACCOUNT_RE.test(account))throw new Error('Invalid account');
    const [master,current]=await Promise.all([fetchAll('v_account_mappings',account),fetchAll('ola_account_url_mappings',account)]);
    return NextResponse.json({account,master,current},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}
export async function POST(req:NextRequest){
  if(!authorized(req))return NextResponse.json({error:'Admin access required'},{status:401});
  try{
    const body=await req.json();const account=String(body.account||'').trim().toLowerCase();
    if(!ACCOUNT_RE.test(account))throw new Error('Invalid account');
    if(!Array.isArray(body.rows)||body.rows.length>MAX_ROWS)throw new Error(`Maximum ${MAX_ROWS} rows per request`);
    const [master,current]=await Promise.all([fetchAll('v_account_mappings',account),fetchAll('ola_account_url_mappings',account)]);
    const valid=new Set(master.map(m=>normalizeSku(m.account_sku)));
    const existing=new Map(current.map(r=>[normalizeSku(r.account_sku),String(r.product_url??'')]));
    const seen=new Set<string>();const approved:{account_sku:string;product_url:string}[]=[];
    for(const row of body.rows){
      const sku=normalizeSku(row.account_sku);
      if(!sku||sku.length>200||!valid.has(sku))throw new Error(`SKU is not active in ${account}: ${sku}`);
      if(seen.has(sku))throw new Error(`Duplicate SKU: ${sku}`);seen.add(sku);
      const url=cleanURL(row.product_url,account);
      if(body.expected && body.expected[sku]!==undefined && String(body.expected[sku])!==String(existing.get(sku)||''))throw new Error(`Mapping changed after preview: ${sku}; refresh and review again`);
      approved.push({account_sku:sku,product_url:url});
    }
    const db=getSupabaseAdmin();
    const {data,error}=await db.rpc('apply_ola_account_url_mappings',{p_account:account,p_rows:approved});
    if(error)throw error;
    return NextResponse.json({ok:true,...data});
  }catch(error){return errorResponse(error);}
}
