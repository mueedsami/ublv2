import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const VALID = new Set(['beauty_booth','daraz','arogga','othoba','shwapno','shajgoj','pandamart','cartup','ushop','foodi']);
type RunMetric = {
 run_id: string; account_code: string; run_status: string; started_at: string; finished_at: string | null;
 observation_date: string; checked_rows: number; available_rows: number; unavailable_rows: number;
 unknown_rows: number; ola_pct: number | null; branches_observed: number;
};
export async function GET(req:NextRequest){
 try {
  const account = req.nextUrl.searchParams.get('account') ?? '';
  if(!VALID.has(account)) return NextResponse.json({error:'Invalid OLA account'},{status:400});
  const supabase=getSupabaseAdmin();
  const all:RunMetric[]=[];
  for(let offset=0;offset<20000;offset+=500){
   const {data,error}=await supabase.from('v_ola_scraped_run_metrics').select('*')
    .eq('account_code',account).order('observation_date',{ascending:false})
    .order('finished_at',{ascending:false}).range(offset,offset+499);
   if(error)throw error;
   all.push(...(data??[] as RunMetric[]));
   if(!data||data.length<500) break;
   if(offset===19500)throw new Error('OLA history exceeds pagination limit');
  }
  // One latest successful snapshot per calendar day; partial snapshots are used only if no success exists.
  const latestByDate = new Map<string,RunMetric>();
  for(const r of all){
   const old=latestByDate.get(r.observation_date);
   if(!old || (old.run_status!=='success' && r.run_status==='success') ||
       (old.run_status===r.run_status && (r.finished_at??r.started_at)>(old.finished_at??old.started_at))) {
    latestByDate.set(r.observation_date,r);
   }
  }
  const daily=Array.from(latestByDate.values()).sort((a,b)=>b.observation_date.localeCompare(a.observation_date));
  const months=new Map<string,RunMetric[]>();
  for(const day of daily){const k=day.observation_date.slice(0,7);months.set(k,[...(months.get(k)??[]),day]);}
  const monthly=Array.from(months.entries()).map(([month,days])=>{
   const valid=days.filter(r=>r.ola_pct!=null);
   const percentages=valid.map(r=>Number(r.ola_pct));
   return {month,observed_days:days.length,valid_days:valid.length,
    avg_ola_pct:percentages.length?Number((percentages.reduce((a,b)=>a+b,0)/percentages.length).toFixed(2)):null,
    min_ola_pct:percentages.length?Math.min(...percentages):null,
    max_ola_pct:percentages.length?Math.max(...percentages):null,
    first_date:days[days.length-1].observation_date,last_date:days[0].observation_date,
    unknown_rows:days.reduce((n,r)=>n+Number(r.unknown_rows),0)};
  }).sort((a,b)=>b.month.localeCompare(a.month));
  return NextResponse.json({account,latest:daily[0]??null,daily,monthly,total_runs:all.length,source:'scraped',
   methodology:'Latest successful scrape per local day (or latest partial if no success); monthly arithmetic mean of daily confirmed-status OLA. Unknown excluded from daily denominator.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'OLA history unavailable'},{status:500});}
}
