import {NextRequest,NextResponse} from 'next/server';
import {dhakaToday,loadRunMetrics,selectDailyRuns} from '@/lib/ola-live-metrics';
import {getSupabaseAdmin} from '@/lib/supabase-admin';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const ACCOUNTS=['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno'];
const norm=(v:unknown)=>String(v??'').trim().toLowerCase();
const txt=(v:unknown)=>String(v??'').trim();
const numberOrNull=(v:unknown):number|null=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const offsetDate=(date:string,n:number)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
type Status='available'|'unavailable'|'unknown';
type Day={date:string;status:Status;qty:number|null};
type Raw={id:number;run_id:string;account_code:string;account_sku:string;branch:string|null;status:string|null;
  availability:boolean|null;observed_at:string;stock_qty:number|null;source_product:string|null;product_url:string|null};
type Mapping={account_code:string;account_sku:string;product_id:string|null;product_name:string|null;brand:string|null;
  business_group:string|null;category:string|null};
type Series={latest:Raw;days:Map<string,{day:Day;observed_at:string;id:number}>;url:string};
type Detail={account:string;sku:string;branch:string;product:string;brand:string;business_unit:string;category:string;
  latest_status:Status;latest_date:string;latest_qty:number|null;observed_days:number;known_days:number;oos_days:number;
  current_oos_checks:number;current_oos_calendar_span:number|null;new_oos:boolean;recovered:boolean;recoveries:number;
  status_changes:number;last_recovery_date:string|null;timeline:Day[];product_url:string};

