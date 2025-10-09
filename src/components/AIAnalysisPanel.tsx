import React from 'react';
import { Brain, TrendingUp, TrendingDown, Activity, BarChart3, Gauge, Target } from 'lucide-react';
import { AIAnalysisData } from '../types/ai-analysis';

interface AIAnalysisPanelProps {
  analysis?: AIAnalysisData;
  symbol: string;
}

export const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({ analysis, symbol }) => {
  if (!analysis) return null;

  const getSentimentColor = (bias: string) => {
    switch (bias) {
      case 'bullish': return 'text-emerald-400';
      case 'bearish': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  const getSentimentBgColor = (bias: string) => {
    switch (bias) {
      case 'bullish': return 'bg-emerald-500/20';
      case 'bearish': return 'bg-red-500/20';
      default: return 'bg-yellow-500/20';
    }
  };

  const getRSIColor = (status: string) => {
    switch (status) {
      case 'overbought': return 'text-red-400';
      case 'oversold': return 'text-blue-400';
      default: return 'text-yellow-400';
    }
  };

  const getVolumeTrendColor = (trend: string) => {
    switch (trend) {
      case 'increasing': return 'text-emerald-400';
      case 'decreasing': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  const getFearGreedColor = (level: string) => {
    switch (level) {
      case 'extreme-fear': return 'text-blue-400';
      case 'fear': return 'text-cyan-400';
      case 'neutral': return 'text-yellow-400';
      case 'greed': return 'text-orange-400';
      case 'extreme-greed': return 'text-red-400';
      default: return 'text-white';
    }
  };

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {analysis.marketSentiment && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              {analysis.marketSentiment.bias === 'bullish' ? (
                <TrendingUp className="h-4 w-4 text-emerald-400" />
              ) : analysis.marketSentiment.bias === 'bearish' ? (
                <TrendingDown className="h-4 w-4 text-red-400" />
              ) : (
                <Activity className="h-4 w-4 text-yellow-400" />
              )}
              <h4 className="text-sm font-semibold text-white">Market Sentiment</h4>
            </div>
            <div className="space-y-2">
              <div className={`text-2xl font-bold ${getSentimentColor(analysis.marketSentiment.bias)} uppercase`}>
                {analysis.marketSentiment.bias}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60">Confidence:</span>
                <span className="text-emerald-400 font-semibold">
                  {Math.round(analysis.marketSentiment.confidence * 100)}%
                </span>
              </div>
              <p className="text-xs text-white/50 mt-2">
                {analysis.marketSentiment.description}
              </p>
            </div>
          </div>
        )}

        {analysis.overboughtOversold && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              <Gauge className="h-4 w-4 text-purple-400" />
              <h4 className="text-sm font-semibold text-white">RSI Indicator</h4>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white/60 text-sm">RSI:</span>
                <span className="text-2xl font-bold text-white">
                  {analysis.overboughtOversold.rsi.toFixed(1)}
                </span>
              </div>
              <div className={`text-sm font-bold uppercase ${getRSIColor(analysis.overboughtOversold.status)}`}>
                {analysis.overboughtOversold.status}
              </div>
              <p className="text-xs text-white/50 mt-2">
                {analysis.overboughtOversold.signal}
              </p>
            </div>
          </div>
        )}

        {analysis.volumeAnalysis && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              <BarChart3 className="h-4 w-4 text-cyan-400" />
              <h4 className="text-sm font-semibold text-white">Volume Analysis</h4>
            </div>
            <div className="space-y-2">
              <div className={`text-lg font-bold uppercase ${getVolumeTrendColor(analysis.volumeAnalysis.trend)}`}>
                {analysis.volumeAnalysis.trend}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60">Current:</span>
                <span className="text-white/80 font-mono">
                  {(analysis.volumeAnalysis.currentVolume / 1000).toFixed(1)}K
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60">Average:</span>
                <span className="text-white/80 font-mono">
                  {(analysis.volumeAnalysis.averageVolume / 1000).toFixed(1)}K
                </span>
              </div>
              <p className="text-xs text-white/50 mt-2">
                {analysis.volumeAnalysis.description}
              </p>
            </div>
          </div>
        )}

        {analysis.fearGreedIndex && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              <Target className="h-4 w-4 text-orange-400" />
              <h4 className="text-sm font-semibold text-white">Fear & Greed</h4>
            </div>
            <div className="space-y-2">
              <div className="text-center">
                <div className={`text-3xl font-bold ${getFearGreedColor(analysis.fearGreedIndex.level)}`}>
                  {analysis.fearGreedIndex.value}
                </div>
                <div className="text-xs text-white/40">out of 100</div>
              </div>
              <div className={`text-sm font-bold uppercase text-center ${getFearGreedColor(analysis.fearGreedIndex.level)}`}>
                {analysis.fearGreedIndex.level.replace('-', ' ')}
              </div>
              <p className="text-xs text-white/50 mt-2">
                {analysis.fearGreedIndex.description}
              </p>
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
