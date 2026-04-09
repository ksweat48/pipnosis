// ─────────────────────────────────────────────────────────────────────────────
// SessionIntelligenceMonitor
//
// SSOT Authority: sole UI owner of the Market Attention panel.
// Responsibility: display market behavior signals per pair/style and guide
//                 users to scan Alpha when the market is showing activity.
//
// CCIP Governance (2026-04-09 Redesign):
//   - Replaced indicator-based readiness scoring (GREEN/YELLOW/RED) with
//     raw market behavior signal detection (HOT/ACTIVE/QUIET).
//   - Alpha is the SOLE trade decision authority. This panel's job is ONLY
//     to alert users: "Something interesting is happening — go ask Alpha."
//   - Data source: market_behavior_signals table (server-side, every 3 min).
//   - Session quality banner and market closed banner preserved.
//   - Structural alerts section preserved.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  Clock,
  TrendingUp,
  TrendingDown,
  Sun,
  Moon,
  Sunrise,
  Zap,
  Timer,
  Activity,
  MapPin,
  Bitcoin,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flame,
  Radio,
  Minus,
  BarChart2,
  RefreshCw,
  Maximize2,
  Minimize2,
  ArrowRight,
} from 'lucide-react';
import { calculateSessionContext, getForexMarketStatus, isCryptoSymbol } from '@/utils/marketHours';
import { supabase } from '@/lib/supabase';
import type { SignalKey, HeatLevel, TradingStyle } from '@/config/market-behavior-signals';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MarketBehaviorRow {
  id: string;
  symbol: string;
  style: TradingStyle;
  controlling_timeframe: string;
  firing_signals: SignalKey[];
  signal_details: Record<string, { direction: 'BUY' | 'SELL' | 'NEUTRAL'; description: string }>;
  attention_score: number;
  heat_level: HeatLevel;
  direction_lean: 'BUY' | 'SELL' | 'NEUTRAL';
  dominant_behavior: string;
  signal_count: number;
  last_scanned_at: string;
  expires_at: string;
}

interface StructuralAlertRow {
  id: string;
  symbol: string;
  style: string;
  rule_type: string;
  direction: string;
  details_text: string;
  created_at: string;
}

type SignalTab = 'all' | TradingStyle;
type TimeQuality = 'prime' | 'good' | 'slow';

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

// ─── Style tab config ─────────────────────────────────────────────────────────

interface StyleTabConfig {
  key: TradingStyle;
  label: string;
  tf: string;
  headerColor: string;
  badgeBg: string;
  badgeText: string;
  icon: React.ReactNode;
}

const STYLE_TAB_CONFIG: StyleTabConfig[] = [
  {
    key: 'SCALP',
    label: 'Scalp',
    tf: 'M1',
    headerColor: 'text-amber-400',
    badgeBg: 'bg-amber-500/20 border-amber-500/50',
    badgeText: 'text-amber-400',
    icon: <Zap className="w-3.5 h-3.5" />,
  },
  {
    key: 'MICRO_INTRADAY',
    label: 'Micro',
    tf: 'M5',
    headerColor: 'text-cyan-400',
    badgeBg: 'bg-cyan-500/20 border-cyan-500/50',
    badgeText: 'text-cyan-400',
    icon: <Timer className="w-3.5 h-3.5" />,
  },
  {
    key: 'INTRADAY',
    label: 'Intraday',
    tf: 'M15',
    headerColor: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/20 border-emerald-500/50',
    badgeText: 'text-emerald-400',
    icon: <Activity className="w-3.5 h-3.5" />,
  },
];

// ─── Heat level config ────────────────────────────────────────────────────────

