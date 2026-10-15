'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Play, RefreshCw, RotateCcw, Search, Target } from 'lucide-react';
import { SosComposition, SosLeaderboard, SosMetricTiles, SosRing } from '@/components/SosVisuals';

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
  terms_attempted: number;
  terms_scraped: number;
  terms_failed: number;
  top_slots: number | null;
  results_found: number | null;
  ubl_count: number | null;
  non_target_ubl_count: number | null;
  competitor_count: number | null;
  target_hits: number | null;
  target_opportunities: number | null;
  ubl_sos: number | null;
  target_achievement: number | null;
};

type TermMetric = {
  run_id: string;
  keyword_id: string;
  term_id: string;
  searched_term: string;
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

type ReportResponse = {
  configuration?: { unresolvedTargets?: number; latestImport?: any };
  runs: RunRow[];
  run: RunRow | null;
  summary: any;
  keywordMetrics: KeywordMetric[];
  termMetrics: TermMetric[];
  results: ResultRow[];
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

export default function SosShajgojReport() {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
      const res = await fetch(`/api/sos/shajgoj/report${query ? `?${query}` : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load Shajgoj SoS report.');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Shajgoj SoS report.');
    } finally {
      setLoading(false);
    }
  }

  async function runScrape() {
    setRunning(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/sos/shajgoj/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topN: 4 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Shajgoj SoS scrape failed.');
      setSuccess(`Scrape complete: ${json.termsScraped}/${json.termsExpected} search terms · ${json.rowsObserved} top-result rows saved.`);
      setFormatFilter('all');
      setKeywordFilter('all');
      setTermFilter('all');
      setClassificationFilter('all');
      setResultQuery('');
      await load(json.runId || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Shajgoj SoS scrape failed.');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const keywordMetrics = data?.keywordMetrics || [];
  const termMetrics = data?.termMetrics || [];
  const results = data?.results || [];
  const keywordMap = useMemo(() => new Map(keywordMetrics.map((row) => [row.keyword_id, row])), [keywordMetrics]);

  const formats = useMemo(() => Array.from(new Set(keywordMetrics.map((row) => row.format))).sort(), [keywordMetrics]);
  const keywords = useMemo(() => keywordMetrics
    .filter((row) => formatFilter === 'all' || row.format === formatFilter)
    .map((row) => ({ id: row.keyword_id, label: row.keyword }))
    .sort((a, b) => a.label.localeCompare(b.label)), [keywordMetrics, formatFilter]);
  const terms = useMemo(() => termMetrics
    .filter((row) => {
      const keyword = keywordMap.get(row.keyword_id);
      return (formatFilter === 'all' || keyword?.format === formatFilter)
        && (keywordFilter === 'all' || row.keyword_id === keywordFilter);
    })
    .map((row) => ({ id: row.term_id, label: row.searched_term }))
    .sort((a, b) => a.label.localeCompare(b.label)), [termMetrics, keywordMap, formatFilter, keywordFilter]);

  useEffect(() => {
    if (keywordFilter !== 'all' && !keywords.some((row) => row.id === keywordFilter)) setKeywordFilter('all');
  }, [formatFilter, keywordFilter, keywords]);
  useEffect(() => {
    if (termFilter !== 'all' && !terms.some((row) => row.id === termFilter)) setTermFilter('all');
  }, [keywordFilter, formatFilter, termFilter, terms]);

  const filteredTerms = useMemo(() => termMetrics.filter((row) => {
    const keyword = keywordMap.get(row.keyword_id);
    if (formatFilter !== 'all' && keyword?.format !== formatFilter) return false;
    if (keywordFilter !== 'all' && row.keyword_id !== keywordFilter) return false;
    if (termFilter !== 'all' && row.term_id !== termFilter) return false;
    return true;
  }), [termMetrics, keywordMap, formatFilter, keywordFilter, termFilter]);

  const filteredKeywordIds = useMemo(() => new Set(filteredTerms.map((row) => row.keyword_id)), [filteredTerms]);
  const filteredKeywords = useMemo(() => keywordMetrics.filter((row) => {
    if (formatFilter !== 'all' && row.format !== formatFilter) return false;
    if (keywordFilter !== 'all' && row.keyword_id !== keywordFilter) return false;
    if (termFilter !== 'all' && !filteredKeywordIds.has(row.keyword_id)) return false;
    return true;
  }), [keywordMetrics, formatFilter, keywordFilter, termFilter, filteredKeywordIds]);

  const filteredResults = useMemo(() => {
    const q = resultQuery.trim().toLowerCase();
    return results.filter((row) => {
      const keyword = keywordMap.get(row.keyword_id);
      if (formatFilter !== 'all' && keyword?.format !== formatFilter) return false;
      if (keywordFilter !== 'all' && row.keyword_id !== keywordFilter) return false;
      if (termFilter !== 'all' && row.term_id !== termFilter) return false;
      if (classificationFilter !== 'all' && row.classification !== classificationFilter) return false;
      if (q) {
        const haystack = [row.product_name, row.marketplace_sku || '', row.searched_term, row.matched_brand || '', keyword?.keyword || '', keyword?.format || ''].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [results, keywordMap, formatFilter, keywordFilter, termFilter, classificationFilter, resultQuery]);

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
      topSlots,
      ublCount,
      targetHits,
      targetOpportunities,
      nonTargetUbl,
      competitors,
      termsOk: okTerms.length,
      termsTotal: filteredTerms.length,
      failed: filteredTerms.filter((row) => row.status === 'error').length,
    };
  }, [filteredTerms]);

  const needsAttention = useMemo(() => [...filteredKeywords]
    .filter((row) => numeric(row.target_opportunities) > 0 && numeric(row.target_achievement) < 0.999999)
    .sort((a, b) => numeric(a.target_achievement) - numeric(b.target_achievement)), [filteredKeywords]);

  const keywordVisualRows = useMemo(() => [...filteredKeywords]
    .sort((a, b) => numeric(a.target_achievement) - numeric(b.target_achievement))
    .slice(0, 8)
    .map((row) => ({ key: row.keyword_id, label: row.keyword, note: row.format, sos: row.ubl_sos, target: row.target_achievement, danger: numeric(row.target_achievement) < 0.75 })), [filteredKeywords]);
  const strongestKeyword = useMemo(() => [...filteredKeywords].filter((row) => row.ubl_sos !== null).sort((a, b) => numeric(b.ubl_sos) - numeric(a.ubl_sos))[0] || null, [filteredKeywords]);
  const weakestTargetKeyword = needsAttention[0] || null;
  const resetFilters = () => { setFormatFilter('all'); setKeywordFilter('all'); setTermFilter('all'); setClassificationFilter('all'); setResultQuery(''); };

  return <div className="page sos-report-page">
    <div className="page-head sos-report-head">
      <div>
        <div className="eyebrow">Share of Search · Phase 2</div>
        <h1>Shajgoj SoS Intelligence</h1>
        <p>Search every active Shajgoj keyword, inspect the top 4, and separate target UBL products from other UBL visibility and competitor results.</p>
      </div>
      <div className="sos-run-actions">
        <button className="button secondary" onClick={() => void load(data?.run?.id || '')} disabled={loading || running}><RefreshCw size={16}/>{loading ? 'Loading…' : 'Refresh'}</button>
        <button className="button" onClick={() => void runScrape()} disabled={running}><Play size={16}/>{running ? 'Scraping Shajgoj…' : 'Run Shajgoj SoS scrape'}</button>
      </div>
    </div>

    {error && <div className="alert error sos-top-alert">{error}</div>}
    {success && <div className="alert success sos-top-alert"><CheckCircle2 size={17}/>{success}</div>}
    {Boolean(data?.configuration?.unresolvedTargets) && <div className="alert warning sos-top-alert"><AlertTriangle size={17}/>{data?.configuration?.unresolvedTargets} Shajgoj workbook target row(s) still need mapping. Scraping can run, but Target Achievement only uses currently assigned targets until those rows are resolved.</div>}

    <section className="card sos-run-card">
      <div className="sos-run-meta">
        <div><span>Report run</span><select value={data?.run?.id || ''} disabled={!data?.runs?.length || running} onChange={(e) => void load(e.target.value)}>{(data?.runs || []).map((run) => <option key={run.id} value={run.id}>{dateTime(run.started_at)} · {run.status} · {run.terms_scraped}/{run.terms_expected} terms</option>)}</select></div>
        <div><span>Measurement</span><strong>Top 4 results per search term</strong></div>
        <div><span>Current run status</span><strong className={`sos-run-status ${data?.run?.status || 'empty'}`}>{data?.run?.status || 'No run yet'}</strong></div>
        <div><span>Last completed</span><strong>{dateTime(data?.run?.finished_at)}</strong></div>
      </div>
    </section>

    {!loading && !data?.run && <section className="card"><div className="empty sos-empty-run"><Target size={26}/><strong>No Shajgoj SoS run yet.</strong><span>First import the Shajgoj keyword set, confirm the target products, then run the scraper from this page.</span></div></section>}

    {data?.run && <>
      {data.run.error_count > 0 && <div className="alert warning sos-top-alert"><AlertTriangle size={17}/>{data.run.error_count} search term(s) failed in this run. Failed terms are excluded from SoS and Target Achievement instead of being treated as zero.</div>}

      <section className="sos-insight-hero sos-insight-hero-shajgoj">
        <div className="sos-insight-copy"><span className="sos-insight-kicker">Shajgoj search visibility</span><h2>{pct(summary.ublSos)} UBL share across the measured top 4</h2><p>UBL visibility and assigned-target achievement are deliberately separated. A non-target UBL product improves share of search, but does not satisfy the target-product objective.</p><div className="sos-insight-meta"><span>Run <strong>{dateTime(data.run.started_at)}</strong></span><span>Completed <strong>{summary.termsOk}/{summary.termsTotal}</strong></span><span>Measured slots <strong>{summary.topSlots}</strong></span><span>Failed <strong>{summary.failed}</strong></span></div></div>
        <div className="sos-dual-rings"><SosRing value={summary.ublSos} label="UBL SoS" note={`${summary.ublCount}/${summary.topSlots} top positions`}/><SosRing value={summary.targetAchievement} label="Target achievement" tone="target" note={`${summary.targetHits}/${summary.targetOpportunities} target opportunities`}/></div>
      </section>

      <section className="sos-report-kpis sos-report-kpis-heavy">
        <div className="kpi hero"><span>UBL Share of Search</span><strong>{pct(summary.ublSos)}</strong><small>{summary.ublCount}/{summary.topSlots} top-4 positions are UBL</small></div>
        <div className="kpi target-kpi"><span>Target Achievement</span><strong>{pct(summary.targetAchievement)}</strong><small>{summary.targetHits}/{summary.targetOpportunities} expected target appearances achieved</small></div>
        <div className="kpi"><span>Completed terms</span><strong>{summary.termsOk}/{summary.termsTotal}</strong><small>{summary.failed ? `${summary.failed} failed and excluded` : 'All selected terms completed'}</small></div>
        <div className="kpi"><span>Competitor positions</span><strong>{summary.competitors}</strong><small>Non-UBL products in the measured top 4</small></div>
      </section>

      <section className="card sos-filter-card sos-filter-workbench">
        <div className="card-head"><div><h2>Report filters</h2><p>Every KPI and detailed result below reacts to these filters.</p></div><button className="account-reset-button" type="button" onClick={resetFilters}><RotateCcw size={14}/>Reset</button></div>
        <div className="filters sos-report-filters">
          <label><span>Format</span><select value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)}><option value="all">All formats</option>{formats.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Main keyword</span><select value={keywordFilter} onChange={(e) => setKeywordFilter(e.target.value)}><option value="all">All keywords</option>{keywords.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
          <label><span>Searched term</span><select value={termFilter} onChange={(e) => setTermFilter(e.target.value)}><option value="all">All search terms</option>{terms.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
          <label><span>Result type</span><select value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value)}><option value="all">All result types</option><option value="target_ubl">Target UBL</option><option value="ubl_non_target">UBL – non-target</option><option value="competitor">Competitor</option></select></label>
          <label className="sos-result-search"><span>Find product</span><div className="search-box"><Search size={15}/><input value={resultQuery} onChange={(e) => setResultQuery(e.target.value)} placeholder="Product, SKU or brand…"/></div></label>
        </div>
      </section>

      <section className="sos-visual-grid">
        <div className="card sos-visual-card"><div className="card-head"><div><h2>Top-4 composition</h2><p>Where the measured search real estate is going.</p></div><BarChart3 size={18}/></div><SosComposition target={Math.max(0,summary.ublCount-summary.nonTargetUbl)} nonTarget={summary.nonTargetUbl} competitor={summary.competitors} total={summary.topSlots}/></div>
        <div className="card sos-visual-card"><div className="card-head"><div><h2>Keyword visibility pressure</h2><p>Weakest target achievement first. Click a keyword to isolate it.</p></div></div><SosLeaderboard rows={keywordVisualRows} onPick={(id)=>{ const row=filteredKeywords.find((item)=>item.keyword_id===id); if(row){setFormatFilter(row.format);setKeywordFilter(row.keyword_id);setTermFilter('all');} }}/></div>
      </section>

      <section className="card sos-executive-readout"><div className="card-head"><div><h2>Executive readout</h2><p>What the current filtered scope says at a glance.</p></div></div><SosMetricTiles items={[
        {label:'Strongest keyword',value:strongestKeyword?.keyword || '—',note:strongestKeyword?`${pct(strongestKeyword.ubl_sos)} UBL SoS`:'No measured keyword',tone:'ubl'},
        {label:'Largest target gap',value:weakestTargetKeyword?.keyword || 'None',note:weakestTargetKeyword?`${pct(weakestTargetKeyword.target_achievement)} target achievement`:'All measured targets achieved',tone:weakestTargetKeyword?'warning':'target'},
        {label:'UBL non-target positions',value:summary.nonTargetUbl,note:'UBL visibility outside the assigned target set',tone:'ubl'},
        {label:'Search health',value:summary.failed?`${summary.failed} failed`:'Complete',note:`${summary.termsOk} successful checks`,tone:summary.failed?'warning':'target'},
      ]}/></section>



      {needsAttention.length > 0 && <section className="card sos-attention-card">
        <div className="card-head"><div><h2>Needs attention</h2><p>Keywords where the assigned target products are not fully appearing in the top 4.</p></div></div>
        <div className="sos-attention-grid">{needsAttention.map((row) => <button key={row.keyword_id} onClick={() => { setFormatFilter(row.format); setKeywordFilter(row.keyword_id); setTermFilter('all'); }}><span>{row.format}</span><strong>{row.keyword}</strong><div><b>{pct(row.target_achievement)}</b> target achievement · {pct(row.ubl_sos)} UBL SoS</div><small>{numeric(row.target_hits)}/{numeric(row.target_opportunities)} target opportunities · {numeric(row.non_target_ubl_count)} non-target UBL positions</small></button>)}</div>
      </section>}

      <section className="card">
        <div className="card-head"><div><h2>Keyword performance</h2><p>Main-keyword rollup across all successful search terms under that keyword.</p></div></div>
        <div className="table-wrap"><table className="sos-report-table"><thead><tr><th>Format</th><th>Keyword</th><th>Terms</th><th>UBL top 4</th><th>UBL SoS</th><th>Target hits</th><th>Target achievement</th><th>Non-target UBL</th><th>Competitor</th></tr></thead><tbody>
          {filteredKeywords.map((row) => <tr key={row.keyword_id}><td>{row.format}</td><td><strong>{row.keyword}</strong></td><td>{row.terms_scraped}/{row.terms_attempted}</td><td>{numeric(row.ubl_count)}/{numeric(row.top_slots)}</td><td><strong>{pct(row.ubl_sos)}</strong></td><td>{numeric(row.target_hits)}/{numeric(row.target_opportunities)}</td><td><strong>{pct(row.target_achievement)}</strong></td><td>{numeric(row.non_target_ubl_count)}</td><td>{numeric(row.competitor_count)}</td></tr>)}
          {!filteredKeywords.length && <tr><td colSpan={9} className="empty">No keyword rows match these filters.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Search-term performance</h2><p>This is the most direct view of your Lux/Lifebuoy case: each searched term has its own UBL SoS and target achievement.</p></div></div>
        <div className="table-wrap"><table className="sos-report-table"><thead><tr><th>Format</th><th>Main keyword</th><th>Searched term</th><th>Status</th><th>UBL top 4</th><th>UBL SoS</th><th>Target hits</th><th>Target achievement</th><th>Non-target UBL</th><th>Competitor</th></tr></thead><tbody>
          {filteredTerms.map((row) => { const keyword = keywordMap.get(row.keyword_id); return <tr key={row.term_id}><td>{keyword?.format || '—'}</td><td>{keyword?.keyword || '—'}</td><td><strong>{row.searched_term}</strong></td><td><span className={`sos-term-status ${row.status}`}>{row.status}</span></td><td>{row.status === 'ok' ? `${numeric(row.ubl_count)}/${numeric(row.top_slots)}` : '—'}</td><td>{pct(row.ubl_sos)}</td><td>{row.status === 'ok' ? `${numeric(row.target_hits)}/${numeric(row.assigned_targets)}` : '—'}</td><td>{pct(row.target_achievement)}</td><td>{row.status === 'ok' ? numeric(row.non_target_ubl_count) : '—'}</td><td>{row.status === 'ok' ? numeric(row.competitor_count) : '—'}</td></tr>; })}
          {!filteredTerms.length && <tr><td colSpan={10} className="empty">No search terms match these filters.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2>Top 4 detailed results</h2><p>{filteredResults.length} result row(s) after filters. Target UBL and UBL non-target are deliberately separated.</p></div></div>
        <div className="table-wrap"><table className="sos-result-table"><thead><tr><th>Format</th><th>Keyword</th><th>Search term</th><th>Rank</th><th>Product</th><th>SKU</th><th>Classification</th><th>UBL match</th><th>Price</th><th>Stock</th></tr></thead><tbody>
          {filteredResults.map((row) => { const keyword = keywordMap.get(row.keyword_id); const shownPrice = row.sale_price ?? row.price; return <tr key={row.id} className={`sos-result-row ${row.classification}`}><td>{keyword?.format || '—'}</td><td>{keyword?.keyword || '—'}</td><td>{row.searched_term}</td><td><strong>#{row.rank}</strong></td><td><strong>{row.product_url ? <a href={row.product_url} target="_blank" rel="noreferrer">{row.product_name}</a> : row.product_name}</strong>{row.size ? <small>{row.size}</small> : null}</td><td>{row.marketplace_sku || '—'}</td><td><span className={`sos-classification ${row.classification}`}>{classificationLabel(row.classification)}</span></td><td><span>{row.ubl_match_method === 'none' ? '—' : row.ubl_match_method.replaceAll('_', ' ')}</span>{row.matched_brand ? <small>{row.matched_brand}</small> : null}</td><td>{shownPrice === null || shownPrice === undefined ? '—' : Number(shownPrice).toLocaleString()}</td><td>{row.stock_qty === null || row.stock_qty === undefined ? (row.in_stock === null ? '—' : row.in_stock ? 'In stock' : 'OOS') : Number(row.stock_qty).toLocaleString()}</td></tr>; })}
          {!filteredResults.length && <tr><td colSpan={10} className="empty">No top-4 result rows match these filters.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </div>;
}
