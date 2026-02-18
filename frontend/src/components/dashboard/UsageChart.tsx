import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageSnapshot } from '../../../../shared/types';

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

// Map utilization (0–100) to Y coordinate
function utilToY(util: number): number {
  return PADDING.top + INNER_H - (Math.min(util, 110) / 110) * INNER_H;
}

// Map time ratio (0–1) to X coordinate
function ratioToX(ratio: number): number {
  return PADDING.left + Math.min(Math.max(ratio, 0), 1) * INNER_W;
}

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
  const isLight = useIsLightMode();

  const chartData = useMemo(() => {
    const now = Date.now();
    const resetTime = new Date(resetsAt).getTime();
    const cycleDuration = field === 'fiveHour' ? 5 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const cycleStart = resetTime - cycleDuration;
    const nowRatio = (now - cycleStart) / cycleDuration;

    // --- Actual usage points ---
    // Always start from cycle start at 0%
    const actualPoints: { x: number; y: number }[] = [
      { x: ratioToX(0), y: utilToY(0) },
    ];

    const relevantSnapshots = snapshots.filter(s => {
      const ts = new Date(s.timestamp).getTime();
      return ts >= cycleStart && ts <= now;
    });

    // Add snapshot points — gaps between them become straight lines naturally
    for (const snap of relevantSnapshots) {
      const ts = new Date(snap.timestamp).getTime();
      const ratio = (ts - cycleStart) / cycleDuration;
      actualPoints.push({ x: ratioToX(ratio), y: utilToY(snap[field].utilization) });
    }

    // Current point (always present, end of the actual line)
    const currentPoint = { x: ratioToX(nowRatio), y: utilToY(currentUtilization) };
    actualPoints.push(currentPoint);

    // --- Projection line (from current point, extending at current pace) ---
    let projectionEnd: { x: number; y: number } | null = null;
    let hitLabel: string | null = null; // Date/time label at the hit point
    let hitsBeforeReset = false;
    if (currentUtilization > 0 && currentUtilization < 100 && nowRatio > 0) {
      const rate = currentUtilization / nowRatio; // utilization per full cycle ratio
      const hitRatio = 100 / rate; // ratio at which 100% is hit

      if (hitRatio <= 1) {
        // Will hit limit before reset
        hitsBeforeReset = true;
        projectionEnd = { x: ratioToX(hitRatio), y: utilToY(100) };
        const hitTime = new Date(cycleStart + hitRatio * cycleDuration);
        if (field === 'fiveHour') {
          hitLabel = `${hitTime.getHours()}:${hitTime.getMinutes().toString().padStart(2, '0')}`;
        } else {
          hitLabel = `${hitTime.getMonth() + 1}/${hitTime.getDate()}`;
        }
      } else {
        // Won't hit limit — project to reset time
        const utilAtReset = rate * 1;
        projectionEnd = { x: ratioToX(1), y: utilToY(utilAtReset) };
      }
    }

    // --- Ideal pace line (0% at cycle start → 100% at reset) ---
    const idealStart = { x: ratioToX(0), y: utilToY(0) };
    const idealEnd = { x: ratioToX(1), y: utilToY(100) };

    // --- Time markers ---
    const markers: number[] = [];
    const step = field === 'sevenDay' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    const count = field === 'sevenDay' ? 7 : 5;
    for (let i = 1; i < count; i++) {
      const ms = cycleStart + i * step;
      if (ms < now) {
        markers.push(ratioToX((ms - cycleStart) / cycleDuration));
      }
    }

    return { actualPoints, currentPoint, projectionEnd, hitLabel, hitsBeforeReset, idealStart, idealEnd, markers };
  }, [snapshots, field, currentUtilization, resetsAt]);

  const { actualPoints, currentPoint, projectionEnd, hitLabel, hitsBeforeReset, idealStart, idealEnd, markers } = chartData;

  const lineColor = getStatusColor(status);
  const gradientId = `grad-${field}`;

  // Build actual usage path
  const actualPath = actualPoints.length > 1
    ? actualPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : '';

  // Build area under actual usage
  const areaPath = actualPoints.length > 1
    ? `${actualPath} L${actualPoints[actualPoints.length - 1].x.toFixed(1)},${utilToY(0).toFixed(1)} L${actualPoints[0].x.toFixed(1)},${utilToY(0).toFixed(1)} Z`
    : '';

  // Projection dashed line from current point
  const projectionPath = projectionEnd
    ? `M${currentPoint.x.toFixed(1)},${currentPoint.y.toFixed(1)} L${projectionEnd.x.toFixed(1)},${projectionEnd.y.toFixed(1)}`
    : '';

  // Ideal pace line
  const idealPath = `M${idealStart.x.toFixed(1)},${idealStart.y.toFixed(1)} L${idealEnd.x.toFixed(1)},${idealEnd.y.toFixed(1)}`;

  const yLabels = [0, 50, 100];

  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-th-text-secondary">{label}</span>
        <span className="text-th-text-secondary">{currentUtilization.toFixed(0)}%</span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Background */}
        <rect x={PADDING.left} y={PADDING.top} width={INNER_W} height={INNER_H} fill={isLight ? '#ffffff' : '#1f2937'} rx="2" />

        {/* Y-axis grid + labels */}
        {yLabels.map(val => {
          const y = utilToY(val);
          return (
            <g key={val}>
              <line x1={PADDING.left} y1={y} x2={PADDING.left + INNER_W} y2={y} stroke={isLight ? '#d1d5db' : '#374151'} strokeWidth="0.5" />
              <text x={PADDING.left - 3} y={y + 3} textAnchor="end" fill={isLight ? '#6b7280' : '#6b7280'} fontSize="7">{val}%</text>
            </g>
          );
        })}

        {/* Time markers */}
        {markers.map((x, i) => (
          <line key={i} x1={x} y1={PADDING.top} x2={x} y2={PADDING.top + INNER_H} stroke={isLight ? '#d1d5db' : '#4b5563'} strokeWidth="0.5" strokeDasharray="2,2" />
        ))}

        {/* 1) Ideal pace line — gray diagonal */}
        <path d={idealPath} fill="none" stroke="#6b7280" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />

        {/* 2) Gradient area under actual usage */}
        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}

        {/* 3) Actual usage line */}
        {actualPath && (
          <path d={actualPath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
        )}

        {/* 4) Projection dashed line */}
        {projectionPath && (
          <path d={projectionPath} fill="none" stroke={lineColor} strokeWidth="1" strokeDasharray="3,2" opacity="0.6" />
        )}

        {/* Projection hit vertical line + label */}
        {projectionEnd && hitsBeforeReset && (
          <g>
            <line
              x1={projectionEnd.x}
              y1={PADDING.top}
              x2={projectionEnd.x}
              y2={PADDING.top + INNER_H}
              stroke="#ef4444"
              strokeWidth="0.75"
              strokeDasharray="2,2"
              opacity="0.7"
            />
            {hitLabel && (
              <text x={projectionEnd.x} y={PADDING.top + INNER_H + 9} textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="bold">
                {hitLabel}
              </text>
            )}
          </g>
        )}

        {/* Projection end dot */}
        {projectionEnd && (
          <circle cx={projectionEnd.x} cy={projectionEnd.y} r="2" fill={lineColor} opacity="0.5" />
        )}

        {/* Current point dot */}
        <circle cx={currentPoint.x} cy={currentPoint.y} r="2.5" fill={lineColor} stroke={isLight ? '#ffffff' : '#111827'} strokeWidth="1" />

        {/* "Now" label */}
        <text x={currentPoint.x} y={CHART_HEIGHT - 2} textAnchor="middle" fill={isLight ? '#6b7280' : '#9ca3af'} fontSize="6">
          {t('dashboard.chartNow')}
        </text>

        {/* "Reset" label */}
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
