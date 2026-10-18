'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

export type Tone = 'excellent' | 'good' | 'warning' | 'critical' | 'neutral';

export function olaTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'neutral';
  const n = Number(value);
  if (n >= 90) return 'excellent';
  if (n >= 75) return 'good';
  if (n >= 60) return 'warning';
  return 'critical';
}

export function AccountRing({ value, label, note }: { value: number | null | undefined; label: string; note?: string }) {
  const safe = Math.max(0, Math.min(100, Number(value ?? 0)));
  const tone = olaTone(value);
  const colors: Record<Tone, string> = {
    excellent: '#24a36f', good: '#3f7fe8', warning: '#dfa43d', critical: '#d6545e', neutral: '#b9c2cf',
  };
  return <div className="account-ring-wrap">
    <div className={`account-ring ${tone}`} style={{ background: `conic-gradient(${colors[tone]} ${safe * 3.6}deg,#e9edf3 0deg)` }}>
      <div><strong>{value == null ? '—' : `${Number(value).toFixed(1)}%`}</strong><span>{label}</span></div>
    </div>
    {note ? <small>{note}</small> : null}
  </div>;
}

export function MiniTrend({ rows, empty = 'No history yet.' }: { rows: Array<{ label: string; value: number | null }>; empty?: string }) {
  const clean = rows.filter((row) => row.value !== null && row.value !== undefined).map((row) => ({ ...row, value: Number(row.value) }));
  if (!clean.length) return <div className="account-chart-empty">{empty}</div>;

  const width = 760;
  const height = 220;
  const left = 42;
  const right = 26;
  const top = 26;
  const bottom = 48;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const minRaw = Math.min(...clean.map((row) => row.value));
  const maxRaw = Math.max(...clean.map((row) => row.value));
  const floor = Math.max(0, Math.floor((minRaw - 8) / 10) * 10);
  const ceil = Math.min(100, Math.max(floor + 10, Math.ceil((maxRaw + 6) / 10) * 10));
  const range = Math.max(1, ceil - floor);
  const x = (index: number) => clean.length === 1 ? left + innerW / 2 : left + (index / (clean.length - 1)) * innerW;
  const y = (value: number) => top + ((ceil - value) / range) * innerH;
  const points = clean.map((row, index) => `${x(index)},${y(row.value)}`).join(' ');
  const area = `${left},${top + innerH} ${points} ${x(clean.length - 1)},${top + innerH}`;
  const labelStep = clean.length <= 7 ? 1 : Math.ceil(clean.length / 7);
  const guides = [floor, floor + range / 2, ceil];

  return <div className="account-line-trend" aria-label="Recent OLA trend">
    <svg viewBox={`0 0 ${width} ${height}`} role="img">
      {guides.map((guide, index) => <g key={guide}>
        <line x1={left} y1={y(guide)} x2={width - right} y2={y(guide)} className="account-trend-guide" />
        <text x={left - 8} y={y(guide) + 4} textAnchor="end" className="account-trend-axis">{Math.round(guide)}%</text>
      </g>)}
      <polygon points={area} className="account-trend-area" />
      <polyline points={points} className="account-trend-line" />
      {clean.map((row, index) => <g key={`${row.label}-${index}`}>
        <circle cx={x(index)} cy={y(row.value)} r="5" className={`account-trend-point ${olaTone(row.value)}`} />
        {(index % labelStep === 0 || index === clean.length - 1) ? <>
          <text x={x(index)} y={Math.max(15, y(row.value) - 12)} textAnchor="middle" className="account-trend-value">{row.value.toFixed(1)}%</text>
          <text x={x(index)} y={height - 17} textAnchor="middle" className="account-trend-label">{row.label}</text>
        </> : null}
      </g>)}
    </svg>
  </div>;
}

