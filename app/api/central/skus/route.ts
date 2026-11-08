import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// Only latest SUCCESSFUL scraper runs are included. No stock-upload data is read.
async function allRows(table: 'v_ola_scraped_latest' | 'v_account_mappings') {
  const supabase=getSupabaseAdmin();
  const result: Record<string,unknown>[]=[];
  for (let from=0; from<100000; from+=500) {
    const query=table==='v_ola_scraped_latest'
      ? supabase.from(table).select('account_code,account_sku,basepack,branch,status,stock_qty,price,product_url,source_product,observed_at,run_finished_at').range(from,from+499)
      : supabase.from(table).select('account_code,account_sku,packsize,product_name,brand,business_group,category,status').eq('status','active').in('account_code',['daraz','pandamart','shajgoj','arogga','othoba','shwapno','cartup','ushop']).range(from,from+499);
    const {data,error}=await query;
    if(error) throw error;
    result.push(...(data ?? []) as Record<string,unknown>[]);
    if(!data || data.length<500) return result;
  }
  throw new Error('Safety limit exceeded for SKU data, aborting to avoid incomplete export');
}

export async function GET() {
  try {
    const [observations,mappings]=await Promise.all([allRows('v_ola_scraped_latest'),allRows('v_account_mappings')]);
    const bySku=new Map<string,Record<string,unknown>>();
    for(const mapping of mappings){
      const key=`${String(mapping.account_code).toLowerCase()}|${String(mapping.account_sku).toLowerCase()}`;
      // Ambiguous master mappings should be flagged in the CSV as a source-data problem.
      if(bySku.has(key) && bySku.get(key)?.packsize !== mapping.packsize){
        bySku.set(key,{...mapping,packsize:'AMBIGUOUS MASTER MAPPING',product_name:'Check master SKU mapping'});
      } else if(!bySku.has(key)){bySku.set(key,mapping);}
    }
    const accountNames:Record<string,string>={daraz:'Daraz',pandamart:'Pandamart',shajgoj:'Shajgoj',arogga:'Arogga',othoba:'Othoba',shwapno:'Shwapno',cartup:'Cartup',ushop:'Ushop'};
    const rows=observations.map(o=>{
      const account=String(o.account_code??'');
      const master=bySku.get(`${account.toLowerCase()}|${String(o.account_sku??'').toLowerCase()}`);
      const rawStatus=String(o.status??'unknown');
      return {
        account_code:account, account_name:accountNames[account]??account,
        account_sku:String(o.account_sku??''),basepack:String(o.basepack??master?.packsize??''),
        product_name:String(o.source_product??master?.product_name??''),
        brand:String(master?.brand??''),category:String(master?.category??''),business_group:String(master?.business_group??''),
        branch:String(o.branch??'All'),
        status:rawStatus==='available'?'available':rawStatus==='unavailable'?'unavailable':'unknown',
        stock_qty:o.stock_qty??null,price:o.price??null,product_url:o.product_url??null,
        observed_at:o.observed_at??'',run_finished_at:o.run_finished_at??null,
      };
    });
    return NextResponse.json({source:'scraped',rows},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Failed to load SKU availability.'},{status:500});}
}