function getHeatConfig(heat: HeatLevel) {
  switch (heat) {
    case 'HOT':
      return {
        dot: 'bg-red-400',
        dotGlow: 'shadow-red-400/70',
        rowBg: 'bg-red-500/8 border-red-500/25',
        scoreBg: 'bg-red-500/20 border-red-500/40',
        scoreText: 'text-red-300',
        pillBg: 'bg-red-500/15 border-red-500/25 text-red-300',
        label: 'HOT',
        labelColor: 'text-red-400',
        labelBg: 'bg-red-500/15 border-red-500/30',
        summaryText: 'text-red-300/90',
        scanBtnBg: 'bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30',
        opacity: '',
      };
    case 'ACTIVE':
      return {
        dot: 'bg-amber-400',
        dotGlow: 'shadow-amber-400/60',
        rowBg: 'bg-amber-500/6 border-amber-500/20',
        scoreBg: 'bg-amber-500/20 border-amber-500/35',
        scoreText: 'text-amber-300',
        pillBg: 'bg-amber-500/15 border-amber-500/25 text-amber-300',
        label: 'ACTIVE',
        labelColor: 'text-amber-400',
        labelBg: 'bg-amber-500/15 border-amber-500/30',
        summaryText: 'text-amber-300/80',
        scanBtnBg: 'bg-amber-500/20 border-amber-500/35 text-amber-300 hover:bg-amber-500/30',
        opacity: '',
      };
    case 'QUIET':
    default:
      return {
        dot: 'bg-slate-600',
        dotGlow: '',
        rowBg: 'bg-slate-800/20 border-slate-700/15',
        scoreBg: 'bg-slate-700/30 border-slate-600/30',
        scoreText: 'text-slate-500',
        pillBg: 'bg-slate-700/25 border-slate-600/20 text-slate-500',
        label: 'QUIET',
        labelColor: 'text-slate-600',
        labelBg: 'bg-slate-700/30 border-slate-600/20',
        summaryText: 'text-slate-600',
        scanBtnBg: 'bg-slate-700/30 border-slate-600/20 text-slate-500 cursor-default',
        opacity: 'opacity-35',
      };
  }
}

// ─── Signal pill icon mapping ─────────────────────────────────────────────────

const SIGNAL_ICON_MAP: Partial<Record<SignalKey, React.ReactNode>> = {
  LARGE_ENGULFING:     <BarChart2 className="w-2.5 h-2.5" />,
  CONSECUTIVE_TREND:   <TrendingUp className="w-2.5 h-2.5" />,
  STRONG_CLOSE:        <Zap className="w-2.5 h-2.5" />,
  MOMENTUM_SPIKE:      <Flame className="w-2.5 h-2.5" />,
  VELOCITY_CANDLE:     <ArrowRight className="w-2.5 h-2.5" />,
  COMPRESSION_FORMING: <Minimize2 className="w-2.5 h-2.5" />,
  COMPRESSION_BREAK:   <Maximize2 className="w-2.5 h-2.5" />,
  INSIDE_BAR_BREAK:    <Maximize2 className="w-2.5 h-2.5" />,
  CLOSE_ABOVE_20EMA:   <TrendingUp className="w-2.5 h-2.5" />,
  CLOSE_BELOW_20EMA:   <TrendingDown className="w-2.5 h-2.5" />,
  EMA_SLOPE_CHANGE:    <RefreshCw className="w-2.5 h-2.5" />,
  PRICE_EMA_REJECTION: <Minus className="w-2.5 h-2.5" />,
  SWING_BREAK:         <BarChart2 className="w-2.5 h-2.5" />,
  WICK_REJECTION:      <Minus className="w-2.5 h-2.5" />,
  OUTSIDE_BAR:         <Maximize2 className="w-2.5 h-2.5" />,
  ATR_SPIKE:           <Activity className="w-2.5 h-2.5" />,
  RANGE_EXPANSION:     <Maximize2 className="w-2.5 h-2.5" />,
};

const SIGNAL_LABEL_MAP: Record<SignalKey, string> = {
  LARGE_ENGULFING:     'Engulfing',
  CONSECUTIVE_TREND:   'Consec. Trend',
  STRONG_CLOSE:        'Strong Close',
  MOMENTUM_SPIKE:      'Mom. Spike',
  VELOCITY_CANDLE:     'Velocity',
  COMPRESSION_FORMING: 'Compressing',
  COMPRESSION_BREAK:   'Breakout',
  INSIDE_BAR_BREAK:    'IB Break',
  CLOSE_ABOVE_20EMA:   'Close > EMA',
  CLOSE_BELOW_20EMA:   'Close < EMA',
  EMA_SLOPE_CHANGE:    'EMA Turn',
  PRICE_EMA_REJECTION: 'EMA Reject',
  SWING_BREAK:         'Swing Break',
  WICK_REJECTION:      'Wick Reject',
  OUTSIDE_BAR:         'Outside Bar',
  ATR_SPIKE:           'ATR Spike',
  RANGE_EXPANSION:     'Range Exp.',
};

// ─── Session time quality ─────────────────────────────────────────────────────

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

