import type { DailyActivity } from '../../../../shared/types';

interface DailyUsageChartProps {
  data: DailyActivity[];
}

export function DailyUsageChart({ data }: DailyUsageChartProps) {
  if (data.length === 0) {
    return (
      <div className="p-3 bg-gray-800 rounded-lg">
        <div className="text-gray-500 text-xs">No activity data</div>
      </div>
    );
  }

  // Get last 7 days for display
  const recentData = data.slice(-7);
  const maxMessages = Math.max(...recentData.map(d => d.messageCount), 1);

  return (
    <div className="p-3 bg-gray-800 rounded-lg">
      <div className="text-sm font-medium text-white mb-2">Daily Activity</div>
      <div className="flex items-end gap-1 h-16">
        {recentData.map((day) => {
          const height = (day.messageCount / maxMessages) * 100;
          const date = new Date(day.date);
          const dayLabel = date.toLocaleDateString('ja', { weekday: 'narrow' });

          return (
            <div key={day.date} className="flex-1 flex flex-col items-center">
              <div
                className="w-full bg-blue-500 rounded-t transition-all duration-300 hover:bg-blue-400"
                style={{ height: `${height}%`, minHeight: day.messageCount > 0 ? '4px' : '0' }}
                title={`${day.date}: ${day.messageCount} messages`}
              />
              <span className="text-[10px] text-gray-500 mt-1">{dayLabel}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-gray-400 text-center">
        Today: {recentData[recentData.length - 1]?.messageCount || 0} messages
      </div>
    </div>
  );
}
