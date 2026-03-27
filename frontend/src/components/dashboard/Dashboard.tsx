import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Globe } from 'lucide-react';
import { useDashboard } from '../../hooks/useDashboard';
import { UsageLimits } from './UsageLimits';
import { DailyUsageChart } from './DailyUsageChart';
import { ModelUsageChart } from './ModelUsageChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { NetworkLatency } from './NetworkLatency';
import { SystemMetricsChart } from './SystemMetrics';
import { useTheme } from '../../hooks/useTheme';

// Onboarding localStorage keys
const ONBOARDING_KEY = 'cchub-onboarding-completed';
const ONBOARDING_SESSIONLIST_KEY = 'cchub-onboarding-sessionlist-completed';

interface DashboardProps {
  className?: string;
  compact?: boolean; // true when in narrow side panel
}

export function Dashboard({ className = '', compact = false }: DashboardProps) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, error } = useDashboard(300000);
  const { theme, toggleTheme } = useTheme();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [cacheClearing, setCacheClearing] = useState(false);

  const handleClearCache = useCallback(async () => {
    setCacheClearing(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      console.error('Cache clear failed:', e);
      setCacheClearing(false);
    }
  }, []);

  const handleResetOnboarding = () => {
    localStorage.removeItem(ONBOARDING_KEY);
    localStorage.removeItem(ONBOARDING_SESSIONLIST_KEY);
    setShowResetConfirm(false);
    window.location.reload();
  };

  if (isLoading && !data) {
    return (
      <div className={`p-2 ${className}`}>
        <div className="text-th-text-muted text-xs animate-pulse">{t('common.loading')}</div>
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
    <div className={`overflow-y-auto overscroll-contain px-4 py-4 ${className}`}>
      <div className={compact ? 'space-y-3' : 'md:grid md:grid-cols-2 md:gap-4 space-y-3 md:space-y-0'}>
        <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
          <NetworkLatency />
        </div>
        <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
          <SystemMetricsChart data={data?.systemMetrics} />
        </div>
        <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
          <UsageLimits data={data?.usageLimits || null} history={data?.usageHistory || []} />
        </div>
        <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
          <DailyUsageChart data={data?.dailyActivity || []} />
        </div>
        <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
          <ModelUsageChart data={data?.modelUsage || []} />
        </div>
        {data?.hourlyActivity && Object.keys(data.hourlyActivity).length > 0 && (
          <div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06] md:col-span-2">
            <HourlyHeatmap data={data.hourlyActivity} />
          </div>
        )}
      </div>

      {/* Settings section */}
      <div className="mt-6 pt-4 border-t border-white/[0.06]">
        <div className="flex flex-wrap items-center gap-2 max-w-lg">
          <button
            onClick={toggleTheme}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 bg-white/[0.04] hover:bg-white/[0.06] rounded-md transition-colors"
            title={theme === 'dark' ? t('appearance.light') : t('appearance.dark')}
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
            <span>{theme === 'dark' ? t('appearance.light') : t('appearance.dark')}</span>
          </button>
          <button
            onClick={() => {
              const newLang = i18n.language === 'ja' ? 'en' : 'ja';
              i18n.changeLanguage(newLang);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 bg-white/[0.04] hover:bg-white/[0.06] rounded-md transition-colors"
            title={i18n.language === 'ja' ? 'Switch to English' : '日本語に切替'}
          >
            <Globe className="w-3.5 h-3.5" />
            {i18n.language === 'ja' ? 'EN' : 'JA'}
          </button>
          <button
            onClick={() => setShowResetConfirm(true)}
            className="text-[12px] text-zinc-600 hover:text-zinc-400 px-3 py-1.5 transition-colors"
          >
            {t('onboarding.resetTutorial')}
          </button>
          <button
            onClick={handleClearCache}
            disabled={cacheClearing}
            className="text-[12px] text-zinc-600 hover:text-red-400 px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {cacheClearing ? t('common.loading') : t('dashboard.clearCache')}
          </button>
        </div>
        {data?.version && (
          <div className="text-[11px] text-zinc-700 mt-3">
            CC Hub v{data.version}
          </div>
        )}
      </div>

      {/* Reset confirmation dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)]">
          <div className="bg-th-surface rounded-md p-4 max-w-xs w-full mx-4 shadow-xl">
            <h3 className="text-sm font-medium text-th-text mb-2">{t('onboarding.resetTutorial')}</h3>
            <p className="text-xs text-th-text-secondary mb-4">{t('onboarding.resetConfirm')}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 text-xs bg-th-surface-active hover:bg-th-surface-active rounded text-th-text transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleResetOnboarding}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded text-th-text transition-colors"
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
