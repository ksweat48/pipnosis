import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart3,
  RefreshCw,
  Sun,
  Moon,
  Sunrise,
  Zap,
  Timer,
  Activity,
} from 'lucide-react';

type TradeStyle = 'scalp' | 'micro' | 'intraday';
type TradeDirection = 'buy' | 'sell';

interface BestPair {
  symbol: string;
  confidence: number;
  tradeConfidence?: number;
  alignedIndicators?: number;
  totalIndicators?: number;
  status?: 'ready' | 'heating' | 'monitoring';
  reasoning: string;
  indicatorAlignment?: {
    vwap: boolean;
    ema20: boolean;
    ema50: boolean;
    rsi: boolean;
    volumePressure: boolean;
    candlePattern: boolean;
    structure: boolean;
    momentum: boolean;
  };
  lastCalculated?: string;
  tradeStyle?: TradeStyle;
  timeframe?: string;
  direction?: TradeDirection;
  constraintFeasible?: boolean;
  constraintWarning?: string;
}

interface SessionData {
  id: string;
  session_name: 'London' | 'New York' | 'Asian';
  session_start_hour: number;
  session_end_hour: number;
  best_pairs: BestPair[];
  top_pairs?: BestPair[];
  all_pair_scores?: BestPair[];
  heating_pairs?: BestPair[];
  market_condition: string;
  is_tradable: boolean;
  recommendation_text: string;
  created_at: string;
  expires_at: string;
}

const STYLE_CONFIG: Record<TradeStyle, {
  label: string;
  border: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
  icon: React.ReactNode;
  glow: string;
  holdTime: string;
}> = {
  scalp: {
    label: 'Scalp',
    border: 'border-amber-500/40',
    bg: 'bg-gradient-to-br from-amber-950/30 to-amber-900/10',
    badgeBg: 'bg-amber-500/20 border-amber-500/50',
    badgeText: 'text-amber-400',
    icon: <Zap className="w-3.5 h-3.5" />,
    glow: 'from-amber-500 to-yellow-500',
    holdTime: '5-30 min',
  },
  micro: {
    label: 'Micro',
    border: 'border-cyan-500/40',
    bg: 'bg-gradient-to-br from-cyan-950/30 to-cyan-900/10',
    badgeBg: 'bg-cyan-500/20 border-cyan-500/50',
    badgeText: 'text-cyan-400',
    icon: <Timer className="w-3.5 h-3.5" />,
    glow: 'from-cyan-500 to-teal-500',
    holdTime: '30 min - 2 hr',
  },
  intraday: {
    label: 'Intraday',
    border: 'border-emerald-500/40',
    bg: 'bg-gradient-to-br from-emerald-950/30 to-emerald-900/10',
    badgeBg: 'bg-emerald-500/20 border-emerald-500/50',
    badgeText: 'text-emerald-400',
    icon: <Activity className="w-3.5 h-3.5" />,
    glow: 'from-emerald-500 to-green-500',
    holdTime: '2-10 hr',
  },
};

