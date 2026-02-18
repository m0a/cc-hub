import type { CostEstimate as CostEstimateType } from '../../../../shared/types';

interface CostEstimateProps {
  data: CostEstimateType[];
}

export function CostEstimate({ data }: CostEstimateProps) {
  if (data.length === 0) {
    return (
      <div className="p-3 bg-th-surface rounded-lg">
        <div className="text-th-text-muted text-xs">No cost data</div>
      </div>
    );
  }

  // Calculate output tokens cost only (more meaningful for subscription users)
  const outputCostOnly = data.reduce((sum, m) => sum + m.outputCost, 0);

  return (
    <div className="p-3 bg-th-surface rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-th-text">Output Tokens</span>
          <span className="text-[10px] text-th-text-muted ml-1">(API換算)</span>
        </div>
        <span className="text-lg font-bold text-blue-400">${outputCostOnly.toFixed(2)}</span>
      </div>

      <div className="space-y-1">
        {data.map((model) => (
          <div key={model.model} className="flex justify-between text-xs">
            <span className="text-th-text-secondary">{model.model}</span>
            <span className="text-th-text-secondary">${model.outputCost.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 pt-2 border-t border-th-border text-[10px] text-th-text-muted">
        ※サブスクリプション利用時は実際の課金なし
      </div>
    </div>
  );
}
