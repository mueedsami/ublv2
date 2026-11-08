import { loadWorkbook, valueText, parseNumber } from '@/lib/excel';

export const TERTIARY_ACCOUNTS = [
  { code: 'arogga', label: 'Arogga', sheetHint: 'Arogga' },
  { code: 'cartup', label: 'Cartup', sheetHint: 'Cartup' },
  { code: 'othoba', label: 'Othoba', sheetHint: 'Othoba' },
  { code: 'pandamart', label: 'Pandamart', sheetHint: 'Pandamart' },
  { code: 'shajgoj', label: 'Shajgoj', sheetHint: 'Shajgoj' },
] as const;
export type TertiaryRow = { account_sku: string; product_name: string; period_month: string; sales_qty: number; revenue: number | null; source_sheet: string; source_row: number; source_date: string | null; source_columns: Record<string, string | number | null> };
export type TertiaryParse = { account: string; month: string; rows: TertiaryRow[]; inputRows: number; issues: string[]; duplicateCount: number; sourceSheets: string[]; matchedProfiles: string[]; revenueCoverage: number };
function norm(x: unknown) { return valueText(x).trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function monthCode(v: string): string | null {
 const months: Record<string,string> = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
 const m=v.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\W*(20\d{2}|\d{2})/i);
 if(!m)return null;const y=m[2].length===2?'20'+m[2]:m[2];return y+'-'+months[m[1].slice(0,3).toLowerCase()];
}
function excelDate(v: unknown): string | null {
 const text=valueText(v).trim();
 if(/^\d{4}-\d{2}-\d{2}/.test(text))return text.slice(0,10);
 const n=Number(text);
 if(Number.isFinite(n)&&n>30000&&n<90000)return new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000).toISOString().slice(0,10);
 const d=new Date(text);return Number.isNaN(+d)?null:d.toISOString().slice(0,10);
}
function num(v: unknown): number | null {const s=valueText(v).trim();if(!s||s==='-'||s==='—'||s.toLowerCase()==='n/a')return null;const x=parseNumber(v);return x!==null&&Number.isFinite(x)?x:null;}
function sku(v: unknown):string {const s=valueText(v).trim();return /^\d+\.0+$/.test(s)?s.split('.')[0]:s;}
function isValid(x:unknown){return !!x && typeof x==='string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(x)}
/** Workbook date headers can be Excel serials (e.g. 46266 for 2026-09-01),
 * ISO dates, or human-readable headings such as September 2026. */
function shajgojSalesMonth(v: unknown): string | null {
 const raw=valueText(v).trim();
 if(!raw)return null;
 const serial=Number(raw);
 if(Number.isFinite(serial)&&serial>=30000&&serial<90000){
  const dt=new Date(Date.UTC(1899,11,30)+Math.floor(serial)*86400000);
  return dt.toISOString().slice(0,7);
 }
 if(/^20\d{2}[-/]\d{1,2}(?:[-/]\d{1,2})?/.test(raw)){
  const m=raw.match(/^(20\d{2})[-/](\d{1,2})/);
  if(m&&Number(m[2])>=1&&Number(m[2])<=12)return m[1]+'-'+m[2].padStart(2,'0');
 }
 return monthCode(raw);
}

export async function parseTertiary(buffer: Buffer, account: string, month: string, sheetOverride=''): Promise<TertiaryParse> {
 if(!isValid(month))throw new Error('Select a valid month (YYYY-MM).');
 if(!TERTIARY_ACCOUNTS.some(a=>a.code===account))throw new Error('Unsupported tertiary account.');
 const workbook=await loadWorkbook(buffer);
 const sheets=workbook.worksheets.filter(s=>s.name.toLowerCase().includes(account==='pandamart'?'pandamart':account));
 const preferred = sheetOverride ? workbook.worksheets.filter(s=>s.name===sheetOverride) : sheets;
 if(!preferred.length)throw new Error(`No ${account} sheet found. Available sheets: ${workbook.worksheets.map(s=>s.name).join(', ')}. Select the correct sheet.`);
 const result:TertiaryRow[]=[];const issues:string[]=[];let inputRows=0;
 for(const sheet of preferred){
  const headerIndex=sheet.rows.findIndex(r=>r.some(c=>['pid','shopsku','productid','sku','itemid','date'].includes(norm(c))));
  if(headerIndex<0){issues.push(`${sheet.name}: recognized header not found`);continue;}
  const headers=sheet.rows[headerIndex].map(norm);
  const col=(...keys:string[])=>keys.map(k=>headers.indexOf(norm(k))).find(n=>n>=0)??-1;
  const at=(row:(string|number|boolean|null)[],i:number)=>i<0?null:row[i]??null;
  const idColumn=account==='arogga'?col('p_id'):account==='cartup'?col('Shop SKU'):account==='shajgoj'?col('SKU'):account==='othoba'?col('Sku','ProductId'):col('Item_Id');
  const nameColumn=account==='arogga'?col('p_name'):account==='cartup'?col('Item'):account==='shajgoj'?col('Name'):account==='othoba'?col('ProductName'):col('Item_Name');
  if(idColumn<0){issues.push(`${sheet.name}: SKU ID column missing`);continue;}
  let quantityColumn=-1,revenueColumn=-1;
  if(account==='arogga')quantityColumn=col('sales_qty_'+monthCodeToAbbrev(month));
  if(account==='cartup')quantityColumn=col('GIS-'+monthCodeToAbbrev(month));
  if(account==='shajgoj'){quantityColumn=sheet.rows[headerIndex].findIndex(v=>shajgojSalesMonth(v)===month);revenueColumn=col('Total Sold');}
  if(account==='othoba'){quantityColumn=col('Sold Qty(1-30)');revenueColumn=col('Sales Value');}
  if(account==='pandamart'){quantityColumn=col('sold_qty');revenueColumn=col('gfv_local');}
  if(quantityColumn<0){issues.push(`${sheet.name}: no dated sales-quantity column for ${month}. Available dated columns: ${sheet.rows[headerIndex].map(v=>shajgojSalesMonth(v)).filter(Boolean).join(', ')||'none detected'}`);continue;}
  if(account==='cartup')issues.push('Cartup GIS values are treated as sold units provisionally; confirm the account definition before approving.');
  if(account==='arogga')issues.push('Arogga dump contains no realized sales revenue; revenue is left blank.');
  if(account==='cartup')issues.push('Cartup current selling price is not realized sales revenue; revenue is left blank.');
  if(account==='othoba')issues.push('Othoba file has no month field. Verify the selected reporting month matches its Sold Qty(1-30) period.');
  for(let i=headerIndex+1;i<sheet.rows.length;i++){
   const row=sheet.rows[i]; const id=sku(at(row,idColumn));if(!id)continue;inputRows++;
   const qty=num(at(row,quantityColumn));if(qty===null)continue;
   if(qty<0){issues.push(`${sheet.name} row ${i+1}: negative quantity skipped`);continue;}
   const rawDate=account==='pandamart'?excelDate(at(row,col('Date'))):null;
   if(account==='pandamart'&&(!rawDate||rawDate.slice(0,7)!==month))continue;
   // Shajgoj month is determined from the dated quantity-column heading, not hard-coded to September.
   const rv=num(at(row,revenueColumn));
   if(rv!==null&&rv<0){issues.push(`${sheet.name} row ${i+1}: negative sales value skipped`);continue;}
   if(account==='pandamart'&&rv===null){issues.push(`${sheet.name} row ${i+1}: missing GFV, retaining quantity only`);}
   result.push({account_sku:id,product_name:valueText(at(row,nameColumn)).trim(),period_month:month,sales_qty:qty,revenue:rv,source_sheet:sheet.name,source_row:i+1,source_date:rawDate,source_columns:{}});
  }
 }
 if(!result.length)throw new Error(`No sales rows found for ${account}, ${month}. Check the selected sheet and reporting month.`);
 // Daily Pandamart rows aggregate by product; never sum duplicate rows for monthly-only source files.
 const grouped=new Map<string,TertiaryRow>();let duplicateCount=0;
 for(const row of result){const existing=grouped.get(row.account_sku);if(!existing){grouped.set(row.account_sku,{...row});continue;}
  // Duplicate Shajgoj lines with identical sales figures are export artifacts:
  // keep one, never sum twice, and report them for audit.
  if(account==='shajgoj' && existing.sales_qty===row.sales_qty && existing.revenue===row.revenue){
   issues.push(`${row.source_sheet} row ${row.source_row}: repeated SKU ${row.account_sku} with identical quantity/revenue; safely deduplicated.`);
   continue;
  }
  duplicateCount++;
  if(account==='pandamart') {existing.sales_qty+=row.sales_qty;existing.revenue=(existing.revenue===null||row.revenue===null)?null:existing.revenue+row.revenue;}
 }
 if(duplicateCount&&account!=='pandamart')issues.push(`${duplicateCount} duplicate SKU rows detected — approval blocked until the source file is deduplicated.`);
 const rows=[...grouped.values()];
 return {account,month,rows,inputRows,issues:[...new Set(issues)].slice(0,100),duplicateCount,sourceSheets:preferred.map(s=>s.name),matchedProfiles:preferred.map(s=>s.name),revenueCoverage:rows.filter(r=>r.revenue!==null).length};
}
function monthCodeToAbbrev(month:string){return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(month.slice(5))-1];}
