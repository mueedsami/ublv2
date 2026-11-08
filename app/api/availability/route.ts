import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// This endpoint is OLA-only. No sales or stock valuation endpoint is changed.
// Default to the original source until the SQL migration and scraping ingestion are validated.
export async function GET(request: NextRequest) {
  try {
    const scraped = request.nextUrl.searchParams.get('source') === 'scraped' ||
      (request.nextUrl.searchParams.get('source') !== 'stock' && process.env.OLA_DATA_SOURCE === 'scraped');
    const supabase = getSupabaseAdmin();
    const [summaryResponse, rowsResponse, pandaResponse] = await Promise.all([
      supabase.from(scraped ? 'v_ola_scraped_account_summary' : 'v_account_availability_summary').select('*').order('sort_order'),
      supabase.from(scraped ? 'v_ola_scraped_basepacks' : 'v_basepack_availability').select('*').order('packsize').range(0, 4999),
      scraped ? Promise.resolve({data:[],error:null}) : supabase.from('v_pandamart_daily_summary').select('*').order('stock_date',{ascending:false}).limit(1),
    ]);
    for(const result of [summaryResponse,rowsResponse,pandaResponse]) if(result.error) throw result.error;
    const panda = pandaResponse.data?.[0] ?? null;
    const summary = (summaryResponse.data ?? []).map((row) => {
      if(scraped || row.account_code!=='pandamart' || !panda) return {...row,metric_type:row.account_code==='pandamart' && scraped?'branch_ola':'basepack'};
      return {...row,snapshot_date:panda.stock_date,expected_basepacks:panda.total_branch_cells,
        available_basepacks:panda.available_branch_cells,unavailable_basepacks:panda.unavailable_branch_cells,
        availability_pct:panda.branch_ola_pct,metric_type:'branch_ola',network_coverage_pct:panda.network_coverage_pct,
        network_expected_basepacks:panda.expected_basepacks,network_available_basepacks:panda.network_available_basepacks};
    });
    return NextResponse.json({summary,rows:rowsResponse.data??[],source:scraped?'scraped':'stock'});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:'Failed to load availability.'},{status:500});
  }
}
