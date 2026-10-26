import { loadWorkbook, valueText } from '@/lib/excel';

export type HistoricStatus = 'Y'|'N'|'N/A'|'';
export type HistoricRow = { name: string; details: Record<string,string>; statuses: Record<string,HistoricStatus> };
export type HistoricalPreview = { rows: HistoricRow[]; accounts: {name:string;code:string}[]; counts: Record<string,number>; warnings: string[] };

const CODES: Record<string,string> = {
  'beauty booth':'beauty_booth', cartup:'cartup', chardike:'chardike', daraz:'daraz', arogga:'arogga', foodi:'foodi',
  'grameen healthtech limited':'grameen_healthtech', ogerio:'ogerio', othoba:'othoba', paikari:'paikari', pandamart:'pandamart',
  perfecto:'perfecto', 'purchase haat limited':'purchase_haat', shajgoj:'shajgoj', 'sharetrip limited':'sharetrip',
  'shwapno ecom':'shwapno', 'the mall':'the_mall', ushop:'ushop', wellbeing:'wellbeing',
};
export function normalizedName(v:string) { return v.toLowerCase().normalize('NFKC').replace(/[\u2018\u2019]/g,"'").replace(/[^a-z0-9]+/g,' ').trim(); }
export function historyKey(name:string) { return `name:${normalizedName(name).replace(/\s+/g,'-')}`; }
function asText(v:unknown) { return valueText(v).trim(); }

export async function parseHistoricalTracker(file:File):Promise<HistoricalPreview> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Historical import requires the original XLSX tracker.');
  const wb=await loadWorkbook(Buffer.from(await file.arrayBuffer()));
  const matrix=wb.getWorksheet('Account wise summary');
  const detail=wb.getWorksheet('Sku enlistment Details');
  if (!matrix || !detail) throw new Error('Expected both Account wise summary and Sku enlistment Details worksheets.');
  const h=(matrix.rows[0]||[]).map(asText);
  if (normalizedName(h[0]||'')!=='sku name') throw new Error('The first column must be Sku Name.');
  const accounts=h.slice(1).filter(Boolean).map(name=>({name,code:CODES[normalizedName(name)]}));
  if (accounts.some(a=>!a.code)) throw new Error('Unknown account column(s): '+accounts.filter(a=>!a.code).map(a=>a.name).join(', '));
  if (new Set(accounts.map(a=>a.code)).size!==accounts.length) throw new Error('Duplicate account columns.');
  const detailHead=(detail.rows[0]||[]).map(asText);
  const getCol=(aliases:string[])=>detailHead.findIndex(h=>aliases.includes(normalizedName(h)));
  const dn=getCol(['sku updated perfect name','name']);
  if(dn<0)throw new Error('The details sheet must contain a product-name column.');
  const detailMap=new Map<string,Record<string,string>>();
  for (const row of detail.rows.slice(1)) {
    const n=asText(row[dn]); if(!n)continue;
    const k=normalizedName(n);
    if (detailMap.has(k)) throw new Error('Duplicate product in details sheet: '+n);
    const record:Record<string,string>={}; detailHead.forEach((header,i)=>{ if(header) record[header]=asText(row[i]); });
    detailMap.set(k,record);
  }
  const rows:HistoricRow[]=[]; const seen=new Set<string>();
  const counts:Record<string,number>={Y:0,N:0,'N/A':0,blank:0}; const warnings:string[]=[];
  for(const [i,row] of matrix.rows.entries()) {
    if(i===0)continue;
    const name=asText(row[0]); if(!name)continue;
    const key=normalizedName(name);
    if(seen.has(key)) throw new Error('Duplicate product in account matrix: '+name);
    seen.add(key);
    const details=detailMap.get(key);
    if(!details){warnings.push(`Row ${i+1}: No matching detail sheet product for ${name}; product will use its name only.`);}
    const statuses:Record<string,HistoricStatus>={};
    accounts.forEach((a,j)=>{
      const raw=asText(row[j+1]).toUpperCase().replace(/\s+/g,'');
      if(raw && raw!=='Y' && raw!=='N' && raw!=='N/A') throw new Error(`Unexpected value '${raw}' for ${name} / ${a.name} at row ${i+1}.`);
      const s=raw as HistoricStatus; statuses[a.code]=s; counts[s||'blank']++;
    });
    rows.push({name,details:details||{},statuses});
  }
  for (const key of detailMap.keys()) if(!seen.has(key)) warnings.push(`Details-only product not in status matrix: ${key}`);
  if(!rows.length)throw new Error('No product records found.');
  return {rows,accounts,counts,warnings};
}
