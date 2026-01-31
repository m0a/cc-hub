import { useDashboard } from '../../hooks/useDashboard';
import { UsageLimits } from './UsageLimits';
import { DailyUsageChart } from './DailyUsageChart';
import { ModelUsageChart } from './ModelUsageChart';

interface DashboardProps {
  className?: string;
}

export function Dashboard({ className = '' }: DashboardProps) {
  const { data, isLoading, error } = useDashboard(60000);

  if (isLoading && !data) {
    return (
      <div className={`p-2 ${className}`}>
        <div className="text-gray-500 text-xs animate-pulse">Loading dashboard...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={`p-2 ${className}`}>
        <div className="text-red-400 text-xs">{error}</div>
      </div>
    );
  }

  return (
    <div className={`p-2 space-y-2 overflow-y-auto ${className}`}>
      <UsageLimits data={data?.usageLimits || null} />
      <DailyUsageChart data={data?.dailyActivity || []} />
      <ModelUsageChart data={data?.modelUsage || []} />
    </div>
  );
}
