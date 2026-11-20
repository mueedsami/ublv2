import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {buildBasepackWorkbook, type MappingIssue, type ReportObservation, type ReportSheet} from '@/lib/ola-basepack-report';
import {cleanLabel,normalizeKey} from '@/lib/central-daily-matrix';

const VALID=new Set(['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno','beauty_booth','ushop','foodi']);
const dhakaToday=()=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}-${parts.find(p=>p.type==='day')?.value}`;
};
const validDate=(v:string)=>/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;
export type BasepackReportQuery={start:string;end:string;accounts:string[];businessGroup:string;category:string;subCategory:string;brand:string;basepack:string;search:string};
export function parseBasepackReportQuery(params:URLSearchParams):BasepackReportQuery {
  const today=dhakaToday(), start=params.get('start')??`${today.slice(0,7)}-01`,end=params.get('end')??today;
  if(!validDate(start)||!validDate(end)||start>end)throw new Error('Choose a valid start and end date (YYYY-MM-DD).');
  const span=(Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000;
  if(span>61)throw new Error('Choose a period of up to 62 days to keep SKU evidence export manageable.');
  if(end>today)throw new Error('End date cannot be in the future.');
  const accounts=params.has('accounts')?(params.get('accounts')??'').split(',').map(normalizeKey).filter(Boolean):
    ['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno'];
  if(accounts.some(a=>!VALID.has(a)))throw new Error('Invalid account selection.');
  const filter=(key:string)=>(params.get(key)??'all').trim().slice(0,200)||'all';
  return {start,end,accounts:[...new Set(accounts)],businessGroup:filter('businessGroup'),category:filter('category'),
    subCategory:filter('subCategory'),brand:filter('brand'),basepack:filter('basepack'),search:(params.get('search')??'').trim().slice(0,200)};
}
type DB=ReturnType<typeof getSupabaseAdmin>;
async function pages<T>(factory:(a:number,b:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>,max:number,name:string):Promise<T[]>{
  const out:T[]=[],pageSize=500;
  for(let offset=0;offset<max;offset+=pageSize){const {data,error}=await factory(offset,offset+pageSize-1);
    if(error)throw new Error(`${name}: ${error.message}`);
    const batch=data??[];out.push(...batch);if(batch.length<pageSize)return out;
  }
  throw new Error(`${name} exceeds ${max} rows; refusing a partial report.`);
}
type Run={run_id:string;account_code:string;run_status:string;observation_date:string;finished_at:string|null;started_at:string|null};
type Mapping={account_code:string;account_sku:string;product_id:string|null;packsize:string|null;product_name:string|null;brand:string|null;business_group:string|null;category:string|null};
type Master={id:string;packsize:string|null;brand:string|null;business_group:string|null;category:string|null;sub_category:string|null;product_type:string|null};
type RawObservation={run_id:string;account_code:string;account_sku:string;branch:string|null;observed_at:string;status:string;
  stock_qty:number|null;price:number|null;product_url:string|null;source_product:string|null};
const matches=(value:string,selected:string)=>selected==='all'||normalizeKey(value)===normalizeKey(selected);

export async function loadBasepackWorkbook(query:BasepackReportQuery):Promise<{sheets:ReportSheet[];info:{runs:number;observations:number;mapped:number;issues:number;accounts:number}}> {
  if(!query.accounts.length)throw new Error('Select at least one account.');
  const db:DB=getSupabaseAdmin();
  const [runs,mappings,master]=await Promise.all([
    pages<Run>((a,b)=>db.from('v_ola_scraped_run_metrics').select('run_id,account_code,run_status,observation_date,finished_at,started_at')
      .in('account_code',query.accounts).gte('observation_date',query.start).lte('observation_date',query.end)
      .order('observation_date',{ascending:false}).order('finished_at',{ascending:false}).range(a,b),20000,'Scraper run history'),
    pages<Mapping>((a,b)=>db.from('v_account_mappings').select('account_code,account_sku,product_id,packsize,product_name,brand,business_group,category')
      .eq('status','active').in('account_code',query.accounts).order('account_code').order('account_sku').range(a,b),100000,'Active SKU mappings'),
    pages<Master>((a,b)=>db.from('v_master_skus').select('id,packsize,brand,business_group,category,sub_category,product_type')
      .order('id').range(a,b),100000,'Master SKU details'),
  ]);
  const byAccountDay=new Map<string,Run>();
  for(const r of runs){if(!['success','partial'].includes(r.run_status))continue;
    const runKey=`${normalizeKey(r.account_code)}|${r.observation_date}`;
    const old=byAccountDay.get(runKey);
    const when=(x:Run)=>x.finished_at??x.started_at??'';
    if(!old||(r.run_status==='success'&&old.run_status!=='success')||(r.run_status===old.run_status&&when(r)>when(old)))byAccountDay.set(runKey,r);
  }
  const chosen=[...byAccountDay.values()];
  if(!chosen.length)throw new Error(`No successful or partial scraper runs were found between ${query.start} and ${query.end}.`);
  const masterMap=new Map(master.map(item=>[String(item.id),item]));
  const mappingMap=new Map<string,Mapping>(),conflicts=new Set<string>();
  for(const mapping of mappings){const sku=normalizeKey(mapping.account_sku);if(!sku)continue;
    const k=`${normalizeKey(mapping.account_code)}|${sku}`,old=mappingMap.get(k);
    if(!old)mappingMap.set(k,mapping);
    else if(String(old.product_id??'')!==String(mapping.product_id??'')||normalizeKey(old.packsize)!==normalizeKey(mapping.packsize))conflicts.add(k);
  }
  const ids=chosen.map(r=>r.run_id),runById=new Map(chosen.map(r=>[r.run_id,r]));
  const sourceById=new Map<string,string>();
  for(let i=0;i<ids.length;i+=30){const batch=ids.slice(i,i+30);
    // Source file is optional metadata, but the underlying table stores it.
    const {data,error}=await db.from('ola_scrape_runs').select('id,source_file').in('id',batch);
    if(!error)for(const row of data??[])sourceById.set(String(row.id),String(row.source_file??''));
  }
  const sourceRows:RawObservation[]=[];
  for(let i=0;i<ids.length;i+=90){
    const sections=Array.from({length:Math.ceil(Math.min(90,ids.length-i)/30)},(_,j)=>ids.slice(i+j*30,i+j*30+30));
    const blocks=await Promise.all(sections.map(chunk=>pages<RawObservation>((a,b)=>db.from('ola_scrape_observations')
      .select('run_id,account_code,account_sku,branch,observed_at,status,stock_qty,price,product_url,source_product')
      .in('run_id',chunk).order('id').range(a,b),180000,'SKU evidence batch')));
    for(const block of blocks)sourceRows.push(...block);
    if(sourceRows.length>180000)throw new Error('This period has over 180,000 SKU observations. Export a shorter date range.');
  }
  const issues:MappingIssue[]=[],issueKeys=new Set<string>();
  const mark=(type:string,account:string,branch:string,sku:string,basepack:string,details:string)=>{
    const k=[type,account,branch,sku,basepack].join('|');
    if(issueKeys.has(k))return;issueKeys.add(k);issues.push({type,account,branch,sku,basepack,details});
  };
  const dedup=new Map<string,ReportObservation & {observedAt:string}>();
  for(const item of sourceRows){
    const run=runById.get(item.run_id);if(!run)continue;
    const account=normalizeKey(item.account_code),sku=String(item.account_sku??'').trim();
    const branch=account==='pandamart'?(String(item.branch??'').trim()||'All'):'All';
    if(!sku){mark('Missing account SKU',account,branch,'','',`Run ${item.run_id}`);continue;}
    const mapKey=`${account}|${normalizeKey(sku)}`, mapping=mappingMap.get(mapKey);
    const product=masterMap.get(String(mapping?.product_id??''));
    const basepack=String(product?.packsize??mapping?.packsize??'').trim();
    const businessUnit=cleanLabel(product?.business_group??mapping?.business_group??'');
    const category=cleanLabel(product?.category??mapping?.category??'');
    const format=cleanLabel(product?.product_type??'');
    const brand=cleanLabel(product?.brand??mapping?.brand??'');
    if(conflicts.has(mapKey))mark('Conflicting active SKU mappings',account,branch,sku,basepack,'Excluded from basepack calculations until mapping conflict is resolved.');
    else if(!mapping)mark('Unmapped account SKU',account,branch,sku,'','No active mapping. Excluded from basepack calculations.');
    else if(!basepack)mark('Missing basepack label',account,branch,sku,'','Active mapping does not identify a basepack.');
    const valid=Boolean(mapping&&basepack&&!conflicts.has(mapKey));
    if(valid && (!matches(businessUnit,query.businessGroup)||!matches(category,query.category)||!matches(cleanLabel(product?.sub_category??''),query.subCategory)||!matches(brand,query.brand)||!matches(basepack,query.basepack)))continue;
    if(query.search && ![sku,basepack,businessUnit,category,format,brand,mapping?.product_name??'',item.source_product??'',account,branch]
      .some(v=>normalizeKey(v).includes(normalizeKey(query.search))))continue;
    const status=item.status==='available'?'available':item.status==='unavailable'?'unavailable':'unknown';
    const record:ReportObservation & {observedAt:string}={date:run.observation_date,account,branch,sku,
      basepack:valid?basepack:'',businessUnit,category,format,brand,productName:String(mapping?.product_name??'').trim(),
      siteName:String(item.source_product??'').trim(),status,price:item.price==null?null:Number(item.price),
      stockQty:item.stock_qty==null?null:Number(item.stock_qty),productUrl:String(item.product_url??'').trim(),
      sourceFile:sourceById.get(item.run_id)??'',observedAt:item.observed_at??''};
    const evidenceKey=[record.date,record.account,record.branch,normalizeKey(record.sku)].join('|');
    const old=dedup.get(evidenceKey);
    if(!old||record.observedAt>old.observedAt)dedup.set(evidenceKey,record);
  }
  const evidence=[...dedup.values()];
  if(!evidence.length)throw new Error('There are no OLA observations matching the selected filters.');
  return {sheets:buildBasepackWorkbook(evidence,issues,query.start,query.end),info:{runs:chosen.length,observations:sourceRows.length,
    mapped:evidence.filter(o=>o.basepack).length,issues:issues.length,accounts:new Set(evidence.map(o=>o.account)).size}};
}
