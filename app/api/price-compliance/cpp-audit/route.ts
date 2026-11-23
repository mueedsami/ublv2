import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { buildScrapedCppAudit, type AuditData, type RawRow, type AuditRow } from '@/lib/scraped-cpp-audit';
import { makeXlsx, type XlsxCell } from '@/lib/xlsx-writer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type DB = ReturnType<typeof getSupabaseAdmin>;

async function readAll(db: DB, table: string, columns: string, orders: string[],
  filter?: (q:any)=>any, maxRows=30000):Promise<RawRow[]> {
  const result:RawRow[]=[]; const pageSize=800;
  for(let offset=0;offset<maxRows;offset+=pageSize){
    let query=db.from(table).select(columns);
    for(const field of orders)query=query.order(field,{ascending:true});
    if(filter)query=filter(query);
    const {data,error}=await query.range(offset,offset+pageSize-1);
    if(error)throw new Error(`${table}: ${error.message}`);
    const page:unknown=data??[];
    if(!Array.isArray(page))throw new Error(`${table}: Unexpected query response`);
    for(const row of page)if(row&&typeof row==='object'&&!Array.isArray(row))result.push(row as RawRow);
    if(page.length<pageSize)return result;
  }
  throw new Error(`${table}: data exceeded ${maxRows} rows. Please narrow the query.`);
}

async function loadAudit(db:DB,days:number):Promise<AuditData>{
  // Every database call in this API is a SELECT. Never uses CPP price-check observations as prices.
  const [accounts,references,products,basepacks,mappings]=await Promise.all([
    readAll(db,'accounts','id,code,name',['code']),
    readAll(db,'cpp_reference_sets','id,account_id,source_file_name,status,effective_from,effective_to,default_tolerance_pct,uploaded_at',['id'],q=>q.eq('status','live')),
    readAll(db,'products','id,ubl_code,name,brand,category,basepack_id,status',['id'],q=>q.eq('status','active')),
    readAll(db,'basepacks','id,packsize',['id']),
    readAll(db,'product_account_ids','account_id,product_id,account_sku',['account_id','product_id','account_sku']),
  ]);
  if(!references.length)return buildScrapedCppAudit({accounts,references,targets:[],observations:[],products,basepacks,mappings});
  const refIds=references.map(r=>String(r.id));
  const accountIds=[...new Set(references.map(r=>String(r.account_id)))];
  const [targets,runs]=await Promise.all([
    readAll(db,'cpp_targets','id,reference_set_id,account_id,account_sku,product_id,basepack_id,source_packsize,product_name,brand,category,expected_price,tolerance_pct,active',['id'],q=>q.in('reference_set_id',refIds).eq('active',true)),
    readAll(db,'ola_scrape_runs','id,account_code,status,finished_at',['finished_at'],
      q=>q.in('account_code',accounts.filter(a=>accountIds.includes(String(a.id))).map(a=>String(a.code)))
        .in('status',['success','partial']).gte('finished_at',new Date(Date.now()-days*86400000).toISOString()))
  ]);
  const runsByAccount=new Map<string,RawRow>();
  for(const run of runs){const code=String(run.account_code||'');
    const previous=runsByAccount.get(code);
    if(!previous||String(run.finished_at)>String(previous.finished_at))runsByAccount.set(code,run);
  }
  const ids=[...runsByAccount.values()].map(r=>String(r.id));
  const observations:RawRow[]=[];
  for(let i=0;i<ids.length;i+=8){
    observations.push(...await readAll(db,'ola_scrape_observations','id,run_id,account_code,account_sku,branch,price,availability,observed_at,product_url',['id'],q=>q.in('run_id',ids.slice(i,i+8)),40000));
  }
  return buildScrapedCppAudit({accounts,references,targets,observations,products,basepacks,mappings,freshnessHours:72});
}

const numberParam=(value:string|null,defaultValue:number,min:number,max:number)=>{
  const n=Number(value);return value!==null && Number.isFinite(n)?Math.min(max,Math.max(min,n)):defaultValue;
};
const makeExport=(data:AuditData,show:string,account:string,search:string):Buffer=>{
  const headers=['Account','Account SKU ID','Product Name','Basepack','UBL SKU ID','Brand','Category','Branch',
    'CPP Expected (BDT)','Scraped Price (BDT)','Maximum Allowed (BDT)','Difference (BDT)',
    'Over Expected (%)','Tolerance (%)','Cross-check Status','Scraped At','CPP Start','CPP End','CPP File','Product URL','Mapping Note'];
  const searchLower=search.trim().toLowerCase();
  const rows:XlsxCell[][]=data.rows.filter(r=>matchStatus(r,show) && (account==='all'||r.accountCode===account) &&
    [r.account,r.accountSku,r.productName,r.ublCode,r.basepack,r.brand].some(v=>v.toLowerCase().includes(searchLower))).map(r=>[
    r.account,r.accountSku,r.productName,r.basepack,r.ublCode,r.brand,r.category,r.branch,r.expectedPrice,r.scrapedPrice,
    r.allowedPrice,r.difference,r.deviationPct===null?null:Number(r.deviationPct.toFixed(2)),r.tolerancePct,r.status,
    r.checkedAt,r.referenceFrom,r.referenceTo,r.referenceFile,r.productUrl,r.mappingNote
  ]);
  return makeXlsx('Scraped CPP Crosscheck',headers,rows);
};
function matchStatus(row:AuditRow,filter:string):boolean{
  if(filter==='violation')return row.status==='violation';
  if(filter==='review')return row.status==='violation'||row.status==='within_tolerance';
  if(filter==='exceptions')return !['violation','within_tolerance','compliant'].includes(row.status);
  if(filter==='compliant')return row.status==='compliant';
  return true;
}
export async function GET(request:NextRequest){
  try{
    const days=numberParam(request.nextUrl.searchParams.get('days'),14,1,30);
    const data=await loadAudit(getSupabaseAdmin(),days);
    if(request.nextUrl.searchParams.get('format')==='xlsx'){
      const filter=request.nextUrl.searchParams.get('status')||'all';
      const account=request.nextUrl.searchParams.get('account')||'all';
      const search=(request.nextUrl.searchParams.get('search')||'').slice(0,160);
      const bytes=makeExport(data,filter,account,search);
      return new NextResponse(new Uint8Array(bytes),{headers:{
        'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':'attachment; filename="UBL_Daily_Scrape_CPP_Crosscheck.xlsx"',
        'Cache-Control':'private, no-store'
      }});
    }
    return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to build CPP cross-check'},
      {status:500,headers:{'Cache-Control':'private, no-store'}});
  }
}
