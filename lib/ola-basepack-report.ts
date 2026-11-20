import type {XlsxCell} from '@/lib/xlsx-writer';

/** Full, auditable historical workbook matching the 2026-08 basepack-account OLA report. */
export type ReportSheet = {name: string; headers: string[]; rows: XlsxCell[][]; percentColumns?: number[]; freezeColumns?: number};
export type ReportObservation = {
  date: string; account: string; branch: string; sku: string; basepack: string;
  businessUnit: string; category: string; format: string; brand: string;
  productName: string; siteName: string; status: 'available' | 'unavailable' | 'unknown';
  price: number | null; stockQty: number | null; productUrl: string; sourceFile: string;
};
export type MappingIssue = {type: string; account: string; branch: string; sku: string; basepack: string; details: string};
const display: Record<string,string> = {shajgoj:'Shajgoj',othoba:'Othoba',arogga:'Arogga',shwapno:'Shwapno',
  pandamart:'Pandamart',daraz:'Daraz',cartup:'Cartup',beauty_booth:'BeautyBooth',ushop:'Ushop',foodi:'Foodi'};
const key = (s:string) => s.trim().toLocaleLowerCase('en');
const label = (s:string) => s.trim() || 'Unclassified';
const ratio = (numerator:number,denominator:number):number|null => denominator ? numerator/denominator : null;
const sortRows = (rows:XlsxCell[][]) => rows.sort((a,b)=>a.map(x=>String(x??'')).join('|').localeCompare(b.map(x=>String(x??'')).join('|')));
const sheet = (name:string,headers:string[],rows:XlsxCell[][],percentColumns:number[]=[],freezeColumns=1):ReportSheet =>
  ({name,headers,rows,percentColumns,freezeColumns});

type Daily = {
  date:string; account:string; branch:string; basepack:string; businessUnit:string; category:string; format:string; brand:string;
  skus:Map<string,ReportObservation>;
};
type Basepack = {account:string;branch:string;basepack:string;businessUnit:string;category:string;format:string;brand:string;
  values:Map<string,number|null>; skus:Set<string>};

