import React from 'react';

interface Props {
  todayPnL: number;
  weeklyPnL: number;
  totalBalance: number;
}

export function TradingDashboard({ todayPnL, weeklyPnL, totalBalance }: Props) {
  return (
    <div className="glass-card p-6">
      <h3 className="text-xl font-bold text-white mb-4">Trading Dashboard</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800 p-4 rounded">
          <div className="text-gray-400 text-sm">Balance</div>
          <div className="text-white text-2xl font-bold">${totalBalance.toFixed(2)}</div>
        </div>
        <div className="bg-gray-800 p-4 rounded">
          <div className="text-gray-400 text-sm">Today P&L</div>
          <div className={`text-2xl font-bold ${todayPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>${todayPnL.toFixed(2)}</div>
        </div>
        <div className="bg-gray-800 p-4 rounded">
          <div className="text-gray-400 text-sm">Weekly P&L</div>
          <div className={`text-2xl font-bold ${weeklyPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>${weeklyPnL.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}
