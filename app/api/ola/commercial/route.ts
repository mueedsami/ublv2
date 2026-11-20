import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Raw = Record<string, any>;
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const str = (v: unknown) => String(v ?? '').trim();
const numberOrNull = (v: unknown): number | null => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const accounts = ['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno'];
const dateBD = () => { const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); const part=(k:string)=>p.find(x=>x.type===k)?.value||'';return `${part('year')}-${part('month')}-${part('day')}`; };

// Paginate source views instead of silently truncating at a PostgREST row limit.
async function scan(label:string, make:(offset:number)=>PromiseLike<{data:Raw[]|null,error:{message:string}|null}>,max=20000):Promise<Raw[]> {
 const rows:Raw[]=[];const size=500;
 for(let at=0;at<max;at+=size){const {data,error}=await make(at);if(error)throw new Error(`${label}: ${error.message}`);const batch=data??[];rows.push(...batch);if(batch.length<size)return rows;}
 throw new Error(`${label} exceeded ${max} rows. Narrow report scope or add a server-side aggregation.`);
}
const key=(account:unknown,sku:unknown)=>`${norm(account)}|${norm(sku)}`;
const branchKey=(v:unknown)=>norm(v).replace(/\s+/g,' ')||'all';
const isOos=(status:unknown)=>norm(status)==='unavailable';

type CommercialRow={account:string;sku:string;branch:string;product:string;brand:string;business_unit:string;ola_status:string;ola_observed_at:string;cpp_status:string|null;cpp_checked_at:string|null;cpp_expected_price:number|null;cpp_actual_price:number|null;cpp_difference:number|null;cpp_match:'exact-branch'|'account-only'|'none';risk:string;};

