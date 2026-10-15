'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ACCOUNTS } from '@/lib/accounts';
import { CheckCircle2, DollarSign, FileSpreadsheet, UploadCloud } from 'lucide-react';

type MasterPreview = {
  sheetName: string;
  rowCount: number;
  basepackCount: number;
  activeCount: number;
  inactiveCount: number;
  mappingCount: number;
  duplicateAccountIds: number;
  accountCounts: Record<string, number>;
};


type CppPreview = {
  valid: boolean;
  account: { id: string; code: string; name: string };
  fileName: string;
  profileName: string;
  profileNote: string;
  detectedSheets: string[];
  effectiveFrom: string;
  effectiveTo: string;
  tolerancePct: number;
  sourceRows: number;
  targets: number;
  scrapableTargets: number;
  mappedToMaster: number;
  unmappedRows: number;
  nonScrapableRows: number;
  fuzzyMatches: number;
  warnings: string[];
  sample: Array<{
    sourceIdentifier: string;
    accountSku: string;
    productName: string;
    sourcePacksize: string;
    expectedPrice: number;
    mrp: number | string;
    supportAmount: number | string;
    mappingStatus: string;
    matchScore: number | string;
    scrapable: boolean;
  }>;
};

type InspectedSheet = {
  name: string;
  headerRow: number;
  columns: string[];
  suggestedSkuColumn: string | null;
  suggestedStockColumns: string[];
  sampleRows: Record<string, string | number | null>[];
  suggestedSnapshotDate: string | null;
  locked: boolean;
  profileName: string | null;
  note: string | null;
  excludedColumns: string[];
  excludedUnits: number;
};

type StockPreview = {
  snapshotDate: string;
  inputRows: number;
  uniqueSkus: number;
  duplicateSkuRows: number;
  totalUnits: number;
  matchedInputIds: number;
  unmatchedInputIds: number;
  unmatchedSample: string[];
  expectedBasepacks: number;
  availableBasepacks: number;
  unavailableBasepacks: number;
  availabilityPct: number | null;
  profileName: string | null;
  profileNote: string | null;
  excludedColumns: string[];
  excludedUnits: number;
  networkCoveragePct?: number | null;
  branchOlaPct?: number | null;
  availableBranchCells?: number;
  totalBranchCells?: number;
  branchOla?: Array<{ branchCode: string; expectedBasepacks: number; availableBasepacks: number; unavailableBasepacks: number; olaPct: number | null }>;
  salesRows?: number;
  salesSkuCount?: number;
  sellingSkuCount?: number;
  salesDateStart?: string | null;
  salesDateEnd?: string | null;
  totalSoldQty?: number;
  totalGfv?: number;
  salesPeriodStart?: string | null;
  salesPeriodEnd?: string | null;
  totalSalesValue?: number;
  historicalSalesMonths?: Array<{ sourceSheet: string; periodStart: string; periodEnd: string; isCompleteMonth: boolean; soldQty: number; salesValue: number }>;
  monthlySalesPeriods?: Array<{ sourceSheet: string; monthStart: string; monthEnd: string; skuCount: number; soldQty: number; totalProductCost: number; totalAmount: number }>;
  normalInputRows?: number;
  ignoredNonNormalRows?: number;
  totalStockValuation?: number;
  matchedStockUnits?: number;
  matchedStockValuation?: number;
};

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function UploadCenter() {
  const params = useSearchParams();
  const requestedTab = params.get('tab');
  const initialTab = requestedTab === 'master' ? 'master' : requestedTab === 'cpp' ? 'cpp' : 'stock';
  const [tab, setTab] = useState<'stock' | 'cpp' | 'master'>(initialTab);

  return <div className="page">
    <div className="page-head"><div><h1>Uploads</h1><p>Load daily stock/sales observations, monthly CPP reference prices, or replace the source-of-truth master when mappings change.</p></div></div>
    <div className="segment-tabs">
      <button className={tab==='stock'?'active':''} onClick={()=>setTab('stock')}>Daily Stock</button>
      <button className={tab==='cpp'?'active':''} onClick={()=>setTab('cpp')}>CPP Reference</button>
      <button className={tab==='master'?'active':''} onClick={()=>setTab('master')}>Master Data</button>
    </div>
    {tab === 'stock' ? <StockUpload /> : tab === 'cpp' ? <CppUpload /> : <MasterUpload />}
  </div>;
}