function getQualityColors(quality: TimeQuality) {
  switch (quality) {
    case 'prime':
      return {
        dot: 'bg-green-400', border: 'border-green-500/50', bg: 'bg-green-500/10',
        text: 'text-green-400', badge: 'bg-green-500/20 border-green-500/40',
        badgeText: 'text-green-300', timelineBar: 'bg-green-500/70',
      };
    case 'good':
      return {
        dot: 'bg-yellow-400', border: 'border-yellow-500/50', bg: 'bg-yellow-500/10',
        text: 'text-yellow-400', badge: 'bg-yellow-500/20 border-yellow-500/40',
        badgeText: 'text-yellow-300', timelineBar: 'bg-yellow-500/70',
      };
    case 'slow':
      return {
        dot: 'bg-red-400', border: 'border-red-500/40', bg: 'bg-red-500/8',
        text: 'text-red-400', badge: 'bg-red-500/20 border-red-500/40',
        badgeText: 'text-red-300', timelineBar: 'bg-red-500/50',
      };
  }
}

function computeSessionTimeQuality(): SessionTimeQualityInfo {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const currentUtcMinutes = utcHours * 60 + utcMinutes;

  const zone = TIMELINE_ZONES.find(
    (z) => utcHours >= z.startUtc && utcHours < z.endUtc
  ) ?? TIMELINE_ZONES[0];

  const windowEndUtcMinutes = zone.endUtc * 60;

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
    prime: 'Prime Time', good: 'Good Window', slow: 'Slow Period',
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
      <p className={`text-[11px] leading-relaxed ${colors.text}`}>{info.description}</p>
      <SessionTimeline currentUtcMinutes={info.currentUtcMinutes} />
    </div>
  );
};

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
    if (totalMins < sundayOpenMins) return sundayOpenMins - totalMins;
    return 0;
  }
  if (day === 5) {
    const fridayCloseMins = 17 * 60;
    if (totalMins >= fridayCloseMins) {
      const minsUntilSatMidnight = (24 * 60) - totalMins;
      return minsUntilSatMidnight + 24 * 60 + sundayOpenMins;
    }
  }
  return 0;
}

