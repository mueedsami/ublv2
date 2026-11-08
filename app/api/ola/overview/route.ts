import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACCOUNTS = [
  {code:'arogga',label:'Arogga'},
  {code:'beauty_booth',label:'BeautyBooth',kind:'catalog'},
  {code:'cartup',label:'Cartup'},
  {code:'daraz',label:'Daraz'},
  {code:'othoba',label:'Othoba'},
  {code:'pandamart',label:'Pandamart'},
  {code:'shajgoj',label:'Shajgoj'},
  {code:'shwapno',label:'Shwapno'},
  {code:'ushop',label:'Ushop',kind:'catalog'},
] as const;
type Metric = {run_id:string;account_code:string;run_status:string;observation_date:string;finished_at:string|null;started_at:string|null;available_rows:number;unavailable_rows:number;unknown_rows:number;checked_rows:number;ola_pct:number|null};
const validMonth = (v:string)=> /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && Number(v.slice(0,4))>=2020 && Number(v.slice(0,4))<=2100;

export async function GET(req:NextRequest) {
 try {
  const month=req.nextUrl.searchParams.get('month')??(()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`;})();
  if (!validMonth(month)) return NextResponse.json({error:'Use month=YYYY-MM'},{status:400});
  const start=`${month}-01`;
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
  const client=getSupabaseAdmin();
  const all:Metric[]=[];
  // Paginate: avoids PostgREST's default 1000-row truncation as the archive grows.
  for(let offset=0;offset<20000;offset+=500){
   const {data,error}=await client.from('v_ola_scraped_run_metrics').select('run_id,account_code,run_status,observation_date,finished_at,started_at,available_rows,unavailable_rows,unknown_rows,checked_rows,ola_pct')
    .gte('observation_date',start).lt('observation_date',end)
    .order('observation_date',{ascending:false}).order('finished_at',{ascending:false})
    .range(offset,offset+499);
   if(error)throw error;
   all.push(...((data??[]) as Metric[]));
   if(!data||data.length<500) break;
   if(offset===19500)throw new Error('More than 20,000 runs in month; reporting limit reached');
  }
  const allowed=new Set<string>(ACCOUNTS.map(a=>a.code));
  const latest=new Map<string,Metric>();
  for(const r of all){
   if(!allowed.has(r.account_code))continue;
   const k=`${r.account_code}:${r.observation_date}`;
   const prior=latest.get(k);
   if(!prior||(prior.run_status!=='success'&&r.run_status==='success')||
      (prior.run_status===r.run_status&&(r.finished_at??r.started_at??'')>(prior.finished_at??prior.started_at??'')))latest.set(k,r);
  }
  const daysInMonth=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
  const dates=Array.from({length:daysInMonth},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
  const records=Array.from(latest.values());
  const accounts=ACCOUNTS.map(a=>{
   const rows=dates.map(date=>{
    const r=latest.get(`${a.code}:${date}`);
    return {date,ola_pct:r?.ola_pct==null?null:Number(r.ola_pct),available:r?.available_rows??null,unavailable:r?.unavailable_rows??null,unknown:r?.unknown_rows??null,checked:r?.checked_rows??null,status:r?.run_status??null};
   });
   const values=rows.map(r=>r.ola_pct).filter((v):v is number=>v!==null);
   return {...a,rows,observed_days:rows.filter(r=>r.status!==null).length,valid_days:values.length,
    avg_ola_pct:values.length?Number((values.reduce((sum,v)=>sum+v,0)/values.length).toFixed(2)):null,
    min_ola_pct:values.length?Math.min(...values):null,max_ola_pct:values.length?Math.max(...values):null};
  });
  return NextResponse.json({month,dates,accounts,total_runs:all.length,selected_snapshots:records.length,methodology:'Latest successful snapshot per account per Dhaka calendar day; otherwise latest partial. Monthly average is unweighted mean of observed daily OLA values. Missing/unknown-only days excluded; unknown SKUs excluded from daily denominator. Catalog accounts report catalog-level availability, not basepack-level coverage.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'OLA overview unavailable'},{status:500});}
}
