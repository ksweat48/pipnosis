// ─────────────────────────────────────────────────────────────────────────────
// SessionIntelligenceMonitor — Alpha Hunt Readiness Monitor
//
// SSOT Authority: sole UI owner of the Hunt Readiness panel.
//
// GOVERNANCE (CCIP-2026-0421-HUNT-READINESS):
//   Completely replaced the market-behavior candle signal system with
//   Alpha's own hunting preconditions. The monitor now answers ONE question:
//   "If I scan right now, will Alpha likely execute a trade on this pair?"
//
//   Data source: alpha_hunt_readiness table (server-side, every 3 min).
//   Alpha is the SOLE trade decision authority. This panel predicts likelihood
//   of execution based on Alpha's four structural hunting preconditions.
//
//   Hunt states:
//     live      — all 5 preconditions confirmed incl. fired trigger + quality ≥ 60
//     ready     — PC1–PC3 + PC5 confirmed, trigger developing
//     not_ready — any PC failed (incl. quality gate) — do not show to user
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  Clock,
  TrendingUp,
  TrendingDown,
  Zap,
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Target,
  Radio,
  Crosshair,
  Eye,
  Minus,
  Sun,
  Moon,
  Sunrise,
} from 'lucide-react';
import { calculateSessionContext, getForexMarketStatus, isCryptoSymbol } from '@/utils/marketHours';
import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

type TradingStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
type HuntState = 'live' | 'ready' | 'not_ready';
type PhaseLabel = 'ACCUMULATION' | 'EXPANSION' | 'DISTRIBUTION' | 'RETRACEMENT' | 'REVERSAL' | 'UNCLEAR';
type DirectionLean = 'BUY' | 'SELL' | 'NEUTRAL';
type TriggerState = 'fired' | 'developing' | 'none';

