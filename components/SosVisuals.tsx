'use client';

export type SosTone = 'ubl' | 'target' | 'competitor' | 'neutral' | 'warning';

function clampPct(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  return Math.max(0, Math.min(1, Number(value)));
}

export function SosRing({ value, label, note, tone = 'ubl' }: { value: number | null | undefined; label: string; note?: string; tone?: SosTone }) {
  const safe = clampPct(value);
  const color = tone === 'target' ? '#8b5cf6' : tone === 'warning' ? '#e4a43d' : tone === 'competitor' ? '#d9535f' : '#155eef';
  return <div className={`sos-visual-ring-wrap ${tone}`}>
    <div className="sos-visual-ring" style={{ background: `conic-gradient(${color} ${safe * 360}deg,rgba(255,255,255,.13) 0deg)` }}>
      <div><strong>{value == null ? '—' : `${(Number(value) * 100).toFixed(1)}%`}</strong><span>{label}</span></div>
    </div>
    {note ? <small>{note}</small> : null}
  </div>;
}

export function SosComposition({ target, nonTarget, competitor, total }: { target: number; nonTarget: number; competitor: number; total?: number }) {
  const measured = Math.max(0, Number(total ?? (target + nonTarget + competitor)));
  const denom = Math.max(1, measured);
  const items = [
    { key: 'target', label: 'Target UBL', value: target, className: 'target' },
    { key: 'nonTarget', label: 'UBL non-target', value: nonTarget, className: 'non-target' },
    { key: 'competitor', label: 'Competitor', value: competitor, className: 'competitor' },
  ];
  return <div className="sos-composition">
    <div className="sos-composition-track">{items.map((item) => item.value > 0 ? <span key={item.key} className={item.className} style={{ width: `${(item.value / denom) * 100}%` }} /> : null)}</div>
    <div className="sos-composition-legend">{items.map((item) => <div key={item.key}><i className={item.className}/><span>{item.label}</span><strong>{item.value}</strong><small>{measured ? `${((item.value / denom) * 100).toFixed(1)}%` : '—'}</small></div>)}</div>
  </div>;
}

export function SosLeaderboard({ rows, empty = 'No performance rows in the current scope.', onPick }: { rows: Array<{ key: string; label: string; note?: string; sos: number | null; target: number | null; danger?: boolean }>; empty?: string; onPick?: (key: string) => void }) {
  if (!rows.length) return <div className="sos-visual-empty">{empty}</div>;
  return <div className="sos-leaderboard">
    {rows.map((row, index) => {
      const sos = clampPct(row.sos);
      const target = clampPct(row.target);
      const content = <>
        <div className="sos-leaderboard-rank">{String(index + 1).padStart(2, '0')}</div>
        <div className="sos-leaderboard-copy"><strong>{row.label}</strong>{row.note ? <small>{row.note}</small> : null}</div>
        <div className="sos-leaderboard-metrics">
          <div><span>UBL SoS <b>{row.sos == null ? '—' : `${(Number(row.sos) * 100).toFixed(1)}%`}</b></span><div className="sos-mini-track"><i className="ubl" style={{ width: `${sos * 100}%` }}/></div></div>
          <div><span>Target <b>{row.target == null ? '—' : `${(Number(row.target) * 100).toFixed(1)}%`}</b></span><div className="sos-mini-track"><i className={row.danger ? 'target danger' : 'target'} style={{ width: `${target * 100}%` }}/></div></div>
        </div>
      </>;
      return onPick ? <button type="button" key={row.key} onClick={() => onPick(row.key)}>{content}</button> : <div key={row.key}>{content}</div>;
    })}
  </div>;
}

export function SosMetricTiles({ items }: { items: Array<{ label: string; value: string | number; note?: string; tone?: SosTone }> }) {
  return <div className="sos-metric-tiles">{items.map((item) => <div key={item.label} className={item.tone || 'neutral'}><span>{item.label}</span><strong>{item.value}</strong>{item.note ? <small>{item.note}</small> : null}</div>)}</div>;
}
