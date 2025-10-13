import React from 'react';
import { Activity, Clock, Target } from 'lucide-react';

interface ChartAutoTradingIndicatorProps {
  isActive: boolean;
  tradesRemaining: number;
  symbolsMonitored: number;
  nextScanIn?: number;
  currentlyScanning?: string;
  onViewAnalysis?: () => void;
}

export const ChartAutoTradingIndicator: React.FC<ChartAutoTradingIndicatorProps> = ({
  isActive,
  tradesRemaining,
  symbolsMonitored,
  nextScanIn,
  currentlyScanning,
  onViewAnalysis
}) => {
  if (!isActive) return null;

  return (
    <div
      className="absolute top-4 right-4 z-10 glass-card p-3 min-w-[200px] cursor-pointer hover:bg-white/10 transition-all"
      onClick={onViewAnalysis}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Activity className="h-4 w-4 text-emerald-400" />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
          </div>
          <span className="text-xs font-bold text-emerald-400">AUTO-TRADING</span>
        </div>
        <span className="text-xs text-white/60">Active</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-1.5">
            <Target className="h-3 w-3 text-white/60" />
            <span className="text-white/60">Trades Left</span>
          </div>
          <span className="text-white font-bold">{tradesRemaining}</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-1.5">
            <Activity className="h-3 w-3 text-white/60" />
            <span className="text-white/60">Monitoring</span>
          </div>
          <span className="text-white font-bold">{symbolsMonitored} symbols</span>
        </div>

        {nextScanIn !== undefined && nextScanIn >= 0 && (
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-1.5">
              <Clock className="h-3 w-3 text-white/60" />
              <span className="text-white/60">Next Scan</span>
            </div>
            <span className="text-emerald-400 font-bold">{nextScanIn}s</span>
          </div>
        )}
      </div>

      {currentlyScanning && (
        <div className="mt-2 pt-2 border-t border-white/10">
          <div className="flex items-center space-x-1.5">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-xs text-emerald-400 font-semibold">
              Scanning {currentlyScanning}
            </span>
          </div>
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-white/10">
        <p className="text-xs text-white/40 text-center hover:text-white/60 transition-colors">
          Click to view analysis
        </p>
      </div>
    </div>
  );
};
