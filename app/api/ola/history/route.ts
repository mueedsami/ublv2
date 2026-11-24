import { NextRequest, NextResponse } from 'next/server';
import {buildOlaOverview,dhakaToday,loadRunMetrics,OLA_ACCOUNTS,shiftMonth} from '@/lib/ola-live-metrics';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request:NextRequest){
  const code=request.nextUrl.searchParams.get('account')??'';
  if(!OLA_ACCOUNTS.some(a=>a.code===code))return NextResponse.json({error:'Unknown OLA account'},{status:400});
  try{
    const now=dhakaToday();const currentMonth=now.slice(0,7);
    // Display 12 months, without an unbounded query across every historical run.
    const fromMonth=shiftMonth(currentMonth,-11);
    const rows=await loadRunMetrics(`${fromMonth}-01`,`${shiftMonth(currentMonth,1)}-01`,code);
    const months=Array.from({length:12},(_,i)=>shiftMonth(currentMonth,-i));
    const monthly=months.map(month=>{
      const overview=buildOlaOverview(month,rows,now);
      const account=overview.accounts.find(a=>a.code===code)!;
      const observed=account.rows.filter(r=>r.status!==null);
      if(!observed.length)return null;
      return {month,observed_days:account.observed_days,valid_days:account.valid_days,
        avg_ola_pct:account.avg_ola_pct,weighted_ola_pct:account.weighted_ola_pct,
        min_ola_pct:account.min_ola_pct,max_ola_pct:account.max_ola_pct,
        first_date:observed[0].date,last_date:observed.at(-1)!.date,
        unknown_rows:observed.reduce((s,v)=>s+(v.unknown??0),0)};
    }).filter((v):v is NonNullable<typeof v>=>v!==null);
    const daily=months.flatMap(month=>{
      const account=buildOlaOverview(month,rows,now).accounts.find(a=>a.code===code)!;
      return account.rows.filter(r=>r.status!==null).map(d=>({
        run_id:'',observation_date:d.date,run_status:d.status,
        checked_rows:d.checked??0,available_rows:d.available??0,unavailable_rows:d.unavailable??0,
        unknown_rows:d.unknown??0,ola_pct:d.ola_pct,branches_observed:d.branches??0,finished_at:null,
      }));
    }).sort((a,b)=>b.observation_date.localeCompare(a.observation_date));
    return NextResponse.json({account:code,latest:daily[0]??null,daily,monthly,total_runs:rows.length,
      source:'scraped',methodology:'Daily SKU/branch scraper observations. Successful run preferred over partial. Unknown and missing excluded; monthly averages are equal-weight daily means.'},
      {headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'OLA account history unavailable'}, {status:503,headers:{'Cache-Control':'no-store'}})}
}
