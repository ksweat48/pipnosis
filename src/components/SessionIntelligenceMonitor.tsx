import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
  Clock,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Sun,
  Moon,
  Sunrise,
  Zap,
  Timer,
  Activity,
  MapPin,
  Flame,
  Target,
  ChevronRight,
  Bitcoin,
} from 'lucide-react';
import { calculateSessionContext, getForexMarketStatus, isSymbolMarketOpen } from '@/utils/marketHours';

type TradeStyle = 'scalper' | 'micro' | 'intraday';
type TradeDirection = 'buy' | 'sell';
type TimeQuality = 'prime' | 'good' | 'slow';

type ScalpSubMode = 'momentum_continuation' | 'pullback_entry' | 'consolidation_breakout';
type ScalpPattern =
  | 'momentum_breakout'
  | 'bos_retest'
  | 'ema_rejection'
  | 'double_bottom'
  | 'double_top'
  | 'range_breakout'
  | 'liquidity_sweep'
  | 'engulfing_at_structure'
  | 'trend_pullback_ema'
  | 'none';
type MomentumPhase = 'starting' | 'developing' | 'exhausted';

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
  scalpSubMode?: ScalpSubMode;
  scalpPattern?: ScalpPattern;
  momentumPhase?: MomentumPhase;
  atrTraveled?: number;
  structureEventType?: string;
  structureEventDescription?: string;
  structureEventRR?: number;
  structureEventConfidence?: number;
  killZoneActive?: boolean;
  killZoneName?: string;
  killZoneLabel?: string;
  killZoneQuality?: string;
  killZoneMinutesRemaining?: number;
  killZoneBadgeColor?: string;
  liquidityPoolDirection?: 'above' | 'below' | 'both' | 'none';
  liquidityPoolDistancePips?: number;
  asiaRangeHigh?: number;
  asiaRangeLow?: number;
  asiaRangePips?: number;
  asiaRangeLocked?: boolean;
}

interface KillZoneContextSnapshot {
  killZoneActive: boolean;
  killZoneName: string | null;
  killZoneLabel: string | null;
  killZoneQuality: string | null;
  minutesRemaining: number;
  minutesUntilNext: number;
  nextKillZoneName: string | null;
  nextKillZoneLabel: string | null;
  cardSuppression: string;
  confidenceBonus: number;
  badgeColor: string;
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
  kill_zone_context?: KillZoneContextSnapshot;
}

interface SessionTimeQualityInfo {
  quality: TimeQuality;
  label: string;
  description: string;
  windowEndUtcMinutes: number;
  sessionLabel: string;
  sessionIcon: 'sun' | 'sunrise' | 'moon' | 'clock';
  sessionStartUtc: number;
  sessionEndUtc: number;
  currentUtcMinutes: number;
}

