// ─────────────────────────────────────────────────────────────────────────────
// SessionIntelligenceMonitor — Alpha Hunt Readiness Monitor
//
// SSOT Authority: sole UI owner of the Hunt Readiness panel.
//
// GOVERNANCE (CCIP-2026-0510J):
//   Binary armed/not_ready model. The monitor is a PARALLEL ADVISORY channel —
//   it does not gate Alpha's hunt loop. Alpha's pre-filter scans all symbols
//   always. This panel surfaces ONLY pairs where a confirmed, high-precision
//   trigger archetype has fired and every arming gate (regime match, structural
//   room, internal invalidation + reward room, adversarial clear, quality) has
//   passed. When a card appears here, it is the optimal moment for the user to
//   manually scan Alpha.
//
//   SL SOVEREIGNTY: This panel NEVER displays invalidation prices, stop-loss
//   levels, or reward-in-pips numbers. Internal arming metrics live in the DB
//   for diagnostics only and are never surfaced to the user or to Alpha's
//   prompt. Alpha retains full SL authority on every scan.
//
//   Data source: alpha_hunt_readiness table (server-side, every 3 min).
//
//   Hunt states rendered:
//     armed     — all gates pass + confirmed trigger archetype fired — SHOW
//     not_ready — any gate failed — HIDE
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Activity,
  Crosshair,
  Sun,
  Moon,
  Sunrise,
} from 'lucide-react';
import { calculateSessionContext, getForexMarketStatus, isCryptoSymbol } from '@/utils/marketHours';
import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

type TradingStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
type HuntState = 'armed' | 'not_ready' | 'live' | 'ready'; // legacy values kept for back-compat reads

type TriggerArchetype =
  | 'BOS_CONFIRMED'
  | 'SWEEP_RECLAIM'
  | 'MANIPULATION_CANDLE'
  | 'MULTI_TOUCH_REJECTION'
  | 'COMPRESSION_BREAKOUT'
  | 'FVG_OB_REACTION'
  | 'MEAN_REVERSION';

type DirectionLean = 'BUY' | 'SELL' | 'NEUTRAL';

