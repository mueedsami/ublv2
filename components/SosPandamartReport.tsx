'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitCompareArrows, Play, RefreshCw, Search, Target } from 'lucide-react';

type RunRow = {
  id: string;
  run_date: string;
  top_n: number;
  started_at: string;
  finished_at: string | null;
  status: 'success' | 'partial' | 'error';
  terms_expected: number;
  terms_scraped: number;
  rows_observed: number;
  error_count: number;
  message: string | null;
};

type KeywordMetric = {
  run_id: string;
  keyword_id: string;
  format: string;
  keyword: string;
};

type TermMetric = {
  run_id: string;
  keyword_id: string;
  term_id: string;
  searched_term: string;
  branch_code: string;
  branch_name: string | null;
  status: 'ok' | 'error';
  total_found: number;
  results_saved: number;
  top_n: number;
  top_slots: number | null;
  results_found: number | null;
  ubl_count: number | null;
  non_target_ubl_count: number | null;
  competitor_count: number | null;
  target_hits: number | null;
  assigned_targets: number;
  ubl_sos: number | null;
  target_achievement: number | null;
};

type ResultRow = {
  id: string;
  keyword_id: string;
  term_id: string;
  branch_code: string;
  branch_name: string | null;
  searched_term: string;
  rank: number;
  marketplace_sku: string | null;
  product_name: string;
  size: string | null;
  price: number | null;
  sale_price: number | null;
  stock_qty: number | null;
  in_stock: boolean | null;
  product_url: string | null;
  matched_brand: string | null;
  is_ubl: boolean;
  is_target: boolean;
  classification: 'target_ubl' | 'ubl_non_target' | 'competitor';
  ubl_match_method: string;
  ubl_match_score: number | null;
};

type BranchOption = { code: string; name: string };

type ReportResponse = {
  configuration?: {
    unresolvedTargets?: number;
    latestImport?: { search_terms_total?: number; mapped_targets_total?: number } | null;
    configuredBranches?: BranchOption[];
    pendingBranches?: BranchOption[];
  };
  runs: RunRow[];
  run: RunRow | null;
  keywordMetrics: KeywordMetric[];
  termMetrics: TermMetric[];
  results: ResultRow[];
};

type AggregateRow = {
  key: string;
  label: string;
  keyword_id?: string;
  format?: string;
  keyword?: string;
  branch_code?: string;
  branch_name?: string;
  terms_attempted: number;
  terms_scraped: number;
  terms_failed: number;
  top_slots: number;
  ubl_count: number;
  target_hits: number;
  target_opportunities: number;
  non_target_ubl_count: number;
  competitor_count: number;
  ubl_sos: number | null;
  target_achievement: number | null;
};

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function classificationLabel(value: ResultRow['classification']): string {
  if (value === 'target_ubl') return 'Target UBL';
  if (value === 'ubl_non_target') return 'UBL – non-target';
  return 'Competitor';
}

function aggregateRows(
  rows: TermMetric[],
  groupKey: (row: TermMetric) => string,
  describe: (row: TermMetric) => Partial<AggregateRow>,
): AggregateRow[] {
  const grouped = new Map<string, { first: TermMetric; rows: TermMetric[] }>();
  for (const row of rows) {
    const key = groupKey(row);
    const current = grouped.get(key);
    if (current) current.rows.push(row);
    else grouped.set(key, { first: row, rows: [row] });
  }

  return Array.from(grouped.entries()).map(([key, group]) => {
    const ok = group.rows.filter((row) => row.status === 'ok');
    const topSlots = ok.reduce((sum, row) => sum + numeric(row.top_slots), 0);
    const ublCount = ok.reduce((sum, row) => sum + numeric(row.ubl_count), 0);
    const targetHits = ok.reduce((sum, row) => sum + numeric(row.target_hits), 0);
    const targetOpportunities = ok.reduce((sum, row) => sum + numeric(row.assigned_targets), 0);
    const nonTargetUbl = ok.reduce((sum, row) => sum + numeric(row.non_target_ubl_count), 0);
    const competitors = ok.reduce((sum, row) => sum + numeric(row.competitor_count), 0);
    return {
      key,
      label: key,
      terms_attempted: group.rows.length,
      terms_scraped: ok.length,
      terms_failed: group.rows.length - ok.length,
      top_slots: topSlots,
      ubl_count: ublCount,
      target_hits: targetHits,
      target_opportunities: targetOpportunities,
      non_target_ubl_count: nonTargetUbl,
      competitor_count: competitors,
      ubl_sos: topSlots ? ublCount / topSlots : null,
      target_achievement: targetOpportunities ? targetHits / targetOpportunities : null,
      ...describe(group.first),
    };
  });
}

