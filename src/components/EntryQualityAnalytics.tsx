import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { EntryQualityScore, EntryMetrics } from '../types/entry';
import { Target, TrendingUp, Clock, CheckCircle } from 'lucide-react';

export function EntryQualityAnalytics() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<EntryMetrics | null>(null);
  const [recentScores, setRecentScores] = useState<EntryQualityScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    loadAnalytics();

    const interval = setInterval(loadAnalytics, 30000);
    return () => clearInterval(interval);
  }, [user]);

  async function loadAnalytics() {
    if (!user) return;

    try {
      const { data: scoresData, error: scoresError } = await supabase
        .from('entry_quality_scores')
        .select(`
          *,
          goal_session_trades!inner(user_id)
        `)
        .eq('goal_session_trades.user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (scoresError) {
        console.error('Failed to load entry quality scores:', scoresError);
        return;
      }

      setRecentScores(scoresData || []);

      if (scoresData && scoresData.length > 0) {
        const calculatedMetrics = calculateMetrics(scoresData);
        setMetrics(calculatedMetrics);
      }
    } catch (error) {
      console.error('Error loading entry analytics:', error);
    } finally {
      setLoading(false);
    }
  }

  function calculateMetrics(scores: EntryQualityScore[]): EntryMetrics {
    const totalScores = scores.length;
    const avgQuality = scores.reduce((sum, s) => sum + s.entry_quality_score, 0) / totalScores;
    const avgTimeToEntry = scores
      .filter(s => s.monitoring_duration_seconds)
      .reduce((sum, s) => sum + (s.monitoring_duration_seconds || 0), 0) / totalScores;

    const successRateByUrgency: Record<string, number> = {
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0
    };

    const successRateByIntent: Record<string, number> = {};

    scores.forEach(score => {
      if (score.urgency) {
        if (!successRateByUrgency[score.urgency]) successRateByUrgency[score.urgency] = 0;
        if (score.entry_quality_score >= 70) {
          successRateByUrgency[score.urgency]++;
        }
      }

      if (score.intent_type) {
        if (!successRateByIntent[score.intent_type]) successRateByIntent[score.intent_type] = 0;
        successRateByIntent[score.intent_type]++;
      }
    });

    return {
      total_intents: totalScores,
      executed_intents: totalScores,
      timeout_intents: 0,
      canceled_intents: 0,
      average_quality_score: avgQuality,
      average_time_to_entry: avgTimeToEntry,
      success_rate_by_urgency: successRateByUrgency as any,
      success_rate_by_intent_type: successRateByIntent as any
    };
  }

  if (!user || loading) return null;
  if (!metrics || recentScores.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg">
      <div className="flex items-center gap-2 mb-6">
        <Target className="w-5 h-5 text-green-400" />
        <h3 className="text-lg font-semibold text-white">Entry Execution Quality</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          icon={<CheckCircle className="w-5 h-5 text-green-400" />}
          label="Avg Quality"
          value={`${metrics.average_quality_score.toFixed(1)}`}
          suffix="/75"
        />

        <MetricCard
          icon={<Target className="w-5 h-5 text-blue-400" />}
          label="Total Entries"
          value={metrics.executed_intents.toString()}
        />

        <MetricCard
          icon={<Clock className="w-5 h-5 text-yellow-400" />}
          label="Avg Time"
          value={Math.floor(metrics.average_time_to_entry / 60).toString()}
          suffix="min"
        />

        <MetricCard
          icon={<TrendingUp className="w-5 h-5 text-purple-400" />}
          label="High Quality"
          value={`${recentScores.filter(s => s.entry_quality_score >= 80).length}`}
          suffix={`/${recentScores.length}`}
        />
      </div>

      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-3">Recent Entry Quality</h4>
        <div className="space-y-2">
          {recentScores.slice(0, 5).map((score) => (
            <EntryQualityItem key={score.id} score={score} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
}

function MetricCard({ icon, label, value, suffix }: MetricCardProps) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold text-white">{value}</span>
        {suffix && <span className="text-sm text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
}

interface EntryQualityItemProps {
  score: EntryQualityScore;
}

function EntryQualityItem({ score }: EntryQualityItemProps) {
  const qualityScore = score.entry_quality_score;
  const qualityColor =
    qualityScore >= 80
      ? 'text-green-400'
      : qualityScore >= 60
      ? 'text-yellow-400'
      : 'text-orange-400';

  const intentTypeName = {
    immediate_momentum: 'Momentum',
    pullback_to_vwap: 'VWAP',
    pullback_to_support: 'Support',
    break_and_retest: 'B&R',
    range_extreme: 'Range',
    retest_structure: 'Structure'
  }[score.intent_type || ''] || 'Unknown';

  return (
    <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`text-lg font-bold ${qualityColor}`}>
            {qualityScore.toFixed(0)}
          </div>
          <div>
            <div className="text-sm text-white">{intentTypeName}</div>
            <div className="text-xs text-slate-400">
              {score.urgency} urgency • {score.slippage_pips.toFixed(1)} pips slippage
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-slate-400">
            {score.monitoring_duration_seconds
              ? `${Math.floor(score.monitoring_duration_seconds / 60)}m`
              : 'Immediate'}
          </div>
          <div className="text-xs text-slate-500">
            {new Date(score.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div className="mt-2">
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              qualityScore >= 80
                ? 'bg-green-500'
                : qualityScore >= 60
                ? 'bg-yellow-500'
                : 'bg-orange-500'
            }`}
            style={{ width: `${qualityScore}%` }}
          />
        </div>
      </div>
    </div>
  );
}