interface TimelineZone {
  startUtc: number;
  endUtc: number;
  quality: TimeQuality;
  label: string;
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
  scalper: {
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

/**
 * SSOT: Session time quality windows defined in UTC hours.
 * Authority: SessionIntelligenceMonitor is the sole owner of UI-layer session quality display.
 * Derived from the same session boundaries used in marketHours.ts calculateSessionContext().
 *
 * Quality tiers:
 *   prime (green)  - Highest volume, tightest spreads, best alpha probability
 *   good  (yellow) - Acceptable liquidity, valid setups but wider spreads possible
 *   slow  (red)    - Low volume, avoid manual entries, spreads are wide
 */
const TIMELINE_ZONES: TimelineZone[] = [
  { startUtc: 0,  endUtc: 3,  quality: 'slow',  label: 'Asian / Dead Zone' },
  { startUtc: 3,  endUtc: 8,  quality: 'good',  label: 'Asian' },
  { startUtc: 8,  endUtc: 10, quality: 'good',  label: 'London Open' },
  { startUtc: 10, endUtc: 13, quality: 'prime', label: 'London Prime' },
  { startUtc: 13, endUtc: 17, quality: 'prime', label: 'London/NY Overlap' },
  { startUtc: 17, endUtc: 19, quality: 'good',  label: 'NY Afternoon' },
  { startUtc: 19, endUtc: 22, quality: 'slow',  label: 'NY Late / Pre-Asia' },
  { startUtc: 22, endUtc: 24, quality: 'slow',  label: 'Sydney / Dead Zone' },
];

function getQualityColors(quality: TimeQuality): {
  dot: string;
  border: string;
  bg: string;
  text: string;
  badge: string;
  badgeText: string;
  timelineBar: string;
} {
  switch (quality) {
    case 'prime':
      return {
        dot: 'bg-green-400',
        border: 'border-green-500/50',
        bg: 'bg-green-500/10',
        text: 'text-green-400',
        badge: 'bg-green-500/20 border-green-500/40',
        badgeText: 'text-green-300',
        timelineBar: 'bg-green-500/70',
      };
    case 'good':
      return {
        dot: 'bg-yellow-400',
        border: 'border-yellow-500/50',
        bg: 'bg-yellow-500/10',
        text: 'text-yellow-400',
        badge: 'bg-yellow-500/20 border-yellow-500/40',
        badgeText: 'text-yellow-300',
        timelineBar: 'bg-yellow-500/70',
      };
    case 'slow':
      return {
        dot: 'bg-red-400',
        border: 'border-red-500/40',
        bg: 'bg-red-500/8',
        text: 'text-red-400',
        badge: 'bg-red-500/20 border-red-500/40',
        badgeText: 'text-red-300',
        timelineBar: 'bg-red-500/50',
      };
  }
}

/**
 * Computes the current session quality and full context from UTC time.
 * Delegates session boundaries to TIMELINE_ZONES (SSOT for quality windows).
 */
function computeSessionTimeQuality(): SessionTimeQualityInfo {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const currentUtcMinutes = utcHours * 60 + utcMinutes;

  const zone = TIMELINE_ZONES.find(
    (z) => utcHours >= z.startUtc && utcHours < z.endUtc
  ) ?? TIMELINE_ZONES[0];

  const windowEndUtcMinutes = zone.endUtc * 60;
  const minutesRemaining = windowEndUtcMinutes - currentUtcMinutes;

  let sessionLabel: string;
  let sessionIcon: SessionTimeQualityInfo['sessionIcon'];
  let sessionStartUtc: number;
  let sessionEndUtc: number;

  if (utcHours >= 8 && utcHours < 17) {
    sessionLabel = 'London Session';
    sessionIcon = 'sun';
    sessionStartUtc = 8;
    sessionEndUtc = 17;
  } else if (utcHours >= 13 && utcHours < 22) {
    sessionLabel = 'New York Session';
    sessionIcon = 'sunrise';
    sessionStartUtc = 13;
    sessionEndUtc = 22;
  } else if (utcHours >= 0 && utcHours < 8) {
    sessionLabel = 'Asian Session';
    sessionIcon = 'moon';
    sessionStartUtc = 0;
    sessionEndUtc = 8;
  } else {
    sessionLabel = 'Sydney / Pre-Asia';
    sessionIcon = 'clock';
    sessionStartUtc = 22;
    sessionEndUtc = 24;
  }

  if (utcHours >= 13 && utcHours < 17) {
    sessionLabel = 'London / NY Overlap';
    sessionIcon = 'sunrise';
    sessionStartUtc = 13;
    sessionEndUtc = 17;
  }

  const qualityLabels: Record<TimeQuality, string> = {
    prime: 'Prime Time',
    good: 'Good Window',
    slow: 'Slow Period',
  };

  const qualityDescriptions: Record<TimeQuality, string> = {
    prime: 'Optimal trading window. Highest volume, tightest spreads, best probability.',
    good: 'Decent liquidity. Valid setups possible — expect slightly wider spreads.',
    slow: 'Low liquidity. Alpha continues scanning. Manual trades carry elevated risk.',
  };

  return {
    quality: zone.quality,
    label: qualityLabels[zone.quality],
    description: qualityDescriptions[zone.quality],
    windowEndUtcMinutes,
    sessionLabel,
    sessionIcon,
    sessionStartUtc,
    sessionEndUtc,
    currentUtcMinutes,
  };
}

function formatMinutesAsCountdown(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function utcHourToLocalDisplay(utcHour: number): string {
  const date = new Date();
  date.setUTCHours(utcHour, 0, 0, 0);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

const SessionTimeline: React.FC<{ currentUtcMinutes: number }> = ({ currentUtcMinutes }) => {
  const totalMinutesInDay = 24 * 60;
  const cursorPct = (currentUtcMinutes / totalMinutesInDay) * 100;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">24h Trading Quality</span>
        <span className="text-[10px] text-gray-600">UTC-based</span>
      </div>
      <div className="relative h-5 rounded-lg overflow-hidden bg-slate-800/60 border border-slate-700/40">
        {TIMELINE_ZONES.map((zone, i) => {
          const leftPct = (zone.startUtc / 24) * 100;
          const widthPct = ((zone.endUtc - zone.startUtc) / 24) * 100;
          const colors = getQualityColors(zone.quality);
          return (
            <div
              key={i}
              className={`absolute top-0 bottom-0 ${colors.timelineBar}`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${zone.label} (${zone.startUtc}:00-${zone.endUtc}:00 UTC)`}
            />
          );
        })}

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white z-10 shadow-lg"
          style={{ left: `${cursorPct}%` }}
        >
          <div className="absolute -top-0.5 -left-1 w-2.5 h-2.5 bg-white rounded-full shadow-md" />
        </div>

        <div className="absolute inset-0 flex">
          {[0, 4, 8, 12, 16, 20].map((h) => (
            <div
              key={h}
              className="absolute top-0 bottom-0 w-px bg-slate-700/30"
              style={{ left: `${(h / 24) * 100}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-between mt-1">
        {[0, 4, 8, 12, 16, 20].map((h) => (
          <span key={h} className="text-[9px] text-gray-600 font-mono">{String(h).padStart(2, '0')}:00</span>
        ))}
        <span className="text-[9px] text-gray-600 font-mono">24:00</span>
      </div>

      <div className="flex items-center gap-3 mt-1.5">
        {(['prime', 'good', 'slow'] as TimeQuality[]).map((q) => {
          const c = getQualityColors(q);
          const labels: Record<TimeQuality, string> = { prime: 'Prime', good: 'Good', slow: 'Slow' };
          return (
            <div key={q} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-sm ${c.timelineBar}`} />
              <span className={`text-[9px] ${c.text}`}>{labels[q]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SessionQualityBanner: React.FC = () => {
  const [info, setInfo] = useState<SessionTimeQualityInfo>(computeSessionTimeQuality);
  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      const fresh = computeSessionTimeQuality();
      setInfo(fresh);
      const now = new Date();
      const currentMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      setCountdown(Math.max(0, fresh.windowEndUtcMinutes - currentMins));
    };
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, []);

  const colors = getQualityColors(info.quality);
  const sessionCtx = calculateSessionContext();

  const sessionStartLocalStr = utcHourToLocalDisplay(info.sessionStartUtc);
  const sessionEndLocalStr = utcHourToLocalDisplay(info.sessionEndUtc);

  const sessionDurationMinutes = (info.sessionEndUtc - info.sessionStartUtc) * 60;
  const elapsedMinutes = info.currentUtcMinutes - info.sessionStartUtc * 60;
  const sessionProgressPct = Math.min(100, Math.max(0, (elapsedMinutes / sessionDurationMinutes) * 100));

  const SessionIconComp = () => {
    switch (info.sessionIcon) {
      case 'sun': return <Sun className="w-4 h-4 text-yellow-400" />;
      case 'sunrise': return <Sunrise className="w-4 h-4 text-orange-400" />;
      case 'moon': return <Moon className="w-4 h-4 text-blue-400" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className={`rounded-xl border p-3.5 mb-4 ${colors.border} ${colors.bg}`}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <SessionIconComp />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">{info.sessionLabel}</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${colors.badge} ${colors.badgeText}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${colors.dot} animate-pulse`} />
                {info.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <MapPin className="w-3 h-3 text-gray-500" />
              <span className="text-[10px] text-gray-500">
                {sessionStartLocalStr} – {sessionEndLocalStr} local
              </span>
              <span className="text-[10px] text-gray-600">·</span>
              <span className="text-[10px] text-gray-500">
                {sessionCtx.sessionTimeRemainingMinutes > 0
                  ? `${formatMinutesAsCountdown(sessionCtx.sessionTimeRemainingMinutes)} left in session`
                  : 'Session ending'}
              </span>
            </div>
          </div>
        </div>

        <div className="text-right flex-shrink-0 ml-3">
          <div className={`text-xs font-semibold ${colors.text}`}>
            {countdown > 0 ? `${formatMinutesAsCountdown(countdown)} left` : 'Window ending'}
          </div>
          <div className="text-[10px] text-gray-500">in this window</div>
        </div>
      </div>

      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-500">Session progress</span>
          <span className="text-[10px] text-gray-500">{Math.round(sessionProgressPct)}%</span>
        </div>
        <div className="h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${colors.dot}`}
            style={{ width: `${sessionProgressPct}%` }}
          />
        </div>
      </div>

      <p className={`text-[11px] leading-relaxed ${colors.text}`}>
        {info.description}
      </p>

      <SessionTimeline currentUtcMinutes={info.currentUtcMinutes} />
    </div>
  );
};

/**
 * CCIP 2026-02-20: Market Close Awareness.
 * Computes minutes until Sunday 5pm EST (market reopen) from current time.
 * Used by MarketClosedBanner to show a countdown to reopen.
 */
function computeMinutesToForexReopen(): number {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = estTime.getDay();
  const h = estTime.getHours();
  const m = estTime.getMinutes();
  const totalMins = h * 60 + m;
  const sundayOpenMins = 17 * 60;

  if (day === 6) {
    const minsUntilSundayMidnight = (24 * 60) - totalMins;
    return minsUntilSundayMidnight + sundayOpenMins;
  }
  if (day === 0) {
    if (totalMins < sundayOpenMins) {
      return sundayOpenMins - totalMins;
    }
    return 0;
  }
  if (day === 5) {
    const fridayCloseMins = 17 * 60;
    if (totalMins >= fridayCloseMins) {
      const minsUntilSatMidnight = (24 * 60) - totalMins;
      const satMins = 24 * 60;
      return minsUntilSatMidnight + satMins + sundayOpenMins;
    }
  }
  return 0;
}

/**
 * CCIP 2026-02-20: Weekend / Market Closed Banner.
 * Replaces SessionQualityBanner when the forex market is closed.
 * Shows countdown to Sunday 5pm EST reopen and informs user that
 * only crypto pairs (BTCUSD, ETHUSD) are available for scanning.
 */
const MarketClosedBanner: React.FC = () => {
  const [minsToReopen, setMinsToReopen] = useState(computeMinutesToForexReopen);

  useEffect(() => {
    const interval = setInterval(() => {
      setMinsToReopen(computeMinutesToForexReopen());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const h = Math.floor(minsToReopen / 60);
  const m = minsToReopen % 60;
  const reopenLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;

  return (
    <div className="rounded-xl border border-slate-600/40 bg-gradient-to-br from-slate-800/60 to-slate-900/40 p-3.5 mb-4">
      <div className="flex items-center gap-3 mb-2.5">
        <div className="p-2 bg-slate-700/50 rounded-lg flex-shrink-0">
          <Moon className="w-4 h-4 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white">Forex Markets Closed</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold bg-slate-700/50 border-slate-600/40 text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              Weekend
            </span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Fri 5:00 PM – Sun 5:00 PM EST &nbsp;·&nbsp; Reopens in{' '}
            <span className="text-slate-300 font-semibold">{reopenLabel}</span>
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-xs font-semibold text-slate-400">{reopenLabel}</div>
          <div className="text-[10px] text-slate-600">to reopen</div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/30">
        <Bitcoin className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <p className="text-[11px] text-slate-300 leading-snug">
          <span className="font-semibold text-white">Crypto only</span> — BTCUSD and ETHUSD trade 24/7.
          Forex, Gold, and Index pairs are hidden until Sunday 5:00 PM EST.
        </p>
      </div>
    </div>
  );
};

type ScanState = 'idle' | 'scanning' | 'done' | 'cooldown' | 'error';

interface SessionIntelligenceMonitorProps {
  sessionId?: string;
  userId?: string;
}

export const SessionIntelligenceMonitor: React.FC<SessionIntelligenceMonitorProps> = ({
  sessionId,
  userId,
}) => {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<TradeStyle | 'all'>('all');
  const [scanAlignedPairs, setScanAlignedPairs] = useState<BestPair[] | null>(null);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanResult, setScanResult] = useState<{ signalsFound: number; scanned: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // CCIP 2026-02-20: Market close awareness.
  // Forex market is closed Fri 5pm – Sun 5pm EST. When closed, only crypto
  // pairs (BTCUSD, ETHUSD) should be shown. Delegates to getForexMarketStatus
  // (SSOT in marketHours.ts). Ticks every 60s to detect reopen automatically.
  const [isForexMarketClosed, setIsForexMarketClosed] = useState(
    () => !getForexMarketStatus().isOpen
  );

  useEffect(() => {
    const checkMarket = () => {
      setIsForexMarketClosed(!getForexMarketStatus().isOpen);
    };
    const interval = setInterval(checkMarket, 60000);
    return () => clearInterval(interval);
  }, []);

  // CCIP (2026-02-18): SSOT compliance fix.
  // The populate-session-intelligence Netlify function is a SCHEDULED data populator.
  // It runs every 5 minutes server-side. The browser must NEVER call it directly —
  // that route causes 500s under load (concurrent analysis of 27 symbol/style pairs
  // can exceed the on-demand function timeout). The UI is a pure READ consumer.
  // Data freshness is guaranteed by the scheduler; the UI subscribes to changes.

  const loadSessionData = useCallback(async (allowExpired = false) => {
    try {
      let query = supabase
        .from('session_intelligence_data')
        .select(
          'id, session_name, session_start_hour, session_end_hour, best_pairs, top_pairs, all_pair_scores, heating_pairs, market_condition, is_tradable, recommendation_text, created_at, expires_at, kill_zone_context'
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
      await loadSessionData();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, loadSessionData]);

  const handleScanNow = useCallback(async () => {
    if (scanState === 'scanning' || scanState === 'cooldown') return;

    setScanState('scanning');
    setScanResult(null);
    setScanError(null);

    try {
      const response = await fetch('/.netlify/functions/scan-alpha-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (response.status === 429) {
        setScanState('cooldown');
        setCooldownSeconds(data.secondsRemaining ?? 60);
        return;
      }

      if (!response.ok || !data.success) {
        setScanState('error');
        setScanError(data.error ?? 'Scan failed');
        setTimeout(() => setScanState('idle'), 4000);
        return;
      }

      setScanResult({ signalsFound: data.signalsFound ?? 0, scanned: data.scanned ?? 0 });
      setScanState('done');

      // CCIP 2026-02-20: Scan Now now refreshes the single authoritative pipeline
      // (session_intelligence_data / readyPairs) instead of loading a parallel
      // alpha_scan_signals table. SSOT: one pipeline, one card format.
      await loadSessionData();

      setTimeout(() => {
        setScanState('cooldown');
        setCooldownSeconds(60);
      }, 2500);
    } catch {
      setScanState('error');
      setScanError('Network error — try again');
      setTimeout(() => setScanState('idle'), 4000);
    }
  }, [scanState, loadSessionData]);

  useEffect(() => {
    if (scanState !== 'cooldown' || cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((s) => {
        if (s <= 1) {
          clearInterval(timer);
          setScanState('idle');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [scanState, cooldownSeconds]);

  useEffect(() => {
    const init = async () => {
      await loadSessionData();
      setLoading(false);
    };
    init();

    // Realtime subscription: UI updates automatically when the scheduler writes new data.
    // This replaces the 60s poll + direct function call pattern.
    const channel = supabase
      .channel('session_intelligence_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_intelligence_data' },
        () => { loadSessionData(); }
      )
      .subscribe();

    // Fallback poll every 5 minutes (matches scheduler cadence) in case realtime lags.
    const fallbackTimer = setInterval(() => {
      loadSessionData();
    }, 300000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(fallbackTimer);
    };
  }, [loadSessionData]);

  // CCIP 2026-02-20: Scan-aligned confidence overlay.
  // When an active session exists, fetch the latest scan result's per-symbol
  // confidence scores and use them to cap the displayed pair confidence values.
  // This ensures the Intelligence Monitor reflects Alpha's actual current
  // market assessment rather than historical trade averages.
  useEffect(() => {
    if (!sessionId || !userId) {
      setScanAlignedPairs(null);
      return;
    }

    let cancelled = false;

    const fetchScanAligned = async () => {
      try {
        const { data, error } = await supabase.rpc('get_scan_aligned_session_pairs', {
          p_session_id: sessionId,
          p_user_id: userId,
        });
        if (!cancelled && !error && Array.isArray(data) && data.length > 0) {
          setScanAlignedPairs(data as BestPair[]);
        } else if (!cancelled) {
          setScanAlignedPairs(null);
        }
      } catch {
        if (!cancelled) setScanAlignedPairs(null);
      }
    };

    fetchScanAligned();

    // Refresh scan-aligned data when new scan results arrive
    const channel = supabase
      .channel(`scan-results-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'goal_session_scan_results',
        filter: `session_id=eq.${sessionId}`,
      }, () => { fetchScanAligned(); })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sessionId, userId]);

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

  const resolveStyle = (pair: BestPair): TradeStyle => {
    const raw = pair.tradeStyle ?? 'micro';
    if ((raw as string) === 'scalp') return 'scalper';
    return raw;
  };
  const resolveDirection = (pair: BestPair): TradeDirection => pair.direction ?? 'buy';
  const resolveTimeframe = (pair: BestPair): string => pair.timeframe ?? 'M15';

  // CCIP 2026-02-20: Apply scan-aligned confidence cap to a pair.
  // When Alpha's latest scan returned a confidence for this symbol, that value
  // is the SSOT for current market readiness and caps the displayed score.
  const applyScanAlignedCap = (pair: BestPair): BestPair => {
    if (!scanAlignedPairs) return pair;
    const aligned = scanAlignedPairs.find(
      (a) => a.symbol === pair.symbol
    );
    if (!aligned) return pair;
    const cappedConfidence = Math.min(pair.confidence ?? 0, aligned.confidence ?? 0);
    return { ...pair, confidence: cappedConfidence };
  };

  // CCIP 2026-02-20: Market-close filter.
  // When forex is closed, only pairs whose symbol trades 24/7 (crypto) are shown.
  // Delegates to isSymbolMarketOpen (SSOT: marketHours.ts → symbol-registry.ts).
  const applyMarketFilter = (pairs: BestPair[]): BestPair[] => {
    if (!isForexMarketClosed) return pairs;
    return pairs.filter((p) => isSymbolMarketOpen(p.symbol));
  };

  const getReadyPairs = (): BestPair[] => {
    if (!sessionData) return [];
    const ready = applyMarketFilter(
      (sessionData.best_pairs ?? [])
        .map(applyScanAlignedCap)
        .filter((p) => (p.confidence ?? 0) >= 70 && p.constraintFeasible !== false)
    );
    if (activeFilter === 'all') return ready;
    return ready.filter((p) => resolveStyle(p) === activeFilter);
  };

  const getHeatingPairs = (): BestPair[] => {
    if (!sessionData) return [];
    const combined = applyMarketFilter([
      ...(sessionData.best_pairs ?? []).map(applyScanAlignedCap),
      ...(sessionData.heating_pairs ?? []).map(applyScanAlignedCap),
    ]);
    const heating = combined.filter(
      (p) => (p.confidence ?? 0) >= 50 && (p.confidence ?? 0) < 70
    );
    if (activeFilter === 'all') return heating;
    return heating.filter((p) => resolveStyle(p) === activeFilter);
  };

  const getHeatingCount = (): number => {
    if (!sessionData) return 0;
    const combined = applyMarketFilter([
      ...(sessionData.best_pairs ?? []).map(applyScanAlignedCap),
      ...(sessionData.heating_pairs ?? []).map(applyScanAlignedCap),
    ]);
    const heating = combined.filter(
      (p) => (p.confidence ?? 0) >= 50 && (p.confidence ?? 0) < 70
    );
    if (activeFilter === 'all') return heating.length;
    return heating.filter((p) => resolveStyle(p) === activeFilter).length;
  };

  const getStyleCounts = (): Record<TradeStyle, number> => {
    const counts: Record<TradeStyle, number> = { scalper: 0, micro: 0, intraday: 0 };
    const allReady = applyMarketFilter(
      (sessionData?.best_pairs ?? [])
        .map(applyScanAlignedCap)
        .filter((p) => (p.confidence ?? 0) >= 70 && p.constraintFeasible !== false)
    );
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
            {isForexMarketClosed ? <MarketClosedBanner /> : <SessionQualityBanner />}
            <p className="text-sm text-slate-400 mb-2">
              Real-time probability analysis will appear here shortly.
            </p>
            <p className="text-xs text-slate-500">
              {isForexMarketClosed
                ? 'Scanning BTCUSD and ETHUSD — crypto trades 24/7 even on weekends.'
                : 'Scanning Scalp (M5), Micro (M15) and Intraday (H1) setups across all watchlist pairs. Ready to trade pairs show 70%+ indicator alignment.'}
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

  const handleAnalyzeWithAlpha = (pair: BestPair) => {
    const style = resolveStyle(pair);
    sessionStorage.setItem('im_card_signal', JSON.stringify({
      symbol: pair.symbol,
      direction: pair.direction,
      confidence: pair.confidence,
      momentumPhase: pair.momentumPhase,
      scalpSubMode: pair.scalpSubMode,
      scalpPattern: pair.scalpPattern,
      tradeStyle: pair.tradeStyle,
    }));
    navigate('/ai-trade', { replace: false });
    setSearchParams({ style, symbol: pair.symbol });
  };

  const renderAsiaRangeCard = (pair: BestPair) => {
    if (pair.structureEventType !== 'AsiaRangeBuilding') return null;
    if (!pair.asiaRangeHigh || !pair.asiaRangeLow) return null;

    return (
      <div
        key={`${pair.symbol}-asia-range`}
        className="relative rounded-xl p-4 border border-blue-500/30 bg-gradient-to-br from-blue-950/30 to-blue-900/10"
      >
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl bg-gradient-to-r from-blue-500 to-cyan-500 opacity-40" />
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Moon className="w-4 h-4 text-blue-400" />
            <p className="text-sm font-bold text-white">{pair.symbol}</p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold bg-blue-500/15 border-blue-500/40 text-blue-300">
              Asia Range
            </span>
          </div>
          <span className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
            Informational
          </span>
        </div>
        <p className="text-xs text-blue-200/80 mb-2">
          {pair.structureEventDescription}
        </p>
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          <span>H: <span className="text-white font-mono">{pair.asiaRangeHigh.toFixed(5)}</span></span>
          <span>L: <span className="text-white font-mono">{pair.asiaRangeLow.toFixed(5)}</span></span>
          {pair.asiaRangePips && pair.asiaRangePips > 0 && (
            <span>Range: <span className="text-blue-300 font-mono">{Math.round(pair.asiaRangePips)}p</span></span>
          )}
        </div>
        <p className="text-[10px] text-gray-600 mt-2">London will target these levels. Card upgrades to a trade signal when London sweeps this range.</p>
      </div>
    );
  };

  const renderPairCard = (pair: BestPair) => {
    if (pair.structureEventType === 'AsiaRangeBuilding') {
      return renderAsiaRangeCard(pair);
    }

    const style = resolveStyle(pair);
    const direction = resolveDirection(pair);
    const timeframe = resolveTimeframe(pair);
    const config = STYLE_CONFIG[style];
    const confidence = pair.tradeConfidence ?? pair.confidence;
    const isBuy = direction === 'buy';

    const isScalp = style === 'scalper';
    const momentumPhase = pair.momentumPhase;
    const phaseGlow = isScalp && momentumPhase === 'starting'
      ? 'shadow-[0_0_14px_rgba(251,191,36,0.2)]'
      : '';

    const isReady = confidence >= 70;

    const scoreColor = confidence >= 85
      ? 'text-green-400'
      : confidence >= 70
        ? 'text-yellow-400'
        : 'text-gray-400';

    const tradeableLabel = confidence >= 85
      ? 'Trade It'
      : confidence >= 70
        ? 'Worth a Look'
        : 'Not Yet';

    const tradeableBg = confidence >= 85
      ? 'bg-green-500/15 border-green-500/40 text-green-300'
      : confidence >= 70
        ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300'
        : 'bg-gray-700/30 border-gray-600/30 text-gray-500';

    return (
      <div
        key={`${pair.symbol}-${style}-${timeframe}`}
        className={`relative rounded-xl border transition-all duration-300 hover:scale-[1.01] overflow-hidden ${config.border} ${config.bg} ${phaseGlow}`}
      >
        <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${config.glow}`} />

        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-white">{pair.symbol}</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${
                      isBuy
                        ? 'bg-green-500/15 border-green-500/40 text-green-400'
                        : 'bg-red-500/15 border-red-500/40 text-red-400'
                    }`}
                  >
                    {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {isBuy ? 'Buy' : 'Sell'}
                  </span>
                  {isScalp && momentumPhase === 'starting' && (
                    <Flame className="w-3.5 h-3.5 text-orange-400 animate-pulse flex-shrink-0" title="Momentum starting" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0 rounded text-[10px] font-semibold ${config.badgeBg} ${config.badgeText}`}>
                    {config.icon}
                    {config.label}
                  </span>
                  <span className="text-[10px] text-gray-600 font-mono">{timeframe}</span>
                  {pair.killZoneActive && pair.killZoneLabel && (
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0 rounded text-[10px] font-semibold ${pair.killZoneBadgeColor ?? 'bg-green-500/20 border-green-500/40 text-green-300'}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      {pair.killZoneLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-3">
              <span className={`text-2xl font-bold tabular-nums leading-none ${scoreColor}`}>
                {confidence}%
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${tradeableBg}`}>
                {tradeableLabel}
              </span>
            </div>
          </div>

          {isReady && (
            <button
              onClick={() => handleAnalyzeWithAlpha(pair)}
              className={`mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${config.badgeBg} ${config.badgeText} hover:opacity-90`}
            >
              <Target className="w-3.5 h-3.5" />
              Analyze with Alpha
              <ChevronRight className="w-3.5 h-3.5 ml-auto" />
            </button>
          )}
        </div>
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
                {isForexMarketClosed
                  ? 'Crypto Only (Weekend) -- Last: '
                  : 'Scanning Scalp / Micro / Intraday -- Last: '}
                {new Date(sessionData.created_at).toLocaleTimeString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleScanNow}
              disabled={scanState === 'scanning' || scanState === 'cooldown'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-200 ${
                scanState === 'scanning'
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 opacity-75 cursor-not-allowed'
                  : scanState === 'done'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : scanState === 'error'
                  ? 'bg-red-500/20 border-red-500/50 text-red-300'
                  : scanState === 'cooldown'
                  ? 'bg-gray-700/40 border-gray-600/30 text-gray-500 cursor-not-allowed'
                  : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25'
              }`}
              title={scanState === 'cooldown' ? `Cooldown: ${cooldownSeconds}s` : 'Run full indicator scan across all pairs'}
            >
              {scanState === 'scanning' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Scanning...
                </>
              ) : scanState === 'done' && scanResult ? (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  {scanResult.signalsFound} signal{scanResult.signalsFound !== 1 ? 's' : ''}
                </>
              ) : scanState === 'error' ? (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  {scanError ?? 'Error'}
                </>
              ) : scanState === 'cooldown' ? (
                <>
                  <Timer className="w-3.5 h-3.5" />
                  {cooldownSeconds}s
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  Scan Now
                </>
              )}
            </button>

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
        </div>

        {isForexMarketClosed ? <MarketClosedBanner /> : <SessionQualityBanner />}

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div
            className={`px-3 py-1.5 rounded-lg border ${getConditionColor(sessionData.market_condition)}`}
          >
            <p className="text-sm font-semibold capitalize">{sessionData.market_condition}</p>
          </div>

          {readyPairs.length > 0 ? (
            <div className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/20">
              <p className="text-sm font-semibold text-emerald-400">
                {readyPairs.length} Setup{readyPairs.length !== 1 ? 's' : ''} Ready (70%+)
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
          {(['scalper', 'micro', 'intraday'] as TradeStyle[]).map((style) => {
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
              Ready to Trade (70%+)
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
                    {heatingCount === 1 ? 'This setup is' : 'These setups are'} building momentum but not yet at 70%+ confidence threshold. Alpha will monitor automatically.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {readyPairs.length === 0 && heatingCount === 0 && (
          <div className={`rounded-lg p-4 border mb-4 ${isForexMarketClosed ? 'bg-slate-800/30 border-slate-600/30' : 'bg-blue-900/20 border-blue-500/30'}`}>
            <div className="flex items-start gap-3">
              {isForexMarketClosed
                ? <Bitcoin className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                : <Clock className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              }
              <div>
                <p className={`text-sm font-semibold mb-1 ${isForexMarketClosed ? 'text-slate-300' : 'text-blue-300'}`}>
                  {isForexMarketClosed ? 'Scanning Crypto Only' : 'Scanning All Timeframes'}
                </p>
                <p className={`text-sm ${isForexMarketClosed ? 'text-slate-400' : 'text-blue-200/80'}`}>
                  {isForexMarketClosed
                    ? 'Forex and Index markets are closed for the weekend. Only BTCUSD and ETHUSD are available.'
                    : 'Analyzing Scalp (M5), Micro (M15) and Intraday (H1) for setups with 70%+ indicator alignment.'}
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