interface HuntReadinessRow {
  id: string;
  symbol: string;
  style: TradingStyle;
  session: string;
  hunt_state: HuntState;
  phase_detected: PhaseLabel;
  phase_evidence: string;
  preconditions_met: string[];
  structural_room_pips: number;
  structural_room_direction: DirectionLean;
  trigger_state: TriggerState;
  trigger_evidence: string;
  direction_lean: DirectionLean;
  quality_score: number;
  hunt_summary: string;
  last_scanned_at: string;
  expires_at: string;
  session_minutes_remaining: number | null;
  estimated_feasible_pips: number | null;
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

type StyleTab = 'all' | TradingStyle;

interface StyleTabConfig {
  key: TradingStyle;
  label: string;
  tf: string;
  primaryColor: string;
  headerColor: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STYLE_TAB_CONFIG: StyleTabConfig[] = [
  {
    key: 'SCALP',
    label: 'Scalp',
    tf: 'M1',
    primaryColor: 'text-sky-400',
    headerColor: 'text-sky-400',
    badgeBg: 'bg-sky-500/15 border-sky-500/40',
    badgeText: 'text-sky-300',
    badgeBorder: 'border-sky-500/40',
  },
  {
    key: 'MICRO_INTRADAY',
    label: 'Micro',
    tf: 'M5',
    primaryColor: 'text-amber-400',
    headerColor: 'text-amber-400',
    badgeBg: 'bg-amber-500/15 border-amber-500/40',
    badgeText: 'text-amber-300',
    badgeBorder: 'border-amber-500/40',
  },
  {
    key: 'INTRADAY',
    label: 'Intraday',
    tf: 'M15',
    primaryColor: 'text-emerald-400',
    headerColor: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/15 border-emerald-500/40',
    badgeText: 'text-emerald-300',
    badgeBorder: 'border-emerald-500/40',
  },
];

const PHASE_CONFIG: Record<PhaseLabel, { label: string; color: string; bg: string; description: string }> = {
  ACCUMULATION: {
    label: 'Accumulation',
    color: 'text-cyan-300',
    bg: 'bg-cyan-500/10 border-cyan-500/25',
    description: 'Range-bound — boundary fade, sweep-reclaim, or compression breakout hunt',
  },
  EXPANSION: {
    label: 'Expansion',
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/10 border-emerald-500/25',
    description: 'Trending — continuation, pullback entry, or momentum breakout hunt',
  },
  DISTRIBUTION: {
    label: 'Distribution',
    color: 'text-orange-300',
    bg: 'bg-orange-500/10 border-orange-500/25',
    description: 'Weakening — reversal entry or range extreme fade hunt',
  },
  RETRACEMENT: {
    label: 'Retracement',
    color: 'text-blue-300',
    bg: 'bg-blue-500/10 border-blue-500/25',
    description: 'Pulling back into structure — wait_pullback continuation hunt',
  },
  REVERSAL: {
    label: 'Reversal',
    color: 'text-rose-300',
    bg: 'bg-rose-500/10 border-rose-500/25',
    description: 'Counter-structure forming — reversal entry or structure retest hunt',
  },
  UNCLEAR: {
    label: 'Unclear',
    color: 'text-slate-400',
    bg: 'bg-slate-700/20 border-slate-600/20',
    description: 'Phase unreadable',
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins <= 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function PreconditionBadge({ code, met }: { code: string; met: boolean }) {
  const labels: Record<string, string> = {
    PC1_PHASE_READABLE: 'Phase',
    PC2_SETUP_MATERIAL: 'Setup',
    PC3_STRUCTURAL_ROOM: 'Room',
    PC4_TRIGGER: 'Trigger',
    PC5_QUALITY: 'Quality',
  };
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-bold border ${
      met
        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
        : 'bg-slate-700/30 border-slate-600/20 text-slate-600'
    }`}>
      {met ? '✓' : '·'} {labels[code] ?? code}
    </span>
  );
}

function QualityScorePill({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
    score >= 60 ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' :
    'bg-slate-700/30 border-slate-600/20 text-slate-500';
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded border text-[9px] font-bold tabular-nums ${color}`}>
      Q{score}
    </span>
  );
}

const ALL_PCS = ['PC1_PHASE_READABLE', 'PC2_SETUP_MATERIAL', 'PC3_STRUCTURAL_ROOM', 'PC4_TRIGGER', 'PC5_QUALITY'];

function HuntReadinessCard({ row }: { row: HuntReadinessRow }) {
  const [expanded, setExpanded] = useState(false);
  const isLive = row.hunt_state === 'live';
  const isReady = row.hunt_state === 'ready';
  const phase = PHASE_CONFIG[row.phase_detected] ?? PHASE_CONFIG.UNCLEAR;
  const styleConf = STYLE_TAB_CONFIG.find(s => s.key === row.style);
  const ageLabel = timeAgo(row.last_scanned_at);

  const cardBorder = isLive
    ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 to-slate-900/60'
    : 'border-blue-500/25 bg-gradient-to-br from-slate-900/50 to-blue-950/30';

  const stateDot = isLive
    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] animate-pulse'
    : 'bg-blue-400 shadow-[0_0_4px_rgba(96,165,250,0.5)]';

  const stateLabel = isLive ? 'HUNT LIVE' : 'HUNT READY';
  const stateColor = isLive ? 'text-emerald-400' : 'text-blue-400';

