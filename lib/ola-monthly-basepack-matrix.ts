import { getSupabaseAdmin } from '@/lib/supabase-admin';

/** Monthly OLA matrix: accounts in columns, dates in rows; read-only Supabase data. */
export const OLA_MATRIX_ACCOUNTS = [
  {code:'arogga', label:'Arogga'},
  {code:'beauty_booth', label:'BeautyBooth'},
  {code:'cartup', label:'Cartup'},
  {code:'daraz', label:'Daraz'},
  {code:'othoba', label:'Othoba'},
  {code:'pandamart', label:'PandaMart'},
  {code:'shajgoj', label:'Shajgoj'},
  {code:'shwapno', label:'Shwapno'},
  {code:'ushop', label:'Ushop'},
] as const;
export type MatrixAccountCode = (typeof OLA_MATRIX_ACCOUNTS)[number]['code'];
export type MatrixCount = {available:number; oos:number; unknown:number; valid:number; ola:number|null};
export type DailyCell = MatrixCount & {runStatus:'success'|'partial'|null; branches:number; skus:number};
export type AccountSummary = {code:MatrixAccountCode; label:string; observedDays:number; validDays:number; avgOla:number|null; latestOla:number|null; latestDate:string|null; hasMappings:boolean};
export type OLAAccountMatrix = {
  month:string; dates:string[]; accounts:AccountSummary[];
  rows:Array<{date:string; cells:Record<string,DailyCell>; overall:MatrixCount}>;
  overall: {avgDailyOla:number|null; validDays:number};
  diagnostics: {runs:number; observations:number; mappedObservations:number; unmatchedObservations:number; ambiguousObservations:number; mappedAccounts:number; partialRuns:number};
  methodology:string;
};
const norm=(value:unknown)=>String(value??'').trim().toLocaleLowerCase('en');
const monthValid=(v:string)=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(v) && Number(v.slice(0,4))<=2100;
const emptyCounts=():MatrixCount=>({available:0,oos:0,unknown:0,valid:0,ola:null});
const emptyCell=():DailyCell=>({...emptyCounts(),runStatus:null,branches:0,skus:0});
const numeric=(x:unknown)=>typeof x==='number'?x:Number(x??0);
const round=(x:number)=>Math.round(x*100)/100;
const percent=(a:number,o:number)=>a+o>0?round(a*100/(a+o)):null;
const todayMonth=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return `${parts.find(x=>x.type==='year')?.value}-${parts.find(x=>x.type==='month')?.value}`;
};
export function parseMatrixMonth(value:string|null):string {
  const month=value??todayMonth();
  if(!monthValid(month))throw new Error('month must use YYYY-MM, between 2000 and 2100.');
  return month;
}
export function datesForMonth(month:string):string[] {
  if(!monthValid(month))throw new Error('Invalid month.');
  const y=Number(month.slice(0,4)),m=Number(month.slice(5,7));
  const days=new Date(Date.UTC(y,m,0)).getUTCDate();
  return Array.from({length:days},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
}

type Run = {run_id:string; account_code:string; run_status:string; observation_date:string; finished_at:string|null; started_at:string|null};
type Mapping = {account_code:string; account_sku:string; product_id:string|null; basepack_id:string|null; packsize:string|null};
type Observation = {id:number;run_id:string;account_code:string;account_sku:string;branch:string|null;status:string|null;availability:boolean|null;observed_at:string};
export type MatrixInputs = {month:string; runs:Run[]; mappings:Mapping[]; observations:Observation[]};

/** Pure calculation to allow testing without connecting to production. */
export function calculateMonthlyBasepackMatrix(input:MatrixInputs):OLAAccountMatrix {
  const dates=datesForMonth(input.month);
  const dateSet=new Set(dates);
  const codes=new Set<string>(OLA_MATRIX_ACCOUNTS.map(x=>x.code));
  const runCandidates=new Map<string,Run>();
  for(const run of input.runs){
    const code=norm(run.account_code), date=String(run.observation_date??'');
    if(!codes.has(code)||!dateSet.has(date)||!['success','partial'].includes(run.run_status))continue;
    const key=`${code}|${date}`,prior=runCandidates.get(key);
    const timestamp=(v:Run)=>v.finished_at??v.started_at??'';
    if(!prior||(run.run_status==='success'&&prior.run_status!=='success')||
      (run.run_status===prior.run_status&&timestamp(run)>timestamp(prior)))runCandidates.set(key,run);
  }
  const byRunId=new Map([...runCandidates.values()].map(r=>[r.run_id,r]));
  const mappings=new Map<string,string>();
  const ambiguous=new Set<string>();
  const mappedAccountSet=new Set<string>();
  for(const row of input.mappings){
    const code=norm(row.account_code),sku=norm(row.account_sku);
    if(!codes.has(code)||!sku)continue;
    const bp=String(row.basepack_id??'').trim()||norm(row.packsize);
    if(!bp)continue;
    mappedAccountSet.add(code);
    const key=`${code}|${sku}`;
    const old=mappings.get(key);
    if(old && old!==bp)ambiguous.add(key);
    else if(!old)mappings.set(key,bp);
  }
  type Status='available'|'unavailable'|'unknown';
  type Evidence={status:Status;at:string;id:number};
  const observations=new Map<string,Evidence>();
  let unmatched=0,conflicts=0;
  const byBranchDay=new Map<string,Set<string>>();
  for(const o of input.observations){
    const run=byRunId.get(o.run_id);
    if(!run)continue;
    const code=norm(o.account_code), sku=norm(o.account_sku);
    if(code!==norm(run.account_code)||!sku)continue;
    const mapKey=`${code}|${sku}`;
    if(ambiguous.has(mapKey)){conflicts++;continue;}
    const bp=mappings.get(mapKey);
    if(!bp){unmatched++;continue;}
    const date=run.observation_date;
    const branch=code==='pandamart'?(norm(o.branch)||'unknown-branch'):'all';
    // Each branch/basepack is a separate OLA unit. Other accounts use one unit per basepack.
    const status:Status=norm(o.status)==='available'?'available':norm(o.status)==='unavailable'?'unavailable':
      norm(o.status)===''?(o.availability===true?'available':o.availability===false?'unavailable':'unknown'):'unknown';
    const evidenceKey=[code,date,branch,bp,sku].join('|');
    const old=observations.get(evidenceKey);
    if(!old||String(o.observed_at??'')>old.at||
      (String(o.observed_at??'')===old.at&&numeric(o.id)>old.id)){
      observations.set(evidenceKey,{status,at:String(o.observed_at??''),id:numeric(o.id)});
    }
    const bk=`${code}|${date}`;
    const branches=byBranchDay.get(bk)??new Set<string>();branches.add(branch);byBranchDay.set(bk,branches);
  }
  const basepackState=new Map<string,{hasAvailable:boolean;hasOos:boolean}>();
  const skuCounts=new Map<string,number>();
  for(const [key,obs] of observations){
    const parts=key.split('|');
    const cellKey=parts.slice(0,4).join('|');
    const state=basepackState.get(cellKey)??{hasAvailable:false,hasOos:false};
    if(obs.status==='available')state.hasAvailable=true;
    if(obs.status==='unavailable')state.hasOos=true;
    basepackState.set(cellKey,state);
    const dayKey=parts.slice(0,2).join('|');
    skuCounts.set(dayKey,(skuCounts.get(dayKey)??0)+1);
  }
  const cells=new Map<string,DailyCell>();
  for(const run of runCandidates.values()){
    const key=`${norm(run.account_code)}|${run.observation_date}`;
    cells.set(key,{...emptyCell(),runStatus:run.run_status as 'success'|'partial',branches:byBranchDay.get(key)?.size??0,skus:skuCounts.get(key)??0});
  }
  for(const [key,status] of basepackState){
    const [account,date]=key.split('|');
    const dayKey=`${account}|${date}`;
    const cell=cells.get(dayKey)??emptyCell();
    if(status.hasAvailable)cell.available++;
    else if(status.hasOos)cell.oos++;
    else cell.unknown++;
    cells.set(dayKey,cell);
  }
  for(const cell of cells.values()){
    cell.valid=cell.available+cell.oos;
    cell.ola=percent(cell.available,cell.oos);
  }
  const rows=dates.map(date=>{
    const dayCells:Record<string,DailyCell>={};
    const total=emptyCounts();
    for(const account of OLA_MATRIX_ACCOUNTS){
      const cell=cells.get(`${account.code}|${date}`)??emptyCell();
      dayCells[account.code]=cell;
      total.available+=cell.available;
      total.oos+=cell.oos;
      total.unknown+=cell.unknown;
    }
    total.valid=total.available+total.oos;
    total.ola=percent(total.available,total.oos);
    return {date,cells:dayCells,overall:total};
  });
  const avg=(values:number[])=>values.length?round(values.reduce((s,x)=>s+x,0)/values.length):null;
  const accounts=OLA_MATRIX_ACCOUNTS.map(a=>{
    const relevant=rows.map(row=>({date:row.date,cell:row.cells[a.code]}));
    const observed=relevant.filter(x=>x.cell.runStatus!==null);
    const valid=relevant.filter(x=>x.cell.ola!==null);
    const latest=valid.at(-1);
    return {code:a.code,label:a.label,observedDays:observed.length,validDays:valid.length,
      avgOla:avg(valid.map(x=>x.cell.ola as number)),latestOla:latest?.cell.ola??null,latestDate:latest?.date??null,
      hasMappings:mappedAccountSet.has(a.code)};
  });
  const overallValid=rows.filter(r=>r.overall.ola!==null);
  return {
    month:input.month,dates,accounts,rows,
    overall:{avgDailyOla:avg(overallValid.map(r=>r.overall.ola as number)),validDays:overallValid.length},
    diagnostics:{runs:runCandidates.size,observations:input.observations.length,mappedObservations:observations.size,
      unmatchedObservations:unmatched,ambiguousObservations:conflicts,mappedAccounts:mappedAccountSet.size,
      partialRuns:[...runCandidates.values()].filter(r=>r.run_status==='partial').length},
    methodology:'Account/day: latest successful scraper run, or latest partial when no success. Account+SKU mapped to current active master basepack. Each account/branch/basepack/day contributes 1 when any mapped SKU is available, 0 when none available but at least one OOS, or Unknown otherwise. PandaMart branches count as separate basepack units. Daily OLA = Available/(Available + OOS). Unknown and missing dates are excluded. Monthly average = arithmetic mean of valid daily percentages, not a weighted SKU percentage. Catalog-only accounts with no master mappings show missing data.',
  };
}

// Read-only paginated access. Never writes to Supabase or changes its schema.
export async function loadMonthlyBasepackMatrix(month:string):Promise<OLAAccountMatrix> {
  datesForMonth(month);
  const db=getSupabaseAdmin();
  const from=`${month}-01`;
  const [year,m]=month.split('-').map(Number);
  const to=new Date(Date.UTC(year,m,1)).toISOString().slice(0,10);
  const rawRuns:Run[]=[];
  for(let offset=0;offset<20000;offset+=1000){
    const {data,error}=await db.from('v_ola_scraped_run_metrics')
      .select('run_id,account_code,run_status,observation_date,finished_at,started_at')
      .gte('observation_date',from).lt('observation_date',to)
      .order('observation_date').order('finished_at',{ascending:false}).range(offset,offset+999);
    if(error)throw new Error(`Scraper runs: ${error.message}`);
    const page=(data??[]) as unknown as Run[];
    rawRuns.push(...page);
    if(page.length<1000)break;
    if(offset===19000)throw new Error('Too many run records for selected month.');
  }
  // Select one run per account and Dhaka day BEFORE fetching observations.
  const noObservations=calculateMonthlyBasepackMatrix({month,runs:rawRuns,mappings:[],observations:[]});
  const chosenIds=new Set<string>();
  // The pure calculator chooses runs identically; we repeat only run selection here to limit reads.
  const chosen=new Map<string,Run>();
  for(const run of rawRuns){
    const code=norm(run.account_code),date=String(run.observation_date??'');
    if(!OLA_MATRIX_ACCOUNTS.some(a=>a.code===code)||!date.startsWith(month)||!['success','partial'].includes(run.run_status))continue;
    const key=`${code}|${date}`,old=chosen.get(key);
    const when=(r:Run)=>r.finished_at??r.started_at??'';
    if(!old||(run.run_status==='success'&&old.run_status!=='success')||
      (old.run_status===run.run_status&&when(run)>when(old)))chosen.set(key,run);
  }
  for(const r of chosen.values())chosenIds.add(r.run_id);
  if(!chosenIds.size)return noObservations;
  const ids=[...chosenIds];
  const mappings:Mapping[]=[];
  const codes=OLA_MATRIX_ACCOUNTS.map(a=>a.code);
  for(let offset=0;offset<20000;offset+=1000){
    const {data,error}=await db.from('v_account_mappings').select('account_code,account_sku,product_id,basepack_id,packsize')
      .eq('status','active').in('account_code',codes).order('account_code').order('account_sku')
      .range(offset,offset+999);
    if(error)throw new Error(`Active mappings: ${error.message}`);
    const page=(data??[]) as unknown as Mapping[];mappings.push(...page);
    if(page.length<1000)break;
    if(offset===19000)throw new Error('Mapping pagination limit exceeded.');
  }
  const observations:Observation[]=[];
  const chunks:Array<string[]> = [];
  for(let i=0;i<ids.length;i+=16)chunks.push(ids.slice(i,i+16));
  // Limit concurrent page streams to avoid overwhelming Supabase/PostgREST.
  let cursor=0;
  const worker=async()=>{
    while(cursor<chunks.length){
      const chunk=chunks[cursor++];
      for(let offset=0;offset<30000;offset+=1000){
        const {data,error}=await db.from('ola_scrape_observations')
          .select('id,run_id,account_code,account_sku,branch,status,availability,observed_at')
          .in('run_id',chunk).order('id').range(offset,offset+999);
        if(error)throw new Error(`Scraper observations: ${error.message}`);
        const page=(data??[]) as unknown as Observation[];
        observations.push(...page);
        if(observations.length>250000)throw new Error('Monthly observations exceed 250,000; select a shorter scope.');
        if(page.length<1000)break;
        if(offset===29000)throw new Error('An observation batch exceeded its row limit.');
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(5,chunks.length)},()=>worker()));
  return calculateMonthlyBasepackMatrix({month,runs:rawRuns,mappings,observations});
}
