import React from 'react';
import { Activity, TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, AlertCircle, Target, Zap } from 'lucide-react';

interface SymbolPhaseStatus {
  symbol: string;
  phase1: { passed: boolean | null; confidence: number | null; reason: string | null };
  phase2: { passed: boolean | null; confidence: number | null; reason: string | null };
  phase3: { passed: boolean | null; confidence: number | null; reason: string | null };
  overallConfidence: number;
  signalGenerated: boolean;
  direction?: 'BUY' | 'SELL';
  entryPrice?: number;
  currentPrice?: number;
  rsi?: number;
  vwap?: number;
  atr?: number;
}

interface AutoTradingAnalysisPanelProps {
  symbols: SymbolPhaseStatus[];
  isActive: boolean;
  tradesRemaining: number;
  tradesTotal: number;
  lastScanTime?: Date;
  nextScanTime?: Date;
  currentlyScanning?: string;
}

export const AutoTradingAnalysisPanel: React.FC<AutoTradingAnalysisPanelProps> = ({
  symbols,
  isActive,
  tradesRemaining,
  tradesTotal,
  lastScanTime,
  nextScanTime,
  currentlyScanning
}) => {
  const getPhaseIcon = (passed: boolean | null) => {
    if (passed === null) return <Clock className="w-4 h-4 text-white/40" />;
    if (passed) return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    return <XCircle className="w-4 h-4 text-red-400" />;
  };

  const getPhaseStatusColor = (passed: boolean | null) => {
    if (passed === null) return 'text-white/40';
    if (passed) return 'text-emerald-400';
    return 'text-red-400';
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 75) return 'text-emerald-400';
    if (confidence >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const sortedSymbols = [...symbols].sort((a, b) => {
    if (a.signalGenerated && !b.signalGenerated) return -1;
    if (!a.signalGenerated && b.signalGenerated) return 1;
    return b.overallConfidence - a.overallConfidence;
  });

  return (
    <div className="glass-card p-4 sm:p-6 mt-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-xl">
            <Activity className={`h-5 w-5 text-emerald-400 ${isActive ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Auto-Trading Analysis</h3>
            <p className="text-xs text-white/60">
              {isActive ? `Monitoring ${symbols.length} symbols` : 'Auto-trading paused'}
            </p>
          </div>
        </div>
        {lastScanTime && (
          <p className="text-xs text-white/40">
            Last scan: {lastScanTime.toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/60 text-sm">Trades Remaining</span>
            <Target className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {tradesRemaining}<span className="text-lg text-white/60">/{tradesTotal}</span>
          </p>
        </div>

        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/60 text-sm">Active Signals</span>
            <Zap className="h-4 w-4 text-yellow-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {symbols.filter(s => s.signalGenerated).length}
          </p>
        </div>

        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/60 text-sm">Status</span>
            <Activity className={`h-4 w-4 ${isActive ? 'text-emerald-400' : 'text-red-400'}`} />
          </div>
          <p className={`text-lg font-bold ${isActive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isActive ? 'Active' : 'Paused'}
          </p>
        </div>
      </div>

      {currentlyScanning && (
        <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
            <p className="text-sm text-emerald-400">
              Currently scanning: <span className="font-bold">{currentlyScanning}</span>
            </p>
          </div>
        </div>
      )}

      {nextScanTime && isActive && (
        <div className="mb-4 p-3 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Next scan in:</span>
            <span className="text-sm font-bold text-emerald-400">
              {Math.max(0, Math.floor((nextScanTime.getTime() - Date.now()) / 1000))}s
            </span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-white mb-3">Monitored Symbols</h4>

        {sortedSymbols.length === 0 ? (
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-white/30 mx-auto mb-3" />
            <p className="text-white/60">No symbols being monitored</p>
            <p className="text-white/40 text-sm mt-1">Start auto-trading to begin analysis</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {sortedSymbols.map((symbolData) => (
              <div
                key={symbolData.symbol}
                className={`bg-white/5 rounded-lg p-4 border transition-all ${
                  symbolData.signalGenerated
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-white/10'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <h5 className="text-base font-bold text-white">{symbolData.symbol}</h5>
                    {symbolData.signalGenerated && symbolData.direction && (
                      <div className={`flex items-center space-x-1 px-2 py-0.5 rounded ${
                        symbolData.direction === 'BUY'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {symbolData.direction === 'BUY' ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        <span className="text-xs font-bold">{symbolData.direction}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${getConfidenceColor(symbolData.overallConfidence)}`}>
                      {symbolData.overallConfidence}%
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      {getPhaseIcon(symbolData.phase1.passed)}
                      <span className="text-white/60">Phase 1: H1 Macro</span>
                    </div>
                    {symbolData.phase1.confidence !== null && (
                      <span className={`font-semibold ${getPhaseStatusColor(symbolData.phase1.passed)}`}>
                        {symbolData.phase1.confidence}%
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      {getPhaseIcon(symbolData.phase2.passed)}
                      <span className="text-white/60">Phase 2: M5 Tactical</span>
                    </div>
                    {symbolData.phase2.confidence !== null && (
                      <span className={`font-semibold ${getPhaseStatusColor(symbolData.phase2.passed)}`}>
                        {symbolData.phase2.confidence}%
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      {getPhaseIcon(symbolData.phase3.passed)}
                      <span className="text-white/60">Phase 3: M1 Entry</span>
                    </div>
                    {symbolData.phase3.confidence !== null && (
                      <span className={`font-semibold ${getPhaseStatusColor(symbolData.phase3.passed)}`}>
                        {symbolData.phase3.confidence}%
                      </span>
                    )}
                  </div>
                </div>

                {(symbolData.rsi !== undefined || symbolData.vwap !== undefined) && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {symbolData.rsi !== undefined && (
                        <div>
                          <span className="text-white/40">RSI</span>
                          <p className="text-white font-semibold">{symbolData.rsi.toFixed(1)}</p>
                        </div>
                      )}
                      {symbolData.vwap !== undefined && (
                        <div>
                          <span className="text-white/40">VWAP</span>
                          <p className="text-white font-semibold">{symbolData.vwap.toFixed(5)}</p>
                        </div>
                      )}
                      {symbolData.atr !== undefined && (
                        <div>
                          <span className="text-white/40">ATR</span>
                          <p className="text-white font-semibold">{symbolData.atr.toFixed(5)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {symbolData.signalGenerated && symbolData.entryPrice && (
                  <div className="mt-3 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-400 font-semibold">Signal Generated</span>
                      <span className="text-emerald-400">Entry: {symbolData.entryPrice.toFixed(5)}</span>
                    </div>
                  </div>
                )}

                {symbolData.phase1.reason && !symbolData.phase1.passed && (
                  <div className="mt-2 text-xs text-white/50">
                    {symbolData.phase1.reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
