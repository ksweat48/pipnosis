import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, CheckCircle, Clock, AlertCircle, Target } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface EQSBreakdown {
  candleAcceptance: number;
  pullbackQuality: number;
  vwapInteraction: number;
  emaAlignment: number;
  liquidityReaction: number;
  compressionExpansion: number;
  failedMoveConfirmation: number;
  timeframeAlignment: number;
}

interface EQSUpdate {
  id: string;
  symbol: string;
  eqs_score: number;
  eqs_grade: string;
  eqs_threshold: number;
  breakdown: EQSBreakdown;
  status: string;
  created_at: string;
}

interface EntryQualityMonitorProps {
  sessionId: string;
  intentId?: string;
}

export const EntryQualityMonitor: React.FC<EntryQualityMonitorProps> = ({ sessionId, intentId }) => {
  const [latestEQS, setLatestEQS] = useState<EQSUpdate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLatestEQS();

    const interval = setInterval(loadLatestEQS, 5000); // Update every 5 seconds

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`eqs-updates-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'entry_monitoring_logs',
          filter: intentId ? `intent_id=eq.${intentId}` : undefined
        },
        (payload) => {
          if (payload.new) {
            setLatestEQS(payload.new as EQSUpdate);
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [sessionId, intentId]);

  const loadLatestEQS = async () => {
    try {
      const { data: intents } = await supabase
        .from('entry_intents')
        .select('id')
        .eq('session_id', sessionId)
        .eq('status', 'monitoring');

      if (!intents || intents.length === 0) {
        setLatestEQS(null);
        setLoading(false);
        return;
      }

      const intentIds = intents.map(i => i.id);

      const { data } = await supabase
        .from('entry_monitoring_logs')
        .select('*')
        .in('intent_id', intentIds)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setLatestEQS(data as EQSUpdate);
      }
    } catch (error) {
      console.error('[EntryQualityMonitor] Error loading EQS:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
          <span className="text-sm text-gray-400">Loading entry quality data...</span>
        </div>
      </div>
    );
  }

  if (!latestEQS) {
    return null;
  }

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-green-400 bg-green-500/10 border-green-500/30';
      case 'B':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'C':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'D':
        return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'F':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      default:
        return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
  };

  const getMetricColor = (score: number, max: number) => {
    const percentage = (score / max) * 100;
    if (percentage >= 80) return 'text-green-400';
    if (percentage >= 60) return 'text-blue-400';
    if (percentage >= 40) return 'text-yellow-400';
    if (percentage >= 20) return 'text-orange-400';
    return 'text-red-400';
  };

  const getMetricIcon = (score: number, max: number) => {
    const percentage = (score / max) * 100;
    if (percentage >= 80) return <CheckCircle className="w-3 h-3 text-green-400" />;
    if (percentage >= 40) return <Clock className="w-3 h-3 text-yellow-400" />;
    return <AlertCircle className="w-3 h-3 text-red-400" />;
  };

  const breakdown = latestEQS.breakdown;
  const scorePercentage = (latestEQS.eqs_score / 100) * 100;
  const thresholdPercentage = (latestEQS.eqs_threshold / 100) * 100;

  const metrics = [
    { name: 'Candle Acceptance', score: breakdown.candleAcceptance, max: 20 },
    { name: 'Pullback Quality', score: breakdown.pullbackQuality, max: 15 },
    { name: 'VWAP Interaction', score: breakdown.vwapInteraction, max: 15 },
    { name: 'EMA Alignment', score: breakdown.emaAlignment, max: 10 },
    { name: 'Liquidity Reaction', score: breakdown.liquidityReaction, max: 15 },
    { name: 'Compression/Expansion', score: breakdown.compressionExpansion, max: 10 },
    { name: 'Failed Move', score: breakdown.failedMoveConfirmation, max: 10 },
    { name: 'Timeframe Alignment', score: breakdown.timeframeAlignment, max: 5 }
  ];

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-purple-400 animate-pulse" />
          <h3 className="text-lg font-bold text-white">Entry Quality Monitor</h3>
        </div>
        <div className={`px-3 py-1 rounded-lg border font-bold ${getGradeColor(latestEQS.eqs_grade)}`}>
          Grade {latestEQS.eqs_grade}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Entry Quality Score</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-white">{latestEQS.eqs_score}</span>
            <span className="text-sm text-gray-400">/100</span>
          </div>
        </div>

        <div className="relative w-full h-3 bg-gray-700 rounded-full overflow-hidden">
          {/* Threshold marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-10"
            style={{ left: `${thresholdPercentage}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-xs text-blue-400 whitespace-nowrap">
              ↓
            </div>
          </div>

          {/* Score bar */}
          <div
            className={`h-full transition-all duration-500 ${
              latestEQS.eqs_score >= latestEQS.eqs_threshold
                ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                : 'bg-gradient-to-r from-red-500 to-orange-500'
            }`}
            style={{ width: `${scorePercentage}%` }}
          />
        </div>

        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-gray-500">Current Score</span>
          <span className="text-xs text-blue-400">
            Threshold: {latestEQS.eqs_threshold}
          </span>
        </div>
      </div>

      {latestEQS.eqs_score < latestEQS.eqs_threshold && (
        <div className="mb-4 p-3 bg-orange-900/20 border border-orange-700/50 rounded-lg">
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-orange-300 mb-1">
                Waiting for Better Entry Quality
              </div>
              <div className="text-xs text-gray-400">
                Need {latestEQS.eqs_threshold - latestEQS.eqs_score} more points to reach execution threshold
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Quality Breakdown
        </div>
        {metrics.map((metric) => (
          <div key={metric.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1">
              {getMetricIcon(metric.score, metric.max)}
              <span className="text-sm text-gray-300">{metric.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    metric.score / metric.max >= 0.8
                      ? 'bg-green-400'
                      : metric.score / metric.max >= 0.4
                      ? 'bg-yellow-400'
                      : 'bg-red-400'
                  }`}
                  style={{ width: `${(metric.score / metric.max) * 100}%` }}
                />
              </div>
              <span className={`text-sm font-mono font-semibold ${getMetricColor(metric.score, metric.max)} min-w-[3rem] text-right`}>
                {metric.score}/{metric.max}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-700">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Last updated</span>
          <span className="text-gray-400">
            {new Date(latestEQS.created_at).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  );
};