export function buildBasepackWorkbook(input:ReportObservation[], issues:MappingIssue[], start:string, end:string):ReportSheet[] {
  const raw = new Map<string,Daily>();
  const latestEvidence = new Map<string,ReportObservation>();
  for(const o of input){
    const branch = o.account === 'pandamart' ? o.branch || 'All' : 'All';
    const eKey = [o.date,o.account,branch,o.sku].join('\u001f');
    // The loader supplies the latest per SKU/branch/day, but defend against duplicate records.
    latestEvidence.set(eKey,{...o,branch});
  }
  const evidence = [...latestEvidence.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.account.localeCompare(b.account)||a.branch.localeCompare(b.branch)||a.sku.localeCompare(b.sku));
  for(const o of evidence){
    if(!o.basepack) continue; // unmapped SKU retained in evidence and Mapping Health but not in OLA.
    const groupKey = [o.date,o.account,o.branch,key(o.basepack)].join('\u001f');
    let item = raw.get(groupKey);
    if(!item){item={date:o.date,account:o.account,branch:o.branch,basepack:o.basepack,businessUnit:label(o.businessUnit),
      category:label(o.category),format:label(o.format),brand:label(o.brand),skus:new Map()};raw.set(groupKey,item);}
    item.skus.set(o.sku,o);
  }
  const basepacks = new Map<string,Basepack>();
  const allDays = new Set<string>();
  const observed = new Map<string,{a:number;u:number;n:number}>();
  const missingValue = () => ({a:0,u:0,n:0});
  for(const day of raw.values()){
    allDays.add(day.date);
    const statuses = [...day.skus.values()].map(s=>s.status);
    // An available SKU makes its basepack available; all Unknown is genuinely Unknown.
    const status = statuses.includes('available') ? 1 : statuses.includes('unavailable') ? 0 : null;
    const bKey = [day.account,day.branch,key(day.basepack)].join('\u001f');
    let item=basepacks.get(bKey);
    if(!item){item={account:day.account,branch:day.branch,basepack:day.basepack,businessUnit:day.businessUnit,
      category:day.category,format:day.format,brand:day.brand,values:new Map(),skus:new Set()};basepacks.set(bKey,item);}
    item.values.set(day.date,status);
    for(const sku of day.skus.keys()) item.skus.add(sku);
    const dayKey=[day.account,day.branch,day.date].join('\u001f');
    const count=observed.get(dayKey) ?? missingValue();
    if(status === 1)count.a++;else if(status === 0)count.u++;else count.n++;
    observed.set(dayKey,count);
  }
  const dates=[...allDays].sort(),descDates=[...dates].reverse();
  const items=[...basepacks.values()].sort((a,b)=>a.account.localeCompare(b.account)||a.branch.localeCompare(b.branch)||a.businessUnit.localeCompare(b.businessUnit)||a.category.localeCompare(b.category)||a.brand.localeCompare(b.brand)||a.basepack.localeCompare(b.basepack));
  const avg = (b:Basepack) => {const vals=[...b.values.values()].filter((n):n is number=>n!==null);return ratio(vals.reduce((sum,x)=>sum+x,0),vals.length)};
  const accounts=[...new Set(items.map(i=>i.account))].sort((a,b)=>{
    const order=['shajgoj','othoba','arogga','pandamart','shwapno','daraz','cartup','beauty_booth','ushop','foodi'];
    return (order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b));
  });
  const summary = (parts:(b:Basepack)=>string[]) => {
    const sums = new Map<string,{fields:string[];a:number;d:number}>();
    for(const b of items){const v=avg(b);if(v===null)continue;
      const fields=parts(b),k=JSON.stringify(fields),s=sums.get(k)??{fields,a:0,d:0};s.a+=v;s.d++;sums.set(k,s);}
    return sortRows([...sums.values()].map(s=>[...s.fields,ratio(s.a,s.d)]));
  };
  const dashboards:XlsxCell[][]=[];
  const compare:XlsxCell[][]=[];
  const groups=[...new Set(items.map(i=>[i.account,i.branch].join('\u001f')))].sort();
  const latestByGroup = new Map<string,string>();
  for(const g of groups){const day=dates.filter(d=>observed.has(`${g}\u001f${d}`)).at(-1);if(day)latestByGroup.set(g,day);}
  for(const groupKey of groups){
    const [account,branch]=groupKey.split('\u001f');
    const countDays=dates.filter(date=>observed.has([account,branch,date].join('\u001f')));
    const latest=latestByGroup.get(groupKey)??'';
    const curr=observed.get([account,branch,latest].join('\u001f'))??missingValue();
    const percentage=ratio(curr.a,curr.a+curr.u);
    const daily=countDays.map(date=>{
      const row=observed.get([account,branch,date].join('\u001f'))!;
      return ratio(row.a,row.a+row.u);
    }).filter((n):n is number=>n!==null);
    dashboards.push([display[account]??account,branch,latest,curr.a+curr.u+curr.n,curr.a,curr.u,curr.n,percentage,countDays.length,ratio(daily.reduce((s,x)=>s+x,0),daily.length)]);
    compare.push([display[account]??account,branch,...dates.map(date=>{
      const count=observed.get([account,branch,date].join('\u001f'));
      return count?ratio(count.a,count.a+count.u):null;
    }),ratio(daily.reduce((s,x)=>s+x,0),daily.length)]);
  }
  const result:ReportSheet[]=[
    sheet('Dashboard',['Account','Branch','Latest Date','Active Basepacks','Available','OOS','Unknown','Latest OLA %','Observed Days','Average Daily OLA %'],dashboards,[7,9],2),
    sheet('OLA Comparison',['Account','Branch',...dates,'Average'],compare,Array.from({length:dates.length+1},(_,i)=>i+2),2),
    sheet('Overall Summary',['Account','BUSINESS UNIT','Category','Format','Brand','Average'],summary(b=>[display[b.account]??b.account,b.businessUnit,b.category,b.format,b.brand]),[5],5),
    sheet('Business Unit Wise',['Account','Branch','BUSINESS UNIT','Average'],summary(b=>[display[b.account]??b.account,b.branch,b.businessUnit]),[3],3),
    sheet('Brand Wise',['Account','Branch','Brand','Average'],summary(b=>[display[b.account]??b.account,b.branch,b.brand]),[3],3),
  ];
  for(const account of accounts){
    const name=display[account]??account;
    const selection=items.filter(i=>i.account===account);
    const dataRows=(arr:Basepack[])=>arr.map(b=>[
      b.basepack,b.businessUnit,b.category,b.format,b.brand,b.branch,'', // Short Stock requires a separate business threshold, not supplied by OLA.
      b.values.get(latestByGroup.get(`${b.account}\u001f${b.branch}`)??'')??null,
      ...descDates.map(date=>b.values.has(date)?b.values.get(date)??null:null),
    ] as XlsxCell[]);
    const rawHeaders=['Basepack','BUSINESS UNIT','Category','Format','Brand','Branch','Short Stock','Latest OLA',...descDates];
    result.push(sheet(`${name} Raw`,rawHeaders,dataRows(selection),[],6));
    result.push(sheet(`${name} - Format Wise`,['Account','Branch','Format','Brand','Average'],summary(b=>b.account===account?[name,b.branch,b.format,b.brand]:[]).filter(r=>r.length===5),[4],4));
    result.push(sheet(`${name} - Category Wise`,['Account','Branch','Category','Brand','Average'],summary(b=>b.account===account?[name,b.branch,b.category,b.brand]:[]).filter(r=>r.length===5),[4],4));
    const oos = selection.filter(b=>{
      const last = latestByGroup.get(`${b.account}\u001f${b.branch}`);return last && b.values.get(last)===0;
    }).map(b=>{
      const last=latestByGroup.get(`${b.account}\u001f${b.branch}`)!;
      return [b.basepack,b.businessUnit,b.category,b.format,b.brand,b.branch,0,avg(b),b.skus.size,[...b.skus].sort().join(', '),'No SKU under this basepack available',last];
    });
    result.push(sheet(`NOLA ${name}`,['Basepack','BUSINESS UNIT','Category','Format','Brand','Branch','Latest OLA','OLA %','Total Active Listings','All Account SKUs','Basepack Status','Observation Date'],oos,[7],6));
    if(account==='pandamart'){
      const branches=[...new Set(selection.map(b=>b.branch))].sort();
      for(const branch of branches)result.push(sheet(`PM - ${branch}`,rawHeaders,dataRows(selection.filter(b=>b.branch===branch)),[],6));
    }
  }
  const reportIssues=[...issues];
  // Multiple account SKUs mapping to one basepack is allowed; report it for auditing.
  for(const b of items)if(b.skus.size>1)reportIssues.push({type:'Multiple SKUs under same Basepack',account:b.account,branch:b.branch,
    sku:[...b.skus].sort().join(', '),basepack:b.basepack,details:'Allowed. Basepack OLA = 1 if any mapped SKU in this branch is Available.'});
  result.push(sheet('Mapping Health',['Issue Type','Account','Branch','Account SKU','Basepack','Details'],
    reportIssues.sort((a,b)=>a.type.localeCompare(b.type)||a.account.localeCompare(b.account)||a.sku.localeCompare(b.sku))
      .map(e=>[e.type,display[e.account]??e.account,e.branch,e.sku,e.basepack,e.details]),[],2));
  result.push(sheet('SKU Evidence', ['Date','Account','Branch','Basepack','BUSINESS UNIT','Category','Format','Brand','Account SKU','Account Product Name',
    'Site Product Name','OLA','Price','Stock Qty','Status','Product URL','Source File','Source Sheet','__match_key','__branch_key','Source Branch Tab','Source SKU List','__branch_key__sku'],
    evidence.map(e=>[e.date,display[e.account]??e.account,e.branch,e.basepack,e.businessUnit,e.category,e.format,e.brand,e.sku,
      e.productName,e.siteName,e.status==='available'?1:e.status==='unavailable'?0:null,e.price,e.stockQty,
      e.status==='available'?'In Stock':e.status==='unavailable'?'Out of Stock':'Unknown',e.productUrl,e.sourceFile,'',e.sku,e.branch,
      e.account==='pandamart'?e.branch:'','',`${e.branch}|${e.sku}`]),[],9));
  result.push(sheet('Methodology',['Rule','Detail'],[
    ['Report period',`${start} through ${end} (Asia/Dhaka run calendar dates; no carry-forward for missing dates)`],
    ['Data source','Read-only v_ola_scraped_run_metrics, ola_scrape_observations, v_account_mappings, v_master_skus, ola_scrape_runs'],
    ['Run selection','Latest success per account/day; latest partial only when no success exists'],
    ['Account SKU deduplication','One latest observation per account / SKU / branch / run-date'],
    ['Basepack rule','Available if ANY mapped account SKU is Available; OOS only if no Available SKU and at least one OOS; otherwise Unknown'],
    ['Daily OLA','Available basepacks / (Available + OOS basepacks) per account and branch; Unknown excluded'],
    ['Average Daily OLA','Arithmetic average of valid observed daily OLA percentages; missing days excluded'],
    ['Summary Average','Arithmetic mean of per-basepack availability rate over its observed, known-status days'],
    ['PandaMart','Branches remain distinct; no combining stores into a single SKU observation'],
    ['Short Stock','Blank because no short-stock threshold is supplied by scraped OLA data'],
    ['SKU Evidence','Current account-to-master mapping is applied to historical scraped observations; mapping may have changed over time'],
    ['Partial runs','Included only when no successful run exists for the account/date; may have incomplete catalog coverage'],
    ['Unknown/missing mapping','Unknown is not OOS. Unmapped and conflicting SKU mappings are excluded from OLA and flagged in Mapping Health'],
    ['Unavailable fields','Source Sheet, Source SKU List and Source Branch Tab may be blank when source evidence is not stored in Supabase'],
  ]));
  return result;
}
