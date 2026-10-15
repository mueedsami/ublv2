'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, PackagePlus, Search, Trash2, UploadCloud } from 'lucide-react';

const ACCOUNTS = [
  { code: 'pandamart', name: 'Pandamart' },
  { code: 'shajgoj', name: 'Shajgoj' },
  { code: 'othoba', name: 'Othoba' },
  { code: 'cartup', name: 'Cartup' },
];

type KeywordRow = {
  id: string;
  keyword: string;
  normalizedKey: string;
  format: string;
  updatedAt: string;
  terms: Array<{ id: string; searchTerm: string; isPrimary: boolean }>;
  targets: Array<{
    id: string;
    productId: string | null;
    basepackId: string | null;
    accountSku: string | null;
    targetName: string;
    assignmentSource: 'manual' | 'import';
    matchScore: number | null;
  }>;
  unresolvedTargets: Array<{
    id: string;
    sourceSku: string | null;
    sourceName: string;
    suggestedSku: string | null;
    mappingStatus: string;
    matchScore: number | null;
  }>;
};

type ImportPreview = {
  valid: boolean;
  accountCode: string;
  fileName: string;
  parserProfile: string;
  sheetName: string;
  rowsTotal: number;
  keywordCount: number;
  searchTermsTotal: number;
  targetRowsTotal: number;
  mappedTargetsTotal: number;
  unresolvedTargetsTotal: number;
  fuzzyMatches: number;
  warnings: string[];
  keywords: Array<{
    keyword: string;
    format: string;
    expectedTargetCount: number | null;
    terms: string[];
    targets: Array<{
      sourceSku: string;
      sourceName: string;
      matchedSku: string;
      matchedName: string;
      mappingStatus: string;
      matchScore: number | null;
      accepted: boolean;
    }>;
  }>;
};

type ProductSearchRow = {
  account_sku: string;
  product_id: string;
  basepack_id: string;
  packsize: string | null;
  ubl_code: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
};

