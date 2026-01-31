import type { UsageLimits as UsageLimitsType } from '../../../../shared/types';

interface UsageLimitsProps {
  data: UsageLimitsType | null;
}

function ProgressBar({
  label,
  utilization,
  timeRemaining,
  estimatedHitTime,
}: {
  label: string;
  utilization: number;
  timeRemaining: string;
  estimatedHitTime?: string;
}) {
  const getBarColor = (pct: number) => {
    if (pct >= 90) return 'bg-red-500';
    if (pct >= 75) return 'bg-yellow-500';
    if (pct >= 50) return 'bg-blue-500';
    return 'bg-green-500';
  };

  const getTextColor = (pct: number) => {
    if (pct >= 90) return 'text-red-400';
    if (pct >= 75) return 'text-yellow-400';
    return 'text-gray-300';
  };

  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-300">{label}</span>
        <span className={getTextColor(utilization)}>
          {utilization.toFixed(0)}%
          <span className="text-gray-500 ml-1">({timeRemaining})</span>
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${getBarColor(utilization)} transition-all duration-300`}
          style={{ width: `${Math.min(100, utilization)}%` }}
        />
      </div>
      {estimatedHitTime && (
        <div className="text-[10px] text-orange-400 mt-0.5">
          このペースで約{estimatedHitTime}後にリミット到達
        </div>
      )}
    </div>
  );
}

export function UsageLimits({ data }: UsageLimitsProps) {
  if (!data) {
    return (
      <div className="p-3 bg-gray-800 rounded-lg">
        <div className="text-gray-500 text-xs">Usage data unavailable</div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-gray-800 rounded-lg">
      <div className="text-sm font-medium text-white mb-3">Usage Limits</div>

      <ProgressBar
        label="5-Hour Cycle"
        utilization={data.fiveHour.utilization}
        timeRemaining={data.fiveHour.timeRemaining}
        estimatedHitTime={data.fiveHour.estimatedHitTime}
      />

      <ProgressBar
        label="7-Day Cycle"
        utilization={data.sevenDay.utilization}
        timeRemaining={data.sevenDay.timeRemaining}
        estimatedHitTime={data.sevenDay.estimatedHitTime}
      />
    </div>
  );
}