function CppUpload() {
  const supported = [
    { code: 'daraz', name: 'Daraz' },
    { code: 'shajgoj', name: 'Shajgoj' },
  ];
  const [accountCode, setAccountCode] = useState('daraz');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CppPreview | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [tolerancePct, setTolerancePct] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(mode: 'preview' | 'commit') {
    if (!file) return;
    setBusy(true); setError(''); if (mode === 'preview') setSuccess('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('account', accountCode);
      fd.append('tolerancePct', tolerancePct || '1');
      if (effectiveFrom) fd.append('effectiveFrom', effectiveFrom);
      if (effectiveTo) fd.append('effectiveTo', effectiveTo);
      if (mode === 'preview') fd.append('preview', 'true');
      else fd.append('confirmed', 'true');
      const res = await fetch('/api/cpp/reference', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'CPP upload failed.');
      if (mode === 'preview') {
        setPreview(json);
        if (!effectiveFrom && json.effectiveFrom) setEffectiveFrom(json.effectiveFrom);
        if (!effectiveTo && json.effectiveTo) setEffectiveTo(json.effectiveTo);
      } else {
        setSuccess(`${json.account.name} CPP activated: ${json.result.rows_total} rows, ${json.result.rows_scrapable} scrapable targets, ${json.result.rows_mapped} mapped to master.`);
        setPreview(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CPP upload failed.');
    } finally {
      setBusy(false);
    }
  }

  function resetForAccount(code: string) {
    setAccountCode(code);
    setFile(null);
    setPreview(null);
    setEffectiveFrom('');
    setEffectiveTo('');
    setError('');
    setSuccess('');
  }

  return <section className="card upload-card">
    <div className="card-head"><div><h2>CPP reference price upload</h2><p>Upload the monthly approved price file. A new commit becomes the live CPP set for that account; the previous set remains in history.</p></div></div>
    {error && <div className="alert error">{error}</div>}
    {success && <div className="alert success"><CheckCircle2 size={17}/>{success}</div>}

    <div className="form-grid two">
      <label><span>Account</span><select value={accountCode} onChange={(e)=>resetForAccount(e.target.value)}>{supported.map((a)=><option key={a.code} value={a.code}>{a.name}</option>)}</select></label>
      <label><span>Allowed tolerance above CPP (%)</span><input type="number" min="0" max="100" step="0.1" value={tolerancePct} onChange={(e)=>{setTolerancePct(e.target.value);setPreview(null);}}/></label>
    </div>

    <div className="alert success"><DollarSign size={17}/><div><strong>{accountCode === 'daraz' ? 'Daraz rule' : 'Shajgoj rule'}</strong><div>{accountCode === 'daraz' ? 'Expected CPP = MRP − October Backmargin. Daraz SKU is read directly from the workbook.' : 'Expected CPP = Selling Price. Shajgoj SKU is resolved from the current master using Packsize/product matching.'}</div></div></div>

    <label className="dropzone"><FileSpreadsheet size={26}/><strong>{file?.name || `Choose ${accountCode === 'daraz' ? 'Daraz' : 'Shajgoj'} CPP workbook`}</strong><span>Excel .xlsx</span><input type="file" accept=".xlsx" onChange={(e)=>{setFile(e.target.files?.[0]||null);setPreview(null);setSuccess('');setError('');setEffectiveFrom('');setEffectiveTo('');}}/></label>
    <div className="action-row"><button className="button" disabled={!file||busy} onClick={()=>void submit('preview')}>{busy?'Reading…':'Preview CPP file'}</button></div>

    {preview && <div className="preview-panel">
      <div className="alert success"><CheckCircle2 size={17}/><div><strong>{preview.profileName}</strong><div>{preview.profileNote}</div></div></div>
      <div className="form-grid two">
        <label><span>Effective from</span><input type="date" value={effectiveFrom} onChange={(e)=>setEffectiveFrom(e.target.value)}/></label>
        <label><span>Effective to</span><input type="date" value={effectiveTo} onChange={(e)=>setEffectiveTo(e.target.value)}/></label>
      </div>
      <div className="preview-grid">
        <div><span>Source rows</span><strong>{preview.sourceRows}</strong></div>
        <div><span>Scrapable targets</span><strong>{preview.scrapableTargets}</strong></div>
        <div><span>Mapped to master</span><strong>{preview.mappedToMaster}</strong></div>
        <div><span>Unmapped</span><strong>{preview.unmappedRows}</strong></div>
        <div><span>Non-scrapable</span><strong>{preview.nonScrapableRows}</strong></div>
        <div><span>Fuzzy matches</span><strong>{preview.fuzzyMatches}</strong></div>
      </div>
      {preview.warnings.map((warning)=><div className="alert warning" key={warning}>{warning}</div>)}
      <div className="sample-block"><strong>Preview sample</strong><div className="table-wrap mini"><table><thead><tr><th>Source</th><th>Marketplace SKU</th><th>Product</th><th>CPP</th><th>Mapping</th><th>Scrapable</th></tr></thead><tbody>{preview.sample.slice(0,12).map((row,i)=><tr key={`${row.sourceIdentifier}-${i}`}><td>{row.sourceIdentifier}</td><td>{row.accountSku||'—'}</td><td>{row.productName||row.sourcePacksize||'—'}</td><td><strong>{row.expectedPrice.toFixed(2)}</strong></td><td>{row.mappingStatus}{row.matchScore!==''&&row.matchScore!==1?` (${row.matchScore})`:''}</td><td>{row.scrapable?'Yes':'No'}</td></tr>)}</tbody></table></div></div>
      <p className="muted">Unmapped rows are preserved in the reference set. Only rows with a resolved marketplace SKU are made available to the scraper.</p>
      <button className="button danger-safe" disabled={busy||!preview.valid} onClick={()=>void submit('commit')}><UploadCloud size={17}/>Activate CPP reference set</button>
    </div>}
  </section>;
}

function MasterUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MasterPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function inspect() {
    if (!file) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/master/preview', { method:'POST', body:fd });
      const json = await res.json(); if (!res.ok) throw new Error(json.error || 'Preview failed.');
      setPreview(json);
    } catch (e) { setError(e instanceof Error ? e.message : 'Preview failed.'); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/master/commit', { method:'POST', body:fd });
      const json = await res.json(); if (!res.ok) throw new Error(json.error || 'Import failed.');
      setSuccess(`Master replaced successfully: ${json.result.basepacks} basepacks, ${json.result.products} UBL SKUs and ${json.result.mappings} account mappings.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); }
    finally { setBusy(false); }
  }

  return <section className="card upload-card">
    <div className="card-head"><div><h2>Master source of truth</h2><p>Packsize is the basepack. The import also keeps Business Group, UBL Category, Sub Category, Brand, Type, Retail Type, Variant, weight, TP/MRP and all account SKU columns.</p></div></div>
    {error && <div className="alert error">{error}</div>}{success && <div className="alert success"><CheckCircle2 size={17}/>{success}</div>}
    <label className="dropzone"><FileSpreadsheet size={26}/><strong>{file?.name || 'Choose master workbook'}</strong><span>Excel .xlsx</span><input type="file" accept=".xlsx" onChange={(e)=>{setFile(e.target.files?.[0]||null);setPreview(null);setSuccess('');}}/></label>
    <div className="action-row"><button className="button" disabled={!file||busy} onClick={()=>void inspect()}>{busy?'Reading…':'Preview master'}</button></div>
    {preview && <div className="preview-panel">
      <div className="preview-grid"><div><span>Sheet</span><strong>{preview.sheetName}</strong></div><div><span>Basepacks</span><strong>{preview.basepackCount}</strong></div><div><span>UBL SKUs</span><strong>{preview.rowCount}</strong></div><div><span>Active</span><strong>{preview.activeCount}</strong></div><div><span>Account IDs</span><strong>{preview.mappingCount}</strong></div><div><span>Repeated IDs</span><strong>{preview.duplicateAccountIds}</strong></div></div>
      <div className="mapping-counts">{ACCOUNTS.map((a)=><span key={a.code}>{a.name}<strong>{preview.accountCounts[a.code] ?? 0}</strong></span>)}</div>
      <p className="muted">Repeated account IDs are allowed. The master workbook is authoritative.</p>
      <button className="button danger-safe" disabled={busy} onClick={()=>void commit()}><UploadCloud size={17}/>Replace master data</button>
    </div>}
  </section>;
}

function StockUpload() {
  const accountFromUrl = useSearchParams().get('account');
  const [accountCode, setAccountCode] = useState(ACCOUNTS.some((a)=>a.code===accountFromUrl)?accountFromUrl!:ACCOUNTS[0].code);
  const [snapshotDate, setSnapshotDate] = useState(todayLocal());
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<InspectedSheet[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [skuColumn, setSkuColumn] = useState('');
  const [stockColumns, setStockColumns] = useState<string[]>([]);
  const [mode, setMode] = useState<'quantity'|'availability'>('quantity');
  const [preview, setPreview] = useState<StockPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedSheet = useMemo(()=>sheets.find((s)=>s.name===sheetName) ?? null,[sheets,sheetName]);

  function applySheet(s: InspectedSheet) {
    setSheetName(s.name);
    setSkuColumn(s.suggestedSkuColumn || s.columns[0] || '');
    setStockColumns(s.locked ? s.suggestedStockColumns : (s.suggestedStockColumns.length ? [s.suggestedStockColumns[0]] : []));
    if (s.suggestedSnapshotDate) setSnapshotDate(s.suggestedSnapshotDate);
    if (s.locked) setMode('quantity');
    setPreview(null);
  }

  async function inspect() {
    if (!file) return;
    setBusy(true);setError('');setSuccess('');
    try {
      const fd=new FormData();fd.append('file',file);fd.append('accountCode',accountCode);fd.append('snapshotDate',snapshotDate);
      const res=await fetch('/api/stock/inspect',{method:'POST',body:fd});const json=await res.json();if(!res.ok)throw new Error(json.error||'Inspection failed.');
      setSheets(json.sheets||[]); if(json.sheets?.[0]) applySheet(json.sheets[0]);
    } catch(e){setError(e instanceof Error?e.message:'Inspection failed.');} finally{setBusy(false);}
  }

  function buildForm() {
    const fd=new FormData(); if(file)fd.append('file',file); fd.append('accountCode',accountCode);fd.append('snapshotDate',snapshotDate);fd.append('sheetName',sheetName);fd.append('headerRow',String(selectedSheet?.headerRow||1));fd.append('skuColumn',skuColumn);fd.append('stockColumns',JSON.stringify(stockColumns));fd.append('mode',mode);return fd;
  }

  async function runPreview() {
    if(!file||!selectedSheet||!skuColumn||!stockColumns.length)return;
    setBusy(true);setError('');setSuccess('');
    try{const res=await fetch('/api/stock/preview',{method:'POST',body:buildForm()});const json=await res.json();if(!res.ok)throw new Error(json.error||'Preview failed.');setPreview(json);}catch(e){setError(e instanceof Error?e.message:'Preview failed.');}finally{setBusy(false);}
  }

  async function commit() {
    if(!preview)return;
    setBusy(true);setError('');setSuccess('');
    try{const res=await fetch('/api/stock/commit',{method:'POST',body:buildForm()});const json=await res.json();if(!res.ok)throw new Error(json.error||'Upload failed.');const savedDate=json.snapshotDate||snapshotDate;if(accountCode==='pandamart')setSuccess(`Saved Pandamart branch stock + day-wise sales for ${savedDate}. Branch OLA: ${json.result.branch_ola_pct ?? '—'}%. Network coverage: ${json.result.network_coverage_pct ?? '—'}%.`);else if(accountCode==='daraz')setSuccess(`Saved Daraz Normal-SKU stock for ${savedDate}. OLA: ${json.result.availability_pct ?? '—'}%. Movement analytics will compare this observation with the prior Daraz upload.`);else if(accountCode==='shajgoj')setSuccess(`Saved Shajgoj stock for ${savedDate} + cumulative sales through ${json.result.mtd_period_end ?? '—'}. OLA: ${json.result.availability_pct ?? '—'}%.`);else if(accountCode==='foodi')setSuccess(`Saved Foodi stock for ${savedDate} + rolling 30-day sales through ${json.result.sales_period_end ?? '—'}. OLA: ${json.result.availability_pct ?? '—'}%.`);else setSuccess(`Saved ${ACCOUNTS.find((a)=>a.code===accountCode)?.name} stock for ${savedDate}. Availability: ${json.result.availability_pct ?? '—'}%.`);}catch(e){setError(e instanceof Error?e.message:'Upload failed.');}finally{setBusy(false);}
  }

  return <section className="card upload-card">
    <div className="card-head"><div><h2>Account stock & sales dump</h2><p>Select the account and upload the latest file you received. Missing calendar days are allowed; account-specific rules preserve the real stock date.</p></div></div>
    {error&&<div className="alert error">{error}</div>}{success&&<div className="alert success"><CheckCircle2 size={17}/>{success}</div>}
    <div className="form-grid two"><label><span>Account</span><select value={accountCode} onChange={(e)=>{setAccountCode(e.target.value);setSheets([]);setSheetName('');setSkuColumn('');setStockColumns([]);setPreview(null);setSuccess('');}}>{ACCOUNTS.map((a)=><option key={a.code} value={a.code}>{a.name}</option>)}</select></label><label><span>{selectedSheet?.suggestedSnapshotDate ? 'Stock date (from file)' : accountCode==='daraz' ? 'Daraz stock observation date' : accountCode==='shajgoj' ? 'Stock date represented by Total Stock QTY' : accountCode==='foodi' ? 'Stock date represented by Total Stock' : 'Stock date'}</span><input type="date" value={snapshotDate} disabled={Boolean(selectedSheet?.suggestedSnapshotDate)} onChange={(e)=>{setSnapshotDate(e.target.value);setPreview(null);if(accountCode==='daraz'||accountCode==='shajgoj'||accountCode==='foodi'){setSheets([]);setSheetName('');setSkuColumn('');setStockColumns([]);}}}/></label></div>
    <label className="dropzone"><FileSpreadsheet size={26}/><strong>{file?.name||'Choose account workbook'}</strong><span>{accountCode==='daraz'?'Daraz imports only Normal SKUs, stores Total - Stock + Stock Valuation, then compares mapped SKU observations over time for implied depletion and replenishment.':accountCode==='pandamart'?'Pandamart stores branch-wise stock plus day-wise sales history.':accountCode==='shajgoj'?'Shajgoj stores the selected-date stock snapshot plus cumulative month-to-date sales and completed month sales history.':accountCode==='foodi'?'Foodi stores selected-date Total Stock plus the rolling 30-day sales quantity ending one day before the stock date.':'Only the configured stock fields are used for this account.'}</span><input type="file" accept=".xlsx" onChange={(e)=>{setFile(e.target.files?.[0]||null);setSheets([]);setPreview(null);setSuccess('');}}/></label>
    <div className="action-row"><button className="button" disabled={!file||busy} onClick={()=>void inspect()}>{busy?'Reading…':'Inspect workbook'}</button></div>

    {sheets.length>0&&selectedSheet&&<div className="mapping-panel">
      {selectedSheet.locked ? <>
        <div className="alert success"><CheckCircle2 size={17}/><div><strong>{selectedSheet.profileName}</strong><div>{selectedSheet.note}</div></div></div>
        <div className="preview-grid"><div><span>Sheet</span><strong>{selectedSheet.name}</strong></div><div><span>SKU column</span><strong>{skuColumn}</strong></div><div><span>{accountCode==='pandamart'?'Store columns':'Stock column(s)'}</span><strong>{accountCode==='daraz'||accountCode==='shajgoj'||accountCode==='foodi'||accountCode==='othoba'?stockColumns.join(', '):stockColumns.length}</strong></div><div><span>Excluded</span><strong>{selectedSheet.excludedColumns.join(', ') || '—'}</strong></div></div>
      </> : <>
        <div className="form-grid two"><label><span>Sheet</span><select value={sheetName} onChange={(e)=>{const s=sheets.find((x)=>x.name===e.target.value);if(s)applySheet(s);}}>{sheets.map((s)=><option key={s.name}>{s.name}</option>)}</select></label><label><span>Marketplace SKU / Product ID column</span><select value={skuColumn} onChange={(e)=>{setSkuColumn(e.target.value);setPreview(null);}}>{selectedSheet.columns.map((c)=><option key={c}>{c}</option>)}</select></label></div>
        <div className="form-grid two"><label><span>Interpret stock as</span><select value={mode} onChange={(e)=>{setMode(e.target.value as 'quantity'|'availability');setPreview(null);}}><option value="quantity">Quantity (stock &gt; 0 = available)</option><option value="availability">Availability flag (Yes / In Stock / 1 = available)</option></select></label><div><span className="field-label">Stock column(s)</span><div className="column-checks">{selectedSheet.columns.filter((c)=>c!==skuColumn).map((c)=><label key={c} className={stockColumns.includes(c)?'checked':''}><input type="checkbox" checked={stockColumns.includes(c)} onChange={(e)=>{setStockColumns((prev)=>e.target.checked?[...prev,c]:prev.filter((x)=>x!==c));setPreview(null);}}/>{c}</label>)}</div></div></div>
      </>}
      <div className="sample-block"><strong>Sample</strong><div className="table-wrap mini"><table><thead><tr>{selectedSheet.columns.slice(0,8).map((c)=><th key={c}>{c}</th>)}</tr></thead><tbody>{selectedSheet.sampleRows.map((r,i)=><tr key={i}>{selectedSheet.columns.slice(0,8).map((c)=><td key={c}>{String(r[c]??'')}</td>)}</tr>)}</tbody></table></div></div>
      <button className="button" disabled={busy||!skuColumn||!stockColumns.length} onClick={()=>void runPreview()}>Preview availability</button>
    </div>}

    {preview&&<div className="preview-panel">
      <div className="preview-grid"><div><span>Stock date</span><strong>{preview.snapshotDate}</strong></div><div><span>Unique stock IDs</span><strong>{preview.uniqueSkus}</strong></div><div><span>Store stock units</span><strong>{preview.totalUnits.toLocaleString()}</strong></div><div><span>Matched IDs</span><strong>{preview.matchedInputIds}</strong></div><div><span>Unmatched IDs</span><strong>{preview.unmatchedInputIds}</strong></div><div><span>Expected basepacks</span><strong>{preview.expectedBasepacks}</strong></div>{accountCode==='pandamart'?<><div><span>Branch OLA</span><strong>{preview.branchOlaPct===null||preview.branchOlaPct===undefined?'—':`${preview.branchOlaPct}%`}</strong></div><div><span>Network coverage</span><strong>{preview.networkCoveragePct===null||preview.networkCoveragePct===undefined?'—':`${preview.networkCoveragePct}%`}</strong></div></>:<><div><span>Available basepacks</span><strong>{preview.availableBasepacks}</strong></div><div><span>Availability</span><strong>{preview.availabilityPct===null?'—':`${preview.availabilityPct}%`}</strong></div></>}</div>
      {preview.profileName&&<div className="alert success"><CheckCircle2 size={17}/><div><strong>{preview.profileName}</strong><div>{preview.profileNote}</div>{preview.excludedColumns.length>0&&<div>{preview.excludedColumns.join(', ')} excluded: {preview.excludedUnits.toLocaleString()} units.</div>}</div></div>}
      {accountCode==='daraz'&&<>
        <div className="preview-grid"><div><span>Normal SKU rows</span><strong>{preview.normalInputRows?.toLocaleString() ?? '—'}</strong></div><div><span>Ignored non-Normal rows</span><strong>{preview.ignoredNonNormalRows?.toLocaleString() ?? '—'}</strong></div><div><span>Mapped stock units</span><strong>{preview.matchedStockUnits?.toLocaleString() ?? '—'}</strong></div><div><span>Mapped stock valuation</span><strong>{preview.matchedStockValuation?.toLocaleString(undefined,{maximumFractionDigits:2}) ?? '—'}</strong></div></div>
      </>}
      {accountCode==='pandamart'&&<>
        <div className="preview-grid"><div><span>Branch cells available</span><strong>{preview.availableBranchCells?.toLocaleString() ?? '—'} / {preview.totalBranchCells?.toLocaleString() ?? '—'}</strong></div><div><span>Sales period in file</span><strong>{preview.salesDateStart&&preview.salesDateEnd?`${preview.salesDateStart} → ${preview.salesDateEnd}`:'—'}</strong></div><div><span>Day-wise sales rows</span><strong>{preview.salesRows?.toLocaleString() ?? '—'}</strong></div><div><span>Total sold qty</span><strong>{preview.totalSoldQty?.toLocaleString() ?? '—'}</strong></div></div>
        {preview.branchOla&&<div className="table-wrap mini"><table><thead><tr><th>Branch</th><th>Available</th><th>Expected</th><th>OLA</th></tr></thead><tbody>{preview.branchOla.map((b)=><tr key={b.branchCode}><td>{b.branchCode.replaceAll('_',' ')}</td><td>{b.availableBasepacks}</td><td>{b.expectedBasepacks}</td><td><strong>{b.olaPct===null?'—':`${b.olaPct}%`}</strong></td></tr>)}</tbody></table></div>}
      </>}
      {accountCode==='shajgoj'&&<>
        <div className="preview-grid"><div><span>Current sales period</span><strong>{preview.salesPeriodStart&&preview.salesPeriodEnd?`${preview.salesPeriodStart} → ${preview.salesPeriodEnd}`:'—'}</strong></div><div><span>Cumulative sold qty</span><strong>{preview.totalSoldQty?.toLocaleString() ?? '—'}</strong></div><div><span>Sales value</span><strong>{preview.totalSalesValue?.toLocaleString() ?? '—'}</strong></div><div><span>Prior month sheets</span><strong>{preview.historicalSalesMonths?.length ?? 0}</strong></div></div>
        {preview.historicalSalesMonths&&preview.historicalSalesMonths.length>0&&<div className="table-wrap mini"><table><thead><tr><th>Historical period</th><th>Status</th><th>Sold qty</th><th>Sales value</th></tr></thead><tbody>{preview.historicalSalesMonths.slice(0,12).map((m)=><tr key={`${m.sourceSheet}-${m.periodEnd}`}><td><strong>{m.periodStart} → {m.periodEnd}</strong></td><td>{m.isCompleteMonth?'Complete month':'Partial month'}</td><td>{m.soldQty.toLocaleString()}</td><td>{m.salesValue.toLocaleString()}</td></tr>)}</tbody></table></div>}
      </>}
      {accountCode==='othoba'&&<>
        <div className="preview-grid"><div><span>Current MTD sales period</span><strong>{preview.salesPeriodStart&&preview.salesPeriodEnd?`${preview.salesPeriodStart} → ${preview.salesPeriodEnd}`:'—'}</strong></div><div><span>MTD sold qty</span><strong>{preview.totalSoldQty?.toLocaleString() ?? '—'}</strong></div><div><span>MTD sales value</span><strong>{preview.totalSalesValue?.toLocaleString() ?? '—'}</strong></div><div><span>Monthly detail sheets</span><strong>{preview.monthlySalesPeriods?.length ?? 0}</strong></div></div>
        {preview.monthlySalesPeriods&&preview.monthlySalesPeriods.length>0&&<div className="table-wrap mini"><table><thead><tr><th>Month</th><th>SKUs</th><th>Sold qty</th><th>Sales amount</th></tr></thead><tbody>{preview.monthlySalesPeriods.slice(0,12).map((m)=><tr key={m.monthStart}><td><strong>{m.monthStart}</strong></td><td>{m.skuCount}</td><td>{m.soldQty.toLocaleString()}</td><td>{m.totalAmount.toLocaleString()}</td></tr>)}</tbody></table></div>}
      </>}
      {accountCode==='foodi'&&<>
        <div className="preview-grid"><div><span>30-day sales period</span><strong>{preview.salesPeriodStart&&preview.salesPeriodEnd?`${preview.salesPeriodStart} → ${preview.salesPeriodEnd}`:'—'}</strong></div><div><span>Sales SKUs</span><strong>{preview.salesSkuCount?.toLocaleString() ?? '—'}</strong></div><div><span>Selling SKUs</span><strong>{preview.sellingSkuCount?.toLocaleString() ?? '—'}</strong></div><div><span>30-day sold qty</span><strong>{preview.totalSoldQty?.toLocaleString() ?? '—'}</strong></div></div>
      </>}
      {preview.unmatchedInputIds>0&&<div className="alert warning">Unmatched stock IDs are outside the current master scope and are ignored. Sample: {preview.unmatchedSample.join(', ')||'—'}</div>}
      <p className="muted">{accountCode==='daraz'?'Daraz OLA and movement analytics use only active master-mapped Daraz IDs from Normal rows. Stock decreases are implied depletion, not confirmed sales; replenishment and observation gaps are shown separately.':accountCode==='pandamart'?'Pandamart OLA is calculated branch-wise: each master-listed basepack × each customer-facing branch is one availability cell. DC never counts toward OLA. Network coverage is shown separately.':accountCode==='shajgoj'?'Shajgoj OLA is stored only for the stock dates you actually upload. Missing dates are never filled forward. Sales are stored as cumulative month-to-date snapshots, so skipped upload days do not lose sales.':accountCode==='othoba'?'Othoba OLA uses only the selected current Sales & Stock sheet. Its MTD sales snapshot and all monthly Sales Report sheets are stored separately, and duplicate monthly sales rows are aggregated by SKU.':accountCode==='foodi'?'Foodi OLA is stored only for dates you actually upload. Total Stock is the stock position on X; 30 Day Sale Qty is stored as the rolling 30-day window ending X−1.':'A basepack is Available when any mapped SKU under it has stock > 0. Listed basepacks missing from the stock dump are Out. Basepacks with no master ID for the account are Not Listed.'}</p>
      <button className="button" disabled={busy} onClick={()=>void commit()}><UploadCloud size={17}/>{accountCode==='daraz'?'Commit Daraz stock history':accountCode==='pandamart'||accountCode==='shajgoj'||accountCode==='foodi'||accountCode==='othoba'?'Commit stock + sales history':'Commit stock snapshot'}</button>
    </div>}
  </section>;
}