export default function SosPandamartReport() {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [runBranch, setRunBranch] = useState('Uttara');
  const [branchFilter, setBranchFilter] = useState('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [keywordFilter, setKeywordFilter] = useState('all');
  const [termFilter, setTermFilter] = useState('all');
  const [classificationFilter, setClassificationFilter] = useState('all');
  const [resultQuery, setResultQuery] = useState('');

  async function load(runId = '') {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (runId) params.set('runId', runId);
      const query = params.toString();
      const res = await fetch(`/api/sos/pandamart/report${query ? `?${query}` : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load Pandamart SoS report.');
      setData(json);
      const configured = json?.configuration?.configuredBranches || [];
      if (configured.length && !configured.some((branch: BranchOption) => branch.code === runBranch)) setRunBranch(configured[0].code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Pandamart SoS report.');
    } finally {
      setLoading(false);
    }
  }

  async function runScrape(branchCodes: string[], label: string) {
    setRunning(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/sos/pandamart/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topN: 4, branchCodes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Pandamart SoS scrape failed.');
      setSuccess(`${label} complete: ${json.termsScraped}/${json.termsExpected} branch × keyword searches · ${json.rowsObserved} top-result rows · ${json.elapsedSeconds}s.`);
      setBranchFilter('all');
      setFormatFilter('all');
      setKeywordFilter('all');
      setTermFilter('all');
      setClassificationFilter('all');
      setResultQuery('');
      await load(json.runId || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pandamart SoS scrape failed.');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const configuredBranches = data?.configuration?.configuredBranches || [];
  const pendingBranches = data?.configuration?.pendingBranches || [];
  const keywordMetrics = data?.keywordMetrics || [];
  const termMetrics = data?.termMetrics || [];
  const results = data?.results || [];
  const keywordMap = useMemo(() => new Map(keywordMetrics.map((row) => [row.keyword_id, row])), [keywordMetrics]);

  const runBranches = useMemo(() => {
    const found = new Map<string, string>();
    for (const row of termMetrics) found.set(row.branch_code, row.branch_name || row.branch_code);
    return configuredBranches.filter((branch) => found.has(branch.code)).map((branch) => ({ code: branch.code, name: found.get(branch.code) || branch.name }));
  }, [termMetrics, configuredBranches]);

  const formats = useMemo(() => Array.from(new Set(keywordMetrics.map((row) => row.format))).sort(), [keywordMetrics]);
  const keywords = useMemo(() => keywordMetrics
    .filter((row) => formatFilter === 'all' || row.format === formatFilter)
    .map((row) => ({ id: row.keyword_id, label: row.keyword }))
    .sort((a, b) => a.label.localeCompare(b.label)), [keywordMetrics, formatFilter]);
  const terms = useMemo(() => {
    const unique = new Map<string, string>();
    for (const row of termMetrics) {
      const keyword = keywordMap.get(row.keyword_id);
      if (formatFilter !== 'all' && keyword?.format !== formatFilter) continue;
      if (keywordFilter !== 'all' && row.keyword_id !== keywordFilter) continue;
      unique.set(row.term_id, row.searched_term);
    }
    return Array.from(unique.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [termMetrics, keywordMap, formatFilter, keywordFilter]);

  useEffect(() => {
    if (keywordFilter !== 'all' && !keywords.some((row) => row.id === keywordFilter)) setKeywordFilter('all');
  }, [formatFilter, keywordFilter, keywords]);
  useEffect(() => {
    if (termFilter !== 'all' && !terms.some((row) => row.id === termFilter)) setTermFilter('all');
  }, [keywordFilter, formatFilter, termFilter, terms]);
  useEffect(() => {
    if (branchFilter !== 'all' && !runBranches.some((row) => row.code === branchFilter)) setBranchFilter('all');
  }, [branchFilter, runBranches]);

  const filteredTerms = useMemo(() => termMetrics.filter((row) => {
    const keyword = keywordMap.get(row.keyword_id);
    if (branchFilter !== 'all' && row.branch_code !== branchFilter) return false;
    if (formatFilter !== 'all' && keyword?.format !== formatFilter) return false;
    if (keywordFilter !== 'all' && row.keyword_id !== keywordFilter) return false;
    if (termFilter !== 'all' && row.term_id !== termFilter) return false;
    return true;
  }), [termMetrics, keywordMap, branchFilter, formatFilter, keywordFilter, termFilter]);

  const comparisonTerms = useMemo(() => termMetrics.filter((row) => {
    const keyword = keywordMap.get(row.keyword_id);
    if (formatFilter !== 'all' && keyword?.format !== formatFilter) return false;
    if (keywordFilter !== 'all' && row.keyword_id !== keywordFilter) return false;
    if (termFilter !== 'all' && row.term_id !== termFilter) return false;
    return true;
  }), [termMetrics, keywordMap, formatFilter, keywordFilter, termFilter]);

  const keywordRows = useMemo(() => aggregateRows(
    filteredTerms,
    (row) => row.keyword_id,
    (row) => {
      const keyword = keywordMap.get(row.keyword_id);
      return { keyword_id: row.keyword_id, format: keyword?.format || 'Unmapped', keyword: keyword?.keyword || 'Unknown', label: keyword?.keyword || 'Unknown' };
    },
  ).sort((a, b) => `${a.format} ${a.keyword}`.localeCompare(`${b.format} ${b.keyword}`)), [filteredTerms, keywordMap]);

  const branchRows = useMemo(() => aggregateRows(
    comparisonTerms,
    (row) => row.branch_code,
    (row) => ({ branch_code: row.branch_code, branch_name: row.branch_name || row.branch_code, label: row.branch_name || row.branch_code }),
  ).sort((a, b) => {
    const ai = configuredBranches.findIndex((branch) => branch.code === a.branch_code);
    const bi = configuredBranches.findIndex((branch) => branch.code === b.branch_code);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  }), [comparisonTerms, configuredBranches]);

  const filteredResults = useMemo(() => {
    const q = resultQuery.trim().toLowerCase();
    return results.filter((row) => {
      const keyword = keywordMap.get(row.keyword_id);
      if (branchFilter !== 'all' && row.branch_code !== branchFilter) return false;
      if (formatFilter !== 'all' && keyword?.format !== formatFilter) return false;
      if (keywordFilter !== 'all' && row.keyword_id !== keywordFilter) return false;
      if (termFilter !== 'all' && row.term_id !== termFilter) return false;
      if (classificationFilter !== 'all' && row.classification !== classificationFilter) return false;
      if (q) {
        const haystack = [row.product_name, row.marketplace_sku || '', row.searched_term, row.matched_brand || '', row.branch_name || '', keyword?.keyword || '', keyword?.format || ''].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [results, keywordMap, branchFilter, formatFilter, keywordFilter, termFilter, classificationFilter, resultQuery]);

  const summary = useMemo(() => {
    const okTerms = filteredTerms.filter((row) => row.status === 'ok');
    const topSlots = okTerms.reduce((sum, row) => sum + numeric(row.top_slots), 0);
    const ublCount = okTerms.reduce((sum, row) => sum + numeric(row.ubl_count), 0);
    const targetHits = okTerms.reduce((sum, row) => sum + numeric(row.target_hits), 0);
    const targetOpportunities = okTerms.reduce((sum, row) => sum + numeric(row.assigned_targets), 0);
    const nonTargetUbl = okTerms.reduce((sum, row) => sum + numeric(row.non_target_ubl_count), 0);
    const competitors = okTerms.reduce((sum, row) => sum + numeric(row.competitor_count), 0);
    return {
      ublSos: topSlots ? ublCount / topSlots : null,
      targetAchievement: targetOpportunities ? targetHits / targetOpportunities : null,
      topSlots, ublCount, targetHits, targetOpportunities, nonTargetUbl, competitors,
      termsOk: okTerms.length, termsTotal: filteredTerms.length,
      failed: filteredTerms.filter((row) => row.status === 'error').length,
    };
  }, [filteredTerms]);

  const needsAttention = useMemo(() => keywordRows
    .filter((row) => row.target_opportunities > 0 && numeric(row.target_achievement) < 0.999999)
    .sort((a, b) => numeric(a.target_achievement) - numeric(b.target_achievement)), [keywordRows]);

  const termCount = Number(data?.configuration?.latestImport?.search_terms_total || 0);
  const selectedBranch = configuredBranches.find((branch) => branch.code === runBranch);

  return <div className="page sos-report-page">
    <div className="page-head sos-report-head">
      <div>
        <div className="eyebrow">Share of Search · Phase 3</div>
        <h1>Pandamart SoS Intelligence</h1>
        <p>Branch-aware top-4 search visibility. UBL SoS and expected target-product achievement are measured separately.</p>
      </div>
      <div className="sos-panda-run-controls">
        <label><span>Test / selected branch</span><select value={runBranch} disabled={running} onChange={(e) => setRunBranch(e.target.value)}>{configuredBranches.map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label>
        <button className="button secondary" disabled={running || !configuredBranches.length} onClick={() => void runScrape([runBranch], selectedBranch?.name || runBranch)}>{running ? <RefreshCw className="spin" size={16}/> : <Play size={16}/>}Run selected branch</button>
        <button className="button" disabled={running || !configuredBranches.length} onClick={() => void runScrape(configuredBranches.map((branch) => branch.code), `All ${configuredBranches.length} branches`)}>{running ? <RefreshCw className="spin" size={16}/> : <GitCompareArrows size={16}/>}Run all {configuredBranches.length} branches</button>
      </div>
    </div>

    {error && <div className="alert error sos-top-alert">{error}</div>}
    {success && <div className="alert success sos-top-alert"><CheckCircle2 size={17}/>{success}</div>}
    {Boolean(data?.configuration?.unresolvedTargets) && <div className="alert warning sos-top-alert"><AlertTriangle size={17}/>{data?.configuration?.unresolvedTargets} Pandamart workbook target row(s) still need mapping. They are excluded from Target Achievement until assigned.</div>}
    {pendingBranches.length > 0 && <div className="alert warning sos-top-alert"><AlertTriangle size={17}/>SoS search is currently configured for {configuredBranches.length} Pandamart branches. Vendor IDs are still needed for {pendingBranches.length} store branch(es): {pendingBranches.map((branch) => branch.name).join(', ')}. Central DC is intentionally not treated as a customer search branch.</div>}

    <section className="card sos-panda-launch-card">
      <div className="sos-panda-launch-grid">
        <div><span>Imported search terms</span><strong>{termCount || '—'}</strong><small>from the Pandamart keyword set</small></div>
        <div><span>Configured search branches</span><strong>{configuredBranches.length}</strong><small>with known Pandamart vendor IDs</small></div>
        <div><span>Selected-branch workload</span><strong>{termCount || '—'}</strong><small>API searches</small></div>
        <div><span>All-branch workload</span><strong>{termCount ? termCount * configuredBranches.length : '—'}</strong><small>branch × keyword searches</small></div>
      </div>
    </section>

    <section className="card sos-run-card">
      <div className="sos-run-meta">
        <div><span>Report run</span><select value={data?.run?.id || ''} disabled={!data?.runs?.length || running} onChange={(e) => void load(e.target.value)}>{(data?.runs || []).map((run) => <option key={run.id} value={run.id}>{dateTime(run.started_at)} · {run.status} · {run.terms_scraped}/{run.terms_expected} checks</option>)}</select></div>
        <div><span>Measurement</span><strong>Top 4 results per search term × branch</strong></div>
        <div><span>Current run status</span><strong className={`sos-run-status ${data?.run?.status || 'empty'}`}>{data?.run?.status || 'No run yet'}</strong></div>
        <div><span>Last completed</span><strong>{dateTime(data?.run?.finished_at)}</strong></div>
      </div>
    </section>

    {!loading && !data?.run && <section className="card"><div className="empty sos-empty-run"><Target size={26}/><strong>No Pandamart SoS run yet.</strong><span>Start with Uttara or another single branch. Once the classifications look right, run all configured branches.</span></div></section>}

    {data?.run && <>
      {data.run.error_count > 0 && <div className="alert warning sos-top-alert"><AlertTriangle size={17}/>{data.run.error_count} branch × search-term checks failed. Failed checks are excluded instead of being counted as zero.</div>}

      <section className="card sos-filter-card">
        <div className="card-head"><div><h2>Report filters</h2><p>Branch, format, keyword and result filters update every KPI and detailed table.</p></div></div>
        <div className="filters sos-report-filters sos-panda-filters">
          <label><span>Branch</span><select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}><option value="all">All branches in run</option>{runBranches.map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label>
          <label><span>Format</span><select value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)}><option value="all">All formats</option>{formats.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Main keyword</span><select value={keywordFilter} onChange={(e) => setKeywordFilter(e.target.value)}><option value="all">All keywords</option>{keywords.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
          <label><span>Searched term</span><select value={termFilter} onChange={(e) => setTermFilter(e.target.value)}><option value="all">All search terms</option>{terms.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
          <label><span>Result type</span><select value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value)}><option value="all">All result types</option><option value="target_ubl">Target UBL</option><option value="ubl_non_target">UBL – non-target</option><option value="competitor">Competitor</option></select></label>
          <label className="sos-result-search"><span>Find product</span><div className="search-box"><Search size={15}/><input value={resultQuery} onChange={(e) => setResultQuery(e.target.value)} placeholder="Product, SKU or brand…"/></div></label>
        </div>
      </section>

      <section className="sos-report-kpis">
        <div className="kpi hero"><span>UBL Share of Search</span><strong>{pct(summary.ublSos)}</strong><small>{summary.ublCount}/{summary.topSlots} measured top-4 positions are UBL</small></div>
        <div className="kpi"><span>Target Achievement</span><strong>{pct(summary.targetAchievement)}</strong><small>{summary.targetHits}/{summary.targetOpportunities} expected target appearances achieved</small></div>
        <div className="kpi"><span>Branch × terms</span><strong>{summary.termsOk}/{summary.termsTotal}</strong><small>{summary.failed ? `${summary.failed} failed and excluded` : 'All selected checks completed'}</small></div>
        <div className="kpi"><span>Target UBL hits</span><strong>{summary.targetHits}</strong><small>Distinct expected products found per search check</small></div>
        <div className="kpi"><span>UBL non-target</span><strong>{summary.nonTargetUbl}</strong><small>UBL visibility that does not meet the target assignment</small></div>
        <div className="kpi"><span>Competitor positions</span><strong>{summary.competitors}</strong><small>Non-UBL positions in the measured top 4</small></div>
      </section>

      {branchRows.length > 1 && <section className="card">
        <div className="card-head"><div><h2>Branch comparison</h2><p>Compare search visibility across branches while keeping the current format/keyword/search-term filters.</p></div></div>
        <div className="table-wrap"><table className="sos-report-table"><thead><tr><th>Branch</th><th>Checks</th><th>UBL top 4</th><th>UBL SoS</th><th>Target hits</th><th>Target achievement</th><th>UBL non-target</th><th>Competitor</th></tr></thead><tbody>
          {branchRows.map((row) => <tr key={row.key}><td><strong>{row.branch_name}</strong></td><td>{row.terms_scraped}/{row.terms_attempted}</td><td>{row.ubl_count}/{row.top_slots}</td><td><strong>{pct(row.ubl_sos)}</strong></td><td>{row.target_hits}/{row.target_opportunities}</td><td><strong>{pct(row.target_achievement)}</strong></td><td>{row.non_target_ubl_count}</td><td>{row.competitor_count}</td></tr>)}
        </tbody></table></div>
      </section>}

      {needsAttention.length > 0 && <section className="card sos-attention-card">
        <div className="card-head"><div><h2>Needs attention</h2><p>Keywords where assigned target products are not fully appearing under the currently selected branch/filter scope.</p></div></div>
        <div className="sos-attention-grid">{needsAttention.slice(0, 12).map((row) => <button key={row.key} onClick={() => { if (row.format) setFormatFilter(row.format); if (row.keyword_id) setKeywordFilter(row.keyword_id); setTermFilter('all'); }}><span>{row.format}</span><strong>{row.keyword}</strong><div><b>{pct(row.target_achievement)}</b> target achievement · {pct(row.ubl_sos)} UBL SoS</div><small>{row.target_hits}/{row.target_opportunities} target opportunities · {row.non_target_ubl_count} non-target UBL positions</small></button>)}</div>
      </section>}

      <section className="card">
        <div className="card-head"><div><h2>Keyword performance</h2><p>Main-keyword rollup for the currently selected branch and report filters.</p></div></div>
        <div className="table-wrap"><table className="sos-report-table"><thead><tr><th>Format</th><th>Keyword</th><th>Checks</th><th>UBL top 4</th><th>UBL SoS</th><th>Target hits</th><th>Target achievement</th><th>Non-target UBL</th><th>Competitor</th></tr></thead><tbody>
          {keywordRows.map((row) => <tr key={row.key}><td>{row.format}</td><td><strong>{row.keyword}</strong></td><td>{row.terms_scraped}/{row.terms_attempted}</td><td>{row.ubl_count}/{row.top_slots}</td><td><strong>{pct(row.ubl_sos)}</strong></td><td>{row.target_hits}/{row.target_opportunities}</td><td><strong>{pct(row.target_achievement)}</strong></td><td>{row.non_target_ubl_count}</td><td>{row.competitor_count}</td></tr>)}
          {!keywordRows.length && <tr><td colSpan={9} className="empty">No keyword rows match these filters.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Branch × search-term performance</h2><p>Each branch/search-term check has its own UBL SoS and target achievement.</p></div></div>
        <div className="table-wrap"><table className="sos-report-table"><thead><tr><th>Branch</th><th>Format</th><th>Main keyword</th><th>Searched term</th><th>Status</th><th>UBL top 4</th><th>UBL SoS</th><th>Target hits</th><th>Target achievement</th><th>Non-target UBL</th><th>Competitor</th></tr></thead><tbody>
          {filteredTerms.map((row) => { const keyword = keywordMap.get(row.keyword_id); return <tr key={`${row.branch_code}:${row.term_id}`}><td><strong>{row.branch_name || row.branch_code}</strong></td><td>{keyword?.format || '—'}</td><td>{keyword?.keyword || '—'}</td><td>{row.searched_term}</td><td><span className={`sos-term-status ${row.status}`}>{row.status}</span></td><td>{row.status === 'ok' ? `${numeric(row.ubl_count)}/${numeric(row.top_slots)}` : '—'}</td><td>{pct(row.ubl_sos)}</td><td>{row.status === 'ok' ? `${numeric(row.target_hits)}/${numeric(row.assigned_targets)}` : '—'}</td><td>{pct(row.target_achievement)}</td><td>{row.status === 'ok' ? numeric(row.non_target_ubl_count) : '—'}</td><td>{row.status === 'ok' ? numeric(row.competitor_count) : '—'}</td></tr>; })}
          {!filteredTerms.length && <tr><td colSpan={11} className="empty">No branch/search terms match these filters.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Top 4 detailed results</h2><p>{filteredResults.length} result row(s) after filters. Branch is preserved on every observation.</p></div></div>
        <div className="table-wrap"><table className="sos-result-table sos-panda-result-table"><thead><tr><th>Branch</th><th>Format</th><th>Keyword</th><th>Search term</th><th>Rank</th><th>Product</th><th>SKU</th><th>Classification</th><th>UBL match</th><th>Price</th><th>Stock</th></tr></thead><tbody>
          {filteredResults.map((row) => { const keyword = keywordMap.get(row.keyword_id); const shownPrice = row.sale_price ?? row.price; return <tr key={row.id} className={`sos-result-row ${row.classification}`}><td><strong>{row.branch_name || row.branch_code}</strong></td><td>{keyword?.format || '—'}</td><td>{keyword?.keyword || '—'}</td><td>{row.searched_term}</td><td><strong>#{row.rank}</strong></td><td><strong>{row.product_url ? <a href={row.product_url} target="_blank" rel="noreferrer">{row.product_name}</a> : row.product_name}</strong>{row.size ? <small>{row.size}</small> : null}</td><td>{row.marketplace_sku || '—'}</td><td><span className={`sos-classification ${row.classification}`}>{classificationLabel(row.classification)}</span></td><td><span>{row.ubl_match_method === 'none' ? '—' : row.ubl_match_method.replaceAll('_', ' ')}</span>{row.matched_brand ? <small>{row.matched_brand}</small> : null}</td><td>{shownPrice === null || shownPrice === undefined ? '—' : Number(shownPrice).toLocaleString()}</td><td>{row.stock_qty === null || row.stock_qty === undefined ? (row.in_stock === null ? '—' : row.in_stock ? 'In stock' : 'OOS') : Number(row.stock_qty).toLocaleString()}</td></tr>; })}
          {!filteredResults.length && <tr><td colSpan={11} className="empty">No top-4 result rows match these filters.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </div>;
}
