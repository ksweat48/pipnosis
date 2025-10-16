/**
 * Real AI Analysis Panel
 * Displays technical indicator analysis from the AI Market Engine
 */

import React from 'react';
import { Brain, TrendingUp, TrendingDown, Activity, BarChart3, Gauge, Target, Zap, CheckCircle, XCircle } from 'lucide-react';
import { AiMarketSummary } from '../lib/aiMarketEngine';

interface RealAIAnalysisPanelProps {
  analysis: AiMarketSummary;
  symbol: string;
  isAnalyzing?: boolean;
}

export const RealAIAnalysisPanel: React.FC<RealAIAnalysisPanelProps> = ({ analysis, symbol, isAnalyzing = false }) => {
  const getEMATrendColor = (direction: string) => {
    switch (direction) {
      case 'BULLISH': return 'text-emerald-400';
      case 'BEARISH': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  const getRSIColor = (status: string) => {
    switch (status) {
      case 'OVERBOUGHT': return 'text-red-400';
      case 'OVERSOLD': return 'text-blue-400';
      default: return 'text-yellow-400';
    }
  };

  const getVWAPColor = (position: string) => {
    switch (position) {
      case 'Above VWAP': return 'text-emerald-400';
      case 'Below VWAP': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  const getVolumeColor = (status: string) => {
    switch (status) {
      case 'HIGH': return 'text-emerald-400';
      case 'LOW': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  const getATRColor = (status: string) => {
    switch (status) {
      case 'Elevated': return 'text-orange-400';
      case 'Low': return 'text-blue-400';
      default: return 'text-yellow-400';
    }
  };

  const getSentimentColor = (status: string) => {
    switch (status) {
      case 'BULLISH': return 'text-emerald-400';
      case 'BEARISH': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  const getSignalColor = (status: string) => {
    return status === 'VALID' ? 'text-emerald-400' : 'text-red-400';
  };

  return (
    <div className="glass-card p-4 sm:p-6 mt-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-xl">
            <Brain className={`h-5 w-5 text-blue-400 ${isAnalyzing ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Real-Time Technical Analysis</h3>
            <p className="text-xs text-white/60">
              {isAnalyzing ? 'Analyzing...' : `${analysis.metadata.candlesAnalyzed} candles analyzed`}
            </p>
          </div>
        </div>
        <p className="text-xs text-white/40">
          {analysis.metadata.timestamp.toLocaleTimeString()}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* RSI Card */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Gauge className="h-4 w-4 text-purple-400" />
            <h4 className="text-sm font-semibold text-white">RSI (14)</h4>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-white/60 text-sm">Value:</span>
              <span className="text-2xl font-bold text-white">
                {analysis.rsi.value.toFixed(1)}
              </span>
            </div>
            <div className={`text-sm font-bold uppercase ${getRSIColor(analysis.rsi.status)}`}>
              {analysis.rsi.status}
            </div>
            {analysis.rsi.trend && (
              <div className="text-xs px-2 py-1 rounded bg-white/5">
                Trend: <span className="font-semibold">{analysis.rsi.trend}</span>
              </div>
            )}
            <div className="w-full bg-white/10 rounded-full h-2 mt-2">
              <div
                className={`h-2 rounded-full ${
                  analysis.rsi.status === 'OVERBOUGHT' ? 'bg-red-500' :
                  analysis.rsi.status === 'OVERSOLD' ? 'bg-blue-500' :
                  'bg-yellow-500'
                }`}
                style={{ width: `${analysis.rsi.value}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* VWAP Card */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Activity className="h-4 w-4 text-yellow-400" />
            <h4 className="text-sm font-semibold text-white">VWAP</h4>
          </div>
          <div className="space-y-2">
            <div className="text-lg font-mono text-white">
              {analysis.vwap.value.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
            </div>
            <div className={`text-sm font-bold ${getVWAPColor(analysis.vwap.position)}`}>
              {analysis.vwap.position}
            </div>
            <p className="text-xs text-white/40 mt-1">
              Volume-Weighted Average Price
            </p>
          </div>
        </div>

        {/* Volume Card */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            <h4 className="text-sm font-semibold text-white">Volume</h4>
          </div>
          <div className="space-y-2">
            <div className={`text-lg font-bold uppercase ${getVolumeColor(analysis.volume.status)}`}>
              {analysis.volume.status}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/60">Change:</span>
              <span className={`font-semibold ${
                analysis.volume.delta.startsWith('+') ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {analysis.volume.delta}
              </span>
            </div>
            <p className="text-xs text-white/40 mt-1">
              vs 20-period average
            </p>
          </div>
        </div>

        {/* ATR Card */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Zap className="h-4 w-4 text-orange-400" />
            <h4 className="text-sm font-semibold text-white">ATR (14)</h4>
          </div>
          <div className="space-y-2">
            <div className="text-lg font-mono text-white">
              {analysis.atr.value.toFixed(symbol === 'XAUUSD' ? 2 : 5)}
            </div>
            <div className={`text-sm font-bold uppercase ${getATRColor(analysis.atr.status)}`}>
              {analysis.atr.status}
            </div>
            {analysis.atr.tooltip && (
              <p className="text-xs text-white/40 mt-1" title={analysis.atr.tooltip}>
                {analysis.atr.tooltip}
              </p>
            )}
          </div>
        </div>

        {/* Candle Pattern Card */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Target className="h-4 w-4 text-purple-400" />
            <h4 className="text-sm font-semibold text-white">Candle Pattern</h4>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-bold text-white">
              {analysis.candleSignal.type}
            </div>
            {analysis.candleSignal.strength && (
              <div className={`text-xs font-semibold px-2 py-1 rounded ${
                analysis.candleSignal.strength === 'Strong' ? 'bg-emerald-500/20 text-emerald-400' :
                analysis.candleSignal.strength === 'Moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-white/10 text-white/60'
              }`}>
                {analysis.candleSignal.strength}
              </div>
            )}
          </div>
        </div>

        {/* Market Structure Card */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <TrendingUp className="h-4 w-4 text-blue-400" />
            <h4 className="text-sm font-semibold text-white">Structure</h4>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-bold text-white">
              {analysis.structure.type}
            </div>
            {analysis.structure.recent && (
              <div className="text-xs font-semibold px-2 py-1 rounded bg-blue-500/20 text-blue-400">
                Recent Change
              </div>
            )}
          </div>
        </div>

        {/* EMA Trend Card */}
        {analysis.ema && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-3">
              <Activity className="h-4 w-4 text-cyan-400" />
              <h4 className="text-sm font-semibold text-white">EMA Trend</h4>
            </div>
            <div className="space-y-2">
              <div className={`text-sm font-bold ${getEMATrendColor(analysis.ema.signals.trend.direction)}`}>
                {analysis.ema.signals.trend.direction}
              </div>
              <div className="text-xs text-white/60">
                Strength: {analysis.ema.signals.trend.strength}%
              </div>
              {analysis.ema.signals.crossoverDescription && (
                <div className="text-xs px-2 py-1 rounded bg-cyan-500/20 text-cyan-400">
                  {analysis.ema.signals.crossoverDescription}
                </div>
              )}
              {analysis.ema.signals.pullback && (
                <div className="text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">
                  Pullback to EMA{analysis.ema.signals.pullback.ema}
                </div>
              )}
              {!analysis.ema.signals.alignedWithH1 && (
                <div className="text-xs px-2 py-1 rounded bg-orange-500/20 text-orange-400">
                  ⚠️ H1 Bias Misaligned
                </div>
              )}
            </div>
          </div>
        )}

        {/* Market Sentiment Card */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            {analysis.sentiment.status === 'BULLISH' ? (
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            ) : analysis.sentiment.status === 'BEARISH' ? (
              <TrendingDown className="h-4 w-4 text-red-400" />
            ) : (
              <Activity className="h-4 w-4 text-yellow-400" />
            )}
            <h4 className="text-sm font-semibold text-white">Market Sentiment</h4>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-white/60 text-sm">Confidence:</span>
              <span className={`text-xl font-bold ${getSentimentColor(analysis.sentiment.status)}`}>
                {analysis.sentiment.confidence}%
              </span>
            </div>
            <div className={`px-3 py-2 rounded-lg text-center ${
              analysis.sentiment.status === 'BULLISH' ? 'bg-emerald-500/20 border border-emerald-500/50' :
              analysis.sentiment.status === 'BEARISH' ? 'bg-red-500/20 border border-red-500/50' :
              'bg-yellow-500/20 border border-yellow-500/50'
            }`}>
              <span className={`text-base font-bold uppercase ${getSentimentColor(analysis.sentiment.status)}`}>
                {analysis.sentiment.status}
              </span>
            </div>
          </div>
        </div>

        {/* Trade Signal Assessment Card */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            {analysis.tradeSignal.status === 'VALID' ? (
              <CheckCircle className="h-4 w-4 text-emerald-400" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400" />
            )}
            <h4 className="text-sm font-semibold text-white">Trade Signal</h4>
          </div>
          <div className="space-y-2">
            <div className={`px-3 py-2 rounded-lg ${
              analysis.tradeSignal.status === 'VALID'
                ? 'bg-emerald-500/20 border border-emerald-500/50'
                : 'bg-red-500/10 border border-red-500/30'
            }`}>
              <div className={`text-sm font-bold uppercase ${getSignalColor(analysis.tradeSignal.status)}`}>
                {analysis.tradeSignal.status}
                {analysis.tradeSignal.direction && ` - ${analysis.tradeSignal.direction}`}
              </div>
              {analysis.tradeSignal.confidence && (
                <div className="text-xs text-white/60 mt-1">
                  Confidence: <span className="text-emerald-400 font-semibold">{analysis.tradeSignal.confidence}%</span>
                </div>
              )}
            </div>
            {analysis.tradeSignal.reason && (
              <p className="text-xs text-white/60">
                {analysis.tradeSignal.reason}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Advanced Pattern Section */}
      {analysis.advancedPattern && analysis.advancedPattern.type !== 'None' && (
        <div className="mt-6 pt-6 border-t border-white/10">
          <h4 className="text-sm font-semibold text-white mb-4">Advanced Pattern Detected</h4>
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg font-bold text-white">{analysis.advancedPattern.type}</span>
              <span className={`text-sm font-semibold px-2 py-1 rounded ${
                analysis.advancedPattern.direction === 'bullish' ? 'bg-emerald-500/20 text-emerald-400' :
                analysis.advancedPattern.direction === 'bearish' ? 'bg-red-500/20 text-red-400' :
                'bg-yellow-500/20 text-yellow-400'
              }`}>
                {analysis.advancedPattern.direction.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-white/70 mb-2">{analysis.advancedPattern.description}</p>
            <div className="flex items-center justify-between text-xs text-white/60">
              <span>Confidence:</span>
              <span className="font-semibold">{analysis.advancedPattern.confidence}%</span>
            </div>
          </div>
        </div>
      )}

      {/* AI Commentary Section */}
      {analysis.aiCommentary && (
        <div className="mt-6 pt-6 border-t border-white/10">
          <h4 className="text-sm font-semibold text-white mb-4">AI Commentary</h4>
          <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-white/90 leading-relaxed">{analysis.aiCommentary}</p>
          </div>
        </div>
      )}
    </div>
  );
};
