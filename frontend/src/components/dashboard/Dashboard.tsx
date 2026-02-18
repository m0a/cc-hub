import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDashboard } from '../../hooks/useDashboard';
import { UsageLimits } from './UsageLimits';
import { DailyUsageChart } from './DailyUsageChart';
import { ModelUsageChart } from './ModelUsageChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { NetworkLatency } from './NetworkLatency';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { useTheme } from '../../hooks/useTheme';

// Onboarding localStorage keys
const ONBOARDING_KEY = 'cchub-onboarding-completed';
const ONBOARDING_SESSIONLIST_KEY = 'cchub-onboarding-sessionlist-completed';

interface DashboardProps {
  className?: string;
}

export function Dashboard({ className = '' }: DashboardProps) {
  const { t } = useTranslation();
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
    <div className={`p-2 space-y-2 overflow-y-auto ${className}`}>
      <NetworkLatency />
      <UsageLimits data={data?.usageLimits || null} history={data?.usageHistory || []} />
      <DailyUsageChart data={data?.dailyActivity || []} />
      <ModelUsageChart data={data?.modelUsage || []} />
      {data?.hourlyActivity && Object.keys(data.hourlyActivity).length > 0 && (
        <HourlyHeatmap data={data.hourlyActivity} />
      )}
      {/* Settings section */}
      <div className="border-t border-th-border pt-3 mt-3">
        <div className="flex items-center justify-between px-2">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="text-xs text-th-text-muted hover:text-th-text-secondary transition-colors"
          >
            {t('onboarding.resetTutorial')}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-th-border text-th-text hover:bg-th-surface-hover active:bg-th-surface-active transition-colors"
              title={theme === 'dark' ? t('appearance.light') : t('appearance.dark')}
            >
              {theme === 'dark' ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
              <span>{theme === 'dark' ? t('appearance.light') : t('appearance.dark')}</span>
            </button>
            <LanguageSwitcher />
          </div>
        </div>
        <div className="flex items-center justify-center px-2 pt-2">
          <button
            onClick={handleClearCache}
            disabled={cacheClearing}
            className="text-xs text-th-text-muted hover:text-red-400 transition-colors disabled:opacity-50"
          >
            {cacheClearing ? 'クリア中...' : 'キャッシュクリア & リロード'}
          </button>
        </div>
        {data?.version && (
          <div className="text-center text-th-text-muted text-xs pt-2">
            CC Hub v{data.version}
          </div>
        )}
      </div>

      {/* Reset confirmation dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)]">
          <div className="bg-th-surface rounded-lg p-4 max-w-xs w-full mx-4 shadow-xl">
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
                className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 rounded text-th-text transition-colors"
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