export const SessionIntelligenceMonitor: React.FC = () => {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<TradeStyle | 'all'>('all');

  const triggerIntelligenceUpdate = useCallback(async (): Promise<boolean> => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) return false;

      const apiUrl = `${supabaseUrl}/functions/v1/update-session-intelligence`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  const loadSessionData = useCallback(async (allowExpired = false) => {
    try {
      let query = supabase
        .from('session_intelligence_data')
        .select(
          'id, session_name, session_start_hour, session_end_hour, best_pairs, top_pairs, all_pair_scores, heating_pairs, market_condition, is_tradable, recommendation_text, created_at, expires_at'
        )
        .order('created_at', { ascending: false })
        .limit(1);

      if (!allowExpired) {
        query = query.gt('expires_at', new Date().toISOString());
      }

      const { data, error } = await query.maybeSingle();
      if (error) return;

      if (data) {
        setSessionData(data);
      } else if (!allowExpired) {
        await loadSessionData(true);
      }
    } catch {
      // silent
    }
  }, []);

  const handleManualRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await triggerIntelligenceUpdate();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await loadSessionData();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, triggerIntelligenceUpdate, loadSessionData]);

  useEffect(() => {
    const init = async () => {
      await loadSessionData();
      setLoading(false);
      triggerIntelligenceUpdate().catch(() => {});
    };
    init();

    const channel = supabase
      .channel('session-intelligence')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_intelligence_data' },
        (payload) => {
          if (payload.new && typeof payload.new === 'object' && 'id' in payload.new) {
            setSessionData(payload.new as SessionData);
          }
        }
      )
      .subscribe();

    const refreshTimer = setInterval(() => {
      loadSessionData();
    }, 120000);

    return () => {
      clearInterval(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [loadSessionData, triggerIntelligenceUpdate]);

  const getSessionIcon = (sessionName: string) => {
    switch (sessionName) {
      case 'London':
        return <Sun className="w-6 h-6 text-yellow-400" />;
      case 'New York':
        return <Sunrise className="w-6 h-6 text-orange-400" />;
      case 'Asian':
        return <Moon className="w-6 h-6 text-blue-400" />;
      default:
        return <Clock className="w-6 h-6 text-gray-400" />;
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'trending':
        return 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30';
      case 'volatile':
        return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
      case 'ranging':
        return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
      default:
        return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
    }
  };

  const resolveStyle = (pair: BestPair): TradeStyle => pair.tradeStyle ?? 'micro';
  const resolveDirection = (pair: BestPair): TradeDirection => pair.direction ?? 'buy';
  const resolveTimeframe = (pair: BestPair): string => pair.timeframe ?? 'M15';

  const getReadyPairs = (): BestPair[] => {
    if (!sessionData) return [];
    const ready = (sessionData.best_pairs ?? []).filter((p) => (p.confidence ?? 0) >= 80);
    if (activeFilter === 'all') return ready;
    return ready.filter((p) => resolveStyle(p) === activeFilter);
  };

  const getHeatingPairs = (): BestPair[] => {
    if (!sessionData) return [];
    const heating = (sessionData.heating_pairs ?? []).filter(
      (p) => (p.confidence ?? 0) >= 50 && (p.confidence ?? 0) < 80
    );
    if (activeFilter === 'all') return heating;
    return heating.filter((p) => resolveStyle(p) === activeFilter);
  };

  const getHeatingCount = (): number => {
    if (!sessionData) return 0;
    const allPairs = [...(sessionData.best_pairs ?? []), ...(sessionData.heating_pairs ?? [])];
    const heating = allPairs.filter(
      (p) => (p.confidence ?? 0) >= 50 && (p.confidence ?? 0) < 80
    );
    if (activeFilter === 'all') return heating.length;
    return heating.filter((p) => resolveStyle(p) === activeFilter).length;
  };

  const getStyleCounts = (): Record<TradeStyle, number> => {
    const counts: Record<TradeStyle, number> = { scalp: 0, micro: 0, intraday: 0 };
    const allReady = (sessionData?.best_pairs ?? []).filter((p) => (p.confidence ?? 0) >= 80);
    for (const pair of allReady) {
      counts[resolveStyle(pair)]++;
    }
    return counts;
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-blue-900/30 to-slate-900/30 rounded-xl p-6 border border-blue-500/30">
        <div className="animate-pulse">
          <div className="h-6 bg-blue-500/20 rounded w-1/2 mb-4" />
          <div className="h-4 bg-blue-500/20 rounded w-3/4 mb-2" />
          <div className="h-4 bg-blue-500/20 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl p-6 border border-slate-700/50">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-slate-700/50 rounded-lg">
            <Clock className="w-6 h-6 text-slate-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-2">Real-Time Intelligence</h3>
            <p className="text-sm text-slate-400 mb-2">
              Real-time probability analysis will appear here shortly.
            </p>
            <p className="text-xs text-slate-500">
              Scanning Scalp (M5), Micro (M15) and Intraday (H1) setups across all watchlist
              pairs. Ready to trade pairs show 70%+ indicator alignment.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const readyPairs = getReadyPairs();
  const heatingPairs = getHeatingPairs();
  const heatingCount = getHeatingCount();
  const styleCounts = getStyleCounts();

  const renderPairCard = (pair: BestPair) => {
    const style = resolveStyle(pair);
    const direction = resolveDirection(pair);
    const timeframe = resolveTimeframe(pair);
    const config = STYLE_CONFIG[style];
    const confidence = pair.tradeConfidence ?? pair.confidence;
    const isBuy = direction === 'buy';

    return (
      <div
        key={`${pair.symbol}-${style}-${timeframe}`}
        className={`relative rounded-xl p-4 border transition-all duration-300 hover:scale-[1.01] ${config.border} ${config.bg}`}
      >
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl bg-gradient-to-r opacity-60" style={{
          backgroundImage: `linear-gradient(to right, var(--tw-gradient-stops))`,
        }}>
          <div className={`h-full rounded-t-xl bg-gradient-to-r ${config.glow}`} />
        </div>

        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-base font-bold text-white truncate">{pair.symbol}</p>
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${
                    isBuy
                      ? 'bg-green-500/15 border-green-500/40 text-green-400'
                      : 'bg-red-500/15 border-red-500/40 text-red-400'
                  }`}
                >
                  {isBuy ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {isBuy ? 'Buy' : 'Sell'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${config.badgeBg} ${config.badgeText}`}
                >
                  {config.icon}
                  {config.label}
                </span>
                <span className="text-xs text-gray-500 font-mono">{timeframe}</span>
                <span className="text-xs text-gray-600">|</span>
                <span className="text-xs text-gray-500">{config.holdTime}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-3">
            <div className="flex items-center gap-1.5">
              <BarChart3 className={`w-4 h-4 ${confidence >= 80 ? 'text-green-400' : confidence >= 70 ? 'text-yellow-400' : 'text-blue-400'}`} />
              <span
                className={`text-lg font-bold ${
                  confidence >= 80
                    ? 'text-green-400'
                    : confidence >= 70
                      ? 'text-yellow-400'
                      : 'text-blue-400'
                }`}
              >
                {confidence}%
              </span>
            </div>
            {pair.alignedIndicators !== undefined && pair.totalIndicators !== undefined && (
              <span className="text-xs text-gray-500">
                {pair.alignedIndicators}/{pair.totalIndicators} aligned
              </span>
            )}
          </div>
        </div>

        {pair.indicatorAlignment && (
          <div className="flex flex-wrap gap-1 mb-2">
            {Object.entries(pair.indicatorAlignment).map(([key, aligned]) => (
              <span
                key={key}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  aligned
                    ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                    : 'bg-gray-800/50 text-gray-600 border border-gray-700/20'
                }`}
              >
                {key === 'volumePressure'
                  ? 'Vol'
                  : key === 'candlePattern'
                    ? 'Pattern'
                    : key === 'ema20'
                      ? 'EMA20'
                      : key === 'ema50'
                        ? 'EMA50'
                        : key.charAt(0).toUpperCase() + key.slice(1)}
              </span>
            ))}
          </div>
        )}

        {pair.constraintFeasible === false && (
          <div className="mt-1.5 mb-1 px-2 py-1 rounded bg-red-500/10 border border-red-500/20 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
            <p className="text-[10px] text-red-400 font-medium leading-tight">
              Style blocked by constraint geometry at current price
            </p>
          </div>
        )}

        {pair.reasoning && (
          <p className="text-xs text-gray-400 leading-relaxed">{pair.reasoning}</p>
        )}
      </div>
    );
  };

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-slate-900/50 to-blue-900/40 rounded-xl p-5 border border-blue-500/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              {getSessionIcon(sessionData.session_name)}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Real-Time Intelligence</h3>
              <p className="text-sm text-blue-300">
                Scanning Scalp / Micro / Intraday -- Last:{' '}
                {new Date(sessionData.created_at).toLocaleTimeString()}
              </p>
            </div>
          </div>

          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="p-2 hover:bg-blue-500/20 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh intelligence"
          >
            <RefreshCw
              className={`w-4 h-4 text-blue-300 ${refreshing ? 'animate-spin' : ''}`}
            />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div
            className={`px-3 py-1.5 rounded-lg border ${getConditionColor(sessionData.market_condition)}`}
          >
            <p className="text-sm font-semibold capitalize">{sessionData.market_condition}</p>
          </div>

          {readyPairs.length > 0 ? (
            <div className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/20">
              <p className="text-sm font-semibold text-emerald-400">
                {readyPairs.length} Setup{readyPairs.length !== 1 ? 's' : ''} Ready (80%+)
              </p>
            </div>
          ) : sessionData.is_tradable ? (
            <div className="px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/20">
              <p className="text-sm font-semibold text-amber-400">Building Setups</p>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/20">
              <p className="text-sm font-semibold text-red-400">No Clear Setups</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0 ${
              activeFilter === 'all'
                ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300'
            }`}
          >
            All
          </button>
          {(['scalp', 'micro', 'intraday'] as TradeStyle[]).map((style) => {
            const cfg = STYLE_CONFIG[style];
            const count = styleCounts[style];
            return (
              <button
                key={style}
                onClick={() => setActiveFilter(style)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0 ${
                  activeFilter === style
                    ? `${cfg.badgeBg} ${cfg.badgeText}`
                    : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300'
                }`}
              >
                {cfg.icon}
                {cfg.label}
                {count > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0 rounded-full text-[10px] ${
                      activeFilter === style ? cfg.badgeText : 'text-gray-500'
                    } ${activeFilter === style ? 'bg-white/10' : 'bg-gray-700/50'}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {readyPairs.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-blue-200 mb-3">
              Ready to Trade (80%+)
            </p>
            <div className="space-y-3">
              {readyPairs.map((pair) => renderPairCard(pair))}
            </div>
          </div>
        )}

        {heatingCount > 0 && (
          <div className="mb-4">
            <div className="bg-amber-900/20 rounded-lg p-4 border border-amber-500/30">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-500/20 rounded-lg flex-shrink-0">
                  <Activity className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-300 mb-1">
                    {heatingCount} {heatingCount === 1 ? 'pair' : 'pairs'} heating up
                  </p>
                  <p className="text-sm text-amber-200/70">
                    {heatingCount === 1 ? 'This setup is' : 'These setups are'} building momentum but not yet at 80%+ confidence threshold. Alpha will monitor automatically.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {readyPairs.length === 0 && heatingCount === 0 && (
          <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/30 mb-4">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-300 mb-1">
                  Scanning All Timeframes
                </p>
                <p className="text-sm text-blue-200/80">
                  Analyzing Scalp (M5), Micro (M15) and Intraday (H1) for setups with 80%+
                  indicator alignment.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/20">
          <p className="text-sm text-blue-100">{sessionData.recommendation_text}</p>
        </div>

        <div className="mt-4 text-xs text-gray-500 text-center">
          Advisory only - Does not affect Alpha's autonomous trading
        </div>
      </div>
    </div>
  );
};
