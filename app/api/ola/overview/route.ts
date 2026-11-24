import { NextRequest, NextResponse } from 'next/server';
import {buildOlaOverview,dhakaToday,loadRunMetrics,shiftMonth,validMonth} from '@/lib/ola-live-metrics';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request:NextRequest){
  try{
    const month=request.nextUrl.searchParams.get('month')||dhakaToday().slice(0,7);
    if(!validMonth(month))return NextResponse.json({error:'Invalid month: use YYYY-MM'}, {status:400});
    if(month>dhakaToday().slice(0,7))return NextResponse.json({error:'A future month has no OLA observations.'},{status:400});
    const previous=shiftMonth(month,-1);
    // Previous-month comparison must not blank the actual requested month if it fails.
    const [currentResult,previousResult]=await Promise.allSettled([
      loadRunMetrics(`${month}-01`,`${shiftMonth(month,1)}-01`),
      loadRunMetrics(`${previous}-01`,`${month}-01`),
    ]);
    if(currentResult.status==='rejected')throw currentResult.reason;
    const current=buildOlaOverview(month,currentResult.value);
    const previousOverview=previousResult.status==='fulfilled'?buildOlaOverview(previous,previousResult.value):null;
    return NextResponse.json({...current,previous:{month:previous,accounts:previousOverview?.accounts.map(a=>({code:a.code,avg_ola_pct:a.avg_ola_pct,valid_days:a.valid_days}))??[]},
      warnings:previousResult.status==='rejected'?['Previous month unavailable; current month remains visible.']:[]},
      {headers:{'Cache-Control':'private, no-store, max-age=0'}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to load OLA intelligence',
      hint:'Verify SUPABASE_URL, SUPABASE_SECRET_KEY and access to v_ola_scraped_run_metrics.'}, {status:503,headers:{'Cache-Control':'no-store'}});
  }
}
