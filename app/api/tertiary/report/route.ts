import { NextRequest,NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {timingSafeEqual} from 'node:crypto';
export const runtime='nodejs';
export async function GET(request:NextRequest){
 try{
  const configured=process.env.URL_MAPPING_ADMIN_TOKEN||'';
  const provided=request.headers.get('x-url-mapping-admin-token')||'';
  if(configured.length<16||provided.length!==configured.length||!timingSafeEqual(Buffer.from(configured),Buffer.from(provided)))
   return NextResponse.json({error:'Admin access required.'},{status:401});
  const month=request.nextUrl.searchParams.get('month')||'';
  const account=request.nextUrl.searchParams.get('account')||'';
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return NextResponse.json({error:'Select YYYY-MM month.'},{status:400});
  const supabase=getSupabaseAdmin();let records:any[]=[];
  for(let start=0;start<100000;start+=1000){
   let query=supabase.from('v_tertiary_monthly_master').select('*').eq('month_start',month+'-01').order('account_code').order('sku_id').range(start,start+999);
   if(account)query=query.eq('account_code',account);
   const {data,error}=await query;if(error)throw error;records.push(...(data??[]));if((data??[]).length<1000)break;
  }
  const totalUnits=records.reduce((n,r)=>n+Number(r.sales_qty||0),0);
  const revenueRows=records.filter(r=>r.revenue!==null);
  const totalRevenue=revenueRows.length?revenueRows.reduce((n,r)=>n+Number(r.revenue),0):null;
  return NextResponse.json({month,account,rows:records,summary:{skus:records.length,units:totalUnits,revenue:totalRevenue,unmapped:records.filter(r=>!r.mapped_to_master).length,revenueCoverage:revenueRows.length}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Unable to load tertiary report.'},{status:500});}
}
