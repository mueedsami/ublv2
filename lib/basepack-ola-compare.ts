import type {ReportObservation, ReportSheet} from '@/lib/ola-basepack-report';
import type {PrioritySku} from '@/lib/priority-ola-input';

export type OlaCounts={available:number;oos:number;unknown:number;valid:number;ola:number|null};
export type SummaryRow={account:string;branch?:string;asOf:string;prioritySkus:number;
  fullMtd:OlaCounts;priorityMtd:OlaCounts;fullLatest:OlaCounts;priorityLatest:OlaCounts;
  gapMtd:number|null;gapLatest:number|null};
export type DailyRow={date:string;account:string;branch:string;full:OlaCounts;priority:OlaCounts;gap:number|null};
export type BasepackRow={account:string;branch:string;date:string;basepack:string;businessUnit:string;category:string;brand:string;format:string;
  fullStatus:string;priorityStatus:string;fullSkus:string;prioritySkus:string;difference:string};
export type DimRow={group:string;full:OlaCounts;priority:OlaCounts;gap:number|null};
export type BasepackComparison={overall:{full:OlaCounts;priority:OlaCounts;gap:number|null};accounts:SummaryRow[];
  branches:SummaryRow[];daily:DailyRow[];basepacks:BasepackRow[];
  dimensions:{businessUnit:DimRow[];category:DimRow[];brand:DimRow[];format:DimRow[]};sheets:ReportSheet[]};

type Cell={date:string;account:string;branch:string;basepack:string;businessUnit:string;category:string;brand:string;format:string;statuses:Map<string,ReportObservation['status']>};
const clean=(v:string)=>v.trim();
const norm=(v:string)=>clean(v).toLocaleLowerCase('en');
const empty=():OlaCounts=>({available:0,oos:0,unknown:0,valid:0,ola:null});
const summarize=(statuses:(0|1|null)[]):OlaCounts=>{
 const c=empty();for(const status of statuses){if(status===1)c.available++;else if(status===0)c.oos++;else c.unknown++;}
 c.valid=c.available+c.oos;c.ola=c.valid?c.available/c.valid:null;return c;
};
const merge=(counts:OlaCounts[]):OlaCounts=>{
 const a=empty();for(const c of counts){a.available+=c.available;a.oos+=c.oos;a.unknown+=c.unknown;}
 a.valid=a.available+a.oos;a.ola=a.valid?a.available/a.valid:null;return a;
};
const gap=(priority:number|null,full:number|null)=>priority!==null&&full!==null?priority-full:null;
const percentagePoints=(value:number|null)=>value===null?null:Math.round(value*10000)/100;
const statusOf=(cell:Cell|undefined):0|1|null|undefined=>{
 if(!cell)return undefined;
 const s=[...cell.statuses.values()];
 return s.includes('available')?1:s.includes('unavailable')?0:null;
};
const statusName=(v:0|1|null|undefined)=>v===1?'In Stock':v===0?'Out of Stock':v===null?'Unknown':'Not Observed';
const sheet=(name:string,headers:string[],rows:(string|number|null)[][],percentColumns:number[]=[],freezeColumns=1):ReportSheet=>({name,headers,rows,percentColumns,freezeColumns});
const p=(c:OlaCounts)=>([c.available,c.oos,c.unknown,c.valid,c.ola] as (number|null)[]);
const accName=(s:string)=>({arogga:'Arogga',cartup:'Cartup',daraz:'Daraz',othoba:'Othoba',pandamart:'PandaMart',shajgoj:'Shajgoj',shwapno:'Shwapno'} as Record<string,string>)[s]??s;

