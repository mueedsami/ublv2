import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { buildPriceMatrix, type DBRow, type PriceMatrixData } from '@/lib/price-compliance-matrix';
import { makeXlsx, type XlsxCell } from '@/lib/xlsx-writer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DB = ReturnType<typeof getSupabaseAdmin>;

async function readAll(db: DB, table: string, columns: string, orderFields: string[],
  filter?: (query: any) => any, maxRows = 100000): Promise<DBRow[]> {
  const rows: DBRow[] = [];
  const pageSize = 1000;
  for (let start = 0; start < maxRows; start += pageSize) {
    let query = db.from(table).select(columns);
    for (const field of orderFields) query = query.order(field, { ascending: true });
    if (filter) query = filter(query);
    const { data, error } = await query.range(start, start + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page: unknown = data ?? [];
    if (!Array.isArray(page)) throw new Error(`${table}: unexpected data shape`);
    for (const row of page) {
      if (row && typeof row === 'object' && !Array.isArray(row)) rows.push(row as DBRow);
    }
    if (page.length < pageSize) return rows;
  }
  throw new Error(`${table} exceeded the query safety limit (${maxRows} rows); report not generated.`);
}

function recentRunIds(runs: DBRow[], days: number): {ids:string[];latest:string|null} {
  const valid = runs.filter(r => ['success','partial'].includes(String(r.status)) && r.finished_at);
  const latest = valid.reduce<string | null>((s,r)=> !s || String(r.finished_at)>s ? String(r.finished_at) : s,null);
  if (!latest) return {ids:[],latest:null};
  const cutoff = Date.parse(latest) - days * 86400000;
  const perAccount = new Map<string, DBRow[]>();
  for (const r of valid) {
    if (Date.parse(String(r.finished_at)) < cutoff) continue;
    const code = String(r.account_code || '');
    const list = perAccount.get(code) || [];
    list.push(r); perAccount.set(code,list);
  }
  const ids: string[] = [];
  for (const list of perAccount.values()) {
    list.sort((a,b)=>String(b.finished_at).localeCompare(String(a.finished_at)));
    // Prefer finished successful runs; accept partial only when no newer full snapshot exists.
    const selected = list.filter(x => x.status === 'success').slice(0,4);
    const chosen = selected.length ? selected : list.slice(0,4);
    for (const r of chosen) ids.push(String(r.id));
  }
  return {ids,latest};
}

async function loadData(db: DB, days: number, warning: number, critical: number):Promise<PriceMatrixData> {
  // Only SELECTs are executed. The CPP reference datasets are not accessed.
  const [accounts,products,basepacks,mappings,runs] = await Promise.all([
    readAll(db,'accounts','id,code,name,active',['code']),
    readAll(db,'products','id,ubl_code,name,status,brand,category,basepack_id',['id']),
    readAll(db,'basepacks','id,packsize',['id']),
    readAll(db,'product_account_ids','account_id,product_id,account_sku',['account_id','product_id','account_sku']),
    readAll(db,'ola_scrape_runs','id,account_code,status,finished_at',['id']),
  ]);
  const {ids,latest} = recentRunIds(runs, days);
  const observations: DBRow[] = [];
  for (let offset=0;offset<ids.length;offset+=6) {
    const batch=ids.slice(offset,offset+6);
    const block=await readAll(db,'ola_scrape_observations',
      'id,run_id,account_code,account_sku,branch,observed_at,price,availability,product_url', ['id'],
      q=>q.in('run_id',batch),30000);
    observations.push(...block);
  }
  return buildPriceMatrix({accounts,products,basepacks,mappings,observations,latestObservation:latest,
    warning,critical,freshnessHours:72,
    accountCodes:[...new Set(runs.filter(r=>['success','partial'].includes(String(r.status))).map(r=>String(r.account_code||'')))],
  });
}

const num = (text:string|null,def:number,min:number,max:number): number => {
  if (text == null) return def;
  const n = Number(text); return Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : def;
};

function exportWorkbook(data:PriceMatrixData):Buffer {
  const codes=data.accounts.map(a=>a.code);
  const headers=['Basepack','Brand','Category','Product','UBL SKU','Severity','Platform Spread %','Min Price (BDT)','Max Price (BDT)',
    ...codes.flatMap(code=>[`${code} Price (BDT)`,`${code} Age / Status`,`${code} Branch Range`])];
  const rows:XlsxCell[][]=[];
  for (const bp of data.basepacks) for (const product of bp.products) {
    rows.push([bp.packsize,bp.brand,bp.category,product.name,product.ublCode,product.severity,
      product.spreadPct===null?null:Number(product.spreadPct.toFixed(2)),product.minPrice,product.maxPrice,
      ...codes.flatMap(code=>{
        const cell=product.platformPrices[code];
        return [cell?.price??null,cell?.excludedReason|| (cell?.price===null?'NO PRICE':'LIVE'),
          cell?.low!==null && cell?.high!==null && cell?.branchCount>1 ? `${cell.low} - ${cell.high} (${cell.branchCount} branches)` : ''];
      })]);
  }
  return makeXlsx('Scraped Price Matrix',headers,rows);
}

export async function GET(request: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const days = num(request.nextUrl.searchParams.get('days'),14,1,30);
    const warning = num(request.nextUrl.searchParams.get('warning'),10,1,50);
    const critical = num(request.nextUrl.searchParams.get('critical'),20,warning+1,100);
    const data=await loadData(db,days,warning,critical);
    if (request.nextUrl.searchParams.get('format')==='xlsx') {
      const file=exportWorkbook(data);
      return new NextResponse(new Uint8Array(file),{headers:{
        'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':'attachment; filename="UBL_Scraped_Price_Matrix.xlsx"',
        'Cache-Control':'private, no-store',
      }});
    }
    return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : 'Unable to load scraped pricing.'},
      {status:500,headers:{'Cache-Control':'no-store'}});
  }
}
