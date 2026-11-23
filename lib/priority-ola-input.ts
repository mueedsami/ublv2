import {cellText,loadWorkbook,normalizeHeader,type WorksheetData} from '@/lib/excel';

export type PrioritySku = {account:string;sku:string;productName:string};
export type PriorityUpload = {items:PrioritySku[];duplicates:number;ignoredRows:number;filename:string};

const ACCOUNTS:Record<string,string>={
  arogga:'arogga',cartup:'cartup',daraz:'daraz',othoba:'othoba',
  pandamart:'pandamart',panda:'pandamart','panda mart':'pandamart',
  shajgoj:'shajgoj',shwapno:'shwapno',
  beautybooth:'beauty_booth','beauty booth':'beauty_booth',
  ushop:'ushop','u shop':'ushop',foodi:'foodi',foodimart:'foodi',
};
const accountKey=(s:string)=>s.toLowerCase().trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const accountFor=(s:string)=>ACCOUNTS[accountKey(s)];
const tidy=(value:unknown)=>String(value??'').trim();
const COLS={
  account:['account name','account','retailer','retailer name','account code'],
  sku:['sku id','sku','account sku','account sku id','seller sku','product id'],
  name:['product name','sku name','product','item name'],
};
const findColumns=(headers:string[])=>{
 const normalized=headers.map(normalizeHeader);
 const find=(choices:string[])=>choices.map(c=>normalized.indexOf(normalizeHeader(c))).find(i=>i!==-1)??-1;
 return {account:find(COLS.account),sku:find(COLS.sku),name:find(COLS.name)};
};

export async function readPriorityWorkbook(buffer:Buffer,filename:string):Promise<PriorityUpload>{
 if(buffer.byteLength>6*1024*1024)throw new Error('Priority SKU workbook exceeds 6 MB. Upload a smaller file.');
 const wb=await loadWorkbook(buffer);
 let worksheet:WorksheetData|undefined,header=0,cols={account:-1,sku:-1,name:-1};
 for(const ws of wb.worksheets){
  for(let row=1;row<=Math.min(ws.rowCount,15);row++){
   const candidate=findColumns(Array.from({length:ws.columnCount},(_,c)=>cellText(ws,row,c+1)));
   if(candidate.account>=0&&candidate.sku>=0&&candidate.name>=0){worksheet=ws;header=row;cols=candidate;break;}
  }
  if(worksheet)break;
 }
 if(!worksheet)throw new Error('Excel must contain columns named Account Name, SKU ID and Product Name.');
 const items:PrioritySku[]=[],seen=new Set<string>();
 let ignoredRows=0,duplicates=0;
 for(let row=header+1;row<=worksheet.rowCount;row++){
  const rawAccount=tidy(cellText(worksheet,row,cols.account+1));
  const sku=tidy(cellText(worksheet,row,cols.sku+1));
  const productName=tidy(cellText(worksheet,row,cols.name+1));
  if(!rawAccount&&!sku&&!productName){ignoredRows++;continue;}
  if(!rawAccount||!sku)throw new Error(`Row ${row}: Account Name and SKU ID are required.`);
  const account=accountFor(rawAccount);
  if(!account)throw new Error(`Row ${row}: Unrecognized account “${rawAccount}”. Check the account spelling.`);
  const key=`${account}|${sku.toLowerCase()}`;
  if(seen.has(key)){duplicates++;continue;}
  if(items.length>=10000)throw new Error('Please limit each priority list to 10,000 unique account SKUs.');
  seen.add(key);items.push({account,sku,productName});
 }
 if(!items.length)throw new Error('No account SKUs found in the workbook.');
 return {items,duplicates,ignoredRows,filename:filename.slice(0,200)};
}