export default function SosKeywordManager() {
  const [accountCode, setAccountCode] = useState('pandamart');
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<ProductSearchRow[]>([]);
  const [productBusy, setProductBusy] = useState(false);

  async function loadKeywords(nextAccount = accountCode) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/sos/keywords?account=${encodeURIComponent(nextAccount)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load keywords.');
      setKeywords(json.keywords || []);
      setSelectedId((current) => (json.keywords || []).some((row: KeywordRow) => row.id === current) ? current : (json.keywords?.[0]?.id || ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load keywords.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadKeywords(accountCode); }, [accountCode]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return keywords;
    return keywords.filter((row) => [row.keyword, row.format, ...row.terms.map((term) => term.searchTerm), ...row.targets.map((target) => target.targetName)]
      .join(' ')
      .toLowerCase()
      .includes(needle));
  }, [keywords, query]);

  const selected = useMemo(() => keywords.find((row) => row.id === selectedId) || null, [keywords, selectedId]);
  const totals = useMemo(() => ({
    keywords: keywords.length,
    terms: keywords.reduce((sum, row) => sum + row.terms.length, 0),
    targets: keywords.reduce((sum, row) => sum + row.targets.length, 0),
    withoutTargets: keywords.filter((row) => row.targets.length === 0).length,
    unresolved: keywords.reduce((sum, row) => sum + row.unresolvedTargets.length, 0),
  }), [keywords]);

  function switchAccount(code: string) {
    setAccountCode(code);
    setFile(null);
    setPreview(null);
    setProducts([]);
    setProductQuery('');
    setSuccess('');
    setError('');
  }

  async function importWorkbook(mode: 'preview' | 'commit') {
    if (!file) return;
    setImportBusy(true);
    setError('');
    if (mode === 'preview') setSuccess('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('account', accountCode);
      fd.append(mode === 'preview' ? 'preview' : 'confirmed', 'true');
      const res = await fetch('/api/sos/keywords/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Keyword import failed.');
      if (mode === 'preview') {
        setPreview(json);
      } else {
        setSuccess(`${ACCOUNTS.find((account) => account.code === accountCode)?.name || accountCode} keyword library updated: ${json.keywordCount} main keywords, ${json.searchTermsTotal} search terms and ${json.mappedTargetsTotal} mapped target products.`);
        setPreview(null);
        setFile(null);
        await loadKeywords(accountCode);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Keyword import failed.');
    } finally {
      setImportBusy(false);
    }
  }

  async function searchProducts() {
    if (!productQuery.trim()) return;
    setProductBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/sos/products?account=${encodeURIComponent(accountCode)}&q=${encodeURIComponent(productQuery.trim())}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Product search failed.');
      setProducts(json.products || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Product search failed.');
    } finally {
      setProductBusy(false);
    }
  }

  async function assignProduct(product: ProductSearchRow) {
    if (!selected) return;
    setProductBusy(true);
    setError('');
    try {
      const res = await fetch('/api/sos/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywordId: selected.id,
          accountCode,
          productId: product.product_id,
          basepackId: product.basepack_id,
          accountSku: product.account_sku,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not assign product.');
      setSuccess(json.alreadyAssigned ? `${product.product_name} is already assigned.` : `${product.product_name} assigned to ${selected.keyword}.`);
      await loadKeywords(accountCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign product.');
    } finally {
      setProductBusy(false);
    }
  }

  async function removeTarget(id: string) {
    setProductBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/sos/targets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not remove target.');
      await loadKeywords(accountCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove target.');
    } finally {
      setProductBusy(false);
    }
  }

  return <div className="page sos-keyword-page">
    <div className="page-head">
      <div>
        <div className="eyebrow">Share of Search · Phase 1</div>
        <h1>Keyword & Target Product Library</h1>
        <p>Import the account keyword workbook, review every search term, and define which UBL products are expected to appear for each main keyword.</p>
      </div>
    </div>

    {error && <div className="alert error sos-top-alert">{error}</div>}
    {success && <div className="alert success sos-top-alert"><CheckCircle2 size={17}/>{success}</div>}

    <div className="sos-account-tabs">
      {ACCOUNTS.map((account) => <button key={account.code} className={accountCode === account.code ? 'active' : ''} onClick={() => switchAccount(account.code)}>{account.name}</button>)}
    </div>

    <section className="card sos-import-card">
      <div className="card-head">
        <div><h2>Import keyword workbook</h2><p>Uses the current account-wise workbook structure. Import replaces that account's active search terms, while manual target assignments are preserved.</p></div>
      </div>
      <div className="sos-import-body">
        <label className="dropzone sos-dropzone">
          <FileSpreadsheet size={25}/>
          <strong>{file?.name || `Choose ${ACCOUNTS.find((account) => account.code === accountCode)?.name} keyword workbook`}</strong>
          <span>Excel .xlsx · existing format supported</span>
          <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setError(''); setSuccess(''); }}/>
        </label>
        <div className="action-row sos-import-actions">
          <button className="button" disabled={!file || importBusy} onClick={() => void importWorkbook('preview')}><UploadCloud size={16}/>{importBusy ? 'Reading…' : 'Preview import'}</button>
        </div>
      </div>

      {preview && <div className="preview-panel sos-import-preview">
        <div className="alert success sos-inline-alert"><CheckCircle2 size={17}/><div><strong>{preview.parserProfile}</strong><div>Detected sheet: {preview.sheetName}</div></div></div>
        <div className="preview-grid sos-preview-grid">
          <div><span>Main keywords</span><strong>{preview.keywordCount}</strong></div>
          <div><span>Search terms</span><strong>{preview.searchTermsTotal}</strong></div>
          <div><span>Target rows</span><strong>{preview.targetRowsTotal}</strong></div>
          <div><span>Auto-mapped</span><strong>{preview.mappedTargetsTotal}</strong></div>
          <div><span>Need review</span><strong>{preview.unresolvedTargetsTotal}</strong></div>
          <div><span>Fuzzy accepted</span><strong>{preview.fuzzyMatches}</strong></div>
        </div>
        {preview.warnings.map((warning) => <div className="alert warning" key={warning}>{warning}</div>)}
        <div className="table-wrap mini sos-preview-table"><table><thead><tr><th>Format</th><th>Keyword</th><th>Search terms</th><th>Targets</th><th>Mapped</th></tr></thead><tbody>
          {preview.keywords.slice(0, 12).map((keyword) => <tr key={`${keyword.format}-${keyword.keyword}`}><td>{keyword.format}</td><td><strong>{keyword.keyword}</strong></td><td>{keyword.terms.join(', ')}</td><td>{keyword.targets.length}</td><td>{keyword.targets.filter((target) => target.accepted).length}</td></tr>)}
        </tbody></table></div>
        <button className="button danger-safe" disabled={importBusy} onClick={() => void importWorkbook('commit')}><UploadCloud size={16}/>Import this keyword set</button>
      </div>}
    </section>

    <div className="sos-kpi-grid">
      <div className="kpi"><span>Main keywords</span><strong>{totals.keywords}</strong><small>Canonical keyword groups for this account</small></div>
      <div className="kpi"><span>Search terms</span><strong>{totals.terms}</strong><small>Terms the scraper will eventually search</small></div>
      <div className="kpi"><span>Assigned targets</span><strong>{totals.targets}</strong><small>Expected UBL marketplace products</small></div>
      <div className="kpi"><span>Need review</span><strong>{totals.unresolved}</strong><small>Workbook target rows not confidently mapped</small></div>
    </div>

    <div className="sos-library-grid">
      <section className="card sos-keyword-list-card">
        <div className="card-head"><div><h2>Keyword library</h2><p>{loading ? 'Loading…' : `${filtered.length} keyword group(s)`}</p></div></div>
        <div className="toolbar">
          <div className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search keyword, format or target product…"/></div>
        </div>
        <div className="sos-keyword-list">
          {!loading && !filtered.length && <div className="empty">No keyword file has been imported for this account yet.</div>}
          {filtered.map((row) => <button key={row.id} className={`sos-keyword-row ${selectedId === row.id ? 'selected' : ''}`} onClick={() => { setSelectedId(row.id); setProducts([]); setProductQuery(''); }}>
            <div className="sos-keyword-row-top"><div><span className="sos-format-label">{row.format}</span><strong>{row.keyword}</strong></div><span className={`sos-target-count ${row.unresolvedTargets.length ? 'empty-target' : row.targets.length ? 'ready' : 'empty-target'}`}>{row.targets.length} target{row.targets.length === 1 ? '' : 's'}{row.unresolvedTargets.length ? ` · ${row.unresolvedTargets.length} review` : ''}</span></div>
            <div className="sos-term-chips">{row.terms.slice(0, 6).map((term) => <span key={term.id} className={term.isPrimary ? 'primary' : ''}>{term.searchTerm}</span>)}{row.terms.length > 6 && <span>+{row.terms.length - 6}</span>}</div>
          </button>)}
        </div>
      </section>

      <section className="card sos-target-card">
        {!selected ? <div className="empty">Choose a keyword to assign its target products.</div> : <>
          <div className="card-head"><div><h2>{selected.keyword}</h2><p>{selected.format} · {selected.terms.length} search term{selected.terms.length === 1 ? '' : 's'}</p></div></div>
          <div className="sos-target-body">
            <div className="sos-detail-section">
              <div className="sos-section-title"><div><strong>Search terms</strong><span>These terms will feed the account scraper in Phase 2.</span></div></div>
              <div className="sos-term-chips large">{selected.terms.map((term) => <span key={term.id} className={term.isPrimary ? 'primary' : ''}>{term.searchTerm}</span>)}</div>
            </div>

            {selected.unresolvedTargets.length > 0 && <div className="sos-detail-section">
              <div className="sos-section-title"><div><strong>Needs mapping from workbook</strong><span>These expected products were present in the source file but could not be confidently linked to the current V2 marketplace master.</span></div></div>
              <div className="sos-target-list">{selected.unresolvedTargets.map((target) => <div className="sos-target-item unresolved" key={target.id}><div><strong>{target.sourceName}</strong><span>{target.sourceSku || 'No usable source SKU'} · {target.mappingStatus}{target.matchScore ? ` · score ${Number(target.matchScore).toFixed(2)}` : ''}</span></div></div>)}</div>
            </div>}

            <div className="sos-detail-section">
              <div className="sos-section-title"><div><strong>Target products</strong><span>Only these products count toward Target Achievement. Other UBL products will still count toward UBL SoS later.</span></div></div>
              {!selected.targets.length ? <div className="sos-empty-target">No target product assigned yet.</div> : <div className="sos-target-list">
                {selected.targets.map((target) => <div className="sos-target-item" key={target.id}><div><strong>{target.targetName}</strong><span>{target.accountSku || 'No marketplace SKU'} · {target.assignmentSource === 'import' ? 'Imported' : 'Manual'}</span></div><button title="Remove target" disabled={productBusy} onClick={() => void removeTarget(target.id)}><Trash2 size={15}/></button></div>)}
              </div>}
            </div>

            <div className="sos-detail-section">
              <div className="sos-section-title"><div><strong>Assign from UBL master</strong><span>Search the current {ACCOUNTS.find((account) => account.code === accountCode)?.name} marketplace mapping.</span></div></div>
              <div className="sos-product-search"><div className="search-box"><Search size={16}/><input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void searchProducts(); }} placeholder="Product name, brand or marketplace SKU…"/></div><button className="button secondary" disabled={!productQuery.trim() || productBusy} onClick={() => void searchProducts()}>{productBusy ? 'Searching…' : 'Search'}</button></div>
              <div className="sos-product-results">
                {products.map((product) => {
                  const assigned = selected.targets.some((target) => target.accountSku === product.account_sku && target.basepackId === product.basepack_id);
                  return <div className="sos-product-result" key={`${product.account_sku}-${product.basepack_id}`}><div><strong>{product.product_name}</strong><span>{product.brand || 'UBL'} · {product.account_sku} {product.packsize ? `· ${product.packsize}` : ''}</span></div><button className="button compact" disabled={assigned || productBusy} onClick={() => void assignProduct(product)}><PackagePlus size={15}/>{assigned ? 'Assigned' : 'Assign'}</button></div>;
                })}
              </div>
            </div>
          </div>
        </>}
      </section>
    </div>
  </div>;
}
