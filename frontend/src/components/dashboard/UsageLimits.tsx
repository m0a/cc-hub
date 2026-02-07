import { useTranslation } from 'react-i18next';
import type { UsageLimits as UsageLimitsType, UsageSnapshot } from '../../../../shared/types';
import { UsageChart } from './UsageChart';

interface UsageLimitsProps {
  data: UsageLimitsType | null;
  history: UsageSnapshot[];
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
      return t('dashboard.statusDanger', { time: estimatedHitTime || timeRemaining, resetTime: timeRemaining });
    case 'warning':
      return t('dashboard.statusWarning', { time: timeRemaining });
    default:
      // For 'safe' status, check utilization to decide between safe and normal
      return t('dashboard.statusSafe', { time: timeRemaining });
  }
}

export function UsageLimits({ data, history }: UsageLimitsProps) {
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

      <UsageChart
        label={t('dashboard.fiveHourCycle')}
        field="fiveHour"
        snapshots={history}
        currentUtilization={data.fiveHour.utilization}
        resetsAt={data.fiveHour.resetsAt}
        status={data.fiveHour.status || 'safe'}
        statusMessage={getStatusMessage(t, data.fiveHour.status, data.fiveHour.timeRemaining, data.fiveHour.estimatedHitTime)}
      />

      <UsageChart
        label={t('dashboard.sevenDayCycle')}
        field="sevenDay"
        snapshots={history}
        currentUtilization={data.sevenDay.utilization}
        resetsAt={data.sevenDay.resetsAt}
        status={data.sevenDay.status || 'safe'}
        statusMessage={getStatusMessage(t, data.sevenDay.status, data.sevenDay.timeRemaining, data.sevenDay.estimatedHitTime)}
      />
    </div>
  );
}
