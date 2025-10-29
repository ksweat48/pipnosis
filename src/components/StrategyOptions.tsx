import React from 'react';
import { StrategyOption } from '@/types/strategy';

interface Props {
  options: StrategyOption[];
  onSelect: (option: StrategyOption) => void;
  isExecuting: boolean;
}

export function StrategyOptions({ options, onSelect, isExecuting }: Props) {
  if (options.length === 0) return null;

  return (
    <div className="glass-card p-6 space-y-4">
      <h3 className="text-xl font-bold text-white">Strategy Options</h3>
      {options.map(opt => (
        <div key={opt.id} className="bg-gray-800 p-4 rounded">
          <div className="text-white font-semibold">{opt.name}</div>
          <div className="text-gray-400 text-sm">{opt.reasoning}</div>
          <button
            onClick={() => onSelect(opt)}
            disabled={isExecuting}
            className="mt-3 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            Execute Trade
          </button>
        </div>
      ))}
    </div>
  );
}
