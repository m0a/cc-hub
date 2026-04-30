import { useTranslation } from 'react-i18next';
import type { UsageLimits as UsageLimitsType, UsageLimitsStatus, UsageSnapshot } from '../../../../shared/types';
import { UsageChart } from './UsageChart';

interface UsageLimitsProps {
  data: UsageLimitsType | null;
  status?: UsageLimitsStatus;
  history: UsageSnapshot[];
}

function formatTimeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (minutes > 0) return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
  return `${seconds}s`;
}

function ErrorMessage({ status }: { status: UsageLimitsStatus }) {
  const { t } = useTranslation();
  if (!status.errorReason) return null;

  const messageKey: Record<NonNullable<UsageLimitsStatus['errorReason']>, string> = {
    'rate-limited': 'dashboard.usageErrorRateLimited',
    'no-credentials': 'dashboard.usageErrorNoCredentials',
    'unauthorized': 'dashboard.usageErrorUnauthorized',
    'fetch-failed': 'dashboard.usageErrorFetchFailed',
    'unknown': 'dashboard.usageErrorUnknown',
  };

  const message = t(messageKey[status.errorReason]);
  const isRateLimited = status.errorReason === 'rate-limited';

  return (
    <div className="text-[11px] text-amber-400/90 mb-2 leading-relaxed">
      <div>{message}</div>
      {isRateLimited && (
        <div className="text-th-text-muted mt-0.5">
          {t('dashboard.usageErrorRateLimitedDetail')}
          {status.rateLimitedUntil && (
            <span> · {t('dashboard.usageRetryIn', { time: formatTimeUntil(status.rateLimitedUntil) })}</span>
          )}
        </div>
      )}
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
      return t('dashboard.statusDanger', { time: estimatedHitTime || timeRemaining, resetTime: timeRemaining });
    case 'warning':
      return t('dashboard.statusWarning', { time: timeRemaining });
    default:
      // For 'safe' status, check utilization to decide between safe and normal
      return t('dashboard.statusSafe', { time: timeRemaining });
  }
}

export function UsageLimits({ data, status, history }: UsageLimitsProps) {
  const { t } = useTranslation();

  if (!data) {
    return (
      <div className="p-3 bg-th-surface rounded-md">
        <div className="text-sm font-medium text-th-text mb-2">{t('dashboard.usageLimits')}</div>
        {status?.errorReason ? (
          <ErrorMessage status={status} />
        ) : (
          <div className="text-th-text-muted text-xs">{t('dashboard.usageDataUnavailable')}</div>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 bg-th-surface rounded-md">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-th-text">{t('dashboard.usageLimits')}</div>
        {status?.isStale && (
          <div className="text-[10px] text-th-text-muted">{t('dashboard.usageStaleData')}</div>
        )}
      </div>

      {status?.errorReason && <ErrorMessage status={status} />}

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
