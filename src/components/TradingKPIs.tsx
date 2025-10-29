import React from 'react';

export function TradingKPIs() {
  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-white mb-4">Trading KPIs</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-800 p-3 rounded">
          <div className="text-gray-400 text-xs">Win Rate</div>
          <div className="text-white text-lg font-bold">0%</div>
        </div>
        <div className="bg-gray-800 p-3 rounded">
          <div className="text-gray-400 text-xs">Total Trades</div>
          <div className="text-white text-lg font-bold">0</div>
        </div>
      </div>
    </div>
  );
}
