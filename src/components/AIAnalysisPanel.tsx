import React from 'react';
import { Brain, TrendingUp, TrendingDown, Target, Activity } from 'lucide-react';
import { AIAnalysisData } from '../types/ai-analysis';

interface AIAnalysisPanelProps {
  analysis?: AIAnalysisData;
  symbol: string;
}

export const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({ analysis, symbol }) => {
  if (!analysis) return null;

  const supportLevels = analysis.supportResistanceLevels?.filter(l => l.type === 'support') || [];
  const resistanceLevels = analysis.supportResistanceLevels?.filter(l => l.type === 'resistance') || [];

  return (
    <div className="glass-card p-4 sm:p-6 mt-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-xl">
            <Brain className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">AI Market Analysis</h3>
            {analysis.aiConfidence && (
              <p className="text-xs text-white/60">
                Confidence: <span className="text-emerald-400 font-semibold">{Math.round(analysis.aiConfidence * 100)}%</span>
              </p>
            )}
          </div>
        </div>
        {analysis.analysisTimestamp && (
          <p className="text-xs text-white/40">
            {new Date(analysis.analysisTimestamp).toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {supportLevels.length > 0 && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              <TrendingUp className="h-4 w-4 text-blue-400" />
              <h4 className="text-sm font-semibold text-white">Support Levels</h4>
            </div>
            <div className="space-y-2">
              {supportLevels.slice(0, 3).map((level, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-white/60 font-mono">
                    {level.price.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
                  </span>
                  <span className="text-blue-400 text-xs">
                    {Math.round(level.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {resistanceLevels.length > 0 && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              <TrendingDown className="h-4 w-4 text-red-400" />
              <h4 className="text-sm font-semibold text-white">Resistance Levels</h4>
            </div>
            <div className="space-y-2">
              {resistanceLevels.slice(0, 3).map((level, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-white/60 font-mono">
                    {level.price.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
                  </span>
                  <span className="text-red-400 text-xs">
                    {Math.round(level.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis.patterns && analysis.patterns.length > 0 && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              <Target className="h-4 w-4 text-purple-400" />
              <h4 className="text-sm font-semibold text-white">Detected Patterns</h4>
            </div>
            <div className="space-y-2">
              {analysis.patterns.slice(0, 3).map((pattern, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-white/60 capitalize">
                    {pattern.type.replace('-', ' ')}
                  </span>
                  <span className={`text-xs ${pattern.direction === 'bullish' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pattern.direction.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis.vwap && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              <Activity className="h-4 w-4 text-yellow-400" />
              <h4 className="text-sm font-semibold text-white">VWAP</h4>
            </div>
            <div className="text-lg font-mono text-white">
              {analysis.vwap.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
            </div>
            <p className="text-xs text-white/40 mt-1">Volume-Weighted Average Price</p>
          </div>
        )}
      </div>

      {analysis.trendLines && analysis.trendLines.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <h4 className="text-sm font-semibold text-white mb-2">Active Trend Lines</h4>
          <div className="flex flex-wrap gap-2">
            {analysis.trendLines.map((trend, idx) => (
              <div
                key={idx}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  trend.type === 'bullish'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {trend.type.toUpperCase()} ({Math.round(trend.confidence * 100)}%)
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
