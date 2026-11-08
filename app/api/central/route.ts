import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function fetchEveryRow(s:ReturnType<typeof getSupabaseAdmin>, table:string){
 const result: Record<string, unknown>[]=[];
 for(let start=0;start<100000;start+=500){
  const {data,error}=await s.from(table).select('*').order('sort_order').order('packsize').range(start,start+499);
  if(error)throw error;
  result.push(...(data??[]));
  if(!data||data.length<500)return result;
 }
 throw new Error('Central availability exceeds pagination safety limit');
}

export async function GET(request:NextRequest){
 try {
  const scraped=request.nextUrl.searchParams.get('source')==='scraped'||(request.nextUrl.searchParams.get('source')!=='stock'&&process.env.OLA_DATA_SOURCE==='scraped');
  const s=getSupabaseAdmin();
  if(!scraped){
   const [r,a]=await Promise.all([s.from('v_central_availability_current').select('*').order('sort_order').order('packsize').range(0,4999),s.from('v_central_account_ola_current').select('*').order('sort_order')]);
   if(r.error)throw r.error;if(a.error)throw a.error;return NextResponse.json({rows:r.data??[],accounts:a.data??[],source:'stock'});
  }
  // Scraped source preserves the response keys, with master metadata supplied by the new view.
  const [rows,a]=await Promise.all([fetchEveryRow(s,'v_ola_scraped_central'),s.from('v_ola_scraped_central_accounts').select('*').order('sort_order')]);
  if(a.error)throw a.error;
  return NextResponse.json({rows,accounts:a.data??[],source:'scraped'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Failed to load central OLA.'},{status:500});}
}
