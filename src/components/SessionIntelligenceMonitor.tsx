// ─────────────────────────────────────────────────────────────────────────────
// SessionIntelligenceMonitor
//
// SSOT Authority: sole UI owner of the Real-Time Intelligence panel.
// Responsibility: display Signal Readiness (pre_screen_results) and
//                 session quality context to the user.
//
// CCIP Governance:
//   - The old "Scan Now / Ready to Trade" alpha-preview-scanner pipeline has
//     been removed from this component. That pipeline (alpha-preview-scanner +
//     platform-scan-manager) remains in the service layer for potential future
//     use but is no longer consumed here.
//   - Signal Readiness is now the primary and only content. It is powered
//     exclusively by pre_screen_results (written by the server-side
//     pre-screen-structure-monitor Netlify function every 5 minutes).
//   - Style tabs (Scalp / Micro / Intraday) now control which style group is
//     displayed inside Signal Readiness, replacing the old scan-result filter.
//   - No database schema changes are required — pre_screen_results and
//     structural_alerts are unchanged.
//   - This refactor is SSOT-compliant: one UI owner, one data source per
//     concern, no duplicated logic.
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
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { calculateSessionContext, getForexMarketStatus, isCryptoSymbol } from '@/utils/marketHours';
import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PreScreenRow {
  id: string;
  symbol: string;
  style: string;
  controlling_timeframe: string;
  alignment_status: 'ALIGNED' | 'RULE1_ONLY' | 'RULE2_ONLY' | 'BOTH_RULES_MET' | 'BLOCKED';
  direction_bias: 'BUY' | 'SELL' | 'NEUTRAL';
  rule1_met: boolean;
  rule2_met: boolean;
  rule1_detail: string;
  rule2_detail: string;
  last_checked_at: string;
  signals_firing: string[];
  bull_signals: string[];
  bear_signals: string[];
  readiness_score: number;
  readiness_tier: 'GREEN' | 'YELLOW' | 'RED';
  signal_count: number;
  dominant_signal: string;
  signal_summary: string;
  market_phase?: string;
  load_bearing_signals?: string[];
  phase_min_signals?: number;
  phase_confidence_band_min?: number;
  phase_confidence_band_max?: number;
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

type SignalTab = 'all' | 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
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

// ─── Style tab config (Scalp / Micro / Intraday) ─────────────────────────────
// Maps pre_screen_results.style values to display config.
// SSOT: this is the canonical tab → style mapping for Signal Readiness.

interface StyleTabConfig {
  key: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
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

// ─── Signal display ───────────────────────────────────────────────────────────

const SIGNAL_LABEL_MAP: Record<string, string> = {
  BOS: 'BOS',
  LIQUIDITY_SWEEP: 'Sweep',
  CHOCH: 'ChoCH',
  FVG: 'FVG',
  PIN_BAR: 'Pin Bar',
  ENGULFING: 'Engulf',
  EMA_STACK: 'EMA Stack',
  MOMENTUM_DIV: 'Mom. Div',
  ATR_EXPANSION: 'ATR Exp',
  ORDER_BLOCK: 'OB',
};

function getTierConfig(tier: 'GREEN' | 'YELLOW' | 'RED') {
  switch (tier) {
    case 'GREEN':
      return {
        dot: 'bg-green-400',
        dotGlow: 'shadow-green-400/60',
        rowBg: 'bg-green-500/8 border-green-500/20',
        scoreBg: 'bg-green-500/20 border-green-500/40',
        scoreText: 'text-green-300',
        pillBg: 'bg-green-500/15 border-green-500/30 text-green-300',
        label: 'READY',
        labelColor: 'text-green-400',
        summaryText: 'text-green-300',
      };
    case 'YELLOW':
      return {
        dot: 'bg-yellow-400',
        dotGlow: 'shadow-yellow-400/60',
        rowBg: 'bg-yellow-500/6 border-yellow-500/15',
        scoreBg: 'bg-yellow-500/20 border-yellow-500/40',
        scoreText: 'text-yellow-300',
        pillBg: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300',
        label: 'DEVELOPING',
        labelColor: 'text-yellow-400',
        summaryText: 'text-yellow-300/80',
      };
    case 'RED':
    default:
      return {
        dot: 'bg-slate-600',
        dotGlow: '',
        rowBg: 'bg-slate-800/20 border-slate-700/20',
        scoreBg: 'bg-slate-700/30 border-slate-600/30',
        scoreText: 'text-slate-500',
        pillBg: 'bg-slate-700/30 border-slate-600/20 text-slate-500',
        label: 'WEAK',
        labelColor: 'text-slate-500',
        summaryText: 'text-slate-500',
      };
  }
}

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

// ─── Phase badge config ───────────────────────────────────────────────────────

const PHASE_BADGE_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  ACCUMULATION:  { bg: 'bg-sky-500/15',    text: 'text-sky-300',    border: 'border-sky-500/30',    label: 'ACCUM' },
  EXPANSION:     { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30', label: 'EXPAN' },
  DISTRIBUTION:  { bg: 'bg-orange-500/15', text: 'text-orange-300', border: 'border-orange-500/30', label: 'DIST' },
  RETRACEMENT:   { bg: 'bg-amber-500/15',  text: 'text-amber-300',  border: 'border-amber-500/30',  label: 'RETRACE' },
  REVERSAL:      { bg: 'bg-rose-500/15',   text: 'text-rose-300',   border: 'border-rose-500/30',   label: 'REVERSAL' },
  UNKNOWN:       { bg: 'bg-slate-700/30',  text: 'text-slate-500',  border: 'border-slate-600/30',  label: '?' },
};

function getPhaseBadge(phase: string | undefined) {
  if (!phase || phase === 'UNKNOWN' || !PHASE_BADGE_CONFIG[phase]) return null;
  return PHASE_BADGE_CONFIG[phase];
}

// ─── Signal Readiness rows renderer ─────────────────────────────────────────

function renderSignalRow(row: PreScreenRow) {
  const tier = (row.readiness_tier ?? 'RED') as 'GREEN' | 'YELLOW' | 'RED';
  const cfg = getTierConfig(tier);
  const signals = Array.isArray(row.signals_firing) ? row.signals_firing : [];
  const loadBearing = Array.isArray(row.load_bearing_signals) ? row.load_bearing_signals : [];
  const isBuy = row.direction_bias === 'BUY';
  const isSell = row.direction_bias === 'SELL';
  const score = row.readiness_score ?? 0;
  const isWeak = tier === 'RED';
  const phaseBadge = getPhaseBadge(row.market_phase);
  const hasPhaseContext = phaseBadge !== null && row.phase_confidence_band_min !== undefined;

  return (
    <div
      key={row.id}
      className={`rounded-lg border transition-all duration-200 ${cfg.rowBg} ${isWeak ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${tier !== 'RED' ? `shadow-sm ${cfg.dotGlow}` : ''}`} />
        <span className="text-[12px] font-bold text-white w-16 flex-shrink-0">{row.symbol}</span>
        <div className={`flex-shrink-0 flex items-center justify-center w-9 h-6 rounded border text-[11px] font-bold tabular-nums ${cfg.scoreBg} ${cfg.scoreText}`}>
          {score}
        </div>
        {(isBuy || isSell) ? (
          <span className={`flex items-center gap-0.5 text-[10px] font-bold flex-shrink-0 ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
            {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {row.direction_bias}
          </span>
        ) : (
          <span className="text-[10px] text-slate-600 flex-shrink-0">—</span>
        )}
        {phaseBadge && (
          <span
            className={`inline-block px-1.5 py-px rounded text-[9px] font-bold border flex-shrink-0 ${phaseBadge.bg} ${phaseBadge.text} ${phaseBadge.border}`}
            title={`Phase: ${row.market_phase} | Needs ${row.phase_min_signals ?? 3}/7 | Band: ${row.phase_confidence_band_min ?? 50}-${row.phase_confidence_band_max ?? 65}%`}
          >
            {phaseBadge.label}
          </span>
        )}
        {hasPhaseContext && !isWeak && (
          <span className="text-[9px] text-slate-500 flex-shrink-0 tabular-nums">
            {row.phase_confidence_band_min}-{row.phase_confidence_band_max}%
          </span>
        )}
        <span className={`text-[9px] font-bold ml-auto flex-shrink-0 ${cfg.labelColor}`}>{cfg.label}</span>
      </div>

      {signals.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {signals.slice(0, 6).map((sig) => {
            const isLB = loadBearing.includes(sig);
            return (
              <span
                key={sig}
                className={`inline-block px-1.5 py-px rounded text-[9px] font-semibold border transition-all ${
                  isLB
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 shadow-sm shadow-amber-500/20'
                    : cfg.pillBg
                }`}
                title={isLB ? 'Load-bearing signal for this phase' : undefined}
              >
                {SIGNAL_LABEL_MAP[sig] ?? sig}
                {isLB && <span className="ml-0.5 opacity-70">*</span>}
              </span>
            );
          })}
          {signals.length > 6 && (
            <span className="inline-block px-1.5 py-px rounded text-[9px] text-slate-500 border border-slate-700/30">
              +{signals.length - 6}
            </span>
          )}
          {loadBearing.length > 0 && (
            <span className="inline-block px-1.5 py-px text-[9px] text-amber-500/60 ml-0.5">
              * key signal
            </span>
          )}
        </div>
      )}

      {row.signal_summary && !isWeak && (
        <p className={`px-3 pb-2 text-[10px] leading-snug ${cfg.summaryText}`}>
          {row.signal_summary}
        </p>
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
  const [preScreenRows, setPreScreenRows] = useState<PreScreenRow[]>([]);
  const [preScreenLastChecked, setPreScreenLastChecked] = useState<string>('');
  const [structuralAlerts, setStructuralAlerts] = useState<StructuralAlertRow[]>([]);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [isForexMarketClosed, setIsForexMarketClosed] = useState(
    () => !getForexMarketStatus().isOpen
  );

  // Market hours check (updates every minute)
  useEffect(() => {
    const interval = setInterval(() => {
      setIsForexMarketClosed(!getForexMarketStatus().isOpen);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Pre-screen results subscription (SSOT: pre_screen_results table)
  useEffect(() => {
    supabase
      .from('pre_screen_results')
      .select('*')
      .order('last_checked_at', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setPreScreenRows(data as PreScreenRow[]);
          const latest = data[0].last_checked_at;
          const mins = Math.round((Date.now() - new Date(latest).getTime()) / 60000);
          setPreScreenLastChecked(mins <= 1 ? 'just now' : `${mins}m ago`);
        }
      });

    const channel = supabase
      .channel('pre_screen_results_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pre_screen_results' }, (payload) => {
        if (payload.new) {
          setPreScreenRows((prev) => {
            const updated = payload.new as PreScreenRow;
            const idx = prev.findIndex(
              (r) => r.symbol === updated.symbol && r.style === updated.style && r.controlling_timeframe === updated.controlling_timeframe
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updated;
              return next;
            }
            return [updated, ...prev];
          });
          const mins = Math.round((Date.now() - new Date((payload.new as PreScreenRow).last_checked_at).getTime()) / 60000);
          setPreScreenLastChecked(mins <= 1 ? 'just now' : `${mins}m ago`);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Structural alerts subscription (session-scoped)
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

  // Derive per-style counts for tab badges
  const visibleRows = isForexMarketClosed
    ? preScreenRows.filter((r) => isCryptoSymbol(r.symbol))
    : preScreenRows;

  const getTabCounts = () => {
    const counts: Record<string, number> = { SCALP: 0, MICRO_INTRADAY: 0, INTRADAY: 0 };
    for (const row of visibleRows) {
      if (row.readiness_tier === 'GREEN' || row.readiness_tier === 'YELLOW') {
        if (counts[row.style] !== undefined) counts[row.style]++;
      }
    }
    return counts;
  };

  const tabCounts = getTabCounts();
  const totalGreen = visibleRows.filter((r) => r.readiness_tier === 'GREEN').length;
  const totalYellow = visibleRows.filter((r) => r.readiness_tier === 'YELLOW').length;
  const totalSignals = visibleRows.reduce((sum, r) => sum + (r.signal_count ?? 0), 0);

  // Rows to display based on active tab
  const getVisibleStyleGroups = (): StyleTabConfig[] => {
    if (activeTab === 'all') return STYLE_TAB_CONFIG;
    return STYLE_TAB_CONFIG.filter((s) => s.key === activeTab);
  };

  const visibleGroups = getVisibleStyleGroups();

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-slate-900/50 to-blue-900/40 rounded-xl p-5 border border-blue-500/50">

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Signal Readiness</h3>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <p className="text-sm text-blue-300">
                  {totalSignals > 0 ? `${totalSignals} signals` : '10 signals'} · 5-min refresh
                </p>
                {preScreenLastChecked && (
                  <span className="text-[11px] text-blue-400/60">· {preScreenLastChecked}</span>
                )}
              </div>
            </div>
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {totalGreen > 0 && (
              <span className="text-[10px] font-bold text-green-400 bg-green-500/15 border border-green-500/30 px-2 py-0.5 rounded-full">
                {totalGreen} ready
              </span>
            )}
            {totalYellow > 0 && (
              <span className="text-[10px] font-bold text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                {totalYellow} developing
              </span>
            )}
          </div>
        </div>

        {/* Session / Market context banner */}
        {isForexMarketClosed ? <MarketClosedBanner /> : <SessionQualityBanner />}

        {/* Style tabs — Scalp / Micro / Intraday */}
        {visibleRows.length > 0 && (
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
        )}

        {/* Signal Readiness content */}
        {visibleRows.length > 0 ? (
          <div className="space-y-4">
            {visibleGroups.map(({ key, label, tf, headerColor }) => {
              const styleRows = visibleRows
                .filter((r) => r.style === key)
                .sort((a, b) => (b.readiness_score ?? 0) - (a.readiness_score ?? 0));

              if (styleRows.length === 0) return null;

              const bestScore = styleRows[0]?.readiness_score ?? 0;

              return (
                <div key={key}>
                  {/* Style group header — only shown when "All" tab is active */}
                  {activeTab === 'all' && (
                    <div className="flex items-center gap-2 mb-2 mt-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${headerColor}`}>{label}</span>
                      <span className="text-[10px] text-slate-600 font-mono">{tf}</span>
                      {bestScore >= 65 && (
                        <span className="text-[9px] font-bold text-green-400 bg-green-500/15 border border-green-500/25 px-1.5 py-px rounded-full ml-auto">
                          Active Signals
                        </span>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {styleRows.map((row) => renderSignalRow(row))}
                  </div>
                </div>
              );
            })}

            <div className="pt-2 border-t border-slate-700/30 space-y-1">
              <p className="text-[10px] text-slate-600">
                Score = phase-weighted confluence of 10 signals. Thresholds adjust by market phase (CCIP-2026-0325C).
              </p>
              <p className="text-[10px] text-slate-600">
                Green &ge;60-65 · Yellow &ge;30-35 · Red below threshold. Phase badge = market context. * = load-bearing signal.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg p-5 border border-blue-500/20 bg-blue-900/10 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-blue-500/15 rounded-full">
                <ShieldCheck className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-200 mb-1">
                  Awaiting signal data
                </p>
                <p className="text-xs text-blue-300/70 max-w-xs mx-auto">
                  Signal Readiness updates every 5 minutes. Data will appear shortly.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Session Structural Alerts (session-scoped, collapsible) */}
        {sessionId && structuralAlerts.length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-900/40 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
              onClick={() => setAlertsExpanded((v) => !v)}
            >
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-orange-400" />
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
                  const alertBg = isBlocked ? 'bg-red-500/8 border-red-500/15' : isQualified ? 'bg-green-500/8 border-green-500/15' : 'bg-slate-700/30 border-slate-600/20';
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
