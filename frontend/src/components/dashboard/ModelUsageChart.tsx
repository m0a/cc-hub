import type { ModelUsage } from '../../../../shared/types';

interface ModelUsageChartProps {
  data: ModelUsage[];
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function ModelUsageChart({ data }: ModelUsageChartProps) {
  if (data.length === 0) {
    return (
      <div className="p-3 bg-gray-800 rounded-lg">
        <div className="text-gray-500 text-xs">No model usage data</div>
      </div>
    );
  }

  const total = data.reduce((sum, m) => sum + m.totalTokensIn + m.totalTokensOut + m.totalCacheRead, 0);

  const getColor = (model: string): string => {
    if (model === 'Opus 4.6') return 'bg-purple-500';
    if (model === 'Opus 4.5') return 'bg-fuchsia-400';
    if (model.startsWith('Opus')) return 'bg-purple-500';
    if (model.startsWith('Sonnet')) return 'bg-blue-500';
    return 'bg-gray-500';
  };

  return (
    <div className="p-3 bg-gray-800 rounded-lg">
      <div className="text-sm font-medium text-white mb-2">Model Usage</div>

      {/* Bar chart */}
      <div className="h-4 bg-gray-700 rounded-full overflow-hidden flex">
        {data.map((model) => {
          const modelTotal = model.totalTokensIn + model.totalTokensOut + model.totalCacheRead;
          const pct = (modelTotal / total) * 100;
          if (pct < 1) return null;
          return (
            <div
              key={model.model}
              className={`${getColor(model.model)} h-full`}
              style={{ width: `${pct}%` }}
              title={`${model.model}: ${formatTokens(modelTotal)} tokens`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex gap-3 text-xs">
        {data.map((model) => (
          <div key={model.model} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${getColor(model.model)}`} />
            <span className="text-gray-400">{model.model}</span>
            <span className="text-gray-500">{formatTokens(model.totalTokensOut)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
