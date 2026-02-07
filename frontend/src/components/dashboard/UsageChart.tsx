import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageSnapshot } from '../../../../shared/types';

interface UsageChartProps {
  label: string;
  field: 'fiveHour' | 'sevenDay';
  snapshots: UsageSnapshot[];
  currentUtilization: number;
  resetsAt: string;
  status: 'safe' | 'warning' | 'danger' | 'exceeded';
  statusMessage: string;
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 80;
const PADDING = { top: 4, right: 8, bottom: 16, left: 28 };
const INNER_W = CHART_WIDTH - PADDING.left - PADDING.right;
const INNER_H = CHART_HEIGHT - PADDING.top - PADDING.bottom;

function getStatusColor(status: string): string {
  switch (status) {
    case 'exceeded': return '#dc2626';
    case 'danger': return '#ef4444';
    case 'warning': return '#eab308';
    default: return '#22c55e';
  }
}

function getStatusTextColor(status: string): string {
  switch (status) {
    case 'exceeded':
    case 'danger': return 'text-red-400';
    case 'warning': return 'text-yellow-400';
    default: return 'text-green-400';
  }
}

export function UsageChart({ label, field, snapshots, currentUtilization, resetsAt, status, statusMessage }: UsageChartProps) {
  const { t } = useTranslation();

  const { points, gradientId, resetMarkers } = useMemo(() => {
    const gId = `grad-${field}`;
    const now = Date.now();
    const resetTime = new Date(resetsAt).getTime();

    // Filter snapshots for the current cycle
    // For 5-hour cycle, show last 5 hours; for 7-day, show last 7 days
    const cycleDuration = field === 'fiveHour' ? 5 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const cycleStart = resetTime - cycleDuration;

    const relevantSnapshots = snapshots.filter(s => {
      const ts = new Date(s.timestamp).getTime();
      return ts >= cycleStart && ts <= now;
    });

    // Build points from snapshots
    const pts: { x: number; y: number }[] = [];

    for (const snap of relevantSnapshots) {
      const ts = new Date(snap.timestamp).getTime();
      const xRatio = (ts - cycleStart) / cycleDuration;
      const util = snap[field].utilization;
      pts.push({
        x: PADDING.left + xRatio * INNER_W,
        y: PADDING.top + INNER_H - (Math.min(util, 120) / 120) * INNER_H,
      });
    }

    // Add current point
    const currentXRatio = (now - cycleStart) / cycleDuration;
    pts.push({
      x: PADDING.left + Math.min(currentXRatio, 1) * INNER_W,
      y: PADDING.top + INNER_H - (Math.min(currentUtilization, 120) / 120) * INNER_H,
    });

    // Find reset markers within the visible range
    const markers: number[] = [];
    if (field === 'sevenDay') {
      // For 7-day view, mark each day
      for (let i = 1; i < 7; i++) {
        const dayMs = cycleStart + i * 24 * 60 * 60 * 1000;
        if (dayMs < now) {
          const xRatio = (dayMs - cycleStart) / cycleDuration;
          markers.push(PADDING.left + xRatio * INNER_W);
        }
      }
    } else {
      // For 5-hour view, mark each hour
      for (let i = 1; i < 5; i++) {
        const hourMs = cycleStart + i * 60 * 60 * 1000;
        if (hourMs < now) {
          const xRatio = (hourMs - cycleStart) / cycleDuration;
          markers.push(PADDING.left + xRatio * INNER_W);
        }
      }
    }

    return { points: pts, gradientId: gId, resetMarkers: markers };
  }, [snapshots, field, currentUtilization, resetsAt]);

  const lineColor = getStatusColor(status);

  // Build SVG path
  const linePath = points.length > 1
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : '';

  // Area path (for gradient fill)
  const areaPath = points.length > 1
    ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${(PADDING.top + INNER_H).toFixed(1)} L${points[0].x.toFixed(1)},${(PADDING.top + INNER_H).toFixed(1)} Z`
    : '';

  // Y-axis labels
  const yLabels = [0, 50, 100];
  const thresholdY = PADDING.top + INNER_H - (100 / 120) * INNER_H;

  // "Now" marker
  const nowX = points.length > 0 ? points[points.length - 1].x : PADDING.left + INNER_W;

  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-300">{currentUtilization.toFixed(0)}%</span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Background */}
        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={INNER_W}
          height={INNER_H}
          fill="#1f2937"
          rx="2"
        />

        {/* Y-axis labels and grid lines */}
        {yLabels.map(val => {
          const y = PADDING.top + INNER_H - (val / 120) * INNER_H;
          return (
            <g key={val}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={PADDING.left + INNER_W}
                y2={y}
                stroke="#374151"
                strokeWidth="0.5"
              />
              <text x={PADDING.left - 3} y={y + 3} textAnchor="end" fill="#6b7280" fontSize="7">
                {val}%
              </text>
            </g>
          );
        })}

        {/* 100% threshold line */}
        <line
          x1={PADDING.left}
          y1={thresholdY}
          x2={PADDING.left + INNER_W}
          y2={thresholdY}
          stroke="#ef4444"
          strokeWidth="0.5"
          strokeDasharray="3,2"
          opacity="0.5"
        />

        {/* Reset markers */}
        {resetMarkers.map((x, i) => (
          <line
            key={i}
            x1={x}
            y1={PADDING.top}
            x2={x}
            y2={PADDING.top + INNER_H}
            stroke="#4b5563"
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
        ))}

        {/* Gradient area */}
        {areaPath && (
          <path d={areaPath} fill={`url(#${gradientId})`} />
        )}

        {/* Line */}
        {linePath && (
          <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
        )}

        {/* Current point dot */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="2.5"
            fill={lineColor}
            stroke="#111827"
            strokeWidth="1"
          />
        )}

        {/* "Now" label */}
        <text x={nowX} y={CHART_HEIGHT - 2} textAnchor="middle" fill="#9ca3af" fontSize="6">
          {t('dashboard.chartNow')}
        </text>

        {/* Reset label */}
        <text x={PADDING.left + INNER_W} y={CHART_HEIGHT - 2} textAnchor="end" fill="#6b7280" fontSize="6">
          {t('dashboard.chartReset')}
        </text>
      </svg>
      <div className={`text-[10px] mt-0.5 ${getStatusTextColor(status)}`}>
        {statusMessage}
      </div>
    </div>
  );
}
