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
  Zap,
  Brain,
  XCircle,
  Star,
  Pin,
  History
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { midTradeMonitorService, type MidTradeGuidance, type PersistedMidTradeAlert } from '@/services/mid-trade-monitor-service';
import { pricePollingCoordinator } from '@/services/price-polling-coordinator';
import type { TrailingSLOptions } from '@/services/mid-trade-plan-engine';

// GOVERNANCE (CCIP): Mobile standard = 2 decimal places for all price displays.
const isMobileScreen = (): boolean => window.innerWidth < 640;

const cleanPrice = (price: number): string => {
  if (isMobileScreen()) return price.toFixed(2);
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

const PersistedAlertBanner: React.FC<{
  alert: PersistedMidTradeAlert;
  symbol: string;
}> = ({ alert, symbol }) => {
  const [copied, setCopied] = useState(false);

  const colorMap: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    emerald: {
      bg: 'bg-emerald-900/30',
      border: 'border-emerald-500/40',
      text: 'text-emerald-300',
      badge: 'bg-emerald-500/20 text-emerald-300'
    },
    amber: {
      bg: 'bg-amber-900/30',
      border: 'border-amber-500/40',
      text: 'text-amber-300',
      badge: 'bg-amber-500/20 text-amber-300'
    },
    red: {
      bg: 'bg-red-900/30',
      border: 'border-red-500/40',
      text: 'text-red-300',
      badge: 'bg-red-500/20 text-red-300'
    },
    blue: {
      bg: 'bg-blue-900/30',
      border: 'border-blue-500/40',
      text: 'text-blue-300',
      badge: 'bg-blue-500/20 text-blue-300'
    },
  };

  const c = colorMap[alert.color] ?? colorMap.amber;

  const handleCopy = () => {
    if (alert.action_price == null) return;
    navigator.clipboard.writeText(alert.action_price.toString()).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const firedAt = alert.fired_at
    ? new Date(alert.fired_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <Pin className={`w-3 h-3 ${c.text} flex-shrink-0`} />
        <span className={`text-[9px] uppercase tracking-widest font-bold ${c.text}`}>
          Alpha Alert — persisted
        </span>
        {firedAt && (
          <span className="ml-auto text-[9px] text-gray-500">fired {firedAt}</span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <p className={`text-sm font-semibold ${c.text} leading-snug`}>
          {alert.primary_message}
        </p>
        {alert.sub_message && (
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            {alert.sub_message}
          </p>
        )}
        {alert.action_price != null && alert.action_label && (
          <div className="mt-2 flex items-center gap-2">
            <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border ${c.border} ${c.bg}`}>
              <div>
                <p className="text-[9px] text-gray-400 uppercase tracking-wide">{alert.action_label}</p>
                <p className={`text-sm font-bold font-mono ${c.text}`}>
                  {alert.action_price.toFixed(symbol === 'EURUSD' || symbol === 'GBPUSD' ? 5 : 2)}
                </p>
              </div>
              <button
                onClick={handleCopy}
                className="p-1 hover:bg-white/10 rounded transition-colors"
                title="Copy price"
              >
                {copied
                  ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  : <Copy className="w-3.5 h-3.5 text-gray-400" />
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const alertActionLabel: Record<string, string> = {
  trail_sl: 'Trail SL',
  warning: 'Warning',
  tp1_timing: 'TP Timing',
  risk_alert: 'Risk Alert',
  hold: 'Hold',
};

const AlertHistoryLog: React.FC<{
  alertLog: PersistedMidTradeAlert[];
  symbol: string;
  currentPersistedAlert: PersistedMidTradeAlert | null;
}> = ({ alertLog, symbol, currentPersistedAlert }) => {
  const [expanded, setExpanded] = useState(false);

  // Show only past alerts that are not the current sticky banner
  const pastAlerts = alertLog.filter(
    a => a.trigger_type !== currentPersistedAlert?.trigger_type
  );

  if (pastAlerts.length === 0) return null;

  const colorMap: Record<string, { text: string; badge: string; dot: string }> = {
    emerald: { text: 'text-emerald-300', badge: 'bg-emerald-500/20 text-emerald-300', dot: 'bg-emerald-400' },
    amber:   { text: 'text-amber-300',   badge: 'bg-amber-500/20 text-amber-300',     dot: 'bg-amber-400'   },
    red:     { text: 'text-red-300',     badge: 'bg-red-500/20 text-red-300',         dot: 'bg-red-400'     },
    blue:    { text: 'text-blue-300',    badge: 'bg-blue-500/20 text-blue-300',       dot: 'bg-blue-400'    },
    orange:  { text: 'text-orange-300',  badge: 'bg-orange-500/20 text-orange-300',   dot: 'bg-orange-400'  },
  };

  const decimalPlaces = symbol.includes('JPY') ? 3 : symbol.length <= 6 && !symbol.includes('USD') ? 5 : 2;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <History className="w-3 h-3 text-gray-500 flex-shrink-0" />
        <span className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">
          {pastAlerts.length} prior alert{pastAlerts.length !== 1 ? 's' : ''}
        </span>
        <span className="ml-auto">
          {expanded
            ? <ChevronUp className="w-3 h-3 text-gray-500" />
            : <ChevronDown className="w-3 h-3 text-gray-500" />
          }
        </span>
      </button>

      {expanded && (
        <div className="divide-y divide-white/5">
          {[...pastAlerts].reverse().map((alert, idx) => {
            const c = colorMap[alert.color] ?? colorMap.amber;
            const firedAt = alert.fired_at
              ? new Date(alert.fired_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : null;
            const actionLabel = alertActionLabel[alert.action] ?? alert.action;

            return (
              <div key={`${alert.trigger_type}-${idx}`} className="px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${c.badge}`}>
                    {actionLabel}
                  </span>
                  {firedAt && (
                    <span className="ml-auto text-[9px] text-gray-600 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" /> {firedAt}
                    </span>
                  )}
                </div>
                <p className={`text-xs font-medium ${c.text} leading-snug`}>
                  {alert.primary_message}
                </p>
                {alert.sub_message && (
                  <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                    {alert.sub_message}
                  </p>
                )}
                {alert.action_price != null && alert.action_label && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-500 uppercase">{alert.action_label}:</span>
                    <span className={`text-xs font-bold font-mono ${c.text}`}>
                      {alert.action_price.toFixed(decimalPlaces)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const splitPrice = (price: number): { integer: string; decimal: string } => {
  const raw = cleanPrice(price);
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) return { integer: raw, decimal: '' };
  const decimalPart = raw.slice(dotIdx);
  // MOBILE STANDARD: cap decimal to 2 digits (.XX) on small screens
  const cappedDecimal = isMobileScreen()
    ? decimalPart.slice(0, 3)  // keeps the dot + 2 digits
    : decimalPart;
  return { integer: raw.slice(0, dotIdx), decimal: cappedDecimal };
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
// Badge usage: 'none' maps to empty string so no badge chip is rendered.
const SCALP_PATTERN_BADGE_LABELS: Record<string, string> = { ...SCALP_PATTERN_LABELS, none: '' };

const getDurationPillStyle = (minutes: number): { text: string; classes: string } => {
  const hours = minutes / 60;
  if (hours <= 2) {
    return {
      text: minutes < 60 ? `~${minutes}m` : `~${(hours).toFixed(1)}h`,
      classes: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
    };
  }
  if (hours <= 6) {
    return {
      text: `~${hours.toFixed(1)}h`,
      classes: 'text-amber-400 bg-amber-500/15 border-amber-500/30'
    };
  }
  return {
    text: `~${hours.toFixed(1)}h`,
    classes: 'text-red-400 bg-red-500/15 border-red-500/30'
  };
};

/**
 * CCIP-2026-0320D: TP1 Milestone Alert Banner
 * Shown prominently when tp1_hit = true on a trade.
 * Pulsing green alert to ensure the user does not miss the breakeven protection signal.
 */
const TP1MilestoneBanner: React.FC<{
  symbol: string;
  tp1BreakevenSL: number | null;
}> = ({ symbol, tp1BreakevenSL }) => {
  return (
    <div className="mb-3 rounded-lg border border-emerald-400/60 bg-emerald-900/30 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="shrink-0 relative">
          <div className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping" />
          <div className="relative p-1.5 rounded-full bg-emerald-500/20">
            <Star className="w-4 h-4 text-emerald-300 fill-emerald-300/30" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-emerald-300 leading-tight">
            TP1 Hit — SL Moved to Breakeven
          </p>
          <p className="text-xs text-emerald-200/70 mt-0.5 leading-snug">
            {symbol} reached its first target. Your trade is now <span className="font-semibold text-emerald-300">fully protected</span> — monitoring continues for TP2.
            {tp1BreakevenSL != null && (
              <> New SL: <span className="font-mono font-semibold text-emerald-300">{cleanPrice(tp1BreakevenSL)}</span></>
            )}
          </p>
        </div>
        <div className="shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Protected
          </span>
        </div>
      </div>
    </div>
  );
};

const AlphaEntryIntelligence: React.FC<{ guide: MidTradeGuidance }> = ({ guide }) => {
  const [expanded, setExpanded] = useState(false);
  const plan = guide.midTradePlan;

  if (!plan) return null;

  const narrative = plan.entry_narrative || plan.setup_summary;
  const patternKey = plan.scalp_pattern && plan.scalp_pattern !== 'none' ? plan.scalp_pattern : null;
  const patternLabel = patternKey ? (SCALP_PATTERN_BADGE_LABELS[patternKey] ?? patternKey) : null;
  const setupTypeLabel = patternLabel || plan.patterns?.htf || null;

  const directionColor = guide.direction === 'buy'
    ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
    : 'text-red-400 bg-red-500/15 border-red-500/30';
  const directionLabel = guide.direction === 'buy' ? 'LONG' : 'SHORT';

  const durationPill = plan.expected_duration_minutes
    ? getDurationPillStyle(plan.expected_duration_minutes)
    : null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full rounded-lg bg-gray-800/60 hover:bg-gray-800/80 transition-colors border border-gray-700/40 overflow-hidden"
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <Brain className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-sky-300 flex-shrink-0">Why Alpha Entered</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${directionColor}`}>
              {directionLabel}
            </span>
            {setupTypeLabel && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-amber-300 bg-amber-900/30 border-amber-600/40 truncate max-w-[130px] flex-shrink-0">
                {setupTypeLabel}
              </span>
            )}
            {durationPill && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex items-center gap-1 flex-shrink-0 ${durationPill.classes}`}>
                <Clock className="w-2.5 h-2.5" />
                {durationPill.text}
              </span>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 ml-2" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 ml-2" />
          )}
        </div>

        {!expanded && (
          <div className="px-3 pb-2.5">
            <p className="text-xs text-gray-400 leading-relaxed line-clamp-2 text-left">
              {narrative}
            </p>
          </div>
        )}
      </button>

      {expanded && (
        <div className="mt-1 rounded-lg bg-gray-800/40 border border-gray-700/30 overflow-hidden">
          <div className="px-3 py-3">
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {setupTypeLabel && (
                <span className="text-[10px] font-bold px-2 py-1 rounded border text-amber-300 bg-amber-900/30 border-amber-600/40">
                  {setupTypeLabel}
                </span>
              )}
              {plan.patterns?.mtf && plan.patterns.mtf !== plan.patterns.htf && (
                <span className="text-[10px] font-semibold px-2 py-1 rounded border text-blue-300 bg-blue-900/20 border-blue-700/30">
                  {plan.patterns.mtf}
                </span>
              )}
              {plan.scalp_sub_mode && (
                <span className="text-[10px] font-semibold px-2 py-1 rounded border text-gray-300 bg-gray-700/50 border-gray-600/40">
                  {plan.scalp_sub_mode.replace(/_/g, ' ')}
                </span>
              )}
              {plan.regime_at_entry && plan.regime_at_entry !== 'unknown' && (
                <span className="text-[10px] font-semibold px-2 py-1 rounded border text-sky-300 bg-sky-900/20 border-sky-700/30">
                  {plan.regime_at_entry}
                </span>
              )}
              {durationPill && (
                <span className={`text-[10px] font-semibold px-2 py-1 rounded border flex items-center gap-1 ${durationPill.classes}`}>
                  <Clock className="w-2.5 h-2.5" />
                  {durationPill.text}
                </span>
              )}
            </div>

            <p className="text-xs text-gray-200 leading-relaxed">
              {narrative}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const SCALP_SUBMODE_LABELS: Record<string, string> = {
  momentum_continuation: 'Momentum',
  pullback_entry: 'Pullback Entry',
  consolidation_breakout: 'Breakout',
};

const AlphaAnswerSheet: React.FC<{ guide: MidTradeGuidance }> = ({ guide }) => {
  const [expanded, setExpanded] = useState(false);
  const sheet = guide.answerSheet;
  if (!sheet) return null;

  // CCIP-2026-0516A: Detect whether this is new free-form schema or legacy Q-field schema
  const isFreeForm = !!(sheet.market_analysis || sheet.direction_thesis);

  const failProb = sheet.failure_probability ?? sheet.Q5_failure_probability;
  const failScenario = sheet.failure_scenario ?? sheet.Q5_failure_mode;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full rounded-lg bg-sky-900/20 hover:bg-sky-900/30 transition-colors border border-sky-700/30 overflow-hidden"
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-sky-300">Alpha Pre-Trade Reasoning</span>
          </div>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-1 rounded-lg bg-sky-900/10 border border-sky-700/20 overflow-hidden divide-y divide-sky-800/20">
          {isFreeForm ? (
            <>
              {sheet.market_analysis && (
                <div className="px-3 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-sky-600 mb-0.5">Market Analysis</p>
                  <p className="text-[11px] text-gray-300 leading-snug">{sheet.market_analysis}</p>
                </div>
              )}
              {sheet.direction_thesis && (
                <div className="px-3 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-sky-600 mb-0.5">Direction Thesis</p>
                  <p className="text-[11px] text-gray-300 leading-snug">{sheet.direction_thesis}</p>
                </div>
              )}
              {sheet.invalidation_thesis && (
                <div className="px-3 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-sky-600 mb-0.5">Invalidation</p>
                  <p className="text-[11px] text-gray-300 leading-snug">{sheet.invalidation_thesis}</p>
                </div>
              )}
              {sheet.reward_thesis && (
                <div className="px-3 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-sky-600 mb-0.5">Reward Thesis</p>
                  <p className="text-[11px] text-gray-300 leading-snug">{sheet.reward_thesis}</p>
                </div>
              )}
            </>
          ) : (
            <div className="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {sheet.Q2_structure_level && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-sky-600 mb-0.5">Structure Level</p>
                  <p className="text-[11px] text-gray-300 leading-snug">{sheet.Q2_structure_level}</p>
                </div>
              )}
              {sheet.Q4_momentum_stage && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-sky-600 mb-0.5">Momentum Stage</p>
                  <p className="text-[11px] text-gray-300 leading-snug">{sheet.Q4_momentum_stage}</p>
                </div>
              )}
              {sheet.Q6_entry_trigger && (
                <div className="col-span-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-sky-600 mb-0.5">Entry Trigger</p>
                  <p className="text-[11px] text-gray-300 leading-snug">{sheet.Q6_entry_trigger}</p>
                </div>
              )}
            </div>
          )}
          {(failScenario || failProb != null) && (
            <div className="px-3 py-2 bg-red-900/10">
              <p className="text-[9px] font-bold uppercase tracking-wider text-red-500 mb-0.5">
                Failure Scenario{failProb != null ? ` · ${failProb}% probability` : ''}
              </p>
              <p className="text-[11px] text-red-300/80 leading-snug">{failScenario || '—'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
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

const THESIS_STATUS_CONFIG = {
  INTACT: {
    label: 'Thesis Intact',
    classes: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  WEAKENING: {
    label: 'Weakening',
    classes: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  INVALIDATED: {
    label: 'Invalidated',
    classes: 'text-red-400 bg-red-500/15 border-red-500/30',
    dot: 'bg-red-400',
  },
};

const VERDICT_CONFIG = {
  HOLD: {
    label: 'Hold',
    icon: <CheckCircle className="w-4 h-4" />,
    cardClasses: 'border-emerald-500/30 bg-emerald-900/20',
    textColor: 'text-emerald-400',
    headerBg: 'bg-emerald-900/30',
  },
  CLOSE_NOW: {
    label: 'Close Now',
    icon: <XCircle className="w-4 h-4" />,
    cardClasses: 'border-red-500/40 bg-red-900/25',
    textColor: 'text-red-400',
    headerBg: 'bg-red-900/40',
  },
  TAKE_PARTIAL: {
    label: 'Take Partial',
    icon: <Target className="w-4 h-4" />,
    cardClasses: 'border-amber-500/40 bg-amber-900/25',
    textColor: 'text-amber-400',
    headerBg: 'bg-amber-900/30',
  },
  TRAIL_SL: {
    label: 'Trail SL',
    icon: <Shield className="w-4 h-4" />,
    cardClasses: 'border-sky-500/30 bg-sky-900/20',
    textColor: 'text-sky-400',
    headerBg: 'bg-sky-900/30',
  },
};

const AlphaRecheckPanel: React.FC<{ guide: MidTradeGuidance }> = ({ guide }) => {
  const [expanded, setExpanded] = useState(false);
  const recheck = guide.alphaRecheck;

  if (!recheck) return null;

  const verdictCfg = VERDICT_CONFIG[recheck.verdict] ?? VERDICT_CONFIG.HOLD;
  const thesisCfg = THESIS_STATUS_CONFIG[recheck.thesisStatus] ?? THESIS_STATUS_CONFIG.INTACT;

  const checkedAt = recheck.checkedAt
    ? (() => {
        const diffMs = Date.now() - new Date(recheck.checkedAt).getTime();
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
      })()
    : null;

  const isCritical = recheck.verdict === 'CLOSE_NOW';
  const isActionable = recheck.verdict !== 'HOLD';

  return (
    <div className={`mt-2 rounded-lg border overflow-hidden ${verdictCfg.cardClasses}`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className={`w-full flex items-center justify-between px-3 py-2.5 ${verdictCfg.headerBg} transition-colors hover:brightness-110`}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <Brain className={`w-3.5 h-3.5 flex-shrink-0 ${verdictCfg.textColor}`} />
          <span className={`text-xs font-bold flex-shrink-0 ${verdictCfg.textColor}`}>
            Alpha Re-Analysis
          </span>

          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 flex-shrink-0 ${verdictCfg.textColor} border-current bg-transparent`}>
            {verdictCfg.icon}
            {verdictCfg.label}
          </span>

          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex items-center gap-1 flex-shrink-0 ${thesisCfg.classes}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${thesisCfg.dot}`} />
            {thesisCfg.label}
          </span>

          {isCritical && (
            <span className="text-[10px] font-bold text-red-300 bg-red-900/60 border border-red-500/50 px-1.5 py-0.5 rounded animate-pulse flex-shrink-0">
              ACTION NEEDED
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          {checkedAt && (
            <span className="text-[10px] text-gray-500 hidden sm:block">{checkedAt}</span>
          )}
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
          )}
        </div>
      </button>

      {!expanded && isActionable && (
        <div className="px-3 py-2">
          <p className="text-xs text-gray-300 leading-relaxed line-clamp-2">
            {recheck.userMessage}
          </p>
        </div>
      )}

      {expanded && (
        <div className="divide-y divide-gray-700/30">
          <div className="px-3 py-2.5">
            <p className="text-xs text-gray-200 leading-relaxed">{recheck.userMessage}</p>
          </div>

          <div className="px-3 py-2 grid grid-cols-3 gap-2">
            <div>
              <p className="text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Confidence</p>
              <p className={`text-xs font-bold font-mono ${
                recheck.confidence >= 75 ? 'text-emerald-400' :
                recheck.confidence >= 55 ? 'text-amber-400' :
                'text-red-400'
              }`}>{recheck.confidence}%</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Trigger</p>
              <p className="text-xs text-gray-400 truncate">{recheck.triggerType.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Checked</p>
              <p className="text-xs text-gray-400">{checkedAt}</p>
            </div>
          </div>

          {recheck.alphaReasoning && (
            <div className="px-3 py-2 bg-gray-900/30">
              <p className="text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Alpha Internal Reasoning</p>
              <p className="text-[11px] text-gray-400 leading-relaxed italic">{recheck.alphaReasoning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface MidTradeMonitorProps {
  /** CCIP (2026-03-01): When provided, filters the monitor view to this trade only.
   *  Used by TradingMonitorStack in multi-trade sessions to show one trade at a time. */
  activeTradeId?: string;
}

export const MidTradeMonitor: React.FC<MidTradeMonitorProps> = ({ activeTradeId }) => {
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

  // CCIP (2026-03-01): When activeTradeId is set (multi-trade mode), show only that trade.
  // Falls back to full list for single-trade sessions or when no id is supplied.
  const visibleGuidance = activeTradeId
    ? guidance.filter(g => g.tradeId === activeTradeId)
    : guidance;

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
          {visibleGuidance.map((guide) => {
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
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <p className="text-[10px] text-gray-500">P&L</p>
                      <span className={`text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded ${
                        guide.rMultiple >= 0
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {guide.rMultiple >= 0 ? '+' : ''}{guide.rMultiple.toFixed(2)}R
                      </span>
                    </div>
                  </div>
                </div>

                {/* CCIP-2026-0320D: TP1 Milestone Alert Banner — shown when TP1 has been hit */}
                {guide.tp1Hit && (
                  <TP1MilestoneBanner
                    symbol={guide.symbol}
                    tp1BreakevenSL={guide.tp1BreakevenSL}
                  />
                )}

                {/* Alpha Entry Intelligence — Why Alpha took this trade */}
                <AlphaEntryIntelligence guide={guide} />

                {/* Alpha Pre-Trade Answer Sheet — machine-readable reasoning */}
                <AlphaAnswerSheet guide={guide} />

                {/* Alpha Mid-Trade Re-Analysis — thesis verdict from event-driven recheck */}
                <AlphaRecheckPanel guide={guide} />

                {/* Persisted Alert — sticky banner from the most recent trigger, survives page refresh.
                    Hidden when the current live guidance is already showing the same message. */}
                {guide.persistedAlert && guide.persistedAlert.primary_message !== guide.primaryMessage && (
                  <PersistedAlertBanner
                    alert={guide.persistedAlert}
                    symbol={guide.symbol}
                  />
                )}

                {/* Alert History Log — all prior alerts fired during this trade's life, collapsed by default */}
                <AlertHistoryLog
                  alertLog={guide.alertLog ?? []}
                  symbol={guide.symbol}
                  currentPersistedAlert={guide.persistedAlert}
                />

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

                  {/* RR Intelligence Row */}
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-gray-500 font-medium">Initial RR</span>
                      <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                        guide.initialRR >= 1.5
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : guide.initialRR >= 1.0
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        1:{guide.initialRR.toFixed(2)}
                      </span>
                    </div>
                    <span className="text-gray-600 text-[10px]">|</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-gray-500 font-medium">Live RR</span>
                      <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                        guide.liveRR >= 1.0
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : guide.liveRR >= 0.5
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}>
                        1:{guide.liveRR.toFixed(2)}
                      </span>
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

                {/* Scalp Intelligence Bar — momentum phase detail for scalp trades */}
                {guide.midTradePlan && guide.midTradePlan.scalp_momentum_phase && (
                  <ScalpIntelligenceBar plan={guide.midTradePlan} />
                )}

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