async function readMappings():Promise<Mapping[]>{
  const db=getSupabaseAdmin();const all:Mapping[]=[];
  for(let offset=0;offset<10000;offset+=1000){
    const {data,error}=await db.from('v_account_mappings')
      .select('account_code,account_sku,product_id,product_name,brand,business_group,category,status')
      .in('account_code',ACCOUNTS).eq('status','active').order('account_code').order('account_sku')
      .range(offset,offset+999);
    if(error)throw new Error(`SKU mappings: ${error.message}`);
    const part:unknown=data??[];if(!Array.isArray(part))throw new Error('Mapping response was not an array.');
    for(const row of part)if(row&&typeof row==='object'&&!Array.isArray(row))all.push(row as Mapping);
    if(part.length<1000)return all;
  }
  throw new Error('Master mapping query exceeded 10,000 rows.');
}
/** Fetch 1–2 months of scraped observations without hundreds of sequential 500-row calls. */
async function readObservations(runIds:string[]):Promise<Raw[]>{
  if(!runIds.length)return [];
  const chunks:string[][]=[];for(let i=0;i<runIds.length;i+=6)chunks.push(runIds.slice(i,i+6));
  const db=getSupabaseAdmin();const out:Raw[]=[];
  let next=0;
  async function worker(){
    while(next<chunks.length){
      const ids=chunks[next++];
      for(let offset=0;offset<35000;offset+=1000){
        const {data,error}=await db.from('ola_scrape_observations')
          .select('id,run_id,account_code,account_sku,branch,status,availability,observed_at,stock_qty,source_product,product_url')
          .in('run_id',ids).order('id',{ascending:true}).range(offset,offset+999);
        if(error)throw new Error(`OLA observations: ${error.message}`);
        const part:unknown=data??[];if(!Array.isArray(part))throw new Error('Unexpected OLA observation response.');
        for(const row of part)if(row&&typeof row==='object'&&!Array.isArray(row))out.push(row as Raw);
        if(out.length>250000)throw new Error('Too many historical SKU rows. Select a shorter period.');
        if(part.length<1000)break;
        if(offset>=34000)throw new Error('One scraper group exceeded 35,000 observations.');
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(5,chunks.length)},()=>worker()));
  return out;
}
export async function GET(request:NextRequest){
  try{
    const days=Number(request.nextUrl.searchParams.get('days')??30);
    if(![14,30,45,60].includes(days))return NextResponse.json({error:'days must be 14, 30, 45 or 60'}, {status:400});
    const today=dhakaToday(),start=offsetDate(today,-days+1);
    const [metrics,mappings]=await Promise.all([
      loadRunMetrics(start,offsetDate(today,1)),readMappings(),
    ]);
    const chosen=selectDailyRuns(metrics).filter(r=>ACCOUNTS.includes(r.account_code)&&r.observation_date>=start&&r.observation_date<=today);
    const byRun=new Map(chosen.map(r=>[r.run_id,r]));
    const observations=await readObservations([...byRun.keys()]);
    const map=new Map<string,Mapping>();const ambiguous=new Set<string>();
    for(const m of mappings){const sku=norm(m.account_sku);if(!sku)continue;
      const k=`${norm(m.account_code)}|${sku}`,old=map.get(k);
      if(old&&(txt(old.product_id)!==txt(m.product_id)||txt(old.product_name)!==txt(m.product_name)))ambiguous.add(k);
      else if(!old)map.set(k,m);
    }
    const groups=new Map<string,Series>();let missingSku=0;
    for(const o of observations){const run=byRun.get(txt(o.run_id));if(!run)continue;
      const account=norm(o.account_code),sku=norm(o.account_sku);if(!sku||account!==run.account_code){missingSku++;continue;}
      const branch=account==='pandamart'?(txt(o.branch)||'Unknown branch'):'All';
      const key=`${account}|${sku}|${branch}`,date=run.observation_date;
      const state:Status=o.status==='available'?'available':o.status==='unavailable'?'unavailable':
        o.availability===true?'available':o.availability===false?'unavailable':'unknown';
      const candidate={day:{date,status:state,qty:numberOrNull(o.stock_qty)},observed_at:txt(o.observed_at),id:Number(o.id)||0};
      if(!groups.has(key))groups.set(key,{latest:o,days:new Map(),url:txt(o.product_url)});
      const group=groups.get(key)!;const old=group.days.get(date);
      if(!old||candidate.observed_at>old.observed_at||candidate.observed_at===old.observed_at&&candidate.id>old.id)group.days.set(date,candidate);
      if(txt(o.observed_at)>=txt(group.latest.observed_at))group.latest=o;
      if(o.product_url)group.url=txt(o.product_url);
    }
    const rows:Detail[]=[];let unmapped=0;
    for(const group of groups.values()){
      const o=group.latest,account=norm(o.account_code),sku=norm(o.account_sku),branch=account==='pandamart'?(txt(o.branch)||'Unknown branch'):'All';
      const mKey=`${account}|${sku}`,m=map.get(mKey);
      if(!m||ambiguous.has(mKey))unmapped++;
      const timeline=[...group.days.values()].map(v=>v.day).sort((a,b)=>a.date.localeCompare(b.date));
      if(!timeline.length)continue;
      const last=timeline.at(-1)!;
      let streak=0,first='';for(let i=timeline.length-1;i>=0;i--){if(timeline[i].status!=='unavailable')break;streak++;first=timeline[i].date;}
      let recoveries=0,changes=0,lastRecovery:string|null=null,prior:Day|null=null;
      for(const day of timeline){if(day.status==='unknown'){prior=null;continue;}
        if(prior&&prior.status!==day.status){changes++;if(prior.status==='unavailable'&&day.status==='available'){recoveries++;lastRecovery=day.date;}}
        prior=day;
      }
      const previous=timeline.length>1?timeline[timeline.length-2]:null;
      const known=timeline.filter(r=>r.status!=='unknown');
      rows.push({account,sku:txt(o.account_sku),branch,product:txt(m?.product_name)||txt(o.source_product)||sku,
        brand:txt(m?.brand)||'Unmapped',business_unit:txt(m?.business_group)||'Unmapped',category:txt(m?.category)||'Unmapped',
        latest_status:last.status,latest_date:last.date,latest_qty:last.qty,observed_days:timeline.length,known_days:known.length,
        oos_days:known.filter(d=>d.status==='unavailable').length,current_oos_checks:streak,
        current_oos_calendar_span:streak?Math.round((Date.parse(`${last.date}T12:00:00Z`)-Date.parse(`${first}T12:00:00Z`))/86400000)+1:null,
        new_oos:last.status==='unavailable'&&previous?.status==='available',recovered:last.status==='available'&&previous?.status==='unavailable',
        recoveries,status_changes:changes,last_recovery_date:lastRecovery,timeline,product_url:group.url});
    }
    rows.sort((a,b)=>b.current_oos_checks-a.current_oos_checks||b.oos_days-a.oos_days||a.product.localeCompare(b.product));
    return NextResponse.json({rows,meta:{start,end:today,days,successful_or_partial_daily_runs:chosen.length,
      observations:observations.length,sku_branch_series:rows.length,unmapped_series:unmapped,rows_without_sku:missingSku,
      methodology:'One successful scraper run per account and Bangladesh date, otherwise latest partial. SKU and PandaMart branch histories are distinct. Unknown breaks an OOS streak; missing dates are never inferred.'}},
      {headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'SKU intelligence unavailable'}, {status:503,headers:{'Cache-Control':'no-store'}})}
}
