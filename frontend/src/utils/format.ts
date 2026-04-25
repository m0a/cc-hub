type TFunction = (key: string, options?: Record<string, unknown>) => string;

export function formatRelativeTime(isoDate: string, t: TFunction, locale: string): string {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 5) return t('time.now');
  if (diffSec < 60) return t('time.secondsAgo', { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('time.hoursAgo', { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t('time.daysAgo', { count: diffDay });
  const dateLocale = locale === 'ja' ? 'ja-JP' : 'en-US';
  return new Date(ts).toLocaleDateString(dateLocale);
}
