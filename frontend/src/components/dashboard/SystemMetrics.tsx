import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemMetrics as SystemMetricsType, SystemMetricsSnapshot } from '../../../../shared/types';

function useIsLightMode() {
  const [light, setLight] = useState(() => document.documentElement.getAttribute('data-theme') === 'light');
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setLight(document.documentElement.getAttribute('data-theme') === 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return light;
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 60;
const PADDING = { top: 4, right: 8, bottom: 14, left: 28 };
const INNER_W = CHART_WIDTH - PADDING.left - PADDING.right;
const INNER_H = CHART_HEIGHT - PADDING.top - PADDING.bottom;

function valueToY(value: number): number {
  return PADDING.top + INNER_H - (Math.min(value, 100) / 100) * INNER_H;
}

function buildPath(snapshots: SystemMetricsSnapshot[], getValue: (s: SystemMetricsSnapshot) => number): { linePath: string; areaPath: string } {
  if (snapshots.length === 0) return { linePath: '', areaPath: '' };

  const minTs = snapshots[0].timestamp;
  const maxTs = snapshots[snapshots.length - 1].timestamp;
  const range = maxTs - minTs || 1;

  const points = snapshots.map(s => {
    const x = PADDING.left + ((s.timestamp - minTs) / range) * INNER_W;
    const y = valueToY(getValue(s));
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const baseline = valueToY(0);
  const areaPath = `${linePath} L${lastPoint.x.toFixed(1)},${baseline.toFixed(1)} L${firstPoint.x.toFixed(1)},${baseline.toFixed(1)} Z`;

  return { linePath, areaPath };
}

interface MiniChartProps {
  snapshots: SystemMetricsSnapshot[];
  getValue: (s: SystemMetricsSnapshot) => number;
  lineColor: string;
  gradientId: string;
  isLight: boolean;
}

function MiniChart({ snapshots, getValue, lineColor, gradientId, isLight }: MiniChartProps) {
  const { linePath, areaPath } = useMemo(() => buildPath(snapshots, getValue), [snapshots, getValue]);

  const yLabels = [0, 50, 100];

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Background */}
      <rect x={PADDING.left} y={PADDING.top} width={INNER_W} height={INNER_H} fill={isLight ? '#ffffff' : '#1f2937'} rx="2" />

      {/* Y-axis grid + labels */}
      {yLabels.map(val => {
        const y = valueToY(val);
        return (
          <g key={val}>
            <line x1={PADDING.left} y1={y} x2={PADDING.left + INNER_W} y2={y} stroke={isLight ? '#d1d5db' : '#374151'} strokeWidth="0.5" />
            <text x={PADDING.left - 3} y={y + 3} textAnchor="end" fill="#6b7280" fontSize="7">{val}%</text>
          </g>
        );
      })}

      {/* Area fill */}
      {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}

      {/* Line */}
      {linePath && <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />}

      {/* Current point dot */}
      {snapshots.length > 0 && (() => {
        const last = snapshots[snapshots.length - 1];
        const minTs = snapshots[0].timestamp;
        const maxTs = last.timestamp;
        const range = maxTs - minTs || 1;
        const cx = PADDING.left + ((last.timestamp - minTs) / range) * INNER_W;
        const cy = valueToY(getValue(last));
        return <circle cx={cx} cy={cy} r="2.5" fill={lineColor} stroke={isLight ? '#ffffff' : '#111827'} strokeWidth="1" />;
      })()}

      {/* Time labels */}
      {snapshots.length >= 2 && (() => {
        const oldest = new Date(snapshots[0].timestamp);
        const newest = new Date(snapshots[snapshots.length - 1].timestamp);
        const fmt = (d: Date) => `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
        return (
          <>
            <text x={PADDING.left} y={CHART_HEIGHT - 2} textAnchor="start" fill="#6b7280" fontSize="6">{fmt(oldest)}</text>
            <text x={PADDING.left + INNER_W} y={CHART_HEIGHT - 2} textAnchor="end" fill="#6b7280" fontSize="6">{fmt(newest)}</text>
          </>
        );
      })()}
    </svg>
  );
}

interface SystemMetricsChartProps {
  data?: SystemMetricsType;
}

export function SystemMetricsChart({ data }: SystemMetricsChartProps) {
  const { t } = useTranslation();
  const isLight = useIsLightMode();

  if (!data) {
    return (
      <div className="text-th-text-muted text-xs">{t('dashboard.noData')}</div>
    );
  }

  const { current, history, loadAvg, cpuCount } = data;
  const getCpu = useMemo(() => (s: SystemMetricsSnapshot) => s.cpuPercent, []);
  const getMem = useMemo(() => (s: SystemMetricsSnapshot) => s.memUsedPercent, []);

  return (
    <div className="space-y-3">
      {/* CPU */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[12px] font-semibold uppercase tracking-widest text-zinc-500">
            {t('dashboard.cpuUsage')}
          </span>
          <span className="text-lg font-medium text-blue-400 tabular-nums">
            {current.cpuPercent.toFixed(1)}%
          </span>
        </div>
        <MiniChart
          snapshots={history}
          getValue={getCpu}
          lineColor="#3b82f6"
          gradientId="grad-cpu"
          isLight={isLight}
        />
        <div className="text-[10px] text-th-text-muted mt-0.5">
          {t('dashboard.loadAverage')}: {loadAvg[0].toFixed(2)} / {loadAvg[1].toFixed(2)} / {loadAvg[2].toFixed(2)} ({cpuCount} {t('dashboard.cores')})
        </div>
      </div>

      {/* Memory */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[12px] font-semibold uppercase tracking-widest text-zinc-500">
            {t('dashboard.memoryUsage')}
          </span>
          <span className="text-lg font-medium text-purple-400 tabular-nums">
            {current.memUsedPercent.toFixed(1)}%
          </span>
        </div>
        <MiniChart
          snapshots={history}
          getValue={getMem}
          lineColor="#a855f7"
          gradientId="grad-mem"
          isLight={isLight}
        />
        <div className="text-[10px] text-th-text-muted mt-0.5">
          {(current.memUsedMB / 1024).toFixed(1)} GB / {(current.memTotalMB / 1024).toFixed(1)} GB
        </div>
      </div>
    </div>
  );
}