interface HuntReadinessRow {
  id: string;
  symbol: string;
  style: TradingStyle;
  hunt_state: HuntState;
  trigger_archetype: TriggerArchetype | null;
  direction_lean: DirectionLean;
  quality_score: number;
  hunt_summary: string;
  last_scanned_at: string;
  expires_at: string;
  armed_at: string | null;
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

// ─── Config ───────────────────────────────────────────────────────────────────

const ARCHETYPE_LABEL: Record<TriggerArchetype, string> = {
  BOS_CONFIRMED: 'Break of Structure',
  SWEEP_RECLAIM: 'Sweep + Reclaim',
  MANIPULATION_CANDLE: 'Manipulation Candle',
  MULTI_TOUCH_REJECTION: 'Multi-Touch Rejection',
  COMPRESSION_BREAKOUT: 'Compression Breakout',
  FVG_OB_REACTION: 'FVG / Order Block',
  MEAN_REVERSION: 'Mean Reversion',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins <= 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ─── Armed Card ───────────────────────────────────────────────────────────────

function ArmedCard({ row }: { row: HuntReadinessRow }) {
  const [expanded, setExpanded] = useState(false);
  const archetypeLabel = row.trigger_archetype ? ARCHETYPE_LABEL[row.trigger_archetype] : 'Confirmed Trigger';
  const ageLabel = timeAgo(row.armed_at ?? row.last_scanned_at);

  return (
    <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 to-slate-900/60 overflow-hidden transition-all duration-200">
      <button
        className="w-full text-left px-3.5 py-3 hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] animate-pulse" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white tracking-wide">{row.symbol}</span>
                {row.direction_lean === 'BUY' && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    <ArrowUpRight className="w-2.5 h-2.5" />BUY
                  </span>
                )}
                {row.direction_lean === 'SELL' && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-red-300 bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 rounded">
                    <ArrowDownRight className="w-2.5 h-2.5" />SELL
                  </span>
                )}
                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400">
                  ARMED
                </span>
              </div>
              <p className="text-[11px] text-emerald-200/90 mt-0.5 leading-snug">
                {archetypeLabel} just confirmed
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">Armed {ageLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            {expanded
              ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
              : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            }
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-emerald-500/20 px-3.5 pb-3.5 pt-3 space-y-3">
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
            <Crosshair className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-0.5">
                Scan Alpha now — {archetypeLabel} just confirmed
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">{row.hunt_summary}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Session Banner ───────────────────────────────────────────────────────────

function SessionBanner() {
  const ctx = calculateSessionContext();
  const sessions = [
    { id: 'asian',  label: 'Asian',  start: 1, end: 8 },
    { id: 'london', label: 'London', start: 8, end: 17 },
    { id: 'ny',     label: 'NY',     start: 13, end: 22 },
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
}) => {
  const [readinessRows, setReadinessRows] = useState<HuntReadinessRow[]>([]);
  const [lastScanned, setLastScanned] = useState<string>('');
  const [structuralAlerts, setStructuralAlerts] = useState<StructuralAlertRow[]>([]);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [isForexMarketClosed, setIsForexMarketClosed] = useState(false);

  useEffect(() => {
    const check = () => {
      const status = getForexMarketStatus();
      setIsForexMarketClosed(status === 'closed');
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fetch = () => {
      supabase
        .from('alpha_hunt_readiness')
        .select('id, symbol, style, hunt_state, trigger_archetype, direction_lean, quality_score, hunt_summary, last_scanned_at, expires_at, armed_at')
        .eq('hunt_state', 'armed')
        .gt('expires_at', new Date().toISOString())
        .order('armed_at', { ascending: false })
        .then(({ data }) => {
          if (data) {
            setReadinessRows(data as HuntReadinessRow[]);
            const latest = data.reduce((best: string, r: HuntReadinessRow) =>
              r.last_scanned_at > best ? r.last_scanned_at : best, '');
            if (latest) setLastScanned(timeAgo(latest));
          }
        });
    };
    fetch();

    const channel = supabase
      .channel('alpha_hunt_readiness_armed')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'alpha_hunt_readiness',
      }, () => fetch())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

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

  const visibleRows = isForexMarketClosed
    ? readinessRows.filter(r => isCryptoSymbol(r.symbol))
    : readinessRows;

  const armedCount = visibleRows.length;

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-slate-900/50 to-emerald-900/30 rounded-xl p-5 border border-emerald-500/40">

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/15 rounded-lg">
              <Crosshair className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Hunt Readiness</h3>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <p className="text-sm text-emerald-300/80">Armed-only advisory · fires on confirmed triggers</p>
                {lastScanned && (
                  <span className="text-[11px] text-emerald-400/60">· {lastScanned}</span>
                )}
              </div>
            </div>
          </div>

          {armedCount > 0 && (
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              {armedCount} armed
            </span>
          )}
        </div>

        {/* Session banner */}
        {isForexMarketClosed ? <MarketClosedBanner /> : <SessionBanner />}

        {/* Armed cards */}
        {visibleRows.length === 0 ? (
          <div className="rounded-lg p-5 border border-slate-700/30 bg-slate-900/30 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-slate-700/30 rounded-full">
                <Crosshair className="w-6 h-6 text-slate-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-300 mb-1">
                  No armed setups right now
                </p>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  The advisory fires only when a confirmed, high-precision trigger has just fired. Alpha is still hunting in the background — you can scan at any time.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRows.map(row => (
              <ArmedCard key={`${row.symbol}-${row.style}`} row={row} />
            ))}

            <div className="pt-2 border-t border-slate-700/30">
              <p className="text-[10px] text-slate-600">
                ARMED = confirmed trigger just fired + every arming gate passed. This is the optimal moment to scan Alpha. Alpha still makes every trade decision — including stop placement.
              </p>
            </div>
          </div>
        )}

        {/* Session Structural Alerts (unchanged) */}
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
