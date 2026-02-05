import { useTranslation } from 'react-i18next';
import type { UsageLimits as UsageLimitsType } from '../../../../shared/types';

interface UsageLimitsProps {
  data: UsageLimitsType | null;
}

function ProgressBar({
  label,
  utilization,
  status,
  statusMessage,
}: {
  label: string;
  utilization: number;
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

// Generate translated status message based on status
function getStatusMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: 'safe' | 'warning' | 'danger' | 'exceeded' | undefined,
  timeRemaining: string,
  estimatedHitTime?: string
): string {
  switch (status) {
    case 'exceeded':
      return t('dashboard.statusExceeded');
    case 'danger':
      return t('dashboard.statusDanger', { time: estimatedHitTime || timeRemaining });
    case 'warning':
      return t('dashboard.statusWarning', { time: timeRemaining });
    default:
      // For 'safe' status, check utilization to decide between safe and normal
      return t('dashboard.statusSafe', { time: timeRemaining });
  }
}

export function UsageLimits({ data }: UsageLimitsProps) {
  const { t } = useTranslation();

  if (!data) {
    return (
      <div className="p-3 bg-gray-800 rounded-lg">
        <div className="text-gray-500 text-xs">{t('dashboard.usageDataUnavailable')}</div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-gray-800 rounded-lg">
      <div className="text-sm font-medium text-white mb-3">{t('dashboard.usageLimits')}</div>

      <ProgressBar
        label={t('dashboard.fiveHourCycle')}
        utilization={data.fiveHour.utilization}
        status={data.fiveHour.status || 'safe'}
        statusMessage={getStatusMessage(t, data.fiveHour.status, data.fiveHour.timeRemaining)}
      />

      <ProgressBar
        label={t('dashboard.sevenDayCycle')}
        utilization={data.sevenDay.utilization}
        status={data.sevenDay.status || 'safe'}
        statusMessage={getStatusMessage(t, data.sevenDay.status, data.sevenDay.timeRemaining)}
      />
    </div>
  );
}
