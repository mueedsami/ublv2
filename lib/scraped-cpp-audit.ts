/** CPP cross-check over DAILY OLA scrape observations. Pure function. Never writes to Supabase. */
export type RawRow = Record<string, unknown>;
export type AuditStatus = 'violation'|'within_tolerance'|'compliant'|'reference_expired'|'reference_future'|'ambiguous_cpp'|'invalid_reference'|'not_scraped'|'missing_price'|'unavailable'|'unknown_stock'|'stale';
export type AuditRow = {
  id: string; account: string; accountCode: string; accountSku: string; branch: string;
  productName: string; ublCode: string; basepack: string; brand: string; category: string;
  expectedPrice: number|null; scrapedPrice: number|null; allowedPrice: number|null;
  difference: number|null; deviationPct: number|null; tolerancePct: number;
  status: AuditStatus; checkedAt: string|null; productUrl: string|null;
  referenceFrom: string|null; referenceTo: string|null; referenceFile: string;
  mappingNote: string;
};
export type AccountAudit = {
  code:string; name:string; referenceFile:string; referenceFrom:string|null; referenceTo:string|null;
  targetSkus:number; checked:number; violations:number; withinTolerance:number; compliant:number;
  exceptions:number; latestScrape:string|null;
};
export type AuditData = {
  source: 'ola_scrape_observations.price + cpp_targets.expected_price';
  asOf: string; reportDate: string; freshnessHours: number;
  summary: {cppAccounts:number; cppSkus:number; evaluated:number; violations:number; withinTolerance:number;
    compliant:number; exceptions:number; excludedScrapeSkus:number; ambiguousCppSkus:number; cppRowsWithoutSku:number;};
  accounts: AccountAudit[]; rows: AuditRow[];
};

