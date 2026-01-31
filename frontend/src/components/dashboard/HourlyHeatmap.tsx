interface HourlyHeatmapProps {
  data: Record<number, number>;
  className?: string;
}

export function HourlyHeatmap({ data, className = '' }: HourlyHeatmapProps) {
  // Find max value for color scaling
  const values = Object.values(data);
  const maxValue = Math.max(...values, 1);

  // Get color intensity based on value
  const getColor = (value: number): string => {
    if (value === 0) return 'bg-gray-800';
    const intensity = value / maxValue;
    if (intensity < 0.25) return 'bg-green-900/50';
    if (intensity < 0.5) return 'bg-green-700/60';
    if (intensity < 0.75) return 'bg-green-500/70';
    return 'bg-green-400';
  };

  // Format hour for display
  const formatHour = (hour: number): string => {
    if (hour === 0) return '0時';
    if (hour === 6) return '6時';
    if (hour === 12) return '12時';
    if (hour === 18) return '18時';
    return '';
  };

  // Group hours into 4 rows of 6
  const rows = [
    [0, 1, 2, 3, 4, 5],     // 00:00 - 05:00
    [6, 7, 8, 9, 10, 11],   // 06:00 - 11:00
    [12, 13, 14, 15, 16, 17], // 12:00 - 17:00
    [18, 19, 20, 21, 22, 23], // 18:00 - 23:00
  ];

  return (
    <div className={`bg-gray-800/50 rounded-lg p-3 ${className}`}>
      <h3 className="text-xs text-gray-400 mb-2">時間帯別アクティビティ</h3>

      <div className="space-y-1">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 w-6 text-right shrink-0">
              {formatHour(row[0])}
            </span>
            <div className="flex gap-0.5 flex-1">
              {row.map((hour) => {
                const value = data[hour] || 0;
                return (
                  <div
                    key={hour}
                    className={`flex-1 h-5 rounded-sm ${getColor(value)} relative group cursor-default`}
                    title={`${hour}時: ${value}セッション`}
                  >
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-gray-900 text-[10px] text-white rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {hour}時: {value}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-gray-500">
        <span>少</span>
        <div className="w-3 h-3 rounded-sm bg-gray-800" />
        <div className="w-3 h-3 rounded-sm bg-green-900/50" />
        <div className="w-3 h-3 rounded-sm bg-green-700/60" />
        <div className="w-3 h-3 rounded-sm bg-green-500/70" />
        <div className="w-3 h-3 rounded-sm bg-green-400" />
        <span>多</span>
      </div>
    </div>
  );
}
