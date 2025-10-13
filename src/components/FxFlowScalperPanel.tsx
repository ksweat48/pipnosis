import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, Clock, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { strategyService } from '../strategies';
import { useAuth } from '../hooks/useAuth';

interface PhaseStatus {
  phase: number;
  name: string;
  timeframe: string;
  passed: boolean | null;
  confidence: number | null;
  reason: string | null;
}

interface StrategyStatus {
  isActive: boolean;
  lastEvaluation: Date | null;
  phases: PhaseStatus[];
  currentSignal: any | null;
}

export function FxFlowScalperPanel() {
  const { user } = useAuth();
  const [strategyStatus, setStrategyStatus] = useState<StrategyStatus>({
    isActive: false,
    lastEvaluation: null,
    phases: [
      { phase: 1, name: 'Macro Bias Filter', timeframe: '1H', passed: null, confidence: null, reason: null },
      { phase: 2, name: 'Tactical Setup', timeframe: '5M', passed: null, confidence: null, reason: null },
      { phase: 3, name: 'Precision Entry', timeframe: '1M', passed: null, confidence: null, reason: null }
    ],
    currentSignal: null
  });
  const [recentSignals, setRecentSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadRecentSignals();
      const interval = setInterval(loadRecentSignals, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadRecentSignals = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const signals = await strategyService.getRecentSignals(user.id, 5);
      setRecentSignals(signals);

      if (signals.length > 0) {
        const latest = signals[0];
        setStrategyStatus({
          isActive: true,
          lastEvaluation: new Date(latest.created_at),
          phases: [
            {
              phase: 1,
              name: 'Macro Bias Filter',
              timeframe: '1H',
              passed: latest.phase1_passed,
              confidence: latest.phase1_confidence,
              reason: latest.phase1_reason
            },
            {
              phase: 2,
              name: 'Tactical Setup',
              timeframe: '5M',
              passed: latest.phase2_passed,
              confidence: latest.phase2_confidence,
              reason: latest.phase2_reason
            },
            {
              phase: 3,
              name: 'Precision Entry',
              timeframe: '1M',
              passed: latest.phase3_passed,
              confidence: latest.phase3_confidence,
              reason: latest.phase3_reason
            }
          ],
          currentSignal: latest.approved && !latest.executed ? latest : null
        });
      }
    } catch (error) {
      console.error('Error loading recent signals:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPhaseIcon = (passed: boolean | null) => {
    if (passed === null) return <Clock className="w-5 h-5 text-white/40" />;
    if (passed) return <CheckCircle className="w-5 h-5 text-emerald-400" />;
    return <XCircle className="w-5 h-5 text-red-400" />;
  };

  const getPhaseStatusClass = (passed: boolean | null) => {
    if (passed === null) return 'bg-white/5 border-white/10';
    if (passed) return 'bg-emerald-500/10 border-emerald-500/30';
    return 'bg-red-500/10 border-red-500/30';
  };

  const getPhaseTextColor = (passed: boolean | null) => {
    if (passed === null) return 'text-white/60';
    if (passed) return 'text-emerald-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-4">
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-xl">
              <Activity className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Fx Flow Scalper v2.0</h3>
              <p className="text-sm text-white/60">Three-Phase Trade Validation System</p>
            </div>
          </div>
          {strategyStatus.lastEvaluation && (
            <div className="text-right">
              <p className="text-xs text-white/40">Last Check</p>
              <p className="text-sm font-medium text-white/70">
                {strategyStatus.lastEvaluation.toLocaleTimeString()}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {strategyStatus.phases.map((phase) => (
            <div
              key={phase.phase}
              className={`p-4 rounded-lg border-2 transition-all ${getPhaseStatusClass(phase.passed)}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  {getPhaseIcon(phase.passed)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-white">
                        Phase {phase.phase}: {phase.name}
                      </h4>
                      <span className="px-2 py-0.5 text-xs font-medium bg-white/10 text-white/70 rounded">
                        {phase.timeframe}
                      </span>
                    </div>
                    {phase.reason && (
                      <p className={`text-sm mt-1 ${getPhaseTextColor(phase.passed)}`}>
                        {phase.reason}
                      </p>
                    )}
                  </div>
                </div>
                {phase.confidence !== null && (
                  <div className="ml-4 text-right">
                    <p className="text-xs text-white/40 mb-1">Confidence</p>
                    <p className={`text-lg font-bold ${getPhaseTextColor(phase.passed)}`}>
                      {phase.confidence}%
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {strategyStatus.currentSignal && (
          <div className="mt-6 p-4 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-emerald-400 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-emerald-400 mb-1">Active Signal Ready</h4>
                <p className="text-sm text-emerald-400/80">
                  {strategyStatus.currentSignal.symbol} {strategyStatus.currentSignal.direction} at{' '}
                  {parseFloat(strategyStatus.currentSignal.entry_price).toFixed(5)}
                  {' '}(Confidence: {strategyStatus.currentSignal.confidence}%)
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {recentSignals.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Recent Signals</h3>
          <div className="space-y-2">
            {recentSignals.slice(0, 5).map((signal) => (
              <div
                key={signal.id}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors border border-white/10"
              >
                <div className="flex items-center gap-3">
                  {signal.direction === 'BUY' ? (
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  )}
                  <div>
                    <p className="font-medium text-white">
                      {signal.symbol} {signal.direction}
                    </p>
                    <p className="text-xs text-white/50">
                      {new Date(signal.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">{signal.confidence}%</p>
                  <div className="flex gap-1 mt-1">
                    {signal.executed && (
                      <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/30">
                        Executed
                      </span>
                    )}
                    {signal.approved && !signal.executed && (
                      <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded border border-yellow-500/30">
                        Approved
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