  return (
    <div className={`rounded-xl border overflow-hidden transition-all duration-200 ${cardBorder}`}>
      {/* Card header — always visible */}
      <button
        className="w-full text-left px-3.5 py-3 hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start justify-between gap-2">
          {/* Left: Symbol + state */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${stateDot}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white tracking-wide">{row.symbol}</span>
                {styleConf && (
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded border ${styleConf.badgeBg} ${styleConf.badgeText} ${styleConf.badgeBorder}`}>
                    {styleConf.label} · {styleConf.tf}
                  </span>
                )}
                <span className={`text-[9px] font-bold uppercase tracking-widest ${stateColor}`}>
                  {stateLabel}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug line-clamp-1">
                {row.hunt_summary}
              </p>
              {/* Session runway — informational context only, never a gate */}
              {row.session_minutes_remaining !== null && row.session_minutes_remaining > 0 && (
                <div className="flex items-center gap-1 mt-1">
                  <Clock className="w-2.5 h-2.5 text-slate-600 flex-shrink-0" />
                  <span className={`text-[10px] font-medium tabular-nums ${
                    row.session_minutes_remaining < 20
                      ? 'text-amber-500/80'
                      : 'text-slate-500'
                  }`}>
                    {row.session_minutes_remaining}m session left
                    {row.estimated_feasible_pips !== null && row.estimated_feasible_pips > 0 && (
                      <span className="text-slate-600"> · ~{row.estimated_feasible_pips}p runway</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Quality score + Direction + expand */}
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            {row.quality_score > 0 && <QualityScorePill score={row.quality_score} />}
            {row.direction_lean !== 'NEUTRAL' && (
              <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-px rounded border ${
                row.direction_lean === 'BUY'
                  ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
                  : 'bg-rose-500/15 border-rose-500/25 text-rose-400'
              }`}>
                {row.direction_lean === 'BUY'
                  ? <TrendingUp className="w-2.5 h-2.5" />
                  : <TrendingDown className="w-2.5 h-2.5" />
                }
                {row.direction_lean}
              </span>
            )}
            {expanded
              ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
              : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            }
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-700/30 px-3.5 pb-3.5 pt-3 space-y-3">
          {/* Phase */}
          <div className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${phase.bg}`}>
            <div className="flex-shrink-0 mt-0.5">
              <Activity className={`w-3.5 h-3.5 ${phase.color}`} />
            </div>
            <div>
              <div className={`text-[10px] font-bold uppercase tracking-wider ${phase.color} mb-0.5`}>
                {phase.label} Phase
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">{row.phase_evidence}</p>
              <p className={`text-[9px] mt-0.5 ${phase.color} opacity-70`}>{phase.description}</p>
            </div>
          </div>

          {/* Preconditions grid */}
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Alpha's Hunting Preconditions
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_PCS.map(pc => (
                <PreconditionBadge
                  key={pc}
                  code={pc}
                  met={row.preconditions_met.includes(pc)}
                />
              ))}
            </div>
          </div>

          {/* Structural room */}
          {row.structural_room_pips > 0 && (
            <div className="flex items-center gap-2">
              <Target className="w-3 h-3 text-slate-500 flex-shrink-0" />
              <span className="text-[10px] text-slate-400">
                <span className="text-white font-semibold">{row.structural_room_pips.toFixed(0)} pips</span> structural room {row.structural_room_direction !== 'NEUTRAL' ? `(${row.structural_room_direction})` : ''}
              </span>
            </div>
          )}

          {/* Trigger */}
          {row.trigger_state !== 'none' && row.trigger_evidence && (
            <div className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${
              row.trigger_state === 'fired'
                ? 'bg-emerald-500/8 border-emerald-500/20'
                : 'bg-amber-500/8 border-amber-500/20'
            }`}>
              <Zap className={`w-3 h-3 flex-shrink-0 mt-0.5 ${row.trigger_state === 'fired' ? 'text-emerald-400' : 'text-amber-400'}`} />
              <div>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${row.trigger_state === 'fired' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {row.trigger_state === 'fired' ? 'Trigger Fired' : 'Trigger Developing'}
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{row.trigger_evidence}</p>
              </div>
            </div>
          )}

          {/* Scan CTA */}
          {isLive && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <Crosshair className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span className="text-[10px] text-emerald-300 font-semibold">
                All preconditions confirmed — scan Alpha now for likely execution
              </span>
            </div>
          )}
          {isReady && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-blue-500/8 border border-blue-500/25">
              <Eye className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
              <span className="text-[10px] text-blue-300/90 font-medium">
                Structural material ready — scan Alpha while trigger is developing
              </span>
            </div>
          )}

          <div className="text-[9px] text-slate-600 pt-0.5">Scanned {ageLabel}</div>
        </div>
      )}
    </div>
  );
}

// ─── Session Banner ───────────────────────────────────────────────────────────

