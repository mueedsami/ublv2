/** One read-only source for OLA overview and account history.
 * The database view uses raw scraper SKU/branch observations, NOT the basepack matrix.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const OLA_ACCOUNTS = [
  {code:'arogga',label:'Arogga'},
  {code:'beauty_booth',label:'BeautyBooth',kind:'catalog'},
  {code:'cartup',label:'Cartup'},
  {code:'daraz',label:'Daraz'},
  {code:'othoba',label:'Othoba'},
  {code:'pandamart',label:'PandaMart'},
  {code:'shajgoj',label:'Shajgoj'},
  {code:'shwapno',label:'Shwapno'},
  {code:'ushop',label:'Ushop',kind:'catalog'},
  {code:'foodi',label:'Foodi',kind:'catalog'},
] as const;
export type RunMetric = {
  run_id:string;account_code:string;run_status:string;observation_date:string;
  finished_at:string|null;started_at:string|null;available_rows:number;unavailable_rows:number;
  unknown_rows:number;checked_rows:number;ola_pct:number|null;branches_observed:number;
};
export type OlaDay = {
  date:string;ola_pct:number|null;available:number|null;unavailable:number|null;
  unknown:number|null;checked:number|null;status:string|null;branches:number|null;
};
export type OlaMonthAccount = {
  code:string;label:string;kind?:string;rows:OlaDay[];observed_days:number;valid_days:number;
  avg_ola_pct:number|null;weighted_ola_pct:number|null;min_ola_pct:number|null;
  max_ola_pct:number|null;latest_date:string|null;latest_status:string|null;
  latest_available:number|null;latest_unavailable:number|null;latest_unknown:number|null;
};
export type OlaOverview = {
  month:string;dates:string[];accounts:OlaMonthAccount[];total_runs:number;selected_snapshots:number;
  last_observation_date:string|null;source:'v_ola_scraped_run_metrics';as_of:string;methodology:string;
};
export const METHODOLOGY='Latest successful scraper run per account per Bangladesh calendar day; latest partial is used only if no successful run exists. Each scraper observation is a SKU/branch check. Daily OLA = Available / (Available + Unavailable). Unknown and days without a run are excluded. Monthly average = equal-weight arithmetic mean of valid daily percentages. Monthly weighted OLA = sum(Available) / sum(Available + Unavailable). PandaMart includes all observed branches. Catalog-only accounts are separately marked; this is NOT the basepack-level OLA matrix.';
const str=(v:unknown)=>String(v??'').trim();
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const numberOrNull=(v:unknown)=>v===null||v===undefined||str(v)===''?null:Number(v);
const round=(v:number)=>Math.round(v*100)/100;
export function dhakaToday(date=new Date()):string{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const field=(k:string)=>parts.find(p=>p.type===k)?.value??'';
  return `${field('year')}-${field('month')}-${field('day')}`;
}
export const validMonth=(v:string)=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(v);
export function shiftMonth(month:string,diff:number):string{
  const [year,m]=month.split('-').map(Number);
  const date=new Date(Date.UTC(year,m-1+diff,1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
}
export function datesInMonth(month:string):string[]{
  if(!validMonth(month))throw new Error('Invalid month. Use YYYY-MM.');
  const [year,m]=month.split('-').map(Number);
  const count=new Date(Date.UTC(year,m,0)).getUTCDate();
  return Array.from({length:count},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
}
export function selectDailyRuns(raw:RunMetric[]):RunMetric[]{
  const best=new Map<string,RunMetric>();
  for(const r of raw){
    if(!['success','partial'].includes(r.run_status)||!/^20\d{2}-\d{2}-\d{2}$/.test(r.observation_date))continue;
    const key=`${r.account_code}|${r.observation_date}`;
    const old=best.get(key);
    const when=(v:RunMetric)=>v.finished_at??v.started_at??'';
    if(!old||(r.run_status==='success'&&old.run_status!=='success')||
      (r.run_status===old.run_status&&when(r)>when(old)))best.set(key,r);
  }
  return [...best.values()];
}
function cell(r:RunMetric|undefined,date:string):OlaDay{
  if(!r)return {date,ola_pct:null,available:null,unavailable:null,unknown:null,checked:null,status:null,branches:null};
  const available=n(r.available_rows),unavailable=n(r.unavailable_rows);
  return {date,ola_pct:available+unavailable?round(available*100/(available+unavailable)):null,
    available,unavailable,unknown:n(r.unknown_rows),checked:n(r.checked_rows),
    status:r.run_status,branches:n(r.branches_observed)};
}
export function buildOlaOverview(month:string,raw:RunMetric[],asOf=dhakaToday()):OlaOverview{
  const dates=datesInMonth(month);
  const selected=selectDailyRuns(raw).filter(r=>r.observation_date.startsWith(month)&&r.observation_date<=asOf);
  const index=new Map(selected.map(r=>[`${r.account_code}|${r.observation_date}`,r]));
  const accounts:OlaMonthAccount[]=OLA_ACCOUNTS.map(a=>{
    const rows=dates.map(date=>cell(index.get(`${a.code}|${date}`),date));
    const valid=rows.filter(r=>r.ola_pct!==null);
    const checked=rows.filter(r=>r.status!==null);
    const sumAvailable=valid.reduce((s,r)=>s+(r.available??0),0);
    const sumOos=valid.reduce((s,r)=>s+(r.unavailable??0),0);
    const latest=checked.at(-1)??null;
    const values=valid.map(r=>r.ola_pct as number);
    return {...a,rows,observed_days:checked.length,valid_days:valid.length,
      avg_ola_pct:values.length?round(values.reduce((s,v)=>s+v,0)/values.length):null,
      weighted_ola_pct:sumAvailable+sumOos?round(sumAvailable*100/(sumAvailable+sumOos)):null,
      min_ola_pct:values.length?Math.min(...values):null,max_ola_pct:values.length?Math.max(...values):null,
      latest_date:latest?.date??null,latest_status:latest?.status??null,
      latest_available:latest?.available??null,latest_unavailable:latest?.unavailable??null,
      latest_unknown:latest?.unknown??null};
  });
  return {month,dates,accounts,total_runs:raw.filter(r=>r.observation_date.startsWith(month)).length,
    selected_snapshots:selected.length,last_observation_date:selected.length?selected.map(r=>r.observation_date).sort().at(-1)??null:null,
    as_of:asOf,source:'v_ola_scraped_run_metrics',methodology:METHODOLOGY};
}

/** Bounded and paginated; one API query can retrieve current + previous month. */
export async function loadRunMetrics(start:string,endExclusive:string,account?:string):Promise<RunMetric[]>{
  const db=getSupabaseAdmin();
  const results:RunMetric[]=[];
  const pageSize=400;
  for(let offset=0;offset<12000;offset+=pageSize){
    let query=db.from('v_ola_scraped_run_metrics')
      .select('run_id,account_code,run_status,observation_date,finished_at,started_at,available_rows,unavailable_rows,unknown_rows,checked_rows,ola_pct,branches_observed')
      .gte('observation_date',start).lt('observation_date',endExclusive)
      .order('observation_date',{ascending:false})
      .order('finished_at',{ascending:false})
      .range(offset,offset+pageSize-1);
    if(account)query=query.eq('account_code',account);
    const {data,error}=await query;
    if(error)throw new Error(`OLA run metrics unavailable: ${error.message}`);
    const page:unknown=data??[];
    if(!Array.isArray(page))throw new Error('OLA run metrics returned an invalid response.');
    for(const item of page){
      if(!item||typeof item!=='object'||Array.isArray(item))continue;
      const v=item as Record<string,unknown>;
      if(!v.observation_date||!v.account_code)continue;
      results.push({run_id:str(v.run_id),account_code:str(v.account_code),run_status:str(v.run_status),
        observation_date:str(v.observation_date).slice(0,10),started_at:v.started_at===null?null:str(v.started_at),
        finished_at:v.finished_at===null?null:str(v.finished_at),available_rows:n(v.available_rows),
        unavailable_rows:n(v.unavailable_rows),unknown_rows:n(v.unknown_rows),checked_rows:n(v.checked_rows),
        ola_pct:numberOrNull(v.ola_pct),branches_observed:n(v.branches_observed)});
    }
    if(page.length<pageSize)return results;
  }
  throw new Error('OLA run history exceeded 12,000 rows. No partial report was returned.');
}
