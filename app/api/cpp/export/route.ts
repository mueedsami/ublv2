import { NextRequest, NextResponse } from 'next/server';
import { makeXlsx, type XlsxCell } from '@/lib/xlsx-writer';

export const runtime='nodejs';
const MAX_ROWS=50000;
const MAX_COLS=40;
export async function POST(req:NextRequest){
  try{
    const body=await req.json();
    const headers:unknown=body.headers;
    const rows:unknown=body.rows;
    if(!Array.isArray(headers)||headers.length<1||headers.length>MAX_COLS||!headers.every(h=>typeof h==='string'&&h.length<=100)||!Array.isArray(rows)||rows.length>MAX_ROWS)
      return NextResponse.json({error:'Invalid export data'},{status:400});
    if(!rows.every(r=>Array.isArray(r)&&r.length===headers.length&&r.every((v:unknown)=>v==null||['string','number','boolean'].includes(typeof v))))
      return NextResponse.json({error:'Invalid export row values'},{status:400});
    const safe=(v:XlsxCell):XlsxCell=>typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?`'${v}`:v;
    const buffer=makeXlsx('CPP comparisons',(headers as string[]).map(h=>h.slice(0,100)),(rows as XlsxCell[][]).map(r=>r.map(safe)));
    return new NextResponse(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="cpp_comparisons.xlsx"','Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Unable to generate CPP export'},{status:500});}
}
