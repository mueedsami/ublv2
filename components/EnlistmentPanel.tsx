'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileSpreadsheet, PackagePlus, RefreshCw, RotateCcw, Search, Upload, X } from 'lucide-react';

type Account = { id: string; code: string; name: string };
type Target = {
  id: string;
  enlistment_id: string;
  account_id: string;
  selected: boolean;
  status: string;
  account_fields: Record<string, any>;
  notes: string | null;
  updated_at: string;
  account: { code: string; name: string } | null;
};
type Product = {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
  image_url: string | null;
  description: string | null;
  tp: number | null;
  mrp: number | null;
  length_cm: number | null;
  depth_cm: number | null;
  height_cm: number | null;
  shelf_life_days: number | null;
  pcs_per_crm: number | null;
  cert_license: string | null;
  supplier_name: string | null;
  country_of_origin: string | null;
  source_status: string | null;
  updated_at: string;
  targets: Target[];
};
type PanelData = {
  accounts: Account[];
  products: Product[];
  imports: any[];
  exports: any[];
  statuses: string[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
type Preview = {
  fileName: string;
  rowsTotal: number;
  sourceColumns: string[];
  warnings: string[];
  sample: { sourceRow: number; barcode: string; name: string; brand: string; category: string; tp: string; mrp: string }[];
};

const statusLabels: Record<string, string> = {
  pending: 'Pending', ready: 'Ready', sent: 'Sent', under_review: 'Under review', enlisted: 'Enlisted',
  needs_correction: 'Needs correction', rejected: 'Rejected',
};
const statusClass: Record<string, string> = {
  pending: 'neutral', ready: 'info', sent: 'info', under_review: 'warning', enlisted: 'ok', needs_correction: 'warning', rejected: 'danger',
};

function money(value: number | null | undefined) {
  return value == null ? '—' : `৳${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}
function accountFormat(code: string) {
  if (code.toLowerCase() === 'daraz') return 'Daraz template';
  if (code.toLowerCase() === 'pandamart') return 'Pandamart template';
  return 'Regular template';
}

export default function EnlistmentPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const latestLoad = useRef(0);
  const historyFileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [accountFilter, setAccountFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [historyFile, setHistoryFile] = useState<File | null>(null);
  const [historyPreview, setHistoryPreview] = useState<{fileName:string;products:number;accounts:{name:string;code:string}[];counts:Record<string,number>;warnings:string[]}|null>(null);
  const [bulkAccounts, setBulkAccounts] = useState<string[]>([]);
  const [exportAccount, setExportAccount] = useState('');
  const [exportType, setExportType] = useState<'xlsx'|'csv'>('xlsx');

  async function load(nextPage = page, nextSearch = searchTerm, nextAccount = accountFilter, nextStatus = statusFilter) {
    const requestId = ++latestLoad.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(nextPage), search: nextSearch, account: nextAccount, status: nextStatus });
      const res = await fetch(`/api/enlistment?${params}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load enlistment panel.');
      if (requestId !== latestLoad.current) return;
      setData(json);
      if (!exportAccount && json.accounts?.length) setExportAccount(json.accounts[0].code);
    } catch (e) {
      if (requestId === latestLoad.current) setError(e instanceof Error ? e.message : 'Failed to load enlistment panel.');
    } finally { if (requestId === latestLoad.current) setLoading(false); }
  }

  // Debounce typed searches; every search and filter runs against the full database.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => { setPage(1); }, [searchTerm]);
  useEffect(() => { setChecked(new Set()); void load(page, searchTerm, accountFilter, statusFilter); }, [page, searchTerm, accountFilter, statusFilter]);

  const products = data?.products || [];
  const accounts = data?.accounts || [];
  const openProduct = products.find((p) => p.id === openProductId) || null;

  // API already applied filters before paginating; each product includes all its account mappings.
  const filtered = products;
  const pagination = data?.pagination || { page, pageSize: 50, total: 0, pages: 1 };
  const selectedProducts = products.filter((p) => checked.has(p.id));
  const exportEligible = selectedProducts.filter((p) => p.targets.some((t) => t.selected && t.account?.code === exportAccount));
  const pendingCount = products.reduce((sum, p) => sum + p.targets.filter((t) => t.selected && t.status !== 'enlisted').length, 0);
  const enlistedCount = products.reduce((sum, p) => sum + p.targets.filter((t) => t.selected && t.status === 'enlisted').length, 0);
  const selectedTaskCount = pendingCount + enlistedCount;
  const unassignedCount = products.filter((p) => !p.targets.some((t) => t.selected)).length;
  const attentionCount = products.reduce((sum, p) => sum + p.targets.filter((t) => t.selected && ['needs_correction', 'rejected'].includes(t.status)).length, 0);
  const completionPct = selectedTaskCount ? Math.round((enlistedCount / selectedTaskCount) * 100) : 0;
  const accountProgress = useMemo(() => accounts.map((account) => {
    const targets = products.flatMap((product) => product.targets).filter((target) => target.selected && target.account?.code === account.code);
    const enlisted = targets.filter((target) => target.status === 'enlisted').length;
    const attention = targets.filter((target) => ['needs_correction', 'rejected'].includes(target.status)).length;
    return { account, total: targets.length, enlisted, attention, pct: targets.length ? Math.round((enlisted / targets.length) * 100) : 0 };
  }).filter((row) => row.total > 0), [accounts, products]);

  async function historicalImport(file: File, commit = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const fd = new FormData(); fd.append('file', file);
      if (commit) fd.append('confirmation','IMPORT HISTORICAL ENLISTMENTS');
      const res = await fetch(`/api/enlistment/historical?mode=${commit ? 'commit' : 'preview'}`, {method:'POST',body:fd});
      const json = await res.json();
      if(!res.ok) throw new Error(json.error || 'Historical import failed.');
      if(!commit) {setHistoryFile(file);setHistoryPreview(json);}
      else {
        const r=json.result;
        setNotice(`Historical import: ${r.products} products, ${r.targetsCreated} account mappings added, ${r.targetsUpdated} updated, ${r.excluded} N/A mappings excluded. ${r.skipped} records skipped for review.`);
        if(json.warnings?.length) setNotice(old=>`${old} ${json.warnings.length} warnings returned; review server logs or re-preview before making further changes.`);
        setHistoryFile(null);setHistoryPreview(null);await load();
      }
    } catch(e) {setError(e instanceof Error ? e.message : 'Historical import failed.');}
    finally {setBusy(false);}
  }

  async function inspectFile(file: File) {
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/enlistment/import?mode=preview', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'File inspection failed.');
      setPendingFile(file); setPreview(json);
    } catch (e) { setError(e instanceof Error ? e.message : 'File inspection failed.'); }
    finally { setBusy(false); }
  }

  async function commitImport() {
    if (!pendingFile) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const fd = new FormData(); fd.append('file', pendingFile);
      const res = await fetch('/api/enlistment/import?mode=commit', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed.');
      const result = json.result || {};
      setNotice(`Imported ${result.rows_total ?? preview?.rowsTotal ?? 0} products: ${result.rows_inserted ?? 0} new, ${result.rows_updated ?? 0} updated. Account selection was not taken from the source file.`);
      setPendingFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); }
    finally { setBusy(false); }
  }

  async function setAccounts(product: Product, accountCodes: string[]) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/enlistment/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-selection', productId: product.id, accountCodes }) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error || 'Failed to save target accounts.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save target accounts.'); }
    finally { setBusy(false); }
  }

  async function bulkAssign() {
    if (!checked.size || !bulkAccounts.length) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/enlistment/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-accounts', productIds: [...checked], accountCodes: bulkAccounts }) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error || 'Failed to assign accounts.');
      setNotice(`Added ${bulkAccounts.length} account${bulkAccounts.length === 1 ? '' : 's'} to ${checked.size} selected product${checked.size === 1 ? '' : 's'}. Existing statuses were preserved.`);
      setBulkAccounts([]); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to assign accounts.'); }
    finally { setBusy(false); }
  }

  async function updateTarget(target: Target, patch: { status?: string; accountFields?: Record<string, any>; notes?: string }) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/enlistment/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-target', targetId: target.id, ...patch }) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error || 'Failed to update account status.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update account status.'); }
    finally { setBusy(false); }
  }

  async function downloadExport() {
    if (!exportAccount || !checked.size) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/enlistment/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountCode: exportAccount, productIds: [...checked], fileType: exportType }) });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})); throw new Error(json.error || 'Export failed.');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `enlistment.${exportType}`;
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url);
      setNotice(`Exported ${res.headers.get('X-Enlistment-Rows') || exportEligible.length} product(s) using the ${res.headers.get('X-Enlistment-Format') || accountFormat(exportAccount)} format. Exporting does not change enlistment status.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
    finally { setBusy(false); }
  }

  function toggleCheck(id: string) {
    setChecked((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  return <div className="page enlistment-page enlistment-page-polished">
    <div className="page-head enlistment-head">
      <div><span className="eyebrow">Enlistment Panel</span><h1>Product enlistment workspace</h1><p>Upload the UBL product master, choose target accounts manually, track marketplace progress and export the exact template each account needs.</p></div>
      <div className="enlistment-head-actions">
        <input ref={fileRef} type="file" accept=".csv,.xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void inspectFile(f); }} />
        <button className="button" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={16}/>{busy ? 'Working…' : 'Upload enlistment file'}</button>
        <input ref={historyFileRef} type="file" accept=".xlsx" hidden onChange={(e) => {const f=e.target.files?.[0];if(f)void historicalImport(f);e.target.value='';}}/>
        <button className="button secondary" onClick={() => historyFileRef.current?.click()} disabled={busy}><FileSpreadsheet size={16}/>Historical Y/N Import</button>
        <button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>Refresh</button>
      </div>
    </div>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}

    {historyPreview && <section className="card enlistment-preview-card">
      <div className="card-head"><div><span className="eyebrow">One-time historical backfill</span><h2>{historyPreview.fileName}</h2><p>Import existing account enlistment statuses without following the normal new-enlistment workflow.</p></div><button className="icon-button" onClick={() => {setHistoryPreview(null);setHistoryFile(null);}}><X size={18}/></button></div>
      <div className="enlistment-preview-stats">
        <div><strong>{historyPreview.products}</strong><span>Products</span></div>
        <div><strong>{historyPreview.accounts.length}</strong><span>Platform columns</span></div>
        <div><strong>{historyPreview.counts.Y || 0}</strong><span>Enlisted (Y)</span></div>
        <div><strong>{historyPreview.counts.N || 0}</strong><span>Not enlisted (N)</span></div>
        <div><strong>{historyPreview.counts['N/A'] || 0}</strong><span>Excluded (N/A)</span></div>
      </div>
      <p><strong>Y</strong> = enlisted; <strong>N</strong> = pending; <strong>N/A</strong> = no active account mapping; blank = untouched. Existing progressed tasks are protected. Historical-only platforms do not become active OLA/CPP accounts.</p>
      {historyPreview.warnings.slice(0,10).map((warning,i)=><div className="alert warning" key={i}>{warning}</div>)}
      <div className="enlistment-preview-actions"><button className="button" disabled={busy || !historyFile} onClick={() => {if(historyFile && window.confirm('Import historical enlistment statuses? This updates the selected product-account mappings.')) void historicalImport(historyFile,true);}}><PackagePlus size={16}/>Confirm one-time backfill</button><span>Preview counts before importing. Do not re-import this historical file after editing live statuses.</span></div>
    </section>}

    {preview && <section className="card enlistment-preview-card">
      <div className="card-head"><div><span className="eyebrow">Import preview</span><h2>{preview.fileName}</h2><p>{preview.rowsTotal} product rows detected. Source platform columns will not assign accounts or statuses.</p></div><button className="icon-button" onClick={() => { setPreview(null); setPendingFile(null); }}><X size={18}/></button></div>
      <div className="enlistment-preview-stats"><div><strong>{preview.rowsTotal}</strong><span>Products</span></div><div><strong>{preview.sourceColumns.length}</strong><span>Source columns</span></div><div><strong>{preview.warnings.length}</strong><span>Warnings</span></div></div>
      {preview.warnings.map((warning) => <div className="alert warning" key={warning}>{warning}</div>)}
      <div className="table-wrap"><table><thead><tr><th>Row</th><th>Barcode</th><th>Product</th><th>Brand</th><th>Category</th><th>TP</th><th>MRP</th></tr></thead><tbody>{preview.sample.map((row) => <tr key={`${row.sourceRow}-${row.barcode}`}><td>{row.sourceRow}</td><td>{row.barcode || '—'}</td><td><strong>{row.name}</strong></td><td>{row.brand || '—'}</td><td>{row.category || '—'}</td><td>{row.tp || '—'}</td><td>{row.mrp || '—'}</td></tr>)}</tbody></table></div>
      <div className="enlistment-preview-actions"><button className="button" onClick={() => void commitImport()} disabled={busy}><PackagePlus size={16}/>Import products</button><span>Existing products are updated by barcode; their account selections and statuses are preserved.</span></div>
    </section>}

    <section className="enlistment-summary-card">
      <div className="enlistment-summary-copy"><span className="eyebrow">Workflow health</span><h2>{completionPct}% of account tasks on this page are enlisted</h2><p>The panel tracks every product-account combination independently. <strong>{pendingCount}</strong> task{pendingCount===1?' is':'s are'} still in progress and <strong>{unassignedCount}</strong> product{unassignedCount===1?' has':'s have'} no target account yet.</p><div className="enlistment-summary-progress"><span style={{ width: `${completionPct}%` }}/></div></div>
      <div className="enlistment-summary-stats"><div><span>Products on page</span><strong>{products.length}</strong></div><div><span>Account tasks</span><strong>{selectedTaskCount}</strong></div><div><span>Enlisted</span><strong>{enlistedCount}</strong></div><div className={attentionCount ? 'attention' : ''}><span>Needs attention</span><strong>{attentionCount}</strong></div></div>
    </section>

    {accountProgress.length ? <section className="card enlistment-account-progress-card">
      <div className="card-head"><div><h2>Account progress — current page</h2><p>Progress for products shown on this page. Use filters to view other products.</p></div></div>
      <div className="enlistment-account-progress-grid">{accountProgress.map(({ account, total, enlisted, attention, pct }) => <button type="button" key={account.code} onClick={() => setAccountFilter(account.code)}>
        <div className="enlistment-account-progress-top"><div><strong>{account.name}</strong><span>{accountFormat(account.code)}</span></div><b>{pct}%</b></div>
        <div className="enlistment-account-progress-track"><span style={{ width: `${pct}%` }}/></div>
        <div className="enlistment-account-progress-meta"><span>{enlisted}/{total} enlisted</span>{attention ? <span className="attention">{attention} need attention</span> : <span>On track</span>}</div>
      </button>)}</div>
    </section> : null}

    <section className="card enlistment-filter-card">
      <div className="enlistment-workbench-head"><div><span className="eyebrow">Product workbench</span><strong>{pagination.total} matching products · {products.length} on this page</strong></div><button type="button" className="account-reset-button" onClick={() => { setPage(1); setQuery(''); setSearchTerm(''); setAccountFilter('all'); setStatusFilter('all'); }}><RotateCcw size={14}/>Reset filters</button></div>
      <div className="enlistment-filter-row">
        <label className="enlistment-search"><span>Search</span><div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Product, barcode, brand or category"/></div></label>
        <label><span>Target account</span><select value={accountFilter} onChange={(e) => { setPage(1); setAccountFilter(e.target.value); }}><option value="all">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.code}>{a.name}</option>)}</select></label>
        <label><span>Status</span><select value={statusFilter} onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}><option value="all">All statuses</option>{(data?.statuses || []).map((s) => <option key={s} value={s}>{statusLabels[s] || s}</option>)}</select></label>
      </div>
    </section>

    <section className="enlistment-action-grid">
      <div className="card enlistment-action-card">
        <div className="enlistment-action-card-head"><div><span className="eyebrow">Bulk assignment</span><h2>Add target accounts</h2><p>Apply marketplace targets to the products you selected below.</p></div><strong>{checked.size}</strong></div>
        <div className="enlistment-account-pills">{accounts.map((a) => <label key={a.id} className={bulkAccounts.includes(a.code) ? 'selected' : ''}><input type="checkbox" checked={bulkAccounts.includes(a.code)} onChange={(e) => setBulkAccounts((old) => e.target.checked ? [...old, a.code] : old.filter((x) => x !== a.code))}/><span>{a.name}</span></label>)}</div>
        <button className="button secondary" onClick={() => void bulkAssign()} disabled={busy || !checked.size || !bulkAccounts.length}><Check size={16}/>Add to {checked.size || 0} selected product{checked.size === 1 ? '' : 's'}</button>
      </div>
      <div className="card enlistment-action-card">
        <div className="enlistment-action-card-head"><div><span className="eyebrow">Account export</span><h2>Prepare marketplace file</h2><p>Only selected products already targeted to this account will be exported.</p></div><FileSpreadsheet size={21}/></div>
        <div className="enlistment-export-controls"><label><span>Account</span><select value={exportAccount} onChange={(e) => setExportAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.code}>{a.name} · {accountFormat(a.code)}</option>)}</select></label><label><span>File type</span><select value={exportType} onChange={(e) => setExportType(e.target.value as 'xlsx'|'csv')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select></label></div>
        <div className="enlistment-export-footer"><span><strong>{exportEligible.length}</strong> eligible from {checked.size} selected</span><button className="button" onClick={() => void downloadExport()} disabled={busy || !checked.size || !exportEligible.length}><Download size={16}/>Export file</button></div>
      </div>
    </section>

    <section className="card enlistment-master-card">
      <div className="card-head"><div><h2>Enlistment master</h2><p>Target accounts are chosen manually. Open a product to manage marketplace-specific progress and Daraz fields.</p></div>{checked.size ? <span className="enlistment-selection-chip">{checked.size} selected</span> : null}</div>
      {loading ? <div className="empty">Loading enlistments…</div> : !products.length ? <div className="empty"><PackagePlus size={28}/><strong>{pagination.total === 0 && (searchTerm || accountFilter !== 'all' || statusFilter !== 'all') ? 'No matching products' : 'No enlistments yet'}</strong><span>{pagination.total === 0 && (searchTerm || accountFilter !== 'all' || statusFilter !== 'all') ? 'Try another search or reset filters.' : 'Upload your UBL product enlistment CSV or XLSX to start.'}</span></div> : <div className="table-wrap"><table className="enlistment-table enlistment-table-polished"><thead><tr><th><input type="checkbox" checked={filtered.length > 0 && filtered.every((p) => checked.has(p.id))} onChange={(e) => setChecked((old) => { const next = new Set(old); filtered.forEach((p) => e.target.checked ? next.add(p.id) : next.delete(p.id)); return next; })}/></th><th>Product</th><th>Barcode</th><th>Commercial</th><th>Account progress</th><th>Updated</th><th></th></tr></thead><tbody>
        {filtered.map((product) => { const activeTargets = product.targets.filter((t) => t.selected); const productEnlisted = activeTargets.filter((t) => t.status === 'enlisted').length; const progress = activeTargets.length ? Math.round((productEnlisted / activeTargets.length) * 100) : 0; const hasAttention = activeTargets.some((t) => ['needs_correction', 'rejected'].includes(t.status)); return <tr key={product.id} className={openProductId === product.id ? 'active-row' : ''}>
          <td><input type="checkbox" checked={checked.has(product.id)} onChange={() => toggleCheck(product.id)}/></td>
          <td><div className="enlistment-product-cell"><span className="enlistment-product-mark">{(product.brand || product.name || 'P').slice(0,1).toUpperCase()}</span><div><strong>{product.name}</strong><small>{product.brand || '—'} · {product.category || '—'}</small></div></div></td>
          <td><span className="mono">{product.barcode || '—'}</span></td>
          <td><strong>{money(product.tp)} TP</strong><small>{money(product.mrp)} MRP</small></td>
          <td>{activeTargets.length ? <div className="enlistment-product-progress"><div className="enlistment-product-progress-head"><span>{productEnlisted}/{activeTargets.length} enlisted</span><b className={hasAttention ? 'attention' : ''}>{hasAttention ? 'Needs attention' : `${progress}%`}</b></div><div className="enlistment-product-progress-track"><span style={{ width: `${progress}%` }}/></div><div className="enlistment-status-pills">{activeTargets.map((target) => <span key={target.id} className={`dashboard-badge ${statusClass[target.status] || 'neutral'}`}>{target.account?.name || 'Account'} · {statusLabels[target.status] || target.status}</span>)}</div></div> : <span className="enlistment-unassigned">No account selected</span>}</td>
          <td>{formatDate(product.updated_at)}</td>
          <td><button className="button secondary compact" onClick={() => setOpenProductId(product.id)}>Manage</button></td>
        </tr>; })}
      </tbody></table></div>}
    </section>

    <div className="card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginTop:12,padding:16}}>
      <span>Showing {pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} products</span>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <button type="button" className="button secondary compact" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1,p-1))}>Previous</button>
        <strong>Page {pagination.page} of {pagination.pages}</strong>
        <button type="button" className="button secondary compact" disabled={loading || page >= pagination.pages} onClick={() => setPage((p) => p+1)}>Next</button>
      </div>
    </div>

    {openProduct && <ProductDrawer product={openProduct} accounts={accounts} statuses={data?.statuses || []} busy={busy} onClose={() => setOpenProductId(null)} onSetAccounts={setAccounts} onUpdateTarget={updateTarget}/>} 

    {!!data?.exports?.length && <section className="card enlistment-history-card"><div className="card-head"><div><h2>Recent exports</h2><p>Prepared marketplace files. Exporting does not automatically change workflow status.</p></div><span className="enlistment-history-count">{data.exports.length} recent</span></div><div className="enlistment-history-list">{data.exports.map((row: any) => <div className="enlistment-history-row" key={row.id}><div className="enlistment-history-file"><span className="enlistment-history-icon"><FileSpreadsheet size={16}/></span><div><strong>{row.file_name}</strong><span>{row.account?.name || 'Account'} · {String(row.export_format || '').toUpperCase()}</span></div></div><div className="enlistment-history-meta"><span>{row.row_count} product{Number(row.row_count)===1?'':'s'}</span><span>{formatDate(row.exported_at)}</span></div></div>)}</div></section>}
  </div>;
}

function ProductDrawer({ product, accounts, statuses, busy, onClose, onSetAccounts, onUpdateTarget }: {
  product: Product; accounts: Account[]; statuses: string[]; busy: boolean; onClose: () => void;
  onSetAccounts: (product: Product, codes: string[]) => Promise<void>;
  onUpdateTarget: (target: Target, patch: { status?: string; accountFields?: Record<string, any>; notes?: string }) => Promise<void>;
}) {
  const selectedTargets = product.targets.filter((t) => t.selected);
  const selected = selectedTargets.map((t) => t.account?.code).filter(Boolean) as string[];
  const enlistedTargets = selectedTargets.filter((t) => t.status === 'enlisted').length;
  const attentionTargets = selectedTargets.filter((t) => ['needs_correction', 'rejected'].includes(t.status)).length;
  const drawerProgress = selectedTargets.length ? Math.round((enlistedTargets / selectedTargets.length) * 100) : 0;
  const [chosen, setChosen] = useState<string[]>(selected);

  useEffect(() => setChosen(selected), [product.id, product.targets.map((t) => `${t.id}:${t.selected}`).join('|')]);

  return <div className="enlistment-drawer-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}><aside className="enlistment-drawer">
    <div className="enlistment-drawer-head"><div><span className="eyebrow">Enlistment detail</span><h2>{product.name}</h2><p>{product.brand || '—'} · {product.barcode || 'No barcode'}</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <div className="enlistment-drawer-summary"><div><span>Target accounts</span><strong>{selectedTargets.length}</strong></div><div><span>Enlisted</span><strong>{enlistedTargets}</strong></div><div><span>Completion</span><strong>{drawerProgress}%</strong></div><div className={attentionTargets ? 'attention' : ''}><span>Needs attention</span><strong>{attentionTargets}</strong></div><div className="enlistment-drawer-progress"><span style={{ width: `${drawerProgress}%` }}/></div></div>

    <section className="enlistment-drawer-section"><h3>Product information</h3><div className="enlistment-info-grid">
      <Info label="Category" value={product.category}/><Info label="TP" value={money(product.tp)}/><Info label="MRP" value={money(product.mrp)}/><Info label="Shelf life" value={product.shelf_life_days == null ? null : `${product.shelf_life_days} days`}/><Info label="Pcs per CRM" value={product.pcs_per_crm}/><Info label="Country" value={product.country_of_origin}/><Info label="Supplier" value={product.supplier_name}/><Info label="Certification" value={product.cert_license}/><Info label="Source status" value={product.source_status}/>
    </div>{product.image_url && <a href={product.image_url} target="_blank" rel="noreferrer" className="enlistment-image-link">Open image folder / URL ↗</a>}{product.description && <details><summary>Product description</summary><p className="enlistment-description">{product.description}</p></details>}</section>

    <section className="enlistment-drawer-section"><div className="section-title-row"><div><h3>Target accounts</h3><p>Manual selection only. The source file's platform columns are ignored.</p></div><button className="button secondary compact" onClick={() => void onSetAccounts(product, chosen)} disabled={busy}>Save accounts</button></div><div className="enlistment-drawer-accounts">{accounts.map((a) => <label key={a.id} className={chosen.includes(a.code) ? 'selected' : ''}><input type="checkbox" checked={chosen.includes(a.code)} onChange={(e) => setChosen((old) => e.target.checked ? [...old, a.code] : old.filter((x) => x !== a.code))}/><div><strong>{a.name}</strong><span>{accountFormat(a.code)}</span></div></label>)}</div></section>

    <section className="enlistment-drawer-section"><h3>Account progress</h3>{product.targets.filter((t) => t.selected).length ? <div className="enlistment-target-cards">{product.targets.filter((t) => t.selected).map((target) => <TargetCard key={target.id} target={target} statuses={statuses} busy={busy} onUpdate={onUpdateTarget}/>)}</div> : <div className="empty compact">Select accounts above and save to create account-specific tracking.</div>}</section>
  </aside></div>;
}

function Info({ label, value }: { label: string; value: any }) { return <div><span>{label}</span><strong>{value == null || value === '' ? '—' : String(value)}</strong></div>; }

function TargetCard({ target, statuses, busy, onUpdate }: { key?: string; target: Target; statuses: string[]; busy: boolean; onUpdate: (target: Target, patch: { status?: string; accountFields?: Record<string, any>; notes?: string }) => Promise<void> }) {
  const code = target.account?.code || '';
  const [fields, setFields] = useState<Record<string, any>>(target.account_fields || {});
  const [notes, setNotes] = useState(target.notes || '');
  useEffect(() => { setFields(target.account_fields || {}); setNotes(target.notes || ''); }, [target.id, target.updated_at]);
  const daraz = code === 'daraz';

  const set = (key: string, value: string) => setFields((old) => ({ ...old, [key]: value }));
  return <div className="enlistment-target-card">
    <div className="enlistment-target-head"><div><strong>{target.account?.name || 'Account'}</strong><span>{accountFormat(code)}</span></div><select value={target.status} onChange={(e) => void onUpdate(target, { status: e.target.value })} disabled={busy}>{statuses.map((s) => <option key={s} value={s}>{statusLabels[s] || s}</option>)}</select></div>
    {daraz && <div className="daraz-extra-fields"><p>Daraz-specific fields</p><div className="daraz-extra-grid">
      <Field label="Product Weight" value={fields.product_weight} onChange={(v) => set('product_weight', v)}/><Field label="New Shop SKU" value={fields.new_shop_sku} onChange={(v) => set('new_shop_sku', v)}/><Field label="Daraz Seller SKU" value={fields.daraz_seller_sku} onChange={(v) => set('daraz_seller_sku', v)}/><Field label="NEW SP" value={fields.new_sp} onChange={(v) => set('new_sp', v)}/><Field label="NEW COGP override" value={fields.new_cogp} onChange={(v) => set('new_cogp', v)} placeholder="Auto: TP ÷ 1.05"/><Field label="Supplier Code" value={fields.supplier_code} onChange={(v) => set('supplier_code', v)}/>
      <label><span>Product Type</span><select value={fields.product_type || ''} onChange={(e) => set('product_type', e.target.value)}><option value="">Choose…</option><option>Food</option><option>Liquid</option><option>Dangerous Goods</option><option>Other</option></select></label>
      <Field label="Reject before expiry (days)" value={fields.reject_before_expiry_days} onChange={(v) => set('reject_before_expiry_days', v)}/><Field label="Alert before expiry (days)" value={fields.alert_before_expiry_days} onChange={(v) => set('alert_before_expiry_days', v)}/><Field label="Offline before expiry (days)" value={fields.offline_before_expiry_days} onChange={(v) => set('offline_before_expiry_days', v)}/>
    </div><button className="button secondary compact" onClick={() => void onUpdate(target, { accountFields: fields, notes })} disabled={busy}>Save Daraz fields</button></div>}
    <label className="enlistment-notes"><span>Notes</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Account feedback, correction request, reference…"/><button className="button secondary compact" onClick={() => void onUpdate(target, { accountFields: fields, notes })} disabled={busy}>Save notes</button></label>
  </div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: any; onChange: (value: string) => void; placeholder?: string }) { return <label><span>{label}</span><input value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || ''}/></label>; }
