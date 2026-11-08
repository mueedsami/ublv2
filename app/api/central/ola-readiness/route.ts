import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 try{
  const s=getSupabaseAdmin();
  const [stores,maps,runs]=await Promise.all([
   s.from('ola_pandamart_stores').select('store_id,store_name,store_url,active').eq('active',true).order('store_name'),
   s.from('v_account_mappings').select('account_code,account_sku').eq('status','active').in('account_code',['pandamart','ushop']),
   s.from('ola_scrape_runs').select('account_code,status,finished_at').in('account_code',['pandamart','ushop']).order('finished_at',{ascending:false}).limit(20),
  ]);
  if(stores.error)throw stores.error;
  if(maps.error)throw maps.error;
  if(runs.error)throw runs.error;
  const counts=Object.fromEntries(['pandamart','ushop'].map(code=>[code,new Set((maps.data??[]).filter(x=>x.account_code===code).map(x=>String(x.account_sku).toLowerCase())).size]));
  const latest=Object.fromEntries(['pandamart','ushop'].map(code=>[code,(runs.data??[]).find(x=>x.account_code===code)??null]));
  return NextResponse.json({stores:stores.data??[],skuCounts:counts,latest},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Readiness check failed'},{status:500});}
}
