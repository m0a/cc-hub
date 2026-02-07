import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDashboard } from '../../hooks/useDashboard';
import { UsageLimits } from './UsageLimits';
import { DailyUsageChart } from './DailyUsageChart';
import { ModelUsageChart } from './ModelUsageChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { NetworkLatency } from './NetworkLatency';
import { LanguageSwitcher } from '../LanguageSwitcher';

// Onboarding localStorage keys
const ONBOARDING_KEY = 'cchub-onboarding-completed';
const ONBOARDING_SESSIONLIST_KEY = 'cchub-onboarding-sessionlist-completed';

interface DashboardProps {
  className?: string;
}

export function Dashboard({ className = '' }: DashboardProps) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useDashboard(60000);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleResetOnboarding = () => {
    localStorage.removeItem(ONBOARDING_KEY);
    localStorage.removeItem(ONBOARDING_SESSIONLIST_KEY);
    setShowResetConfirm(false);
    window.location.reload();
  };

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
      <NetworkLatency />
      <UsageLimits data={data?.usageLimits || null} history={data?.usageHistory || []} />
      <DailyUsageChart data={data?.dailyActivity || []} />
      <ModelUsageChart data={data?.modelUsage || []} />
      {data?.hourlyActivity && Object.keys(data.hourlyActivity).length > 0 && (
        <HourlyHeatmap data={data.hourlyActivity} />
      )}
      {/* Settings section */}
      <div className="border-t border-gray-700 pt-3 mt-3">
        <div className="flex items-center justify-between px-2">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {t('onboarding.resetTutorial')}
          </button>
          <LanguageSwitcher />
        </div>
        {data?.version && (
          <div className="text-center text-gray-600 text-xs pt-2">
            CC Hub v{data.version}
          </div>
        )}
      </div>

      {/* Reset confirmation dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-800 rounded-lg p-4 max-w-xs w-full mx-4 shadow-xl">
            <h3 className="text-sm font-medium text-white mb-2">{t('onboarding.resetTutorial')}</h3>
            <p className="text-xs text-gray-400 mb-4">{t('onboarding.resetConfirm')}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleResetOnboarding}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white transition-colors"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