export function HorizontalBars({ rows, suffix = '%', prefix = '', onPick }: { rows: Array<{ label: string; value: number; note?: string; tone?: Tone }>; suffix?: string; prefix?: string; onPick?: (label: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  if (!rows.length) return <div className="account-chart-empty">No data in this view.</div>;
  return <div className="account-horizontal-bars">
    {rows.map((row) => {
      const width = Math.max(2, (Number(row.value || 0) / max) * 100);
      const content = <>
        <div className="account-horizontal-label"><strong>{row.label}</strong>{row.note ? <small>{row.note}</small> : null}</div>
        <div className="account-horizontal-track"><span className={row.tone ?? 'good'} style={{ width: `${width}%` }} /></div>
        <b>{prefix}{Number(row.value).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix}</b>
      </>;
      return onPick ? <button type="button" key={row.label} onClick={() => onPick(row.label)}>{content}</button> : <div key={row.label}>{content}</div>;
    })}
  </div>;
}

export function SeverityStrip({ critical = 0, warning = 0, watch = 0, positive = 0 }: { critical?: number; warning?: number; watch?: number; positive?: number }) {
  const total = critical + warning + watch + positive;
  const parts = [
    ['critical', critical], ['warning', warning], ['watch', watch], ['positive', positive],
  ] as const;
  return <div className="account-severity-block">
    <div className="account-severity-track">
      {parts.map(([key, value]) => value > 0 ? <span key={key} className={key} style={{ width: `${(value / Math.max(1, total)) * 100}%` }} /> : null)}
    </div>
    <div className="account-severity-legend">
      {parts.map(([key, value]) => <div key={key}><i className={key}/><span>{key}</span><strong>{value}</strong></div>)}
    </div>
  </div>;
}


export type SalesShareSlice = {
  label: string;
  sold_qty: number;
  sales_value: number;
  sku_count: number;
};

const SHARE_COLORS = ['#3f7fe8','#24a36f','#dfa43d','#8b67d9','#d6545e','#2f9aa0','#9a6a43'];

function compactNumber(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function SalesShareDonut({
  rows, metric, title, subtitle, valuePrefix = '', valueSuffix = '', topN = 6,
}: {
  rows: SalesShareSlice[];
  metric: 'sales_value' | 'sold_qty';
  title: string;
  subtitle?: string;
  valuePrefix?: string;
  valueSuffix?: string;
  topN?: number;
}) {
  const sorted = [...rows].sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0));
  const total = sorted.reduce((sum, row) => sum + Number(row[metric] || 0), 0);
  if (!sorted.length || total <= 0) return <div className="sales-share-empty">No sales contribution data for this period.</div>;

  const visible = sorted.slice(0, topN).map((row) => ({ ...row }));
  const rest = sorted.slice(topN);
  if (rest.length) {
    visible.push({
      label: 'Others',
      sold_qty: rest.reduce((sum, row) => sum + Number(row.sold_qty || 0), 0),
      sales_value: rest.reduce((sum, row) => sum + Number(row.sales_value || 0), 0),
      sku_count: rest.reduce((sum, row) => sum + Number(row.sku_count || 0), 0),
    });
  }

  let cursor = 0;
  const segments = visible.map((row, index) => {
    const share = (Number(row[metric] || 0) / total) * 100;
    const start = cursor; cursor += share;
    return `${SHARE_COLORS[index % SHARE_COLORS.length]} ${start}% ${cursor}%`;
  });
  const formatSelected = (value: number) => `${valuePrefix}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}${valueSuffix}`;

  return <div className="sales-share-chart">
    <div className="sales-share-heading"><div><h3>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}</div></div>
    <div className="sales-share-body">
      <div className="sales-share-donut" style={{ background: `conic-gradient(${segments.join(',')})` }}>
        <div><strong>{valuePrefix}{compactNumber(total)}{valueSuffix}</strong><span>{metric === 'sales_value' ? 'value' : 'quantity'}</span></div>
      </div>
      <div className="sales-share-legend">{visible.map((row, index) => {
        const selected = Number(row[metric] || 0);
        const share = total > 0 ? (selected / total) * 100 : 0;
        return <div key={`${row.label}-${index}`} className="sales-share-row">
          <i style={{ background: SHARE_COLORS[index % SHARE_COLORS.length] }} />
          <div><strong>{row.label}</strong><small>{row.sku_count} SKU{row.sku_count === 1 ? '' : 's'} · {metric === 'sales_value' ? `${Number(row.sold_qty || 0).toLocaleString()} units` : `৳${Number(row.sales_value || 0).toLocaleString(undefined,{maximumFractionDigits:0})}`}</small></div>
          <div className="sales-share-row-value"><b>{share.toFixed(1)}%</b><span>{formatSelected(selected)}</span></div>
        </div>;
      })}</div>
    </div>
  </div>;
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="account-filter-field"><span>{label}</span>{children}</label>;
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="account-filter-field account-filter-search"><span>Search</span><div><Search size={14}/><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}/></div></label>;
}

export function FlagMetricChips({ metrics }: { metrics: Array<{ label: string; value: string | number | null | undefined }> }) {
  const visible = metrics.filter((m) => m.value !== null && m.value !== undefined && String(m.value) !== '');
  if (!visible.length) return <span className="account-flag-no-metrics">—</span>;
  return <div className="account-flag-metrics">{visible.slice(0, 4).map((m) => <span key={m.label}><small>{m.label}</small><strong>{m.value}</strong></span>)}</div>;
}