export async function GET(){
 const warnings:string[]=[];const freshness:Record<string,string|null>={ola:null,cpp:null,sos:null,sales:null};
 try{
  const db=getSupabaseAdmin();const today=dateBD();const month=today.slice(0,7);
  const [olaResult,cppResult] = await Promise.allSettled([
   scan('OLA observations',at=>db.from('v_ola_scraped_latest').select('account_code,account_sku,branch,status,observed_at,source_product').in('account_code',accounts).order('account_code').order('account_sku').range(at,at+499),50000),
   scan('CPP latest checks',at=>db.from('v_cpp_latest_checks').select('account_code,account_sku,branch_code,branch_name,status,checked_at,expected_price,actual_price,price_difference,valid_price_check').in('account_code',accounts).order('account_code').order('account_sku').range(at,at+499),50000),
  ]);
  if(olaResult.status==='rejected')throw olaResult.reason;
  const ola=olaResult.value;
  const cpp=cppResult.status==='fulfilled'?cppResult.value:[];
  if(cppResult.status==='rejected')warnings.push(`CPP unavailable: ${String(cppResult.reason)}. No price classification inferred.`);
  freshness.ola=ola.reduce((v,r)=>str(r.observed_at)>str(v)?str(r.observed_at):v,null as string|null);
  freshness.cpp=cpp.reduce((v,r)=>str(r.checked_at)>str(v)?str(r.checked_at):v,null as string|null);
  const cppIndex=new Map<string,Raw[]>();
  for(const p of cpp){if(!norm(p.account_sku))continue;const k=key(p.account_code,p.account_sku);cppIndex.set(k,[...(cppIndex.get(k)||[]),p]);}
  // A CPP check is never joined across unlike PandaMart branches. Branch-specific records must match exactly.
  function matchingCpp(o:Raw):{row:Raw|null,kind:'exact-branch'|'account-only'|'none'} {
   const candidates=cppIndex.get(key(o.account_code,o.account_sku))??[];
   const branch=branchKey(o.branch);
   const exact=candidates.filter(p=>branchKey(p.branch_code)===branch || branchKey(p.branch_name)===branch);
   const broad=candidates.filter(p=>branchKey(p.branch_code)==='all' && branchKey(p.branch_name)==='all');
   const possible=exact.length?exact:(broad.length?broad:[]);
   if(!possible.length)return {row:null,kind:'none'};
   const winner=[...possible].sort((a,b)=>str(b.checked_at).localeCompare(str(a.checked_at)))[0];
   return {row:winner,kind:exact.length?'exact-branch':'account-only'};
  }
  const rows:CommercialRow[]=ola.filter(o=>norm(o.account_sku)).map(o=>{
   const match=matchingCpp(o),p=match.row,os=norm(o.status);const ps=p?norm(p.status):null;
   const risk=os==='unavailable'&&ps==='issue'?'OOS + CPP issue':os==='unavailable'?'Confirmed OOS':ps==='issue'?'CPP issue':os==='unknown'?'Unknown OLA':'No confirmed issue';
   return {account:norm(o.account_code),sku:str(o.account_sku),branch:str(o.branch)||'All',product:str(o.source_product)||str(o.account_sku),brand:'',business_unit:'',ola_status:os,ola_observed_at:str(o.observed_at),cpp_status:ps,cpp_checked_at:p?str(p.checked_at):null,cpp_expected_price:p?numberOrNull(p.expected_price):null,cpp_actual_price:p?numberOrNull(p.actual_price):null,cpp_difference:p?numberOrNull(p.price_difference):null,cpp_match:match.kind,risk};
  });
  // Optional Master classification: never guess brand/BU from the scraped title.
  try{
   const mappings=await scan('Master mappings',at=>db.from('v_account_mappings').select('account_code,account_sku,brand,business_group,product_name,status').eq('status','active').in('account_code',accounts).order('account_code').order('account_sku').range(at,at+499),50000);
   const m=new Map<string,Raw>();const ambiguous=new Set<string>();
   for(const v of mappings){const k=key(v.account_code,v.account_sku);if(!norm(v.account_sku))continue;const old=m.get(k);if(old&&(str(old.brand)!==str(v.brand)||str(old.business_group)!==str(v.business_group)))ambiguous.add(k);else if(!old)m.set(k,v);}
   for(const r of rows){const k=key(r.account,r.sku);if(ambiguous.has(k))continue;const v=m.get(k);if(v){r.brand=str(v.brand)||'Unclassified';r.business_unit=str(v.business_group)||'Unclassified';r.product=str(v.product_name)||r.product;}}
   if(ambiguous.size)warnings.push(`${ambiguous.size} ambiguous Master mappings were left unclassified.`);
  }catch(err){warnings.push(`Brand/BU mappings unavailable: ${String(err)}.`);}
  // SOS is tracked by keyword/slot, not as an OLA SKU metric. Display latest successful account-run aggregates separately.
  const sos:{account:string;run_date:string;top_slots:number;ubl_count:number;share_pct:number|null;terms_scraped:number;terms_expected:number}[]=[];
  try{
   const runs=await scan('SoS runs',at=>db.from('sos_runs').select('id,account_id,run_date,status,started_at,terms_scraped,terms_expected').in('status',['success','partial']).order('started_at',{ascending:false}).range(at,at+499),15000);
   const acct=(await db.from('accounts').select('id,code').in('code',accounts));if(acct.error)throw acct.error;
   const codeById=new Map<string,string>((acct.data||[]).map((a:Raw):[string,string]=>[str(a.id),norm(a.code)]));
   const last=new Map<string,Raw>();for(const run of runs){const code=codeById.get(str(run.account_id));if(code&&!last.has(code))last.set(code,run);}
   for(const [account,run] of last){const {data,error}=await db.from('v_sos_keyword_metrics').select('top_slots,ubl_count').eq('run_id',run.id).range(0,4999);if(error){warnings.push(`SoS ${account}: ${error.message}`);continue;}
    if((data||[]).length===5000){warnings.push(`SoS ${account}: over 5000 keyword metric rows; skipped to avoid partial totals.`);continue;}
    const slots=(data||[]).reduce((x:number,v:Raw)=>x+(numberOrNull(v.top_slots)||0),0);const hits=(data||[]).reduce((x:number,v:Raw)=>x+(numberOrNull(v.ubl_count)||0),0);
    sos.push({account,run_date:str(run.run_date),top_slots:slots,ubl_count:hits,share_pct:slots?hits/slots*100:null,terms_scraped:numberOrNull(run.terms_scraped)||0,terms_expected:numberOrNull(run.terms_expected)||0});
   }
   freshness.sos=sos.map(x=>x.run_date).sort().at(-1)||null;
  }catch(err){warnings.push(`SoS context unavailable: ${String(err)}.`);}
  // Sales data: account-month context ONLY, never interpreted as stockout-caused lost sales.
  const sales:{account:string;period:string;basis:string;qty:number;sku_count:number;comparable:boolean}[]=[];
  const configs=[
   {account:'daraz',table:'daraz_stock_daily',date:'stock_date',qty:'gis',basis:'Latest MTD GIS snapshot',cumulative:true},
   {account:'pandamart',table:'pandamart_sales_daily',date:'sale_date',qty:'sold_qty',basis:'Daily quantities summed within month',cumulative:false},
   {account:'shajgoj',table:'shajgoj_sales_cumulative',date:'period_end',qty:'sold_qty',basis:'Latest cumulative MTD snapshot per SKU',cumulative:true},
   {account:'othoba',table:'othoba_monthly_sales',date:'period_end',qty:'sold_qty',basis:'Latest cumulative MTD snapshot per SKU',cumulative:true},
  ];
  for(const config of configs){try{
   const all=await scan(`${config.account} sales`,at=>db.from(config.table).select(`account_sku,${config.date},${config.qty}`).gte(config.date,`${month}-01`).lte(config.date,today).order(config.date,{ascending:false}).range(at,at+499),25000);
   const latest=new Map<string,Raw>();const skus=new Set<string>();let total=0,period='';
   for(const v of all){const sku=norm(v.account_sku);if(!sku)continue;skus.add(sku);const date=str(v[config.date]);if(date>period)period=date;
    if(config.cumulative){if(!latest.has(sku))latest.set(sku,v);}else total+=numberOrNull(v[config.qty])||0;}
   if(config.cumulative)total=[...latest.values()].reduce((sum,v)=>sum+(numberOrNull(v[config.qty])||0),0);
   if(all.length)sales.push({account:config.account,period,basis:config.basis,qty:total,sku_count:skus.size,comparable:false});
  }catch(err){warnings.push(`Sales ${config.account} unavailable: ${String(err)}.`);}}
  freshness.sales=sales.map(x=>x.period).sort().at(-1)||null;
  const known=rows.filter(r=>r.ola_status==='available'||r.ola_status==='unavailable');
  return NextResponse.json({rows,sos,sales,warnings,freshness,meta:{ola_rows:rows.length,ola_known:known.length,ola_oos:known.filter(r=>isOos(r.ola_status)).length,cpp_joined:rows.filter(r=>r.cpp_status!==null).length,cpp_issues:rows.filter(r=>r.cpp_status==='issue').length,both_issues:rows.filter(r=>r.risk==='OOS + CPP issue').length,as_of:today,methodology:'OLA latest account-SKU-branch snapshot; CPP latest account-SKU with branch-safe matching. SoS is account/keyword-run aggregate only. Sales are independently reported account-month quantities using source-specific periods, NOT comparable across accounts and NOT lost-sales estimates. No missing data is interpreted as zero or OOS.'}},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Commercial intelligence unavailable'},{status:500});}
}
