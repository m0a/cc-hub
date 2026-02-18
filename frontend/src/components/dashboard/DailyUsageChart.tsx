import { useTranslation } from 'react-i18next';
import type { DailyActivity } from '../../../../shared/types';

interface DailyUsageChartProps {
  data: DailyActivity[];
}

export function DailyUsageChart({ data }: DailyUsageChartProps) {
  const { t, i18n } = useTranslation();

  if (data.length === 0) {
    return (
      <div className="p-3 bg-th-surface rounded-lg">
        <div className="text-th-text-muted text-xs">{t('dashboard.noActivityData')}</div>
      </div>
    );
  }

  // Get last 7 days for display
  const recentData = data.slice(-7);
  const maxMessages = Math.max(...recentData.map(d => d.messageCount), 1);
  const locale = i18n.language === 'ja' ? 'ja' : 'en';

  return (
    <div className="p-3 bg-th-surface rounded-lg">
      <div className="text-sm font-medium text-th-text mb-2">{t('dashboard.dailyStats')}</div>
      <div className="flex items-end gap-1" style={{ height: '64px' }}>
        {recentData.map((day) => {
          const heightPx = Math.round((day.messageCount / maxMessages) * 64);
          return (
            <div key={day.date} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className="w-full bg-blue-500 rounded-t transition-all duration-300 hover:bg-blue-400"
                style={{ height: `${heightPx}px`, minHeight: day.messageCount > 0 ? '4px' : '0' }}
                title={`${day.date}: ${day.messageCount} messages`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {recentData.map((day) => {
          const date = new Date(day.date);
          const dayLabel = date.toLocaleDateString(locale, { weekday: 'narrow' });
          return (
            <div key={day.date} className="flex-1 text-center">
              <span className="text-[10px] text-th-text-muted">{dayLabel}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-th-text-secondary text-center">
        {t('dashboard.today')}: {recentData[recentData.length - 1]?.messageCount || 0} {t('dashboard.messages')}
      </div>
    </div>
  );
}
