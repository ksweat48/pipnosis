import React, { useEffect, useState } from 'react';
import { TrendingUp, Eye, EyeOff } from 'lucide-react';
import { chartOverlayService } from '../services/chart-overlays';

interface StrategyChartOverlayProps {
  onOverlayChange?: (overlays: {
    signalLine: boolean;
    halfTrend: boolean;
    heikinAshi: boolean;
    annotations: boolean;
  }) => void;
}

export function StrategyChartOverlay({ onOverlayChange }: StrategyChartOverlayProps) {
  const [overlays, setOverlays] = useState({
    signalLine: false,
    halfTrend: false,
    heikinAshi: false,
    annotations: true
  });

  useEffect(() => {
    if (onOverlayChange) {
      onOverlayChange(overlays);
    }
  }, [overlays, onOverlayChange]);

  const toggleOverlay = (key: keyof typeof overlays) => {
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-blue-600" />
        <h3 className="font-semibold text-gray-900">Strategy Indicators</h3>
      </div>

      <div className="space-y-2">
        <button
          onClick={() => toggleOverlay('signalLine')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            overlays.signalLine
              ? 'bg-blue-50 border-2 border-blue-500'
              : 'bg-gray-50 border-2 border-gray-200 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center gap-2">
            {overlays.signalLine ? (
              <Eye className="w-4 h-4 text-blue-600" />
            ) : (
              <EyeOff className="w-4 h-4 text-gray-400" />
            )}
            <span className={`text-sm font-medium ${overlays.signalLine ? 'text-blue-900' : 'text-gray-700'}`}>
              Signal Line (Linear Regression)
            </span>
          </div>
          <div className={`w-3 h-3 rounded-full ${overlays.signalLine ? 'bg-blue-600' : 'bg-gray-300'}`} />
        </button>

        <button
          onClick={() => toggleOverlay('halfTrend')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            overlays.halfTrend
              ? 'bg-green-50 border-2 border-green-500'
              : 'bg-gray-50 border-2 border-gray-200 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center gap-2">
            {overlays.halfTrend ? (
              <Eye className="w-4 h-4 text-green-600" />
            ) : (
              <EyeOff className="w-4 h-4 text-gray-400" />
            )}
            <span className={`text-sm font-medium ${overlays.halfTrend ? 'text-green-900' : 'text-gray-700'}`}>
              HalfTrend
            </span>
          </div>
          <div className={`w-3 h-3 rounded-full ${overlays.halfTrend ? 'bg-green-600' : 'bg-gray-300'}`} />
        </button>

        <button
          onClick={() => toggleOverlay('heikinAshi')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            overlays.heikinAshi
              ? 'bg-purple-50 border-2 border-purple-500'
              : 'bg-gray-50 border-2 border-gray-200 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center gap-2">
            {overlays.heikinAshi ? (
              <Eye className="w-4 h-4 text-purple-600" />
            ) : (
              <EyeOff className="w-4 h-4 text-gray-400" />
            )}
            <span className={`text-sm font-medium ${overlays.heikinAshi ? 'text-purple-900' : 'text-gray-700'}`}>
              Heikin Ashi Candles
            </span>
          </div>
          <div className={`w-3 h-3 rounded-full ${overlays.heikinAshi ? 'bg-purple-600' : 'bg-gray-300'}`} />
        </button>

        <button
          onClick={() => toggleOverlay('annotations')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            overlays.annotations
              ? 'bg-orange-50 border-2 border-orange-500'
              : 'bg-gray-50 border-2 border-gray-200 hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center gap-2">
            {overlays.annotations ? (
              <Eye className="w-4 h-4 text-orange-600" />
            ) : (
              <EyeOff className="w-4 h-4 text-gray-400" />
            )}
            <span className={`text-sm font-medium ${overlays.annotations ? 'text-orange-900' : 'text-gray-700'}`}>
              Entry/Exit Markers
            </span>
          </div>
          <div className={`w-3 h-3 rounded-full ${overlays.annotations ? 'bg-orange-600' : 'bg-gray-300'}`} />
        </button>
      </div>

      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-xs text-blue-900 font-medium">
          Toggle indicators to visualize Fx Flow Scalper v2.0 strategy analysis on the chart
        </p>
      </div>
    </div>
  );
}
