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
    if (passed === null) return <Clock className="w-5 h-5 text-gray-400" />;
    if (passed) return <CheckCircle className="w-5 h-5 text-green-500" />;
    return <XCircle className="w-5 h-5 text-red-500" />;
  };

  const getPhaseStatusClass = (passed: boolean | null) => {
    if (passed === null) return 'bg-gray-50 border-gray-200';
    if (passed) return 'bg-green-50 border-green-200';
    return 'bg-red-50 border-red-200';
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-blue-600" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Fx Flow Scalper v2.0</h3>
              <p className="text-sm text-gray-500">Three-Phase Trade Validation System</p>
            </div>
          </div>
          {strategyStatus.lastEvaluation && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Last Check</p>
              <p className="text-sm font-medium text-gray-700">
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
                      <h4 className="font-semibold text-gray-900">
                        Phase {phase.phase}: {phase.name}
                      </h4>
                      <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                        {phase.timeframe}
                      </span>
                    </div>
                    {phase.reason && (
                      <p className="text-sm text-gray-600 mt-1">{phase.reason}</p>
                    )}
                  </div>
                </div>
                {phase.confidence !== null && (
                  <div className="ml-4 text-right">
                    <p className="text-xs text-gray-500 mb-1">Confidence</p>
                    <p className="text-lg font-bold text-gray-900">{phase.confidence}%</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {strategyStatus.currentSignal && (
          <div className="mt-6 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-blue-900 mb-1">Active Signal Ready</h4>
                <p className="text-sm text-blue-700">
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
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Signals</h3>
          <div className="space-y-2">
            {recentSignals.slice(0, 5).map((signal) => (
              <div
                key={signal.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {signal.direction === 'BUY' ? (
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-600" />
                  )}
                  <div>
                    <p className="font-medium text-gray-900">
                      {signal.symbol} {signal.direction}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(signal.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{signal.confidence}%</p>
                  <div className="flex gap-1 mt-1">
                    {signal.executed && (
                      <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                        Executed
                      </span>
                    )}
                    {signal.approved && !signal.executed && (
                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
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
