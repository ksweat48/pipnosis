import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { ActiveEntryIntent } from '../types/entry';
import { Clock, TrendingUp, TrendingDown, Target, X, Zap } from 'lucide-react';
import { EntryExecutionCoordinator } from '../services/entry-execution-coordinator';
import { EntryUrgencyCalculator } from '../services/entry-urgency-calculator';

export function ActiveEntryIntents() {
  const { user } = useAuth();
  const [intents, setIntents] = useState<ActiveEntryIntent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    loadIntents();

    const channel = supabase
      .channel('entry_intents_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'entry_intents',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          loadIntents();
        }
      )
      .subscribe();

    const interval = setInterval(loadIntents, 10000);

    return () => {
      channel.unsubscribe();
      clearInterval(interval);
    };
  }, [user]);

  async function loadIntents() {
    if (!user) return;

    try {
      const { data, error } = await supabase.rpc('get_active_entry_intents', {
        p_user_id: user.id
      });

      if (error) {
        console.error('Failed to load entry intents:', error);
        return;
      }

      setIntents(data || []);
    } catch (error) {
      console.error('Error loading intents:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(intentId: string) {
    await EntryExecutionCoordinator.cancelIntent(intentId, 'User canceled');
    await loadIntents();
  }

  if (!user || loading) return null;
  if (intents.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700 shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <Target className="w-5 h-5 text-blue-400" />
        <h3 className="text-lg font-semibold text-white">Active Entry Monitoring</h3>
      </div>

      <div className="space-y-3">
        {intents.map((intent) => (
          <EntryIntentCard
            key={intent.intent_id}
            intent={intent}
            onCancel={handleCancel}
          />
        ))}
      </div>
    </div>
  );
}

interface EntryIntentCardProps {
  intent: ActiveEntryIntent;
  onCancel: (intentId: string) => void;
}

function EntryIntentCard({ intent, onCancel }: EntryIntentCardProps) {
  const isLong = intent.direction === 'long';

  // Calculate urgency phase
  const createdAt = new Date(intent.created_at);
  const style = intent.style || 'MICRO_INTRADAY';
  const alphaConfidence = intent.alpha_confidence || 60;

  const urgencyResult = EntryUrgencyCalculator.calculateUrgency(
    createdAt,
    style as any,
    alphaConfidence
  );

  const phaseColors = {
    1: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
    2: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
    3: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' }
  }[urgencyResult.phase];

  const urgencyColor = {
    HIGH: 'text-red-400',
    MEDIUM: 'text-yellow-400',
    LOW: 'text-blue-400'
  }[intent.urgency];

  const intentTypeName = {
    immediate_momentum: 'Momentum Entry',
    pullback_to_vwap: 'VWAP Pullback',
    pullback_to_support: 'Support Pullback',
    break_and_retest: 'Break & Retest',
    range_extreme: 'Range Extreme',
    retest_structure: 'Structure Retest'
  }[intent.intent_type] || intent.intent_type;

  const minutesRemaining = Math.max(0, Math.floor(intent.minutes_remaining));
  const distancePips = intent.distance_to_zone_pips || 0;
  const distanceAbs = Math.abs(distancePips);

  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {isLong ? (
            <TrendingUp className="w-5 h-5 text-green-400" />
          ) : (
            <TrendingDown className="w-5 h-5 text-red-400" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold">{intent.symbol}</span>
              <span className={`text-xs font-medium ${urgencyColor}`}>
                {intent.urgency}
              </span>
            </div>
            <div className="text-sm text-slate-400">{intentTypeName}</div>
          </div>
        </div>

        <button
          onClick={() => onCancel(intent.intent_id)}
          className="p-1 hover:bg-slate-700 rounded transition-colors"
          title="Cancel monitoring"
        >
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Entry Zone:</span>
          <span className="text-white font-mono">
            {intent.entry_zone_min.toFixed(5)} - {intent.entry_zone_max.toFixed(5)}
          </span>
        </div>

        {intent.latest_price && (
          <>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Current Price:</span>
              <span className="text-white font-mono">{intent.latest_price.toFixed(5)}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Distance:</span>
              <span className={`font-mono ${distanceAbs < 5 ? 'text-green-400' : 'text-yellow-400'}`}>
                {distanceAbs.toFixed(1)} pips {distancePips > 0 ? '↑' : '↓'}
              </span>
            </div>
          </>
        )}

        <div className="flex justify-between items-center">
          <span className="text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Time Remaining:
          </span>
          <span className={`font-medium ${minutesRemaining < 10 ? 'text-orange-400' : 'text-slate-300'}`}>
            {minutesRemaining} min
          </span>
        </div>

        <div className={`p-2 rounded-lg border ${phaseColors.bg} ${phaseColors.border}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className={`w-4 h-4 ${phaseColors.text}`} />
              <span className={`text-xs font-medium ${phaseColors.text}`}>
                Phase {urgencyResult.phase}
              </span>
            </div>
            <span className={`text-xs ${phaseColors.text}`}>
              EQS {urgencyResult.timeAdjustedThreshold}
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {EntryUrgencyCalculator.getPhaseDescription(urgencyResult.phase)}
          </div>
          {urgencyResult.minutesUntilNextPhase && (
            <div className="text-xs text-slate-500 mt-1">
              Next phase in {EntryUrgencyCalculator.formatTimeRemaining(urgencyResult.minutesUntilNextPhase)}
            </div>
          )}
        </div>
      </div>

      {intent.alpha_reasoning && (
        <div className="mt-3 pt-3 border-t border-slate-700">
          <div className="text-xs text-slate-400 line-clamp-2">{intent.alpha_reasoning}</div>
        </div>
      )}

      <div className="mt-3">
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${
              distanceAbs < 3 ? 'bg-green-500' : distanceAbs < 10 ? 'bg-yellow-500' : 'bg-blue-500'
            }`}
            style={{
              width: `${Math.max(10, Math.min(100, 100 - (distanceAbs / 30) * 100))}%`
            }}
          />
        </div>
      </div>
    </div>
  );
}
