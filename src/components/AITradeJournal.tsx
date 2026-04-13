/**
 * AI Trade Journal — Display Component
 *
 * CCIP 2026-03-01: Journal Display Quality Overhaul
 *
 * Changes in this version:
 *  1. Trade style badge (Scalp / Micro / Intraday) sourced from goal_sessions.trade_style
 *  2. R:R direction fixed: value shown as "{reward}:1" (Reward:Risk) not "1:{reward}"
 *  3. TP exit display is per-style:
 *       Scalp        → 1 TP max, shows "TP Hit"
 *       Micro/Intraday → up to 2 TPs; TP1-only loss shows "TP1 Hit" + "Trade Loss"
 *  4. "Goal reached" headline replaced with "TP Hit!" badge; risk context shown
 *  5. Narrative quality improved via alpha scan context (written by coordinator)
 *  6. Pattern cell falls back to style-based label instead of "Goal Achievement"
 *
 * SSOT:
 *  - ai_trade_journal is the sole read source for this component
 *  - trade_style and dollar_risk are joined from goal_sessions by the query layer
 *  - No writes from this component
 */

import React, { useState, useEffect } from 'react';
import {
  Brain, TrendingUp, CheckCircle, XCircle, AlertCircle,
  ChevronDown, ChevronUp, Shield, Target, BarChart2, Zap, Clock,
} from 'lucide-react';
import { llmReasoningLogger } from '../services/llm-reasoning-logger';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

function deriveSession(entryTime: string): string {
  const hour = new Date(entryTime).getUTCHours();
  if (hour >= 0 && hour < 8) return 'Tokyo';
  if (hour >= 8 && hour < 16) return 'London';
  return 'New York';
}

function normalizeTradeStyle(raw: string | null | undefined): 'scalp' | 'micro' | 'intraday' | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (s === 'scalper' || s === 'scalp') return 'scalp';
  if (s === 'micro' || s === 'micro_intraday') return 'micro';
  if (s === 'intraday' || s === 'day') return 'intraday';
  return null;
}

function styleLabel(style: 'scalp' | 'micro' | 'intraday' | null): string {
  if (style === 'scalp') return 'Scalp';
  if (style === 'micro') return 'Micro';
  if (style === 'intraday') return 'Intraday';
  return '';
}

function styleColors(style: 'scalp' | 'micro' | 'intraday' | null): string {
  if (style === 'scalp') return 'text-orange-400 bg-orange-400/10 border-orange-400/25';
  if (style === 'micro') return 'text-cyan-400 bg-cyan-400/10 border-cyan-400/25';
  if (style === 'intraday') return 'text-teal-400 bg-teal-400/10 border-teal-400/25';
  return 'text-gray-400 bg-gray-400/10 border-gray-400/25';
}

function styleIcon(style: 'scalp' | 'micro' | 'intraday' | null) {
  if (style === 'scalp') return <Zap className="w-2.5 h-2.5" />;
  if (style === 'micro') return <Clock className="w-2.5 h-2.5" />;
  if (style === 'intraday') return <TrendingUp className="w-2.5 h-2.5" />;
  return null;
}

function calcRR(entry: any): string | null {
  const ep = entry.entry_price;
  const sl = entry.stop_loss;
  const tp = entry.take_profit;
  if (!ep || !sl || !tp) return null;
  const risk = Math.abs(ep - sl);
  const reward = Math.abs(tp - ep);
  if (risk === 0) return null;
  return (reward / risk).toFixed(1);
}

function calcPips(symbol: string, from: number, to: number): number {
  const pipValue = symbol?.includes('JPY') ? 0.01 : 0.0001;
  return Math.round(Math.abs(to - from) / pipValue);
}

