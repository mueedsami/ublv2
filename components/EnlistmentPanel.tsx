'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileSpreadsheet, PackagePlus, RefreshCw, Search, Send, Upload, X } from 'lucide-react';

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
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [bulkAccounts, setBulkAccounts] = useState<string[]>([]);
  const [exportAccount, setExportAccount] = useState('');
  const [exportType, setExportType] = useState<'xlsx'|'csv'>('xlsx');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/enlistment', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load enlistment panel.');
      setData(json);
      if (!exportAccount && json.accounts?.length) setExportAccount(json.accounts[0].code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load enlistment panel.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const products = data?.products || [];
  const accounts = data?.accounts || [];
  const openProduct = products.find((p) => p.id === openProductId) || null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      if (needle && !`${product.name} ${product.barcode || ''} ${product.brand || ''} ${product.category || ''}`.toLowerCase().includes(needle)) return false;
      const activeTargets = product.targets.filter((t) => t.selected);
      if (accountFilter !== 'all' && !activeTargets.some((t) => t.account?.code === accountFilter)) return false;
      if (statusFilter !== 'all' && !activeTargets.some((t) => t.status === statusFilter)) return false;
      return true;
    });
  }, [products, query, accountFilter, statusFilter]);

  const selectedProducts = products.filter((p) => checked.has(p.id));
  const exportEligible = selectedProducts.filter((p) => p.targets.some((t) => t.selected && t.account?.code === exportAccount));
  const pendingCount = products.reduce((sum, p) => sum + p.targets.filter((t) => t.selected && t.status !== 'enlisted').length, 0);
  const enlistedCount = products.reduce((sum, p) => sum + p.targets.filter((t) => t.selected && t.status === 'enlisted').length, 0);

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

  return <div className="page enlistment-page">
    <div className="page-head enlistment-head">
      <div><span className="eyebrow">Enlistment Panel</span><h1>Product enlistment workspace</h1><p>Upload the UBL enlistment master once, manually choose target accounts, track account-wise progress, and export each marketplace in the format it requires.</p></div>
      <div className="enlistment-head-actions">
        <input ref={fileRef} type="file" accept=".csv,.xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void inspectFile(f); }} />
        <button className="button" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={16}/>{busy ? 'Working…' : 'Upload enlistment file'}</button>
        <button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>Refresh</button>
      </div>
    </div>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}

    {preview && <section className="card enlistment-preview-card">
      <div className="card-head"><div><span className="eyebrow">Import preview</span><h2>{preview.fileName}</h2><p>{preview.rowsTotal} product rows detected. Source platform columns will not assign accounts or statuses.</p></div><button className="icon-button" onClick={() => { setPreview(null); setPendingFile(null); }}><X size={18}/></button></div>
      <div className="enlistment-preview-stats"><div><strong>{preview.rowsTotal}</strong><span>Products</span></div><div><strong>{preview.sourceColumns.length}</strong><span>Source columns</span></div><div><strong>{preview.warnings.length}</strong><span>Warnings</span></div></div>
      {preview.warnings.map((warning) => <div className="alert warning" key={warning}>{warning}</div>)}
      <div className="table-wrap"><table><thead><tr><th>Row</th><th>Barcode</th><th>Product</th><th>Brand</th><th>Category</th><th>TP</th><th>MRP</th></tr></thead><tbody>{preview.sample.map((row) => <tr key={`${row.sourceRow}-${row.barcode}`}><td>{row.sourceRow}</td><td>{row.barcode || '—'}</td><td><strong>{row.name}</strong></td><td>{row.brand || '—'}</td><td>{row.category || '—'}</td><td>{row.tp || '—'}</td><td>{row.mrp || '—'}</td></tr>)}</tbody></table></div>
      <div className="enlistment-preview-actions"><button className="button" onClick={() => void commitImport()} disabled={busy}><PackagePlus size={16}/>Import products</button><span>Existing products are updated by barcode; their account selections and statuses are preserved.</span></div>
    </section>}

    <section className="enlistment-kpis">
      <div className="kpi hero"><span>Products</span><strong>{products.length}</strong><small>Current enlistment master</small></div>
      <div className="kpi"><span>Selected account tasks</span><strong>{pendingCount + enlistedCount}</strong><small>Across all products</small></div>
      <div className="kpi"><span>Still in progress</span><strong>{pendingCount}</strong><small>Selected accounts not yet enlisted</small></div>
      <div className="kpi"><span>Enlisted</span><strong>{enlistedCount}</strong><small>Account-product confirmations</small></div>
    </section>

    <section className="card enlistment-toolbar-card">
      <div className="enlistment-filter-row">
        <label className="enlistment-search"><span>Search</span><div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Product, barcode, brand or category"/></div></label>
        <label><span>Target account</span><select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}><option value="all">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.code}>{a.name}</option>)}</select></label>
        <label><span>Status</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option>{(data?.statuses || []).map((s) => <option key={s} value={s}>{statusLabels[s] || s}</option>)}</select></label>
      </div>

      <div className="enlistment-bulk-row">
        <div><strong>{checked.size}</strong><span> selected</span></div>
        <div className="enlistment-account-pills">{accounts.map((a) => <label key={a.id} className={bulkAccounts.includes(a.code) ? 'selected' : ''}><input type="checkbox" checked={bulkAccounts.includes(a.code)} onChange={(e) => setBulkAccounts((old) => e.target.checked ? [...old, a.code] : old.filter((x) => x !== a.code))}/><span>{a.name}</span></label>)}</div>
        <button className="button secondary" onClick={() => void bulkAssign()} disabled={busy || !checked.size || !bulkAccounts.length}><Check size={16}/>Add target accounts</button>
      </div>

      <div className="enlistment-export-row">
        <div className="enlistment-export-label"><FileSpreadsheet size={17}/><div><strong>Account export</strong><span>Only selected products already targeted to the chosen account are exported.</span></div></div>
        <select value={exportAccount} onChange={(e) => setExportAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.code}>{a.name} · {accountFormat(a.code)}</option>)}</select>
        <select value={exportType} onChange={(e) => setExportType(e.target.value as 'xlsx'|'csv')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select>
        <button className="button" onClick={() => void downloadExport()} disabled={busy || !checked.size || !exportEligible.length}><Download size={16}/>Export {exportEligible.length || ''}</button>
      </div>
    </section>

    <section className="card">
      <div className="card-head"><div><h2>Enlistment master</h2><p>{filtered.length} of {products.length} products shown. Target accounts are always chosen manually in this panel.</p></div></div>
      {loading ? <div className="empty">Loading enlistments…</div> : !products.length ? <div className="empty"><PackagePlus size={28}/><strong>No enlistments yet</strong><span>Upload your UBL product enlistment CSV or XLSX to start.</span></div> : <div className="table-wrap"><table className="enlistment-table"><thead><tr><th><input type="checkbox" checked={filtered.length > 0 && filtered.every((p) => checked.has(p.id))} onChange={(e) => setChecked((old) => { const next = new Set(old); filtered.forEach((p) => e.target.checked ? next.add(p.id) : next.delete(p.id)); return next; })}/></th><th>Product</th><th>Barcode</th><th>Commercial</th><th>Target accounts</th><th>Updated</th><th></th></tr></thead><tbody>
        {filtered.map((product) => { const activeTargets = product.targets.filter((t) => t.selected); return <tr key={product.id} className={openProductId === product.id ? 'active-row' : ''}>
          <td><input type="checkbox" checked={checked.has(product.id)} onChange={() => toggleCheck(product.id)}/></td>
          <td><strong>{product.name}</strong><small>{product.brand || '—'} · {product.category || '—'}</small></td>
          <td><span className="mono">{product.barcode || '—'}</span></td>
          <td><strong>{money(product.tp)} TP</strong><small>{money(product.mrp)} MRP</small></td>
          <td>{activeTargets.length ? <div className="enlistment-status-pills">{activeTargets.map((target) => <span key={target.id} className={`dashboard-badge ${statusClass[target.status] || 'neutral'}`}>{target.account?.name || 'Account'} · {statusLabels[target.status] || target.status}</span>)}</div> : <span className="muted">No account selected</span>}</td>
          <td>{formatDate(product.updated_at)}</td>
          <td><button className="button secondary compact" onClick={() => setOpenProductId(product.id)}>Open</button></td>
        </tr>; })}
      </tbody></table></div>}
    </section>

    {openProduct && <ProductDrawer product={openProduct} accounts={accounts} statuses={data?.statuses || []} busy={busy} onClose={() => setOpenProductId(null)} onSetAccounts={setAccounts} onUpdateTarget={updateTarget}/>} 

    {!!data?.exports?.length && <section className="card enlistment-history-card"><div className="card-head"><div><h2>Recent exports</h2><p>Downloading a file does not automatically mark anything as sent or enlisted.</p></div></div><div className="enlistment-history-list">{data.exports.map((row: any) => <div key={row.id}><div><strong>{row.account?.name || 'Account'}</strong><span>{row.file_name}</span></div><div><span>{row.row_count} products</span><span>{row.export_format}</span><span>{formatDate(row.exported_at)}</span></div></div>)}</div></section>}
  </div>;
}

function ProductDrawer({ product, accounts, statuses, busy, onClose, onSetAccounts, onUpdateTarget }: {
  product: Product; accounts: Account[]; statuses: string[]; busy: boolean; onClose: () => void;
  onSetAccounts: (product: Product, codes: string[]) => Promise<void>;
  onUpdateTarget: (target: Target, patch: { status?: string; accountFields?: Record<string, any>; notes?: string }) => Promise<void>;
}) {
  const selected = product.targets.filter((t) => t.selected).map((t) => t.account?.code).filter(Boolean) as string[];
  const [chosen, setChosen] = useState<string[]>(selected);

  useEffect(() => setChosen(selected), [product.id, product.targets.map((t) => `${t.id}:${t.selected}`).join('|')]);

  return <div className="enlistment-drawer-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}><aside className="enlistment-drawer">
    <div className="enlistment-drawer-head"><div><span className="eyebrow">Enlistment detail</span><h2>{product.name}</h2><p>{product.brand || '—'} · {product.barcode || 'No barcode'}</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>

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
