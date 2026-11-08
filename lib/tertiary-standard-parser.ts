import {loadWorkbook, valueText, parseNumber} from '@/lib/excel';

export type StandardRow = {
  account_sku: string; product_name: string; sales_qty: number; revenue: number|null;
  source_sheet: string; source_row: number;
};
export type StandardImport = {
  account: string; month: string; rows: StandardRow[]; inputRows: number;
  sourceSheets: string[]; issues: string[]; duplicateCount: number; revenueCoverage: number;
};

const accountLabels:Record<string,string> = {
  arogga:'Arogga',beauty_booth:'BeautyBooth',cartup:'Cartup',chaldal:'Chaldal',daraz:'Daraz',
  foodi:'Foodi',othoba:'Othoba',pandamart:'Pandamart',shajgoj:'Shajgoj',shwapno:'Shwapno',ushop:'Ushop',
  meenabazar:'Meenabazar',rokomari:'Rokomari'
};
export const STANDARD_TERTIARY_ACCOUNTS=Object.entries(accountLabels).map(([code,label])=>({code,label}));
const clean=(v:unknown)=>valueText(v).trim();
const normalize=(v:unknown)=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'');
function numeric(v:unknown):number|null {
  const s=clean(v);
  if(!s||s==='-'||s==='—')return null;
  const parsed=parseNumber(v);
  return parsed===null||!Number.isFinite(parsed)?null:parsed;
}
function sku(v:unknown){const s=clean(v);return /^\d+\.0+$/.test(s)?s.replace(/\.0+$/,''):s;}

export async function parseStandardTertiary(buffer:Buffer, selectedAccount:string, selectedMonth:string):Promise<StandardImport>{
  if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(selectedMonth))throw new Error('Reporting month must be YYYY-MM.');
  if(!accountLabels[selectedAccount])throw new Error('Choose a supported marketplace account.');
  const wb=await loadWorkbook(buffer);
  const sheet=wb.worksheets.find(s=>s.name==='MONTHLY_UPLOAD');
  if(!sheet)throw new Error('MONTHLY_UPLOAD sheet not found. Please use the supplied standard Tertiary template.');
  const rows=sheet.rows;
  // B4 and B5 are required; zero-indexed array coordinates.
  const declaredAccount=normalize(rows[3]?.[1]);
  const expectedAccount=normalize(accountLabels[selectedAccount]);
  if(declaredAccount!==expectedAccount)throw new Error(`Template account ${clean(rows[3]?.[1])||'(blank)'} does not match selected ${accountLabels[selectedAccount]}. Change B4 or the account selection.`);
  const declaredMonth=clean(rows[4]?.[1]).slice(0,7);
  if(declaredMonth!==selectedMonth)throw new Error(`Template month ${declaredMonth||'(blank)'} does not match selected ${selectedMonth}. Change B5 or the month selection.`);
  const header=(rows[8]||[]).map(normalize);
  const required=['accountskuid','unitssold','salesrevenuebdt'];
  if(required.some((x,i)=>header[i]!==x))throw new Error('Unexpected column headers on row 9. Use the original MONTHLY_UPLOAD template without moving its columns.');
  const out:StandardRow[]=[]; const issues:string[]=[]; const seen=new Map<string,number>(); let inputRows=0;
  for(let i=9;i<rows.length;i++){
    const r=rows[i];const id=sku(r?.[0]);const qtyCell=clean(r?.[1]);const revenueCell=clean(r?.[2]);const product=clean(r?.[3]);
    if(!id&&!qtyCell&&!revenueCell&&!product)continue;
    inputRows++;
    if(!id){issues.push(`Row ${i+1}: missing account SKU ID`);continue;}
    if(id.length>200){issues.push(`Row ${i+1}: SKU ID exceeds 200 characters`);continue;}
    const qty=numeric(r?.[1]);
    if(qty===null||qty<0){issues.push(`Row ${i+1}: missing or invalid units sold`);continue;}
    const rev=numeric(r?.[2]);
    if(revenueCell&&(rev===null||rev<0)){issues.push(`Row ${i+1}: invalid revenue`);continue;}
    const previous=seen.get(id);
    if(previous!==undefined){issues.push(`Duplicate account SKU ${id} on rows ${previous} and ${i+1}; consolidate the quantities before approval`);continue;}
    seen.set(id,i+1);
    out.push({account_sku:id,product_name:product,sales_qty:qty,revenue:rev,source_sheet:sheet.name,source_row:i+1});
  }
  if(!inputRows)throw new Error('No sales rows found. Paste SKUs and quantities starting on row 10.');
  return {account:selectedAccount,month:selectedMonth,rows:out,inputRows,sourceSheets:[sheet.name],issues:issues.slice(0,100),duplicateCount:issues.filter(i=>i.startsWith('Duplicate')).length,revenueCoverage:out.filter(r=>r.revenue!==null).length};
}
