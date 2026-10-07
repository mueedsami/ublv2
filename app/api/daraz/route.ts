import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
export const runtime='nodejs';
function err(e:unknown){return e instanceof Error?e.message:(e&&typeof e==='object'&&'message' in e?String(e.message):'Failed to load Daraz intelligence.')}
export async function GET(){try{const s=getSupabaseAdmin();const [current,daily,monthly,movement,movementDaily]=await Promise.all([
 s.from('v_daraz_current_basepacks').select('*').order('packsize').range(0,999),
 s.from('v_daraz_daily_ola').select('*').order('stock_date',{ascending:false}).limit(62),
 s.from('v_daraz_monthly_ola').select('*').order('month_start',{ascending:false}).limit(12),
 s.from('v_daraz_stock_movement').select('*').eq('is_mapped',true).order('stock_date',{ascending:false}).limit(1000),
 s.from('v_daraz_daily_movement_summary').select('*').order('stock_date',{ascending:false}).limit(62),
]);for(const r of [current,daily,monthly,movement,movementDaily])if(r.error)throw r.error;return NextResponse.json({current:current.data??[],daily:daily.data??[],monthly:monthly.data??[],movement:movement.data??[],movementDaily:movementDaily.data??[]});}catch(e){return NextResponse.json({error:err(e)},{status:500})}}