/** Pure, read-only calculations: both portfolio and priority use the same mapped SKU-to-basepack evidence. */
export function buildBasepackComparison(evidence:ReportObservation[],priorityRows:PrioritySku[],start:string,end:string,priorityAudit?:ReportSheet):BasepackComparison{
 const selected=new Set(priorityRows.map(r=>`${norm(r.account)}|${norm(r.sku)}`));
 const priCount=new Map<string,number>();for(const r of priorityRows)priCount.set(norm(r.account),(priCount.get(norm(r.account))??0)+1);
 const full=new Map<string,Cell>();const priority=new Map<string,Cell>();
 const append=(map:Map<string,Cell>,e:ReportObservation)=>{
  if(!clean(e.basepack))return;
  const account=norm(e.account),branch=account==='pandamart'?(clean(e.branch)||'All'):'All',basepack=clean(e.basepack);
  const key=[e.date,account,norm(branch),norm(basepack)].join('\u001f');
  let cell=map.get(key);
  if(!cell){cell={date:e.date,account,branch,basepack,businessUnit:e.businessUnit||'Unclassified',category:e.category||'Unclassified',
   brand:e.brand||'Unclassified',format:e.format||'Unclassified',statuses:new Map()};map.set(key,cell);}
  cell.statuses.set(norm(e.sku),e.status);
 };
 for(const e of evidence){append(full,e);if(selected.has(`${norm(e.account)}|${norm(e.sku)}`))append(priority,e);}
 type Group={account:string;branch:string;date:string;fullStatuses:(0|1|null)[];priorityStatuses:(0|1|null)[]};
 const byDay=new Map<string,Group>();
 for(const [key,cell] of full){
  const dkey=[cell.account,cell.branch,cell.date].join('\u001f');
  const group=byDay.get(dkey)??{date:cell.date,account:cell.account,branch:cell.branch,fullStatuses:[],priorityStatuses:[]};
  group.fullStatuses.push(statusOf(cell)!);byDay.set(dkey,group);
 }
 for(const cell of priority.values()){
  const dkey=[cell.account,cell.branch,cell.date].join('\u001f');
  const group=byDay.get(dkey)??{date:cell.date,account:cell.account,branch:cell.branch,fullStatuses:[],priorityStatuses:[]};
  group.priorityStatuses.push(statusOf(cell)!);byDay.set(dkey,group);
 }
 const daily:DailyRow[]=[...byDay.values()].map(g=>{
  const a=summarize(g.fullStatuses),b=summarize(g.priorityStatuses);
  return {account:g.account,branch:g.branch,date:g.date,full:a,priority:b,gap:gap(b.ola,a.ola)};
 }).sort((a,b)=>a.account.localeCompare(b.account)||a.branch.localeCompare(b.branch)||a.date.localeCompare(b.date));
 const branchGroups=new Map<string,DailyRow[]>();
 for(const d of daily){const k=[d.account,d.branch].join('\u001f');const rows=branchGroups.get(k)??[];rows.push(d);branchGroups.set(k,rows);}
 const branches:SummaryRow[]=[...branchGroups.entries()].map(([k,rows])=>{
  const [account,branch]=k.split('\u001f'),last=rows.at(-1)!;
  const fm=merge(rows.map(x=>x.full)),pm=merge(rows.map(x=>x.priority));
  return {account,branch,asOf:last.date,prioritySkus:priCount.get(account)??0,fullMtd:fm,priorityMtd:pm,
   fullLatest:last.full,priorityLatest:last.priority,gapMtd:gap(pm.ola,fm.ola),gapLatest:last.gap};
 }).sort((a,b)=>a.account.localeCompare(b.account)||String(a.branch).localeCompare(String(b.branch)));
 const accountCodes=[...new Set([...priCount.keys(),...branches.map(x=>x.account)])].sort();
 const accounts:SummaryRow[]=accountCodes.map(account=>{
  const bs=branches.filter(x=>x.account===account),fm=merge(bs.map(x=>x.fullMtd)),pm=merge(bs.map(x=>x.priorityMtd));
  const fl=merge(bs.map(x=>x.fullLatest)),pl=merge(bs.map(x=>x.priorityLatest));
  return {account,asOf:bs.map(b=>b.asOf).sort().at(-1)??'',prioritySkus:priCount.get(account)??0,
   fullMtd:fm,priorityMtd:pm,fullLatest:fl,priorityLatest:pl,gapMtd:gap(pm.ola,fm.ola),gapLatest:gap(pl.ola,fl.ola)};
 });
 const globalFull=merge(daily.map(x=>x.full)),globalPriority=merge(daily.map(x=>x.priority));
 const dates=new Map<string,string>();for(const b of branches)dates.set(`${b.account}\u001f${b.branch}`,b.asOf);
 const latestKeys=[...full.entries()].filter(([,v])=>dates.get(`${v.account}\u001f${v.branch}`)===v.date).map(([key])=>key);
 const basepacks:BasepackRow[]=latestKeys.map(k=>{
  const a=full.get(k)!;const b=priority.get(k);const fa=statusOf(a),pa=statusOf(b);
  let difference='';
  if(b){if(fa===1&&pa===0)difference='Portfolio IS / Priority OOS';
   else if(fa===1&&pa===null)difference='Priority Unknown';
   else if(fa!==pa)difference='Different status';
   else difference='Aligned';}
  else difference='Not in observed priority scope';
  return {account:a.account,branch:a.branch,date:a.date,basepack:a.basepack,businessUnit:a.businessUnit,category:a.category,brand:a.brand,format:a.format,
   fullStatus:statusName(fa),priorityStatus:statusName(pa),fullSkus:[...a.statuses.keys()].sort().join(', '),prioritySkus:b?[...b.statuses.keys()].sort().join(', '):'',difference};
 }).sort((a,b)=>a.account.localeCompare(b.account)||a.branch.localeCompare(b.branch)||a.basepack.localeCompare(b.basepack));
 const makeDim=(field:keyof Pick<Cell,'businessUnit'|'category'|'brand'|'format'>):DimRow[]=>{
  const map=new Map<string,{f:(0|1|null)[];r:(0|1|null)[]}>();
  for(const [k,c] of full){const key=c[field]||'Unclassified',obj=map.get(key)??{f:[],r:[]};obj.f.push(statusOf(c)!);
   const pv=priority.get(k);if(pv)obj.r.push(statusOf(pv)!);map.set(key,obj);}
  return [...map.entries()].map(([group,v])=>{const f=summarize(v.f),r=summarize(v.r);return {group,full:f,priority:r,gap:gap(r.ola,f.ola)};}).sort((a,b)=>a.group.localeCompare(b.group));
 };
 const dimensions={businessUnit:makeDim('businessUnit'),category:makeDim('category'),brand:makeDim('brand'),format:makeDim('format')};
 const accountRows=accounts.map(x=>[accName(x.account),x.prioritySkus,x.asOf,...p(x.fullMtd),...p(x.priorityMtd),percentagePoints(x.gapMtd),
  ...p(x.fullLatest),...p(x.priorityLatest),percentagePoints(x.gapLatest)]);
 const branchRows=branches.map(x=>[accName(x.account),x.branch??'',x.asOf,...p(x.fullMtd),...p(x.priorityMtd),percentagePoints(x.gapMtd),
  ...p(x.fullLatest),...p(x.priorityLatest),percentagePoints(x.gapLatest)]);
 const countHeaders=['IS','OOS','Unknown','Valid Cells','OLA %'];
 const dimensionSheets=(name:string,rows:DimRow[])=>sheet(name,['Group',...countHeaders.map(x=>`Full ${x}`),...countHeaders.map(x=>`Priority ${x}`),'Gap (pp)'],
  rows.map(x=>[x.group,...p(x.full),...p(x.priority),percentagePoints(x.gap)]),[5,10]);
 const reportSheets:ReportSheet[]=[
  sheet('Executive Summary',['Metric','Full Portfolio','Priority Basepacks','Definition'],[
   ['MTD Weighted Basepack OLA',globalFull.ola===null?'—':`${(globalFull.ola*100).toFixed(2)}%`,globalPriority.ola===null?'—':`${(globalPriority.ola*100).toFixed(2)}%`,'Valid observed basepack × account × branch × date cells; Unknown excluded'],
   ['Available Basepack-Day Cells',globalFull.available,globalPriority.available,'Count of observed basepack-day availability'],
   ['OOS Basepack-Day Cells',globalFull.oos,globalPriority.oos,'Count of observed basepack-day out-of-stock'],
   ['Unknown Basepack-Day Cells',globalFull.unknown,globalPriority.unknown,'Excluded from OLA denominator'],
   ['Priority Account SKUs',null,priorityRows.length,'Unique Account + SKU pairs uploaded'],
   ['Period',start,end,'Date range, inclusive'],
  ]),
  sheet('Account Comparison',['Account','Priority SKUs','Latest Date',...countHeaders.map(x=>`Full MTD ${x}`),...countHeaders.map(x=>`Priority MTD ${x}`),'MTD Gap (pp)',
   ...countHeaders.map(x=>`Full Latest ${x}`),...countHeaders.map(x=>`Priority Latest ${x}`),'Latest Gap (pp)'],accountRows,[7,12,18,23],1),
  sheet('Branch Comparison',['Account','Branch','Latest Date',...countHeaders.map(x=>`Full MTD ${x}`),...countHeaders.map(x=>`Priority MTD ${x}`),'MTD Gap (pp)',
   ...countHeaders.map(x=>`Full Latest ${x}`),...countHeaders.map(x=>`Priority Latest ${x}`),'Latest Gap (pp)'],branchRows,[7,12,18,23],2),
  sheet('Daily Comparison',['Date','Account','Branch',...countHeaders.map(x=>`Full ${x}`),...countHeaders.map(x=>`Priority ${x}`),'Gap (pp)'],
   daily.map(x=>[x.date,accName(x.account),x.branch,...p(x.full),...p(x.priority),percentagePoints(x.gap)]),[7,12],3),
  dimensionSheets('Business Unit',dimensions.businessUnit),dimensionSheets('Category',dimensions.category),
  dimensionSheets('Brand',dimensions.brand),dimensionSheets('Format',dimensions.format),
  sheet('Latest Basepack Check',['Account','Branch','Date','Basepack','BU','Category','Brand','Format','Full Status','Priority Status','Full Account SKUs','Priority Account SKUs','Difference'],
   basepacks.map(b=>[accName(b.account),b.branch,b.date,b.basepack,b.businessUnit,b.category,b.brand,b.format,b.fullStatus,b.priorityStatus,b.fullSkus,b.prioritySkus,b.difference]),[],4),
 ];
 if(priorityAudit)reportSheets.push({...priorityAudit,name:'Priority SKU Audit'});
 reportSheets.push(sheet('Methodology',['Rule','Detail'],[
  ['Report Dates',`${start} through ${end}, Asia/Dhaka; no carry-forward into unobserved dates`],
  ['Full portfolio','All currently mapped account SKUs with valid basepack identifiers, independently grouped by account, branch, basepack and date'],
  ['Priority portfolio','Only uploaded Account Name + SKU ID pairs, mapped to master basepacks. Non-priority SKU availability is excluded from priority OLA'],
  ['In Stock basepack','At least one included mapped SKU is In Stock'],
  ['Out of Stock basepack','No included SKU is In Stock and at least one included mapped SKU is Out of Stock'],
  ['Unknown','No known-status evidence; excluded from OLA numerator and denominator'],
  ['Missing day','No observations means no basepack-day cell; not counted as OOS'],
  ['MTD Weighted OLA','SUM(In Stock basepack-day cells) / SUM(In Stock + Out of Stock basepack-day cells) across chosen days'],
  ['Latest','For each account/branch use its latest observed day within the date range; full and priority use that SAME day'],
  ['Gap','Priority OLA minus Full OLA; negative percentage-point difference indicates weaker priority availability'],
  ['PandaMart','One branch is a separate basepack observation unit; results are weighted across observed branch/day cells'],
  ['Mapping','Historical OLA is joined to current active product-to-basepack mappings; past mappings may differ'],
  ['Data access','Read-only Supabase queries; uploaded file processed in memory and never saved to the database'],
 ]));
 return {overall:{full:globalFull,priority:globalPriority,gap:gap(globalPriority.ola,globalFull.ola)},accounts,branches,daily,basepacks,dimensions,sheets:reportSheets};
}
