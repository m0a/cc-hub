import type { UsageLimits as UsageLimitsType } from '../../../../shared/types';

interface UsageLimitsProps {
  data: UsageLimitsType | null;
}

function ProgressBar({
  label,
  utilization,
  timeRemaining,
  status,
  statusMessage,
}: {
  label: string;
  utilization: number;
  timeRemaining: string;
  status: 'safe' | 'warning' | 'danger' | 'exceeded';
  statusMessage: string;
}) {
  const getBarColor = () => {
    switch (status) {
      case 'exceeded': return 'bg-red-600';
      case 'danger': return 'bg-red-500';
      case 'warning': return 'bg-yellow-500';
      default: return 'bg-green-500';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'exceeded': return 'text-red-400';
      case 'danger': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      default: return 'text-green-400';
    }
  };

  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-300">
          {utilization.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${getBarColor()} transition-all duration-300`}
          style={{ width: `${Math.min(100, utilization)}%` }}
        />
      </div>
      <div className={`text-[10px] mt-0.5 ${getStatusColor()}`}>
        {statusMessage}
      </div>
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
        status={data.fiveHour.status || 'safe'}
        statusMessage={data.fiveHour.statusMessage || `リセットまで${data.fiveHour.timeRemaining}`}
      />

      <ProgressBar
        label="7-Day Cycle"
        utilization={data.sevenDay.utilization}
        timeRemaining={data.sevenDay.timeRemaining}
        status={data.sevenDay.status || 'safe'}
        statusMessage={data.sevenDay.statusMessage || `リセットまで${data.sevenDay.timeRemaining}`}
      />
    </div>
  );
}
