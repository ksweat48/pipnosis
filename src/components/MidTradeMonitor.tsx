import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Shield,
  AlertTriangle,
  CheckCircle,
  Target,
  ChevronDown,
  ChevronUp,
  Copy,
  Clock,
  BookOpen,
  Zap
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { midTradeMonitorService, type MidTradeGuidance } from '@/services/mid-trade-monitor-service';
import { pricePollingCoordinator } from '@/services/price-polling-coordinator';
import type { TrailingSLOptions } from '@/services/mid-trade-plan-engine';

const cleanPrice = (price: number): string => {
  return parseFloat(price.toPrecision(8)).toString();
};

const TrailingSLCard: React.FC<{
  options: TrailingSLOptions;
  symbol: string;
}> = ({ options, symbol }) => {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (price: number, key: string) => {
    navigator.clipboard.writeText(cleanPrice(price)).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const optionRows = [
    { key: 'breakeven', label: options.breakeven.label, price: options.breakeven.price, locks: options.breakeven.locksRMultiple, isRecommended: options.recommended === 'breakeven' },
    options.atr ? { key: 'atr', label: options.atr.label, price: options.atr.price, locks: options.atr.locksRMultiple, isRecommended: options.recommended === 'atr' } : null,
    options.swing ? { key: 'swing', label: options.swing.label, price: options.swing.price, locks: options.swing.locksRMultiple, isRecommended: options.recommended === 'swing' } : null
  ].filter(Boolean) as Array<{ key: string; label: string; price: number; locks: number; isRecommended: boolean }>;

  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-900/20 overflow-hidden">
      <div className="px-3 py-2 border-b border-amber-500/20">
        <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Trailing SL Options</p>
        <p className="text-xs text-amber-200/70 mt-0.5">{options.reasoning}</p>
      </div>
      <div className="divide-y divide-amber-500/10">
        {optionRows.map((row) => (
          <div
            key={row.key}
            className={`flex items-center justify-between px-3 py-2 ${row.isRecommended ? 'bg-emerald-900/30' : ''}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {row.isRecommended && (
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">REC</span>
                )}
                <span className="text-xs text-gray-300">{row.label}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Locks +{row.locks.toFixed(2)}R profit
              </p>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <PriceSplit price={row.price} />
              <button
                onClick={() => handleCopy(row.price, row.key)}
                className="p-1 hover:bg-amber-500/20 rounded transition-colors"
                title="Copy price"
              >
                {copied === row.key ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-gray-400" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const splitPrice = (price: number): { integer: string; decimal: string } => {
  const raw = cleanPrice(price);
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) return { integer: raw, decimal: '' };
  return { integer: raw.slice(0, dotIdx), decimal: raw.slice(dotIdx) };
};

const PriceSplit: React.FC<{ price: number; colorClass?: string }> = ({ price, colorClass = 'text-white' }) => {
  const { integer, decimal } = splitPrice(price);
  return (
    <span className={`font-mono font-bold leading-none tabular-nums ${colorClass}`}>
      <span className="text-sm">{integer}</span>
      {decimal && <span className="text-[10px] opacity-70">{decimal}</span>}
    </span>
  );
};

const ActionPriceChip: React.FC<{
  label: string;
  price: number;
}> = ({ label, price }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanPrice(price)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 bg-gray-800/80 rounded-lg px-3 py-2 border border-gray-600/50">
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <PriceSplit price={price} />
      </div>
      <button
        onClick={handleCopy}
        className="p-1 hover:bg-gray-600/50 rounded transition-colors ml-auto"
        title="Copy price"
      >
        {copied ? (
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-gray-400" />
        )}
      </button>
    </div>
  );
};

const AlphaPlanSection: React.FC<{ guide: MidTradeGuidance }> = ({ guide }) => {
  const [expanded, setExpanded] = useState(false);
  const plan = guide.midTradePlan;

  if (!plan) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/60 hover:bg-gray-800/80 transition-colors border border-gray-700/40"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs text-gray-400">Alpha Trade Plan</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 rounded-lg bg-gray-800/40 border border-gray-700/30 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-700/30">
            <p className="text-xs text-gray-300 leading-relaxed">{plan.setup_summary}</p>
          </div>

          {plan.patterns && (Object.values(plan.patterns).some(Boolean)) && (
            <div className="px-3 py-2 border-b border-gray-700/30">
              <p className="text-xs text-gray-500 mb-1">Patterns</p>
              <div className="flex flex-wrap gap-1">
                {plan.patterns.htf && (
                  <span className="text-xs bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded border border-blue-700/30">HTF: {plan.patterns.htf}</span>
                )}
                {plan.patterns.mtf && (
                  <span className="text-xs bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded border border-blue-700/30">MTF: {plan.patterns.mtf}</span>
                )}
                {plan.patterns.ltf && (
                  <span className="text-xs bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded border border-blue-700/30">LTF: {plan.patterns.ltf}</span>
                )}
              </div>
            </div>
          )}

          {plan.key_levels && plan.key_levels.length > 0 && (
            <div className="px-3 py-2 border-b border-gray-700/30">
              <p className="text-xs text-gray-500 mb-1">Key Levels</p>
              <div className="space-y-1">
                {plan.key_levels.map((level, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">{level.label}</span>
                    <span className={`text-xs font-mono font-semibold ${
                      level.type === 'invalidation' ? 'text-red-400' :
                      level.type === 'target' ? 'text-emerald-400' :
                      'text-gray-300'
                    }`}>{level.price}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.omega_consensus && (
            <div className="px-3 py-2">
              <p className="text-xs text-gray-500 mb-0.5">Omega Consensus</p>
              <p className="text-xs text-gray-300">{plan.omega_consensus}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SCALP_PATTERN_LABELS: Record<string, string> = {
  momentum_breakout: 'Momentum Breakout',
  bos_retest: 'BOS Retest',
  ema_rejection: 'EMA Rejection',
  double_bottom: 'Double Bottom',
  double_top: 'Double Top',
  range_breakout: 'Range Breakout',
  liquidity_sweep: 'Liquidity Sweep',
  engulfing_at_structure: 'Engulfing @ Structure',
  trend_pullback_ema: 'Trend Pullback EMA',
  none: 'No Named Structure',
};

const SCALP_SUBMODE_LABELS: Record<string, string> = {
  momentum_continuation: 'Momentum',
  pullback_entry: 'Pullback Entry',
  consolidation_breakout: 'Breakout',
};

const ScalpIntelligenceBar: React.FC<{ plan: import('@/services/mid-trade-plan-engine').MidTradePlan }> = ({ plan }) => {
  if (!plan.scalp_pattern && !plan.scalp_sub_mode && !plan.scalp_momentum_phase) return null;

  const phase = plan.scalp_momentum_phase;
  const phaseColor = phase === 'exhausted'
    ? 'text-red-400 bg-red-500/15 border-red-500/30'
    : phase === 'developing'
      ? 'text-amber-400 bg-amber-500/15 border-amber-500/30'
      : 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';

  const phaseLabel = phase === 'exhausted' ? 'Exhausted' : phase === 'developing' ? 'Developing' : 'Fresh';

  return (
    <div className="mt-2 rounded-lg bg-gray-800/50 border border-gray-700/40 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Zap className="w-3 h-3 text-amber-400" />
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Scalp Entry Intelligence</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {plan.scalp_pattern && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
            plan.scalp_pattern === 'none'
              ? 'text-gray-400 bg-gray-700/50 border-gray-600/40'
              : 'text-sky-300 bg-sky-900/30 border-sky-600/30'
          }`}>
            {SCALP_PATTERN_LABELS[plan.scalp_pattern] ?? plan.scalp_pattern}
          </span>
        )}
        {plan.scalp_sub_mode && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-gray-300 bg-gray-700/50 border-gray-600/40">
            {SCALP_SUBMODE_LABELS[plan.scalp_sub_mode] ?? plan.scalp_sub_mode}
          </span>
        )}
        {phase && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${phaseColor}`}>
            {phaseLabel}{plan.scalp_atr_traveled != null ? ` (${plan.scalp_atr_traveled.toFixed(2)}x ATR)` : ''}
          </span>
        )}
      </div>
    </div>
  );
};

export const MidTradeMonitor: React.FC = () => {
  const { user } = useAuth();
  const [guidance, setGuidance] = useState<MidTradeGuidance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastTradeStateHash, setLastTradeStateHash] = useState<string>('');

  const guidanceRef = useRef<MidTradeGuidance[]>([]);

  useEffect(() => {
    guidanceRef.current = guidance;
  }, [guidance]);

  const loadGuidance = async (fromUser: boolean = false) => {
    if (!user?.id) return;

    try {
      if (fromUser || !loading) {
        setRefreshing(true);
      }

      const result = await midTradeMonitorService.getMidTradeGuidance(user.id);
      setGuidance(result.guidance);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('[MidTradeMonitor] Error loading guidance:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;

    const unsubscribe = pricePollingCoordinator.subscribe((update) => {
      const current = guidanceRef.current;
      if (current.length === 0) return;

      const updated = midTradeMonitorService.applyLivePrices(current, update.prices);
      if (updated !== current) {
        setGuidance(updated);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    let channel: ReturnType<typeof supabase.channel>;

    const debouncedLoad = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadGuidance(false);
      }, 300);
    };

    loadGuidance(false);

    channel = supabase
      .channel(`mid-trade-updates-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'goal_session_trades',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            const newState = JSON.stringify({
              status: (payload.new as any).status,
              closed_at: (payload.new as any).closed_at,
              stop_loss: (payload.new as any).stop_loss,
              take_profit: (payload.new as any).take_profit,
              take_profit_2: (payload.new as any).take_profit_2,
            });

            if (newState !== lastTradeStateHash) {
              setLastTradeStateHash(newState);
              debouncedLoad();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      clearTimeout(debounceTimer);
    };
  }, [user?.id, lastTradeStateHash]);

  const getActionIcon = (action: MidTradeGuidance['primaryAction']) => {
    switch (action) {
      case 'trail_sl':
        return <Shield className="w-5 h-5" />;
      case 'warning':
      case 'risk_alert':
        return <AlertTriangle className="w-5 h-5" />;
      case 'tp1_timing':
        return <Target className="w-5 h-5" />;
      case 'hold':
      default:
        return <CheckCircle className="w-5 h-5" />;
    }
  };

  const getColorClasses = (color: MidTradeGuidance['actionColor']) => {
    switch (color) {
      case 'emerald':
        return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' };
      case 'amber':
        return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' };
      case 'red':
        return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' };
      case 'orange':
        return { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' };
      case 'blue':
      default:
        return { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' };
    }
  };

  const formatTime = (minutes: number) => {
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${Math.floor(minutes)}m`;
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-amber-900/30 to-orange-900/30 rounded-xl p-6 border border-amber-500/30">
        <div className="animate-pulse">
          <div className="h-6 bg-amber-500/20 rounded w-1/2 mb-4" />
          <div className="h-4 bg-amber-500/20 rounded w-3/4 mb-2" />
          <div className="h-4 bg-amber-500/20 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (guidance.length === 0) {
    return (
      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-gray-700/50 rounded-lg">
            <Activity className="w-6 h-6 text-gray-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Mid-Trade Intelligence</h3>
            <p className="text-sm text-gray-400">
              No active trades. Mid-trade guidance appears when Alpha executes positions, providing real-time
              recommendations with exact prices for trail stops, risk alerts, and optimal exit timing.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-amber-900/40 to-orange-900/40 rounded-xl p-6 border border-amber-500/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Mid-Trade Intelligence</h3>
              <p className="text-sm text-amber-300">
                {guidance.length} active trade{guidance.length !== 1 ? 's' : ''} — deterministic guidance
              </p>
            </div>
          </div>

          <button
            onClick={() => loadGuidance(true)}
            className="p-2 hover:bg-amber-500/20 rounded-lg transition-colors"
            title="Refresh"
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 text-amber-300 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-4">
          {guidance.map((guide) => {
            const colors = getColorClasses(guide.actionColor);
            const isProfitable = guide.currentPnL >= 0;

            return (
              <div
                key={guide.tradeId}
                className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50"
              >
                {/* Trade Header */}
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`p-1.5 rounded-lg shrink-0 ${guide.direction === 'buy' ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                      {guide.direction === 'buy' ? (
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">{guide.symbol}</h4>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                          guide.direction === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>{guide.direction}</span>
                        <div className="flex items-center gap-0.5 text-[10px] text-gray-500">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{formatTime(guide.timeInTrade)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className={`text-base font-bold font-mono tabular-nums ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isProfitable ? '+' : ''}${guide.currentPnL.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-gray-500">Current P&L</p>
                  </div>
                </div>

                {/* Scalp Intelligence Bar — only for SCALP trades that have plan data */}
                {guide.midTradePlan && (guide.midTradePlan.scalp_pattern || guide.midTradePlan.scalp_momentum_phase) && (
                  <ScalpIntelligenceBar plan={guide.midTradePlan} />
                )}

                {/* Price Context Row */}
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  <div className="bg-gray-800/60 rounded-lg px-2 py-2 text-right">
                    <p className="text-[10px] text-gray-500 mb-1">SL</p>
                    <PriceSplit price={guide.stopLoss} colorClass="text-red-400" />
                    <p className="text-[10px] text-gray-600 mt-0.5">{Math.abs(guide.distanceToSL).toFixed(1)}p</p>
                  </div>
                  <div className="bg-gray-800/60 rounded-lg px-2 py-2 text-right">
                    <p className="text-[10px] text-gray-500 mb-1">Entry</p>
                    <PriceSplit price={guide.entryPrice} colorClass="text-gray-300" />
                    <p className="text-[10px] text-gray-600 mt-0.5 truncate">
                      {cleanPrice(guide.currentPrice)}
                    </p>
                  </div>
                  <div className="bg-gray-800/60 rounded-lg px-2 py-2 text-right">
                    <p className="text-[10px] text-gray-500 mb-1">TP</p>
                    <PriceSplit price={guide.takeProfit} colorClass="text-emerald-400" />
                    <p className="text-[10px] text-gray-600 mt-0.5">{Math.abs(guide.distanceToTP).toFixed(1)}p</p>
                  </div>
                </div>

                {/* Thesis Status */}
                <div className={`flex items-center gap-1.5 mb-3 px-2 py-1 rounded ${guide.thesisIntact ? 'bg-emerald-900/20' : 'bg-red-900/20'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${guide.thesisIntact ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className={`text-xs ${guide.thesisIntact ? 'text-emerald-400' : 'text-red-400'}`}>
                    Thesis {guide.thesisIntact ? 'intact' : 'broken'}
                  </span>
                </div>

                {/* Primary Guidance */}
                <div className={`${colors.bg} rounded-lg p-3 border ${colors.border}`}>
                  <div className="flex items-start gap-2">
                    <div className={`${colors.text} mt-0.5 flex-shrink-0`}>
                      {getActionIcon(guide.primaryAction)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${colors.text}`}>
                        {guide.primaryMessage}
                      </p>
                      {guide.subMessage && (
                        <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                          {guide.subMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Explicit Action Price */}
                  {guide.actionPrice !== null && guide.actionLabel && !guide.trailingSLOptions && (
                    <div className="mt-2">
                      <ActionPriceChip label={guide.actionLabel} price={guide.actionPrice} />
                    </div>
                  )}
                </div>

                {/* Trailing SL Options */}
                {guide.trailingSLOptions && (
                  <TrailingSLCard options={guide.trailingSLOptions} symbol={guide.symbol} />
                )}

                {/* Alpha Plan Context */}
                <AlphaPlanSection guide={guide} />

                {/* Stale price warning */}
                {guide.stalePriceWarning && (
                  <div className="mt-2 flex items-center gap-2 bg-amber-900/30 rounded-lg px-3 py-2 border border-amber-600/30">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <p className="text-xs text-amber-300">{guide.stalePriceWarning}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          Advisory only — All trade closures require user confirmation
        </div>
      </div>
    </div>
  );
};