const str = (value:unknown):string => String(value??'').trim();
const normalize = (value:unknown):string => str(value).toLowerCase();
const moneyNumber = (value:unknown):number|null => {
  if(value==null||str(value)==='')return null;
  const n=Number(value);return Number.isFinite(n)&&n>0?n:null;
};
const dateMs=(v:unknown):number=>{const ms=Date.parse(str(v));return Number.isFinite(ms)?ms:0;};
// Always apply reference effective dates using the business-local date, not the build host's UTC day.
const dhakaDay=(time:string):string=>{
  const ms=dateMs(time);if(!ms)return '';
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
  const value=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const nround=(x:number):number=>Math.round((x+Number.EPSILON)*100)/100;
const statusFor=(o:RawRow|undefined, expected:number|null,tol:number,refFrom:string,refTo:string,nowMs:number,freshnessHours:number,ambiguous:boolean):AuditStatus=>{
  const scrapeDate=o?dhakaDay(str(o.observed_at)):dhakaDay(new Date(nowMs).toISOString());
  if(refFrom && scrapeDate && scrapeDate<refFrom)return 'reference_future';
  if(refTo && scrapeDate && scrapeDate>refTo)return 'reference_expired';
  if(ambiguous)return 'ambiguous_cpp';
  if(expected===null)return 'invalid_reference';
  if(!o)return 'not_scraped';
  if(o.availability===false)return 'unavailable';
  if(o.availability!==true)return 'unknown_stock';
  const price=moneyNumber(o.price);
  if(price===null)return 'missing_price';
  const observedMs=dateMs(o.observed_at);
  if(!observedMs || nowMs-observedMs>freshnessHours*3600000 || observedMs>nowMs+3600000)return 'stale';
  if(price<=expected+0.000001)return 'compliant';
  return price<=expected*(1+tol)+0.000001?'within_tolerance':'violation';
};

/** Input is deliberately already limited to live CPP references and their active targets. */
export function buildScrapedCppAudit(input:{
  accounts:RawRow[]; references:RawRow[]; targets:RawRow[]; observations:RawRow[];
  products:RawRow[]; mappings:RawRow[]; basepacks:RawRow[];
  nowISO?:string; freshnessHours?:number;
}):AuditData{
  const nowISO=input.nowISO||new Date().toISOString();const nowMs=dateMs(nowISO);
  const freshnessHours=input.freshnessHours??72;
  const accountsById=new Map(input.accounts.map(a=>[str(a.id),{code:normalize(a.code),name:str(a.name)||str(a.code)}]));
  const referencesById=new Map(input.references.map(r=>[str(r.id),r]));
  const productsById=new Map(input.products.map(p=>[str(p.id),p]));
  const packById=new Map(input.basepacks.map(b=>[str(b.id),str(b.packsize)]));
  const perMaster=new Map<string,Set<string>>();
  for(const m of input.mappings){const a=accountsById.get(str(m.account_id));if(!a||!str(m.account_sku))continue;
    const key=`${a.code}|${normalize(m.account_sku)}`;const ps=perMaster.get(key)||new Set<string>();
    if(productsById.has(str(m.product_id)))ps.add(str(m.product_id));perMaster.set(key,ps);
  }
  // One live reference per account. If more than one is live, prefer the newest uploaded reference.
  const referenceForAccount=new Map<string,RawRow>();
  for(const r of [...input.references].sort((a,b)=>dateMs(b.uploaded_at)-dateMs(a.uploaded_at))){
    const key=str(r.account_id);if(!referenceForAccount.has(key))referenceForAccount.set(key,r);
  }
  const cppByKey=new Map<string,RawRow[]>();
  let cppRowsWithoutSku=0;
  for(const t of input.targets){const acc=accountsById.get(str(t.account_id));const ref=referencesById.get(str(t.reference_set_id));
    if(!acc||!ref||str(ref.account_id)!==str(t.account_id)||str(referenceForAccount.get(str(t.account_id))?.id)!==str(ref.id)||t.active!==true)continue;
    const sku=normalize(t.account_sku);if(!sku){cppRowsWithoutSku++;continue;}
    const key=`${acc.code}|${sku}`;cppByKey.set(key,[...(cppByKey.get(key)||[]),t]);
  }
  const observationByKey=new Map<string,RawRow>();const distinctScrapePairs=new Set<string>();
  for(const o of input.observations){const acc=normalize(o.account_code),sku=normalize(o.account_sku),branch=str(o.branch)||'All';
    if(!acc||!sku)continue;
    distinctScrapePairs.add(`${acc}|${sku}`);
    const key=`${acc}|${sku}|${normalize(branch)}`,prev=observationByKey.get(key);
    const ts=dateMs(o.observed_at),prevTs=prev?dateMs(prev.observed_at):0;
    if(!prev||ts>prevTs||ts===prevTs&&Number(o.id||0)>Number(prev.id||0))observationByKey.set(key,o);
  }
  const obsForSku=new Map<string,RawRow[]>();
  for(const [key,o] of observationByKey){const parts=key.split('|');const pair=`${parts[0]}|${parts[1]}`;
    const list=obsForSku.get(pair)||[];list.push(o);obsForSku.set(pair,list);
  }
  const rows:AuditRow[]=[];
  for(const [key,targets] of cppByKey){
    const t=targets[0],acc=accountsById.get(str(t.account_id));if(!acc)continue;
    const ref=referenceForAccount.get(str(t.account_id));if(!ref)continue;
    const sku=str(t.account_sku),referenceFile=str(ref.source_file_name);
    const price=moneyNumber(t.expected_price);
    const tolRaw=Number(t.tolerance_pct??ref.default_tolerance_pct??0);
    const tol=Number.isFinite(tolRaw)&&tolRaw>=0&&tolRaw<=1?tolRaw:0;
    const contradictory=targets.some(x=>{
      const xTol=Number(x.tolerance_pct??ref.default_tolerance_pct??0);
      return moneyNumber(x.expected_price)!==price || Math.abs(xTol-tol)>0.0000001;
    });
    const masterIds=[...(perMaster.get(key)||new Set<string>())];
    const uniqueMaster=masterIds.length===1?productsById.get(masterIds[0]):undefined;
    const sourceProduct=productsById.get(str(t.product_id));
    const product=uniqueMaster || (masterIds.length===0?sourceProduct:undefined);
    const bpId=str(product?.basepack_id)||str(t.basepack_id);
    const branchObservations=obsForSku.get(key)||[undefined];
    const mappingNote=masterIds.length>1?'Ambiguous master SKU mapping':!product?'Not mapped to master product':'';
    for(const o of branchObservations){
      const observedPrice=o?moneyNumber(o.price):null;
      const stat=statusFor(o,price,tol,str(ref.effective_from),str(ref.effective_to),nowMs,freshnessHours,contradictory);
      const diff=price!==null&&observedPrice!==null?nround(observedPrice-price):null;
      const deviation=price!==null&&observedPrice!==null?(observedPrice-price)/price*100:null;
      const branch=o?str(o.branch)||'All':'All';
      rows.push({id:`${key}|${normalize(branch)}`,account:acc.name,accountCode:acc.code,accountSku:sku,branch,
        productName:str(product?.name)||str(t.product_name)||sku,ublCode:str(product?.ubl_code),
        basepack:packById.get(bpId)||str(t.source_packsize)||'Unmapped basepack',
        brand:str(product?.brand)||str(t.brand),category:str(product?.category)||str(t.category),
        expectedPrice:price,scrapedPrice:observedPrice,allowedPrice:price!==null?nround(price*(1+tol)):null,
        difference:diff,deviationPct:deviation,tolerancePct:tol*100,status:stat,
        checkedAt:o?str(o.observed_at):null,productUrl:o?str(o.product_url)||null:null,
        referenceFrom:str(ref.effective_from)||null,referenceTo:str(ref.effective_to)||null,referenceFile,mappingNote});
    }
  }
  const order:Record<AuditStatus,number>={violation:0,within_tolerance:1,ambiguous_cpp:2,reference_expired:3,
    reference_future:4,invalid_reference:5,stale:6,missing_price:7,unavailable:8,unknown_stock:9,not_scraped:10,compliant:11};
  rows.sort((a,b)=>order[a.status]-order[b.status]||a.account.localeCompare(b.account)||a.productName.localeCompare(b.productName)||a.branch.localeCompare(b.branch));
  const evaluated=rows.filter(r=>['compliant','within_tolerance','violation'].includes(r.status));
  const refs=[...referenceForAccount.values()];
  const accounts:AccountAudit[]=refs.map(r=>{
    const a=accountsById.get(str(r.account_id));const code=a?.code||'';const mine=rows.filter(x=>x.accountCode===code);
    const dates=mine.map(x=>x.checkedAt).filter((x):x is string=>!!x).sort();
    return {code,name:a?.name||code,referenceFile:str(r.source_file_name),referenceFrom:str(r.effective_from)||null,referenceTo:str(r.effective_to)||null,
      targetSkus:[...cppByKey.keys()].filter(x=>x.startsWith(`${code}|`)).length,
      checked:mine.filter(x=>['compliant','within_tolerance','violation'].includes(x.status)).length,
      violations:mine.filter(x=>x.status==='violation').length,
      withinTolerance:mine.filter(x=>x.status==='within_tolerance').length,
      compliant:mine.filter(x=>x.status==='compliant').length,
      exceptions:mine.filter(x=>!['compliant','within_tolerance','violation'].includes(x.status)).length,
      latestScrape:dates.at(-1)||null};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  return {source:'ola_scrape_observations.price + cpp_targets.expected_price',asOf:nowISO,reportDate:dhakaDay(nowISO),freshnessHours,
    summary:{cppAccounts:accounts.length,cppSkus:cppByKey.size,evaluated:evaluated.length,cppRowsWithoutSku,
      violations:evaluated.filter(r=>r.status==='violation').length,withinTolerance:evaluated.filter(r=>r.status==='within_tolerance').length,
      compliant:evaluated.filter(r=>r.status==='compliant').length,exceptions:rows.length-evaluated.length,
      excludedScrapeSkus:[...distinctScrapePairs].filter(k=>!cppByKey.has(k)).length,
      ambiguousCppSkus:[...cppByKey.values()].filter(ts=>ts.some(t=>moneyNumber(t.expected_price)!==moneyNumber(ts[0].expected_price)||Number(t.tolerance_pct??0)!==Number(ts[0].tolerance_pct??0))).length},
    accounts,rows};
}
