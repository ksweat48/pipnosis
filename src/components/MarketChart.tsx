import React from 'react';

interface MarketChartProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  tradeLines?: any;
}

export function MarketChart({ symbol, onSymbolChange, tradeLines }: MarketChartProps) {
  return (
    <div className="space-y-4">
      <select value={symbol} onChange={(e) => onSymbolChange(e.target.value)} className="bg-gray-800 text-white p-2 rounded">
        <option>EURUSD</option>
        <option>GBPUSD</option>
        <option>USDJPY</option>
      </select>
      <div className="h-96 bg-gray-800 rounded flex items-center justify-center text-white">Chart: {symbol}</div>
    </div>
  );
}
