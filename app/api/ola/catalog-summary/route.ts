import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 try{
  const supabase=getSupabaseAdmin();
  const {data,error}=await supabase.from('v_ola_catalog_account_summary').select('account_code,account_name,scraped_at,catalog_observations,in_stock,out_of_stock,unknown,ola_pct').order('account_name');
  if(error)throw error;
  return NextResponse.json({source:'catalog_stock',accounts:data??[],methodology:'Stock quantity = 0 => OOS; >0 => in stock; missing/invalid/negative => unknown. No Master SKU or basepack mapping.'},{headers:{'Cache-Control':'no-store'}});
 }catch(err){return NextResponse.json({error:err instanceof Error?err.message:'Failed to load catalog OLA'},{status:500});}
}
