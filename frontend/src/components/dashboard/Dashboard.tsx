import { useTranslation } from 'react-i18next';
import { useDashboard } from '../../hooks/useDashboard';
import { UsageLimits } from './UsageLimits';
import { DailyUsageChart } from './DailyUsageChart';
import { ModelUsageChart } from './ModelUsageChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { LanguageSwitcher } from '../LanguageSwitcher';

interface DashboardProps {
  className?: string;
}

export function Dashboard({ className = '' }: DashboardProps) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useDashboard(60000);

  if (isLoading && !data) {
    return (
      <div className={`p-2 ${className}`}>
        <div className="text-gray-500 text-xs animate-pulse">{t('common.loading')}</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={`p-2 ${className}`}>
        <div className="text-red-400 text-xs">{t('common.error')}: {error}</div>
      </div>
    );
  }

  return (
    <div className={`p-2 space-y-2 overflow-y-auto ${className}`}>
      <UsageLimits data={data?.usageLimits || null} />
      <DailyUsageChart data={data?.dailyActivity || []} />
      <ModelUsageChart data={data?.modelUsage || []} />
      {data?.hourlyActivity && Object.keys(data.hourlyActivity).length > 0 && (
        <HourlyHeatmap data={data.hourlyActivity} />
      )}
      {data?.version && (
        <div className="flex items-center justify-center gap-2 text-gray-600 text-xs pt-2">
          <span>CC Hub v{data.version}</span>
          <LanguageSwitcher />
        </div>
      )}
    </div>
  );
}