const MarketClosedBanner: React.FC = () => {
  const [minsToReopen, setMinsToReopen] = useState(computeMinutesToForexReopen);

  useEffect(() => {
    const interval = setInterval(() => setMinsToReopen(computeMinutesToForexReopen()), 30000);
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

// ─── Behavior card row ────────────────────────────────────────────────────────

function BehaviorRow({ row }: { row: MarketBehaviorRow }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getHeatConfig(row.heat_level);
  const isBuy = row.direction_lean === 'BUY';
  const isSell = row.direction_lean === 'SELL';
  const isHot = row.heat_level === 'HOT';
  const isActive = row.heat_level === 'ACTIVE';
  const isQuiet = row.heat_level === 'QUIET';
  const signals = row.firing_signals ?? [];
  const stale = new Date() > new Date(row.expires_at);

  const ageLabel = (() => {
    const mins = Math.round((Date.now() - new Date(row.last_scanned_at).getTime()) / 60000);
    if (mins <= 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  })();

  return (
    <div
      className={`rounded-xl border transition-all duration-200 ${cfg.rowBg} ${cfg.opacity} ${stale ? 'opacity-50' : ''}`}
    >
      {/* Main row */}
      <div
        className={`flex items-center gap-2.5 px-3 py-2.5 ${!isQuiet ? 'cursor-pointer' : ''}`}
        onClick={() => !isQuiet && setExpanded(v => !v)}
      >
        {/* Heat dot */}
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${
            isHot ? `shadow-sm ${cfg.dotGlow} animate-pulse` : isActive ? `shadow-sm ${cfg.dotGlow}` : ''
          }`}
        />

        {/* Symbol */}
        <span className="text-[12px] font-bold text-white w-16 flex-shrink-0">{row.symbol}</span>

        {/* Attention score */}
        <div
          className={`flex-shrink-0 flex items-center justify-center w-9 h-6 rounded border text-[11px] font-bold tabular-nums ${cfg.scoreBg} ${cfg.scoreText}`}
          title={`Attention score: ${row.attention_score}`}
        >
          {row.attention_score}
        </div>

        {/* Direction lean */}
        {(isBuy || isSell) ? (
          <span className={`flex items-center gap-0.5 text-[10px] font-bold flex-shrink-0 ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {row.direction_lean}
          </span>
        ) : (
          <span className="text-[10px] text-slate-600 flex-shrink-0">—</span>
        )}

        {/* Signal count pill */}
        {signals.length > 0 && (
          <span className={`text-[9px] font-semibold px-1.5 py-px rounded border flex-shrink-0 ${cfg.pillBg}`}>
            {signals.length} signal{signals.length !== 1 ? 's' : ''}
          </span>
        )}

        {/* Heat badge */}
        <span
          className={`ml-auto text-[9px] font-bold px-1.5 py-px rounded border flex-shrink-0 ${cfg.labelBg} ${cfg.labelColor}`}
        >
          {cfg.label}
        </span>

        {/* Expand chevron */}
        {!isQuiet && signals.length > 0 && (
          <span className="text-slate-600 flex-shrink-0">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        )}
      </div>

      {/* Dominant behavior line */}
      {!isQuiet && row.dominant_behavior && row.dominant_behavior !== 'No signals detected' && (
        <div className={`px-3 pb-1.5 text-[10px] leading-snug ${cfg.summaryText}`}>
          {row.dominant_behavior}
        </div>
      )}

      {/* Signal pills */}
      {!isQuiet && signals.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {signals.slice(0, 6).map((sig) => {
            const detail = row.signal_details?.[sig];
            const dirColor = detail?.direction === 'BUY'
              ? 'text-emerald-400'
              : detail?.direction === 'SELL'
              ? 'text-rose-400'
              : '';
            return (
              <span
                key={sig}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-semibold transition-all ${cfg.pillBg} ${dirColor || ''}`}
                title={detail?.description}
              >
                {SIGNAL_ICON_MAP[sig]}
                {SIGNAL_LABEL_MAP[sig] ?? sig}
              </span>
            );
          })}
          {signals.length > 6 && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] text-slate-500 border border-slate-700/30">
              +{signals.length - 6}
            </span>
          )}
        </div>
      )}

      {/* Expanded signal detail */}
      {expanded && signals.length > 0 && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-slate-700/20 pt-2 mt-0.5">
          {signals.map((sig) => {
            const detail = row.signal_details?.[sig];
            if (!detail) return null;
            const dirBadge = detail.direction === 'BUY'
              ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
              : detail.direction === 'SELL'
              ? 'bg-rose-500/15 border-rose-500/25 text-rose-400'
              : 'bg-slate-700/30 border-slate-600/20 text-slate-500';
            return (
              <div key={sig} className="flex items-start gap-2">
                <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded border text-[8px] font-bold flex-shrink-0 mt-px ${dirBadge}`}>
                  {detail.direction !== 'NEUTRAL' && (detail.direction === 'BUY'
                    ? <TrendingUp className="w-2 h-2" />
                    : <TrendingDown className="w-2 h-2" />
                  )}
                  {SIGNAL_LABEL_MAP[sig] ?? sig}
                </span>
                <span className="text-[10px] text-slate-400 leading-snug">{detail.description}</span>
              </div>
            );
          })}
          <div className="text-[9px] text-slate-600 pt-0.5">Scanned {ageLabel}</div>
        </div>
      )}

      {/* Scan Alpha CTA — HOT and ACTIVE only */}
      {isHot && (
        <div className="px-3 pb-3 pt-0.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25">
            <Flame className="w-3 h-3 text-red-400 flex-shrink-0" />
            <span className="text-[10px] text-red-300 font-semibold">
              Market is showing strong activity — scan Alpha for a trade opportunity
            </span>
          </div>
        </div>
      )}
      {isActive && (
        <div className="px-3 pb-3 pt-0.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/8 border border-amber-500/20">
            <Radio className="w-3 h-3 text-amber-400 flex-shrink-0" />
            <span className="text-[10px] text-amber-300/80 font-medium">
              Behaviors developing — worth watching, consider scanning Alpha
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface SessionIntelligenceMonitorProps {
  sessionId?: string;
  userId?: string;
}

export const SessionIntelligenceMonitor: React.FC<SessionIntelligenceMonitorProps> = ({
  sessionId,
  userId: _userId,
}) => {
  const [activeTab, setActiveTab] = useState<SignalTab>('all');
  const [behaviorRows, setBehaviorRows] = useState<MarketBehaviorRow[]>([]);
  const [lastScanned, setLastScanned] = useState<string>('');
  const [structuralAlerts, setStructuralAlerts] = useState<StructuralAlertRow[]>([]);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [isForexMarketClosed, setIsForexMarketClosed] = useState(
    () => !getForexMarketStatus().isOpen
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setIsForexMarketClosed(!getForexMarketStatus().isOpen);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // market_behavior_signals subscription
  useEffect(() => {
    supabase
      .from('market_behavior_signals')
      .select('*')
      .order('attention_score', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setBehaviorRows(data as MarketBehaviorRow[]);
          const latest = data.reduce((a: MarketBehaviorRow, b: MarketBehaviorRow) =>
            new Date(b.last_scanned_at) > new Date(a.last_scanned_at) ? b : a
          );
          const mins = Math.round((Date.now() - new Date(latest.last_scanned_at).getTime()) / 60000);
          setLastScanned(mins <= 1 ? 'just now' : `${mins}m ago`);
        }
      });

    const channel = supabase
      .channel('market_behavior_signals_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_behavior_signals' }, (payload) => {
        if (payload.new) {
          const updated = payload.new as MarketBehaviorRow;
          setBehaviorRows((prev) => {
            const idx = prev.findIndex(r => r.symbol === updated.symbol && r.style === updated.style);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updated;
              return next.sort((a, b) => b.attention_score - a.attention_score);
            }
            return [updated, ...prev].sort((a, b) => b.attention_score - a.attention_score);
          });
          const mins = Math.round((Date.now() - new Date(updated.last_scanned_at).getTime()) / 60000);
          setLastScanned(mins <= 1 ? 'just now' : `${mins}m ago`);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Structural alerts (session-scoped)
  useEffect(() => {
    if (!sessionId) return;

    supabase
      .from('structural_alerts')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setStructuralAlerts(data as StructuralAlertRow[]);
      });

    const channel = supabase
      .channel(`structural_alerts_${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'structural_alerts',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        if (payload.new) {
          setStructuralAlerts((prev) => [payload.new as StructuralAlertRow, ...prev].slice(0, 20));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  // Filter by market hours
  const visibleRows = isForexMarketClosed
    ? behaviorRows.filter(r => isCryptoSymbol(r.symbol))
    : behaviorRows;

  // Filter by active tab
  const filteredRows = activeTab === 'all'
    ? visibleRows
    : visibleRows.filter(r => r.style === activeTab);

  // Tab counts — HOT + ACTIVE
  const getTabCounts = () => {
    const counts: Record<string, number> = { SCALP: 0, MICRO_INTRADAY: 0, INTRADAY: 0 };
    for (const row of visibleRows) {
      if (row.heat_level === 'HOT' || row.heat_level === 'ACTIVE') {
        if (counts[row.style] !== undefined) counts[row.style]++;
      }
    }
    return counts;
  };
  const tabCounts = getTabCounts();
  const totalHot = visibleRows.filter(r => r.heat_level === 'HOT').length;
  const totalActive = visibleRows.filter(r => r.heat_level === 'ACTIVE').length;

  // Group rows by style for "all" tab
  const getGroupedRows = (): Array<{ config: StyleTabConfig; rows: MarketBehaviorRow[] }> => {
    return STYLE_TAB_CONFIG.map(cfg => ({
      config: cfg,
      rows: filteredRows
        .filter(r => r.style === cfg.key)
        .sort((a, b) => b.attention_score - a.attention_score),
    }));
  };

  const grouped = getGroupedRows();
  const hasAnyData = filteredRows.length > 0;

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-slate-900/50 to-blue-900/40 rounded-xl p-5 border border-blue-500/50">

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Radio className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Market Attention</h3>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <p className="text-sm text-blue-300">Candle behavior · 3-min scan</p>
                {lastScanned && (
                  <span className="text-[11px] text-blue-400/60">· {lastScanned}</span>
                )}
              </div>
            </div>
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {totalHot > 0 && (
              <span className="text-[10px] font-bold text-red-400 bg-red-500/15 border border-red-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Flame className="w-2.5 h-2.5" />
                {totalHot} hot
              </span>
            )}
            {totalActive > 0 && (
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                {totalActive} active
              </span>
            )}
          </div>
        </div>

        {/* Context banner */}
        {isForexMarketClosed ? <MarketClosedBanner /> : <SessionQualityBanner />}

        {/* Style tabs */}
        <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-0.5">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0 ${
              activeTab === 'all'
                ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300'
            }`}
          >
            All
          </button>

          {STYLE_TAB_CONFIG.map((cfg) => {
            const count = tabCounts[cfg.key] ?? 0;
            const isActive = activeTab === cfg.key;
            return (
              <button
                key={cfg.key}
                onClick={() => setActiveTab(cfg.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0 ${
                  isActive
                    ? `${cfg.badgeBg} ${cfg.badgeText}`
                    : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300'
                }`}
              >
                {cfg.icon}
                {cfg.label}
                {count > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0 rounded-full text-[10px] ${
                      isActive ? cfg.badgeText : 'text-gray-500'
                    } ${isActive ? 'bg-white/10' : 'bg-gray-700/50'}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Signal cards */}
        {hasAnyData ? (
          <div className="space-y-4">
            {activeTab === 'all' ? (
              grouped.map(({ config, rows }) => {
                // In "all" tab, only show groups with HOT or ACTIVE pairs
                const notableRows = rows.filter(r => r.heat_level !== 'QUIET');
                if (notableRows.length === 0) return null;

                return (
                  <div key={config.key}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${config.headerColor}`}>
                        {config.label}
                      </span>
                      <span className="text-[10px] text-slate-600 font-mono">{config.tf}</span>
                      <div className="flex-1 h-px bg-slate-700/30" />
                    </div>
                    <div className="space-y-2">
                      {notableRows.map(row => (
                        <BehaviorRow key={`${row.symbol}-${row.style}`} row={row} />
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              // Single style tab — show all rows sorted by score
              <div className="space-y-2">
                {filteredRows
                  .filter(r => r.style === activeTab)
                  .sort((a, b) => b.attention_score - a.attention_score)
                  .map(row => (
                    <BehaviorRow key={`${row.symbol}-${row.style}`} row={row} />
                  ))}
              </div>
            )}

            {/* Footer note */}
            <div className="pt-2 border-t border-slate-700/30">
              <p className="text-[10px] text-slate-600">
                HOT = strong market behavior detected. Scan Alpha when a pair is hot — Alpha makes all trade decisions.
                Score reflects candle energy, not trade quality.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg p-5 border border-blue-500/20 bg-blue-900/10 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-blue-500/15 rounded-full">
                <Radio className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-200 mb-1">
                  {activeTab === 'all' ? 'Markets are quiet right now' : 'No active signals for this style'}
                </p>
                <p className="text-xs text-blue-300/70 max-w-xs mx-auto">
                  Market behavior data updates every 3 minutes. HOT and ACTIVE pairs will appear here when candle behaviors are detected.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Session Structural Alerts */}
        {sessionId && structuralAlerts.length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-900/40 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
              onClick={() => setAlertsExpanded(v => !v)}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold text-white">Session Structural Alerts</span>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/30 text-[10px] font-bold text-orange-400 ml-1">
                  {structuralAlerts.length}
                </span>
              </div>
              {alertsExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>

            {alertsExpanded && (
              <div className="px-4 pb-4 space-y-2">
                {structuralAlerts.map((alert) => {
                  const isBlocked = alert.rule_type.includes('BLOCKED') || alert.rule_type.includes('MISSING');
                  const isQualified = alert.rule_type.includes('BOS') || alert.rule_type.includes('SWEEP');
                  const alertBg = isBlocked
                    ? 'bg-red-500/8 border-red-500/15'
                    : isQualified
                    ? 'bg-green-500/8 border-green-500/15'
                    : 'bg-slate-700/30 border-slate-600/20';
                  const alertIcon = isBlocked
                    ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    : isQualified
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    : <Activity className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />;
                  const mins = Math.round((Date.now() - new Date(alert.created_at).getTime()) / 60000);
                  const timeLabel = mins <= 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
                  return (
                    <div key={alert.id} className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg border ${alertBg}`}>
                      {alertIcon}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold text-white">{alert.symbol}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{alert.style}</span>
                          <span className={`text-[10px] font-semibold ${isBlocked ? 'text-red-400' : isQualified ? 'text-green-400' : 'text-slate-400'}`}>
                            {alert.rule_type.replace(/_/g, ' ')}
                          </span>
                          {alert.direction && alert.direction !== 'NEUTRAL' && (
                            <span className={`text-[10px] font-bold ${alert.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                              {alert.direction}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-snug line-clamp-2">{alert.details_text}</p>
                      </div>
                      <span className="text-[9px] text-slate-600 flex-shrink-0 mt-0.5">{timeLabel}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
