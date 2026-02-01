interface HourlyHeatmapProps {
  data: Record<number, number>;
  className?: string;
}

// Time blocks for aggregation
const TIME_BLOCKS = [
  { label: '0-6時', hours: [0, 1, 2, 3, 4, 5] },
  { label: '6-12時', hours: [6, 7, 8, 9, 10, 11] },
  { label: '12-18時', hours: [12, 13, 14, 15, 16, 17] },
  { label: '18-24時', hours: [18, 19, 20, 21, 22, 23] },
];

export function HourlyHeatmap({ data, className = '' }: HourlyHeatmapProps) {
  // Aggregate data by time blocks
  const blockData = TIME_BLOCKS.map(block => ({
    label: block.label,
    total: block.hours.reduce((sum, hour) => sum + (data[hour] || 0), 0),
  }));

  const maxValue = Math.max(...blockData.map(b => b.total), 1);
  const totalActivity = blockData.reduce((sum, b) => sum + b.total, 0);

  return (
    <div className={`bg-gray-800/50 rounded-lg p-3 ${className}`}>
      <h3 className="text-xs text-gray-400 mb-3">時間帯別アクティビティ</h3>

      <div className="space-y-2">
        {blockData.map((block) => {
          const percentage = totalActivity > 0 ? Math.round((block.total / totalActivity) * 100) : 0;
          const barWidth = (block.total / maxValue) * 100;

          return (
            <div key={block.label} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400 w-14 shrink-0">{block.label}</span>
              <div className="flex-1 h-4 bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded transition-all duration-300"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-500 w-8 text-right">{percentage}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