function SessionBanner() {
  const ctx = calculateSessionContext();
  const sessions = [
    { id: 'asian',   label: 'Asian',   start: 1, end: 8 },
    { id: 'london',  label: 'London',  start: 8, end: 17 },
    { id: 'ny',      label: 'NY',      start: 13, end: 22 },
  ];
  const utcHour = new Date().getUTCHours();
  const activeId = ctx.currentSession;
  const Icon = utcHour >= 8 && utcHour < 17 ? Sun : utcHour >= 17 && utcHour < 22 ? Sunrise : Moon;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/30 mb-4">
      <Icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
      <div className="flex items-center gap-1.5 flex-wrap">
        {sessions.map(s => {
          const isActive = activeId === s.id || (s.id === 'london' && activeId === 'overlap') || (s.id === 'ny' && activeId === 'overlap');
          return (
            <span key={s.id} className={`text-[10px] font-semibold ${isActive ? 'text-white' : 'text-slate-600'}`}>
              {s.label}{isActive && <span className="ml-0.5 text-emerald-400">●</span>}
            </span>
          );
        })}
      </div>
      {ctx.sessionName && (
        <span className="text-[10px] text-slate-500 ml-auto">{ctx.sessionName}</span>
      )}
    </div>
  );
}

function MarketClosedBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30 mb-4">
      <Moon className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
      <div>
        <p className="text-xs font-semibold text-slate-300">Forex market closed</p>
        <p className="text-[10px] text-slate-500">Crypto instruments only · Forex opens Sunday 22:00 UTC</p>
      </div>
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
  userId,
}) => {
  const [activeTab, setActiveTab] = useState<StyleTab>('all');
  const [readinessRows, setReadinessRows] = useState<HuntReadinessRow[]>([]);
  const [lastScanned, setLastScanned] = useState<string>('');
  const [structuralAlerts, setStructuralAlerts] = useState<StructuralAlertRow[]>([]);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [isForexMarketClosed, setIsForexMarketClosed] = useState(false);

  // Market hours check
  useEffect(() => {
    const check = () => {
      const status = getForexMarketStatus();
      setIsForexMarketClosed(status === 'closed');
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  // Subscribe to alpha_hunt_readiness realtime updates
  useEffect(() => {
    supabase
      .from('alpha_hunt_readiness')
      .select('*')
      .order('hunt_state', { ascending: true }) // live first
      .then(({ data }) => {
        if (data) {
          setReadinessRows(data as HuntReadinessRow[]);
          const latest = data.reduce((best: string, r: HuntReadinessRow) =>
            r.last_scanned_at > best ? r.last_scanned_at : best, '');
          if (latest) setLastScanned(timeAgo(latest));
        }
      });

    const channel = supabase
      .channel('alpha_hunt_readiness_live')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'alpha_hunt_readiness',
      }, () => {
        supabase
          .from('alpha_hunt_readiness')
          .select('*')
          .then(({ data }) => {
            if (data) {
              setReadinessRows(data as HuntReadinessRow[]);
              const latest = data.reduce((best: string, r: HuntReadinessRow) =>
                r.last_scanned_at > best ? r.last_scanned_at : best, '');
              if (latest) setLastScanned(timeAgo(latest));
            }
          });
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
          setStructuralAlerts(prev => [payload.new as StructuralAlertRow, ...prev].slice(0, 20));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  // Filter by market hours
  const visibleRows = isForexMarketClosed
    ? readinessRows.filter(r => isCryptoSymbol(r.symbol))
    : readinessRows;

  // Only show live and ready — not_ready is intentionally hidden
  const huntableRows = visibleRows.filter(r => r.hunt_state !== 'not_ready');

  // Filter by active tab
  const filteredRows = activeTab === 'all'
    ? huntableRows
    : huntableRows.filter(r => r.style === activeTab);

  // Sort: live first, then ready; within same state by structural room desc
  const sortedRows = [...filteredRows].sort((a, b) => {
    if (a.hunt_state === 'live' && b.hunt_state !== 'live') return -1;
    if (b.hunt_state === 'live' && a.hunt_state !== 'live') return 1;
    return b.structural_room_pips - a.structural_room_pips;
  });

  // Tab counts — live + ready combined
  const getTabCounts = () => {
    const counts: Record<string, number> = { SCALP: 0, MICRO_INTRADAY: 0, INTRADAY: 0 };
    for (const row of huntableRows) {
      if (counts[row.style] !== undefined) counts[row.style]++;
    }
    return counts;
  };
  const tabCounts = getTabCounts();
  const liveCount = huntableRows.filter(r => r.hunt_state === 'live').length;
  const totalHuntable = huntableRows.length;

  // Group rows by style for "all" tab
  const groupedRows = STYLE_TAB_CONFIG.map(cfg => ({
    config: cfg,
    rows: sortedRows.filter(r => r.style === cfg.key),
  }));

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-slate-900/50 to-blue-900/40 rounded-xl p-5 border border-blue-500/50">

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Crosshair className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Hunt Readiness</h3>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <p className="text-sm text-blue-300">Alpha's hunting preconditions · 3-min scan</p>
                {lastScanned && (
                  <span className="text-[11px] text-blue-400/60">· {lastScanned}</span>
                )}
              </div>
            </div>
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {liveCount > 0 && (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" />
                {liveCount} live
              </span>
            )}
            {totalHuntable > liveCount && (
              <span className="text-[10px] font-bold text-blue-400 bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Radio className="w-2.5 h-2.5" />
                {totalHuntable - liveCount} ready
              </span>
            )}
          </div>
        </div>

        {/* Session banner */}
        {isForexMarketClosed ? <MarketClosedBanner /> : <SessionBanner />}

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

          {STYLE_TAB_CONFIG.map(cfg => {
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
                {cfg.label}
                {count > 0 && (
                  <span className={`ml-0.5 px-1.5 py-0 rounded-full text-[10px] ${
                    isActive ? cfg.badgeText : 'text-gray-500'
                  } ${isActive ? 'bg-white/10' : 'bg-gray-700/50'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Hunt readiness cards */}
        {sortedRows.length === 0 ? (
          <div className="rounded-lg p-5 border border-slate-700/30 bg-slate-900/30 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-slate-700/30 rounded-full">
                <Crosshair className="w-6 h-6 text-slate-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-300 mb-1">
                  No hunt opportunities right now
                </p>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Alpha's preconditions are not met on any pair. Scanning now will likely produce NO_TRADE. Wait for the readiness monitor to surface a pair.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {activeTab === 'all' ? (
              groupedRows.map(({ config, rows }) => {
                if (rows.length === 0) return null;
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
                      {rows.map(row => (
                        <HuntReadinessCard key={`${row.symbol}-${row.style}`} row={row} />
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="space-y-2">
                {sortedRows.map(row => (
                  <HuntReadinessCard key={`${row.symbol}-${row.style}`} row={row} />
                ))}
              </div>
            )}

            {/* Footer note */}
            <div className="pt-2 border-t border-slate-700/30">
              <p className="text-[10px] text-slate-600">
                LIVE = trigger fired, all 4 preconditions confirmed — scan Alpha now.
                READY = structural material present, trigger developing — worth scanning.
                Alpha makes all trade decisions.
              </p>
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
              {alertsExpanded
                ? <ChevronUp className="w-4 h-4 text-slate-500" />
                : <ChevronDown className="w-4 h-4 text-slate-500" />
              }
            </button>

            {alertsExpanded && (
              <div className="px-4 pb-4 space-y-2">
                {structuralAlerts.map(alert => {
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
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-[10px] font-bold text-white">{alert.symbol}</span>
                          <span className="text-[9px] text-slate-500 uppercase tracking-wider">{alert.rule_type}</span>
                          {alert.direction && alert.direction !== 'NEUTRAL' && (
                            <span className={`text-[9px] font-bold ${alert.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {alert.direction}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 leading-snug">{alert.details_text}</p>
                        <p className="text-[9px] text-slate-600 mt-0.5">{timeLabel}</p>
                      </div>
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

export default SessionIntelligenceMonitor;
