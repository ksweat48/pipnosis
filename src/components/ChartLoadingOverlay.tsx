import React from 'react';
import { Activity } from 'lucide-react';

interface ChartLoadingOverlayProps {
  symbol: string;
  timeframe: string;
  loaded?: number;
  total?: number;
  message?: string;
}

export function ChartLoadingOverlay({ symbol, timeframe, loaded, total, message }: ChartLoadingOverlayProps) {
  const progress = loaded && total ? (loaded / total) * 100 : 0;
  const showProgress = loaded !== undefined && total !== undefined && total > 0;

  return (
    <div className="absolute inset-0 bg-gray-800/90 rounded-lg flex items-center justify-center z-10">
      <div className="text-center max-w-md px-6">
        <div className="relative mb-4">
          <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto"></div>
          <Activity className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-emerald-500" size={20} />
        </div>

        <p className="text-white font-semibold text-lg mb-2">
          {message || `Loading ${symbol} ${timeframe}`}
        </p>

        {showProgress && (
          <>
            <div className="w-full bg-gray-700 rounded-full h-2 mb-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
            <p className="text-white/60 text-sm">
              {loaded} / {total} candles loaded
            </p>
          </>
        )}

        {!showProgress && (
          <p className="text-white/60 text-sm">
            Fetching fresh market data...
          </p>
        )}
      </div>
    </div>
  );
}

interface BackgroundLoadingIndicatorProps {
  completed: number;
  total: number;
  currentBatch?: string[];
}

export function BackgroundLoadingIndicator({ completed, total, currentBatch }: BackgroundLoadingIndicatorProps) {
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return null;
}
