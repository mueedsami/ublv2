import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ACCOUNTS = ['arogga','cartup','daraz','othoba','pandamart','shajgoj','shwapno'];
const ZONE = 'Asia/Dhaka';
const pageDate = (v:string) => new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const normal = (v:unknown) => String(v??'').trim().toLowerCase();
const text = (v:unknown) => String(v??'').trim();
type Run = {id:string;account_code:string;status:string;finished_at:string|null;started_at:string;};
type Raw = {run_id:string;account_code:string;account_sku:string;branch:string|null;status:string;observed_at:string;stock_qty:number|null;source_product:string|null;product_url:string|null};
type Day = {date:string;status:'available'|'unavailable'|'unknown';qty:number|null};
type Detail = {account:string;sku:string;branch:string;product:string;brand:string;business_unit:string;category:string;latest_status:string;latest_date:string;latest_qty:number|null;observed_days:number;known_days:number;oos_days:number;current_oos_checks:number;current_oos_calendar_span:number|null;new_oos:boolean;recovered:boolean;recoveries:number;status_changes:number;last_recovery_date:string|null;timeline:Day[];product_url:string};

async function paginate<T>(queryFactory:(offset:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>,max:number,label:string):Promise<T[]> {
 const out:T[]=[];const size=500;
 for(let at=0;at<max;at+=size){
  const {data,error}=await queryFactory(at);if(error)throw new Error(`${label}: ${error.message}`);
  const part=data??[];out.push(...part);if(part.length<size)return out;
 }
 throw new Error(`${label} exceeds ${max} rows; narrow the date range rather than returning an incomplete report`);
}
export async function GET(req:NextRequest){
 try{
  const requested=Number(req.nextUrl.searchParams.get('days')??30);
  if(![14,30,45,60].includes(requested))return NextResponse.json({error:'days must be 14, 30, 45 or 60'},{status:400});
  const today=pageDate(new Date().toISOString());
  const [year,month,day]=today.split('-').map(Number);
  const start=new Date(Date.UTC(year,month-1,day-requested+1)).toISOString().slice(0,10);
  const db=getSupabaseAdmin();
  const runs=await paginate<Run>(at=>db.from('ola_scrape_runs').select('id,account_code,status,finished_at,started_at')
   .in('account_code',ACCOUNTS).in('status',['success','partial'])
   .gte('started_at',`${start}T00:00:00+06:00`).order('started_at',{ascending:false}).range(at,at+499),20000,'OLA runs');
  const best=new Map<string,Run>();
  for(const r of runs){const date=pageDate(r.finished_at??r.started_at);if(date<start||date>today)continue;
   const key=`${r.account_code}|${date}`;const old=best.get(key);
   if(!old || (old.status!=='success'&&r.status==='success') || (old.status===r.status&&(r.finished_at??r.started_at)>(old.finished_at??old.started_at)))best.set(key,r);
  }
  const ids=[...best.values()].map(r=>r.id);
  const byId=new Map([...best.values()].map(r=>[r.id,r]));
  const rows:Raw[]=[];
  for(let i=0;i<ids.length;i+=40){const batch=ids.slice(i,i+40);
   const result=await paginate<Raw>(at=>db.from('ola_scrape_observations').select('run_id,account_code,account_sku,branch,status,observed_at,stock_qty,source_product,product_url')
    .in('run_id',batch).order('id',{ascending:true}).range(at,at+499),100000,'OLA observations batch');
   rows.push(...result);
   if(rows.length>250000)throw new Error('OLA history exceeds 250,000 observations. Use a shorter range.');
  }
  const mappings=await paginate<Record<string,unknown>>(at=>db.from('v_account_mappings').select('account_code,account_sku,product_name,brand,business_group,category,status')
   .in('account_code',ACCOUNTS).eq('status','active').order('account_code').order('account_sku').range(at,at+499),100000,'OLA mappings');
  const map=new Map<string,Record<string,unknown>>();const ambiguous=new Set<string>();
  for(const m of mappings){const k=`${normal(m.account_code)}|${normal(m.account_sku)}`;if(!normal(m.account_sku))continue;
   const old=map.get(k);if(old&&['product_name','brand','business_group','category'].some(key=>text(old[key])!==text(m[key])))ambiguous.add(k);
   else if(!old)map.set(k,m);
  }
  const groups=new Map<string,{raw:Raw;days:Map<string,Day>;url:string}>();let skipped=0;
  for(const o of rows){const run=byId.get(o.run_id);if(!run)continue;
   const account=normal(o.account_code),sku=normal(o.account_sku),branch=text(o.branch)||'All';
   if(!sku){skipped++;continue;}
   const key=`${account}|${sku}|${branch}`;const date=pageDate(o.observed_at);
   const status:Day['status']=o.status==='available'?'available':o.status==='unavailable'?'unavailable':'unknown';
   if(!groups.has(key))groups.set(key,{raw:o,days:new Map(),url:text(o.product_url)});
   const group=groups.get(key)!;group.days.set(date,{date,status,qty:o.stock_qty});
   if(date>=pageDate(group.raw.observed_at))group.raw=o;
  }
  const details:Detail[]=[];let unmapped=0;
  for(const group of groups.values()){
   const o=group.raw;const account=normal(o.account_code),sku=normal(o.account_sku),branch=text(o.branch)||'All';
   const mappingKey=`${account}|${sku}`;const m=map.get(mappingKey);
   if(!m||ambiguous.has(mappingKey)){unmapped++;}
   const timeline=[...group.days.values()].sort((a,b)=>a.date.localeCompare(b.date));
   if(!timeline.length)continue;
   const last=timeline[timeline.length-1];
   let streak=0,startStreak='';for(let i=timeline.length-1;i>=0;i--){if(timeline[i].status!=='unavailable')break;streak++;startStreak=timeline[i].date;}
   let recoveries=0,changes=0,lastRecovery:string|null=null;let prevKnown:Day|null=null;
   for(const d of timeline){if(d.status==='unknown'){prevKnown=null;continue;}
    if(prevKnown&&d.status!==prevKnown.status){changes++;if(prevKnown.status==='unavailable'&&d.status==='available'){recoveries++;lastRecovery=d.date;}}
    prevKnown=d;
   }
   const previous=timeline.length>1?timeline[timeline.length-2]:null;
   const newOos=last.status==='unavailable'&&previous?.status==='available';
   const recovered=last.status==='available'&&previous?.status==='unavailable';
   const known=timeline.filter(d=>d.status!=='unknown');
   const span=streak?Math.round((Date.parse(`${last.date}T00:00:00Z`)-Date.parse(`${startStreak}T00:00:00Z`))/86400000)+1:null;
   details.push({account,sku:text(o.account_sku),branch,product:text(m?.product_name)||text(o.source_product)||text(o.account_sku),brand:text(m?.brand)||'Unmapped',business_unit:text(m?.business_group)||'Unmapped',category:text(m?.category)||'Unmapped',latest_status:last.status,latest_date:last.date,latest_qty:last.qty,observed_days:timeline.length,known_days:known.length,oos_days:known.filter(d=>d.status==='unavailable').length,current_oos_checks:streak,current_oos_calendar_span:span,new_oos:newOos,recovered,recoveries,status_changes:changes,last_recovery_date:lastRecovery,timeline,product_url:group.url});
  }
  details.sort((a,b)=>b.current_oos_checks-a.current_oos_checks||b.oos_days-a.oos_days||a.product.localeCompare(b.product));
  return NextResponse.json({rows:details,meta:{start,end:today,days:requested,successful_or_partial_daily_runs:ids.length,observations:rows.length,sku_branch_series:details.length,unmapped_series:unmapped,rows_without_sku:skipped,methodology:'Latest successful run per account per Dhaka date; latest partial if no success. Unknown breaks a confirmed stockout streak. Streak is consecutive observed OOS checks, not necessarily consecutive calendar days. Recovery requires adjacent observed statuses OOS → Available without Unknown. Branches remain distinct; no inference on missing dates.'}},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'SKU intelligence unavailable'},{status:500});}
}
