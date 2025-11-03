import React from 'react';

export function TradingLaws() {
  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-white mb-4">Trading Rules</h3>
      <ul className="space-y-2 text-gray-400 text-sm">
        <li>• Always use stop losses</li>
        <li>• Risk management: 3% low, 5% medium, 10% high</li>
        <li>• Follow your strategy</li>
      </ul>
    </div>
  );
}
