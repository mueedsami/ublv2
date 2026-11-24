import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { buildPriceMatrix, type DBRow, type PriceMatrixData } from '@/lib/price-compliance-matrix';
import { makeXlsx, type XlsxCell } from '@/lib/xlsx-writer';
import { chooseTodayRuns, getDhakaTodayWindow } from '@/lib/price-compliance-today';

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

async function loadData(db: DB, warning: number, critical: number):Promise<PriceMatrixData> {
  // Today's completed scraper runs and today's observations ONLY. No historical fallback.
  // CPP reference datasets are not accessed, and all database queries are SELECT-only.
  const window = getDhakaTodayWindow();
  const [accounts,products,basepacks,mappings,runs] = await Promise.all([
    readAll(db,'accounts','id,code,name,active',['code']),
    readAll(db,'products','id,ubl_code,name,status,brand,category,basepack_id',['id']),
    readAll(db,'basepacks','id,packsize',['id']),
    readAll(db,'product_account_ids','account_id,product_id,account_sku',['account_id','product_id','account_sku']),
    readAll(db,'ola_scrape_runs','id,account_code,status,finished_at',['finished_at'],
      q=>q.in('status',['success','partial'])
        .gte('finished_at',window.startUtc).lt('finished_at',window.endUtc)),
  ]);
  const selected = chooseTodayRuns(runs,window.startUtc,window.endUtc);
  const ids = selected.map(r=>String(r.id));
  const latest = selected.reduce<string|null>((best,r)=>{
    const at=String(r.finished_at);return !best || at>best?at:best;
  },null);
  const observations: DBRow[] = [];
  for (let offset=0;offset<ids.length;offset+=6) {
    const batch=ids.slice(offset,offset+6);
    const block=await readAll(db,'ola_scrape_observations',
      'id,run_id,account_code,account_sku,branch,observed_at,price,availability,product_url', ['id'],
      q=>q.in('run_id',batch).gte('observed_at',window.startUtc).lt('observed_at',window.endUtc),30000);
    observations.push(...block);
  }
  const knownOlaCodes=new Set(['arogga','beauty_booth','cartup','daraz','othoba',
    'pandamart','shajgoj','shwapno','ushop','foodi']);
  return buildPriceMatrix({accounts,products,basepacks,mappings,observations,latestObservation:latest,
    reportDate:window.reportDate,warning,critical,freshnessHours:24,
    accountCodes:accounts.map(a=>String(a.code||'')).filter(code=>knownOlaCodes.has(code)),
  });
}

const num = (text:string|null,def:number,min:number,max:number): number => {
  if (text == null) return def;
  const n = Number(text); return Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : def;
};

function exportWorkbook(data:PriceMatrixData):Buffer {
  const codes=data.accounts.map(a=>a.code);
  const headers=['Scrape Date (Bangladesh)','Basepack','Brand','Category','Product','UBL SKU','Severity','Platform Spread %','Min Price (BDT)','Max Price (BDT)',
    ...codes.flatMap(code=>[`${code} Price (BDT)`,`${code} Age / Status`,`${code} Branch Range`])];
  const rows:XlsxCell[][]=[];
  for (const bp of data.basepacks) for (const product of bp.products) {
    rows.push([data.reportDate,bp.packsize,bp.brand,bp.category,product.name,product.ublCode,product.severity,
      product.spreadPct===null?null:Number(product.spreadPct.toFixed(2)),product.minPrice,product.maxPrice,
      ...codes.flatMap(code=>{
        const cell=product.platformPrices[code];
        return [cell?.price??null,cell?.excludedReason|| (cell?.price===null?'NO PRICE TODAY':'TODAY'),
          cell?.low!==null && cell?.high!==null && cell?.branchCount>1 ? `${cell.low} - ${cell.high} (${cell.branchCount} branches)` : ''];
      })]);
  }
  return makeXlsx('Scraped Price Matrix',headers,rows);
}

export async function GET(request: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const warning = num(request.nextUrl.searchParams.get('warning'),10,1,50);
    const critical = num(request.nextUrl.searchParams.get('critical'),20,warning+1,100);
    const data=await loadData(db,warning,critical);
    if (request.nextUrl.searchParams.get('format')==='xlsx') {
      const file=exportWorkbook(data);
      return new NextResponse(new Uint8Array(file),{headers:{
        'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':`attachment; filename="UBL_Scraped_Price_Matrix_${data.reportDate}.xlsx"`,
        'Cache-Control':'private, no-store',
      }});
    }
    return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : 'Unable to load scraped pricing.'},
      {status:500,headers:{'Cache-Control':'no-store'}});
  }
}