function formatHoldTime(entry: any): string | null {
  if (!entry.entry_time || !entry.exit_time) return null;
  const ms = new Date(entry.exit_time).getTime() - new Date(entry.entry_time).getTime();
  if (ms <= 0) return null;
  const totalMins = Math.round(ms / 60000);
  if (totalMins < 60) return `${totalMins}m`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatPrice(symbol: string, price: number): string {
  const precision = symbol?.includes('JPY') ? 3 : 5;
  return price.toFixed(precision);
}

function pnlStr(v: number): string {
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;
}

function cleanPattern(
  patternIdentified: string | null | undefined,
  setupTypeFromRecord: string | null | undefined,
  style: 'scalp' | 'micro' | 'intraday' | null
): string {
  if (setupTypeFromRecord && setupTypeFromRecord !== 'Unknown' && setupTypeFromRecord !== '') {
    return setupTypeFromRecord;
  }
  if (!patternIdentified || patternIdentified === 'Goal Achievement' || patternIdentified === 'System Trade') {
    return style ? `${styleLabel(style)} Trade` : 'AI Trade';
  }
  return patternIdentified;
}

function humanizeRegime(regime: string | null | undefined): { label: string; color: string } | null {
  if (!regime) return null;
  const r = regime.toLowerCase();
  if (r === 'trend_high_vol') return { label: 'Trending market with high volatility', color: 'text-green-400 bg-green-400/10 border-green-400/25' };
  if (r === 'trend_normal' || r === 'trend_low_vol') return { label: 'Trending market, normal conditions', color: 'text-green-300 bg-green-300/10 border-green-300/25' };
  if (r === 'range_high_vol') return { label: 'Ranging market with elevated volatility', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/25' };
  if (r === 'range_normal' || r === 'range_low_vol') return { label: 'Ranging market, normal conditions', color: 'text-gray-300 bg-gray-300/10 border-gray-300/25' };
  if (r === 'accumulation_normal') return { label: 'Accumulation phase, market building direction', color: 'text-blue-300 bg-blue-300/10 border-blue-300/25' };
  if (r === 'accumulation_high_vol') return { label: 'Accumulation phase with high volatility', color: 'text-orange-400 bg-orange-400/10 border-orange-400/25' };
  if (r.includes('volatile') || r.includes('high_vol')) return { label: 'High volatility conditions', color: 'text-orange-400 bg-orange-400/10 border-orange-400/25' };
  if (r.includes('trend')) return { label: 'Trending market', color: 'text-green-400 bg-green-400/10 border-green-400/25' };
  if (r.includes('range')) return { label: 'Ranging market', color: 'text-gray-300 bg-gray-300/10 border-gray-300/25' };
  return { label: regime.replace(/_/g, ' '), color: 'text-gray-400 bg-gray-400/10 border-gray-400/25' };
}

function convictionLabel(confidence: number | null | undefined, tier: string | null | undefined): string {
  if (confidence == null && !tier) return '';
  if (tier) {
    const tierLabels: Record<string, string> = {
      extreme:   'extreme conviction',
      very_high: 'very high conviction',
      high:      'high conviction',
      confident: 'confident conviction',
      moderate:  'moderate conviction',
      cautious:  'cautious conviction',
      low:       'low conviction',
      no_read:   'no clear read',
    };
    const label = tierLabels[tier] ?? tier;
    const pct = confidence != null ? ` (${confidence}%)` : '';
    return `Alpha entered this trade with ${label}${pct}.`;
  }
  if (confidence == null) return '';
  if (confidence >= 80) return `Alpha entered this trade with strong conviction at ${confidence}% confidence.`;
  if (confidence >= 65) return `Alpha entered this trade with confident conviction at ${confidence}% confidence.`;
  if (confidence >= 50) return `Alpha entered this trade with cautious conviction at ${confidence}% confidence.`;
  return `Alpha entered this trade with low conviction at ${confidence}% confidence, indicating a higher-risk setup.`;
}

interface JournalCardProps {
  entry: any;
}

const JournalCard: React.FC<JournalCardProps> = ({ entry }) => {
  const [omegaExpanded, setOmegaExpanded] = useState(false);
  const rr = calcRR(entry);
  const holdTime = formatHoldTime(entry);
  const session = deriveSession(entry.entry_time);
  const hasOmega = !!(entry.omega8_liquidity_bias || entry.omega8_patterns);
  const hasPriceLevels = entry.entry_price && entry.stop_loss && entry.take_profit;
  const hasExitData = entry.exit_time && entry.exit_price;

  const normalizedStyle = normalizeTradeStyle(entry.trade_style);
  const isScalp = normalizedStyle === 'scalp';
  const hasTwoTPs = normalizedStyle === 'micro' || normalizedStyle === 'intraday';

  const slPips = hasPriceLevels ? calcPips(entry.symbol, entry.entry_price, entry.stop_loss) : null;
  const tpPips = hasPriceLevels ? calcPips(entry.symbol, entry.entry_price, entry.take_profit) : null;
  const exitPips = hasExitData && entry.entry_price
    ? calcPips(entry.symbol, entry.entry_price, entry.exit_price)
    : null;

  const pricePrecision = entry.symbol?.includes('JPY') ? 3 : 5;

  const tp1Hit = entry.journal_stage === 'tp1_hit' || entry.journal_stage === 'tp2_hit';
  const tp2Hit = entry.journal_stage === 'tp2_hit';
  const tp1OnlyThenLoss = tp1Hit && !tp2Hit && entry.outcome === 'loss';

  const hasMilestone = entry.journal_stage === 'goal_achieved'
    || entry.journal_stage === 'tp1_hit'
    || entry.journal_stage === 'tp2_hit';

  const dollarRisk = entry.dollar_risk ?? null;
  const goalPnl = entry.goal_pnl_at_achievement ?? null;
  const finalPnl = entry.pnl ?? null;

  const displayedPattern = cleanPattern(entry.pattern_identified, entry.setup_type_from_record, normalizedStyle);
  const regimeInfo = humanizeRegime(entry.market_regime_at_entry ?? entry.regime_bucket);
  const effectiveConfidence = entry.trade_confidence_from_record ?? entry.conviction_level ?? null;
  const effectiveTier = entry.confidence_tier_from_record ?? null;

  return (
    <div
      className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-white/5 hover:bg-gray-800/70 transition-all overflow-hidden"
      style={{
        borderLeft: `4px solid ${
          entry.outcome === 'win' ? '#10b981'
          : entry.outcome === 'loss' ? '#ef4444'
          : '#6b7280'
        }`
      }}
    >
      {/* Header */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex-shrink-0">
              {entry.outcome === 'win' ? (
                <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-green-500" />
              ) : entry.outcome === 'loss' ? (
                <XCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
              ) : entry.outcome === 'open' ? (
                <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500 animate-pulse" />
              ) : (
                <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gray-600" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-white">
                {entry.symbol} {entry.direction?.toUpperCase()}
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                <p className="text-xs text-gray-400">
                  {new Date(entry.entry_time).toLocaleString()}
                </p>
                <span className="text-xs text-gray-500 bg-gray-700/50 rounded-full px-2 py-0.5">{session}</span>
                {normalizedStyle && (
                  <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5 ${styleColors(normalizedStyle)}`}>
                    {styleIcon(normalizedStyle)}
                    {styleLabel(normalizedStyle)}
                  </span>
                )}
                {entry.outcome === 'open' && (
                  <span className="text-xs text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-full px-2 py-0.5">Live</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className={`text-xl sm:text-2xl font-bold tabular-nums ${
              entry.pnl > 0 ? 'text-green-400'
              : entry.pnl < 0 ? 'text-red-400'
              : 'text-gray-400'
            }`}>
              {entry.outcome === 'open' ? 'OPEN' : pnlStr(finalPnl ?? 0)}
            </div>

            {dollarRisk != null && goalPnl != null && entry.outcome !== 'open' && (
              <span className="text-xs text-gray-400 whitespace-nowrap">
                Risked{' '}
                <span className="text-red-400 font-medium">${Number(dollarRisk).toFixed(0)}</span>
                {' → Returned '}
                <span className={`font-medium ${finalPnl != null && finalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {pnlStr(finalPnl ?? goalPnl)}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* TP milestone badges — per-style logic */}
        {hasMilestone && (
          <div className="flex items-center gap-1.5 mb-3 text-xs font-medium overflow-x-auto pb-0.5">
            {/* Scalp — always just "TP Hit" regardless of stage name */}
            {isScalp && (tp1Hit || entry.journal_stage === 'goal_achieved') && (
              <span className="flex items-center gap-1 bg-green-400/15 text-green-400 border border-green-400/25 rounded-full px-2.5 py-1 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                TP Hit {entry.tp1_pnl != null ? pnlStr(entry.tp1_pnl) : goalPnl != null ? pnlStr(goalPnl) : ''}
              </span>
            )}

            {/* Micro / Intraday — up to 2 TPs */}
            {hasTwoTPs && tp1Hit && entry.tp1_pnl != null && (
              <span className="flex items-center gap-1 bg-blue-400/15 text-blue-400 border border-blue-400/25 rounded-full px-2.5 py-1 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                TP1 Hit {pnlStr(entry.tp1_pnl)}
              </span>
            )}
            {hasTwoTPs && tp2Hit && entry.tp2_pnl != null && (
              <>
                <span className="text-gray-600 flex-shrink-0">→</span>
                <span className="flex items-center gap-1 bg-green-400/15 text-green-400 border border-green-400/25 rounded-full px-2.5 py-1 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                  TP2 Hit {pnlStr(entry.tp2_pnl)}
                </span>
              </>
            )}
            {/* TP1-only then trade lost after TP1 */}
            {hasTwoTPs && tp1OnlyThenLoss && (
              <>
                <span className="text-gray-600 flex-shrink-0">→</span>
                <span className="flex items-center gap-1 bg-red-400/15 text-red-400 border border-red-400/25 rounded-full px-2.5 py-1 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  Trade Loss {finalPnl != null ? pnlStr(finalPnl) : ''}
                </span>
              </>
            )}

          </div>
        )}

        {/* Trade levels */}
        {hasPriceLevels && (
          <div className="grid grid-cols-4 gap-1.5 mb-3 text-xs">
            <div className="bg-gray-700/40 rounded-lg p-2">
              <span className="text-gray-500 block mb-0.5">Entry</span>
              <span className="text-white font-mono font-medium">{formatPrice(entry.symbol, entry.entry_price)}</span>
            </div>
            <div className="bg-red-900/20 border border-red-900/30 rounded-lg p-2">
              <span className="text-gray-500 block mb-0.5">SL</span>
              <span className="text-red-400 font-mono font-medium">{formatPrice(entry.symbol, entry.stop_loss)}</span>
              {slPips !== null && <span className="text-gray-500 block mt-0.5">{slPips}p</span>}
            </div>
            <div className="bg-green-900/20 border border-green-900/30 rounded-lg p-2">
              <span className="text-gray-500 block mb-0.5">{isScalp ? 'TP' : hasTwoTPs ? 'TP1' : 'TP'}</span>
              <span className="text-green-400 font-mono font-medium">{formatPrice(entry.symbol, entry.take_profit)}</span>
              {tpPips !== null && <span className="text-gray-500 block mt-0.5">{tpPips}p</span>}
            </div>
            <div className="bg-blue-900/20 border border-blue-900/30 rounded-lg p-2">
              <span className="text-gray-500 block mb-0.5">Reward : Risk</span>
              <span className="text-blue-400 font-medium">{rr ? `${rr}:1` : 'N/A'}</span>
            </div>
          </div>
        )}

        {/* Exit details */}
        {hasExitData && (
          <div className="grid grid-cols-3 gap-1.5 mb-3 text-xs">
            <div className="bg-gray-700/40 rounded-lg p-2">
              <span className="text-gray-500 block mb-0.5">Exit Price</span>
              <span className="text-white font-mono font-medium">{entry.exit_price.toFixed(pricePrecision)}</span>
            </div>
            <div className="bg-gray-700/40 rounded-lg p-2">
              <span className="text-gray-500 block mb-0.5">Pips Moved</span>
              <span className={`font-medium ${
                entry.outcome === 'win' ? 'text-green-400'
                : entry.outcome === 'loss' ? 'text-red-400'
                : 'text-gray-400'
              }`}>
                {exitPips !== null ? `${exitPips}p` : 'N/A'}
              </span>
            </div>
            <div className="bg-gray-700/40 rounded-lg p-2">
              <span className="text-gray-500 block mb-0.5">Held</span>
              <span className="text-gray-300 font-medium">{holdTime ?? 'N/A'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Narrative sections */}
      <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-2.5">
        {(entry.alpha_reasoning_snapshot || entry.llm_reasoning) && (
          <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-3.5">
            <h4 className="text-xs font-semibold text-blue-400 mb-2 flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5" /> Why Alpha Took This Trade
            </h4>
            {(effectiveConfidence != null || effectiveTier) && (
              <p className="text-xs text-gray-400 mb-2 italic leading-relaxed">
                {convictionLabel(effectiveConfidence, effectiveTier)}
              </p>
            )}
            <p className="text-sm text-gray-300 leading-relaxed">
              {entry.alpha_reasoning_snapshot || entry.llm_reasoning}
            </p>
          </div>
        )}

        {(regimeInfo || entry.market_read) && (
          <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-3.5">
            <h4 className="text-xs font-semibold text-blue-400 mb-2 flex items-center gap-1.5">
              <BarChart2 className="w-3.5 h-3.5" /> Market Context
            </h4>
            {regimeInfo && (
              <span className={`inline-block text-xs font-medium border rounded-full px-2.5 py-1 mb-2 ${regimeInfo.color}`}>
                {regimeInfo.label}
              </span>
            )}
            {entry.market_read && (
              <p className="text-sm text-gray-300 leading-relaxed">{entry.market_read}</p>
            )}
          </div>
        )}

        {(entry.expected_outcome || entry.tp1_reasoning_from_record || entry.tp2_reasoning_from_record) && (
          <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-3.5">
            <h4 className="text-xs font-semibold text-blue-400 mb-2 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" /> Trade Plan
            </h4>
            {entry.expected_outcome && (
              <p className="text-sm text-gray-300 leading-relaxed mb-2">{entry.expected_outcome}</p>
            )}
            {entry.tp1_reasoning_from_record && (
              <div className="mt-2 pt-2 border-t border-blue-500/10">
                <span className="text-xs font-medium text-blue-300 block mb-1">TP1 Target Logic</span>
                <p className="text-xs text-gray-400 leading-relaxed">{entry.tp1_reasoning_from_record}</p>
              </div>
            )}
            {entry.tp2_reasoning_from_record && (
              <div className="mt-2 pt-2 border-t border-blue-500/10">
                <span className="text-xs font-medium text-blue-300 block mb-1">TP2 Target Logic</span>
                <p className="text-xs text-gray-400 leading-relaxed">{entry.tp2_reasoning_from_record}</p>
              </div>
            )}
          </div>
        )}

        {entry.exit_time && (
          <>
            <hr className="border-gray-700/40 my-1" />

            {entry.actual_outcome && (
              <div className="bg-yellow-500/5 border border-yellow-500/10 rounded-xl p-3">
                <h4 className="text-xs font-semibold text-yellow-400 mb-1.5 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> What Actually Happened
                </h4>
                <p className="text-sm text-gray-300 leading-relaxed">{entry.actual_outcome}</p>
              </div>
            )}

            {entry.was_prediction_correct !== null && entry.was_prediction_correct !== undefined && (
              <div className={`border rounded-xl p-3 ${
                entry.was_prediction_correct
                  ? 'bg-green-500/5 border-green-500/15'
                  : 'bg-red-500/5 border-red-500/15'
              }`}>
                <h4 className={`text-xs font-semibold ${entry.was_prediction_correct ? 'text-green-400' : 'text-red-400'}`}>
                  {entry.was_prediction_correct ? '✓ Prediction Correct' : '✗ Prediction Incorrect'}
                  {entry.accuracy_score ? ` — ${entry.accuracy_score.toFixed(0)}% accuracy` : ''}
                </h4>
              </div>
            )}

            {entry.lesson_learned && (
              <div className="bg-yellow-500/5 border border-yellow-500/10 rounded-xl p-3">
                <h4 className="text-xs font-semibold text-yellow-400 mb-1.5">What Alpha Learned</h4>
                <p className="text-sm text-gray-300 leading-relaxed">{entry.lesson_learned}</p>
              </div>
            )}

            {entry.what_worked && (
              <div className="bg-green-500/8 border border-green-600/25 rounded-xl p-3">
                <h4 className="text-xs font-semibold text-green-400 mb-1.5">What Worked</h4>
                <p className="text-sm text-gray-300 leading-relaxed">{entry.what_worked}</p>
              </div>
            )}

            {entry.mistake_identified && (
              <div className="bg-red-500/8 border border-red-600/25 rounded-xl p-3">
                <h4 className="text-xs font-semibold text-red-400 mb-1.5">Mistake Identified</h4>
                <p className="text-sm text-gray-300 leading-relaxed">{entry.mistake_identified}</p>
              </div>
            )}
          </>
        )}

        {/* Metadata grid */}
        <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-gray-700/40 mt-1">
          <div className="bg-gray-700/30 rounded-lg p-2">
            <span className="text-xs text-gray-500 block mb-0.5">Setup</span>
            <p className="text-xs text-gray-300 font-medium truncate">{displayedPattern}</p>
          </div>
          <div className="bg-gray-700/30 rounded-lg p-2">
            <span className="text-xs text-gray-500 block mb-0.5">Conviction</span>
            {effectiveTier ? (
              <p className="text-xs text-gray-300 font-medium capitalize">
                {effectiveTier.replace('_', ' ')}
                {effectiveConfidence != null && (
                  <span className="text-gray-500 font-normal ml-1">({effectiveConfidence}%)</span>
                )}
              </p>
            ) : (
              <p className="text-xs text-gray-300 font-medium">
                {effectiveConfidence != null ? `${effectiveConfidence}%` : 'N/A'}
              </p>
            )}
            {effectiveConfidence != null && (
              <div className="mt-1 h-1 w-full bg-gray-600/50 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    effectiveConfidence >= 75 ? 'bg-green-400'
                    : effectiveConfidence >= 55 ? 'bg-yellow-400'
                    : 'bg-red-400'
                  }`}
                  style={{ width: `${Math.min(100, effectiveConfidence)}%` }}
                />
              </div>
            )}
          </div>
          <div className="bg-gray-700/30 rounded-lg p-2">
            <span className="text-xs text-gray-500 block mb-0.5">Rank</span>
            <p className="text-xs text-gray-300 font-medium capitalize truncate">{entry.rank_at_time || 'N/A'}</p>
          </div>
        </div>

        {/* Omega Council — collapsible */}
        {hasOmega && (
          <div className="border border-gray-700/40 rounded-xl overflow-hidden">
            <button
              onClick={() => setOmegaExpanded(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-400 hover:text-gray-300 hover:bg-gray-700/20 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                Omega Council Audit
                {entry.omega9_pass === true && (
                  <span className="text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-1.5 py-0.5 text-xs ml-1">Safety ✓</span>
                )}
                {entry.omega9_pass === false && (
                  <span className="text-red-400 bg-red-400/10 border border-red-400/20 rounded-full px-1.5 py-0.5 text-xs ml-1">Safety ✗</span>
                )}
              </span>
              {omegaExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {omegaExpanded && (
              <div className="px-3 pb-3 pt-1 space-y-2 bg-gray-900/30">
                {entry.omega8_liquidity_bias && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500 block mb-0.5">Liquidity Context</span>
                      <span className="text-gray-300 font-medium capitalize">{entry.omega8_liquidity_bias.replace(/_/g, ' ')}</span>
                    </div>
                    {entry.omega8_patterns && (
                      <div>
                        <span className="text-gray-500 block mb-0.5">Confluence</span>
                        <span className="text-gray-300 font-medium">{entry.omega8_patterns.confluenceScore ?? '—'} signals</span>
                      </div>
                    )}
                    {entry.omega9_pass != null && (
                      <div>
                        <span className="text-gray-500 block mb-0.5">Hallucination Check</span>
                        <span className={`font-medium ${entry.omega9_pass ? 'text-green-400' : 'text-red-400'}`}>
                          {entry.omega9_pass ? 'Passed' : 'Failed'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {entry.omega8_reasoning && (
                  <div>
                    <span className="text-gray-500 text-xs block mb-0.5">Omega8 Reasoning</span>
                    <p className="text-xs text-gray-400 leading-relaxed">{entry.omega8_reasoning}</p>
                  </div>
                )}
                {entry.omega9_reasoning && (
                  <div>
                    <span className="text-gray-500 text-xs block mb-0.5">Omega9 Notes</span>
                    <p className="text-xs text-gray-400 leading-relaxed">{entry.omega9_reasoning}</p>
                  </div>
                )}
                {entry.omega9_flags && Array.isArray(entry.omega9_flags) && entry.omega9_flags.length > 0 && (
                  <div>
                    <span className="text-gray-500 text-xs block mb-1">Safety Flags</span>
                    <div className="flex flex-wrap gap-1">
                      {entry.omega9_flags.map((flag: string, i: number) => (
                        <span key={i} className="text-xs bg-red-400/10 border border-red-400/20 text-red-300 rounded px-1.5 py-0.5">{flag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const AITradeJournal: React.FC = () => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'win' | 'loss'>('all');

  useEffect(() => {
    if (user) {
      loadEntries();

      const subscription = supabase
        .channel('journal_updates')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'ai_trade_journal',
          filter: `user_id=eq.${user.id}`
        }, () => {
          loadEntries();
        })
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [user]);

  const loadEntries = async () => {
    if (!user) return;
    const data = await llmReasoningLogger.getJournalEntries(user.id, 100);
    setEntries(data);
    setLoading(false);
  };

  const filteredEntries = entries.filter(entry => {
    if (filter === 'all') return true;
    return entry.outcome === filter;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-12 w-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="bg-gray-900/80 backdrop-blur-xl p-4 sm:p-6 border-b border-white/10 shadow-lg shadow-black/20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all font-medium ${
                filter === 'all'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('win')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all font-medium ${
                filter === 'win'
                  ? 'bg-green-600 text-white shadow-lg shadow-green-500/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
              }`}
            >
              Wins
            </button>
            <button
              onClick={() => setFilter('loss')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all font-medium ${
                filter === 'loss'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-500/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
              }`}
            >
              Losses
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mobile-panel-scroll px-4 sm:px-6 py-6 sm:py-8">
        <div className="max-w-4xl mx-auto">
          {filteredEntries.length === 0 ? (
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 sm:p-12 text-center border border-white/5">
              <div className="p-4 bg-gray-700/30 rounded-2xl w-20 h-20 flex items-center justify-center mx-auto mb-4">
                <Brain className="w-12 h-12 text-gray-500" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-3">No Journal Entries Yet</h3>
              <p className="text-gray-400 mb-2 max-w-md mx-auto">
                Alpha will start documenting its reasoning as soon as you take trades.
              </p>
              <p className="text-sm text-gray-500 max-w-sm mx-auto">
                Every trade decision, market context, and lesson learned will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {filteredEntries.map((entry) => (
                <JournalCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
