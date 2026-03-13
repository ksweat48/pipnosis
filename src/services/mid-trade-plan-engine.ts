/**
 * Mid-Trade Plan Engine
 *
 * SSOT for deterministic mid-trade evaluation against Alpha's original trade plan.
 * Replaces ALL LLM calls for the 13 trigger types with rule-based calculations
 * that reference the immutable mid_trade_plan snapshot stored at trade entry.
 *
 * GOVERNANCE: Read-only advisory service — no trade mutations
 * CCIP: All 13 triggers are deterministic, zero LLM cost post-entry
 * SSOT: mid_trade_plan column in goal_session_trades is the single authority
 *       for the original trade plan. This engine never re-derives from alpha_decisions.
 */

import { calculatePipDistance, getCurrencyPipInfo, isJPYPair, isIndex, isCrypto } from '@/utils/currencyHelpers';
import type { GoalSessionTrade } from '@/types/position';

export type ScalpPattern =
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

export type ScalpSubMode = 'momentum_continuation' | 'pullback_entry' | 'consolidation_breakout';
export type ScalpMomentumPhase = 'starting' | 'developing' | 'exhausted';

export interface MidTradePlan {
  setup_summary: string;
  entry_narrative?: string;
  invalidation_price: number | null;
  key_levels: Array<{ price: number; type: 'support' | 'resistance' | 'target' | 'invalidation'; label: string }>;
  expected_direction: 'up' | 'down';
  trailing_method: 'atr' | 'swing' | 'breakeven';
  regime_at_entry: string;
  patterns: { htf?: string; mtf?: string; ltf?: string };
  omega_consensus?: string;
  atr_at_entry?: number;
  expected_duration_minutes?: number;
  scalp_pattern?: ScalpPattern;
  scalp_sub_mode?: ScalpSubMode;
  scalp_momentum_phase?: ScalpMomentumPhase;
  scalp_atr_traveled?: number;
}

export interface TrailingSLOptions {
  breakeven: { price: number; label: string; locksRMultiple: number };
  atr: { price: number; label: string; locksRMultiple: number } | null;
  swing: { price: number; label: string; locksRMultiple: number } | null;
  recommended: 'breakeven' | 'atr' | 'swing';
  recommendedPrice: number;
  reasoning: string;
}

export interface TriggerEvaluation {
  triggered: boolean;
  triggerType: string | null;
  severity: 'info' | 'caution' | 'warning' | 'critical';
  primaryMessage: string;
  subMessage: string;
  actionPrice: number | null;
  actionLabel: string | null;
  thesisIntact: boolean;
  urgencyScore: number;
  color: 'emerald' | 'amber' | 'red' | 'blue' | 'orange';
  action: 'hold' | 'trail_sl' | 'warning' | 'tp1_timing' | 'risk_alert';
  trailingSLOptions?: TrailingSLOptions;
  /**
   * SSOT: Current R-multiple derived from entry, SL, and live price.
   * Computed once in evaluateAllTriggers and propagated to MidTradeGuidance.
   * NEVER re-derived downstream — always read from this field.
   */
  rMultiple: number;
}

/**
 * Build the mid_trade_plan snapshot from an Alpha decision.
 * Called once at trade entry by alpha-trade-executor.
 * Result is stored in goal_session_trades.mid_trade_plan (immutable after write).
 */
const SCALP_PATTERN_LABELS_ENGINE: Record<string, string> = {
  momentum_breakout: 'Momentum Breakout',
  bos_retest: 'Break of Structure Retest',
  ema_rejection: 'EMA Rejection',
  double_bottom: 'Double Bottom',
  double_top: 'Double Top',
  range_breakout: 'Range Breakout',
  liquidity_sweep: 'Liquidity Sweep',
  engulfing_at_structure: 'Engulfing at Structure',
  trend_pullback_ema: 'Trend Pullback to EMA',
  none: '',
};

const SCALP_SUBMODE_LABELS_ENGINE: Record<string, string> = {
  momentum_continuation: 'momentum continuation',
  pullback_entry: 'pullback entry',
  consolidation_breakout: 'breakout from consolidation',
};

const SCALP_MOMENTUM_PHASE_LABELS: Record<string, string> = {
  starting: 'fresh momentum starting',
  developing: 'momentum developing',
  exhausted: 'momentum showing exhaustion',
};

function extractKeySignalsFromReasoning(reasoning: string): {
  momentum: string | null;
  ema: string | null;
  rsi: string | null;
  structure: string | null;
  confluence: string | null;
} {
  const lower = reasoning.toLowerCase();

  const momentumMatch = reasoning.match(/momentum\s+is\s+([\w\s]+?)[\.,;]/i)
    || reasoning.match(/(strong|bullish|bearish|positive|negative|increasing|decreasing)\s+momentum/i);
  const emaMatch = reasoning.match(/ema[s]?\s+(?:is\s+)?(?:at\s+|around\s+)?([\d.]+)/i)
    || reasoning.match(/price\s+(?:is\s+)?(?:above|below)\s+(?:the\s+)?ema/i);
  const rsiMatch = reasoning.match(/rsi\s+(?:is\s+)?(?:at\s+)?([\d.]+)/i)
    || reasoning.match(/(?:over|over-?sold|overbought|over-?bought)\s+(?:at\s+)?([\d.]+)?/i);
  const structureMatch = reasoning.match(/(?:break\s+of\s+structure|bos|market\s+structure)\s+(?:on\s+the\s+)?([\w\s]+?(?:timeframe|tf|frame))/i)
    || reasoning.match(/(htf|h4|h1|4h|1h|d1|daily)\s+(?:structure|bias|trend)/i);
  const confluenceMatch = reasoning.match(/(\d+)\s+(?:out\s+of\s+\d+|of\s+\d+)\s+(?:confirmations?|signals?)/i)
    || reasoning.match(/(\d+)\s+confluences?/i)
    || reasoning.match(/(?:multiple|strong)\s+confluence/i);

  return {
    momentum: momentumMatch ? (momentumMatch[1] || momentumMatch[0]).trim() : null,
    ema: lower.includes('ema') ? (emaMatch ? (emaMatch[1] || emaMatch[0]).trim() : 'confirming') : null,
    rsi: lower.includes('rsi') || lower.includes('oversold') || lower.includes('overbought') ? (rsiMatch ? (rsiMatch[1] || rsiMatch[0]).trim() : 'extended') : null,
    structure: structureMatch ? (structureMatch[1] || structureMatch[0]).trim() : null,
    confluence: confluenceMatch ? (confluenceMatch[1] || confluenceMatch[0]).trim() : null,
  };
}

function buildEntryNarrative(params: {
  reasoning: string;
  direction: 'buy' | 'sell';
  symbol: string;
  marketRegime: string | null;
  htfPattern: string | null;
  mtfPattern: string | null;
  ltfPattern: string | null;
  scalpPattern?: ScalpPattern | null;
  scalpSubMode?: ScalpSubMode | null;
  scalpMomentumPhase?: ScalpMomentumPhase | null;
  confidence: number;
  expectedDurationMinutes?: number;
  omegaConsensus?: string | null;
}): string {
  const {
    reasoning, direction, symbol, marketRegime, htfPattern, mtfPattern, ltfPattern,
    scalpPattern, scalpSubMode, scalpMomentumPhase, confidence, expectedDurationMinutes, omegaConsensus
  } = params;

  const directionWord = direction === 'buy' ? 'long' : 'short';
  const signals = extractKeySignalsFromReasoning(reasoning);

  const parts: string[] = [];

  // Pattern identification
  if (scalpPattern && scalpPattern !== 'none') {
    const patternLabel = SCALP_PATTERN_LABELS_ENGINE[scalpPattern] || scalpPattern;
    const subLabel = scalpSubMode ? SCALP_SUBMODE_LABELS_ENGINE[scalpSubMode] : null;
    parts.push(`I identified a ${patternLabel}${subLabel ? ` via ${subLabel}` : ''} on ${symbol}`);
  } else if (htfPattern || mtfPattern) {
    const primaryPattern = htfPattern || mtfPattern;
    parts.push(`I identified a ${primaryPattern} setup on ${symbol}`);
  } else {
    parts.push(`I identified a technical setup on ${symbol}`);
  }

  // Multi-timeframe confirmation
  const confirmedTimeframes: string[] = [];
  if (htfPattern) confirmedTimeframes.push('higher timeframe');
  if (mtfPattern) confirmedTimeframes.push('mid timeframe');
  if (ltfPattern) confirmedTimeframes.push('execution timeframe');

  if (confirmedTimeframes.length > 1) {
    parts.push(`This setup is confirmed across ${confirmedTimeframes.join(' and ')}`);
  } else if (confirmedTimeframes.length === 1) {
    parts.push(`I confirmed this on the ${confirmedTimeframes[0]}`);
  }

  // Structure
  if (signals.structure) {
    const structureText = signals.structure.replace(/\b(htf|h4|h1|4h|1h|d1|daily)\b/i, (m) => m.toUpperCase());
    parts.push(`Market structure on the ${structureText} supports a ${directionWord}`);
  }

  // Momentum
  if (scalpMomentumPhase) {
    parts.push(SCALP_MOMENTUM_PHASE_LABELS[scalpMomentumPhase] || `momentum phase: ${scalpMomentumPhase}`);
  } else if (signals.momentum) {
    parts.push(`momentum is ${signals.momentum}`);
  }

  // EMA
  if (signals.ema) {
    parts.push(`price is ${signals.ema === 'confirming' ? (direction === 'buy' ? 'above' : 'below') + ' the EMA, confirming direction' : 'interacting with the EMA at ' + signals.ema}`);
  }

  // RSI / oversold / overbought
  if (signals.rsi) {
    const rsiNum = parseFloat(signals.rsi);
    if (!isNaN(rsiNum)) {
      const condition = rsiNum < 35 ? 'oversold' : rsiNum > 65 ? 'overbought' : 'at ' + rsiNum;
      parts.push(`RSI is ${condition}`);
    } else {
      const rsiLower = signals.rsi.toLowerCase();
      if (rsiLower.includes('oversold') || rsiLower.includes('overbought')) {
        parts.push(signals.rsi);
      }
    }
  }

  // Regime context
  if (marketRegime && marketRegime !== 'unknown') {
    const regimeLower = marketRegime.toLowerCase();
    if (!regimeLower.includes('unknown')) {
      parts.push(`current market regime is ${marketRegime}`);
    }
  }

  // Omega consensus
  if (omegaConsensus) {
    const consensusShort = omegaConsensus.length > 80 ? omegaConsensus.substring(0, 77) + '...' : omegaConsensus;
    parts.push(`advisory consensus: ${consensusShort}`);
  }

  // Confidence and duration
  const confidenceLevel = confidence >= 75 ? 'high' : confidence >= 60 ? 'moderate' : 'cautious';
  const rrMatch = reasoning.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*(?:r[:\s]?r|risk.?reward)/i);
  const rrText = rrMatch ? ` with a ${rrMatch[1]}:${rrMatch[2]} R:R` : '';

  parts.push(
    `With all of these confirmations I took a ${directionWord}${rrText}. My confidence is ${confidence}% (${confidenceLevel})${expectedDurationMinutes ? ` and this trade should last approximately ${expectedDurationMinutes} minutes` : ''}.`
  );

  // Stitch the narrative together naturally
  const [first, ...rest] = parts;
  if (rest.length === 0) return first + '.';

  // Join into a flowing paragraph
  const body = rest.slice(0, -1).join(', ') ;
  const closing = rest[rest.length - 1];

  if (body) {
    return `${first}. ${capitalize(body)}. ${capitalize(closing)}`;
  }
  return `${first}. ${capitalize(closing)}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildMidTradePlan(params: {
  reasoning: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  direction: 'buy' | 'sell';
  symbol: string;
  marketRegime: string | null;
  patternInvalidationPrice: number | null;
  patternInvalidationReasoning: string | null;
  htfPattern: string | null;
  mtfPattern: string | null;
  ltfPattern: string | null;
  omegaConsensus: string | null;
  confidence: number;
  expectedFillMinutes?: number | null;
  scalpPattern?: ScalpPattern | null;
  scalpSubMode?: ScalpSubMode | null;
  scalpMomentumPhase?: ScalpMomentumPhase | null;
  scalpAtrTraveled?: number | null;
}): MidTradePlan {
  const {
    reasoning, entryPrice, stopLoss, takeProfit, direction, symbol,
    marketRegime, patternInvalidationPrice, htfPattern, mtfPattern, ltfPattern,
    omegaConsensus, expectedFillMinutes,
    scalpPattern, scalpSubMode, scalpMomentumPhase, scalpAtrTraveled
  } = params;

  const risk = Math.abs(entryPrice - stopLoss);
  const isLong = direction === 'buy';

  // Build key levels array
  const keyLevels: MidTradePlan['key_levels'] = [
    {
      price: stopLoss,
      type: 'invalidation',
      label: 'Stop Loss (Thesis Invalidation)'
    },
    {
      price: takeProfit,
      type: 'target',
      label: 'Take Profit Target'
    }
  ];

  // Add invalidation price if different from SL
  if (patternInvalidationPrice && Math.abs(patternInvalidationPrice - stopLoss) > 0.00001) {
    keyLevels.push({
      price: patternInvalidationPrice,
      type: 'invalidation',
      label: 'Pattern Invalidation Level'
    });
  }

  // Breakeven level
  keyLevels.push({
    price: entryPrice,
    type: isLong ? 'support' : 'resistance',
    label: 'Breakeven (Entry)'
  });

  // +1R level
  const oneRLevel = isLong ? entryPrice + risk : entryPrice - risk;
  keyLevels.push({
    price: Math.round(oneRLevel * 100000) / 100000,
    type: 'target',
    label: '+1R Milestone'
  });

  // +2R level
  const twoRLevel = isLong ? entryPrice + (risk * 2) : entryPrice - (risk * 2);
  keyLevels.push({
    price: Math.round(twoRLevel * 100000) / 100000,
    type: 'target',
    label: '+2R Milestone'
  });

  // Determine expected duration from reasoning text
  let expectedDurationMinutes: number | undefined;
  if (expectedFillMinutes && expectedFillMinutes > 0) {
    expectedDurationMinutes = expectedFillMinutes;
  } else {
    const durationMatch = reasoning.match(/Expected fill:\s*(\d+)\s*min/i);
    if (durationMatch) {
      expectedDurationMinutes = parseInt(durationMatch[1]);
    }
  }

  // Build 1-line setup summary
  const patternStr = [htfPattern, mtfPattern].filter(Boolean).join(' + ') || 'Technical Setup';
  const regimeStr = marketRegime ? ` [${marketRegime}]` : '';
  const setupSummary = `${patternStr}${regimeStr} — ${direction === 'buy' ? 'Long' : 'Short'} entry at ${entryPrice}`;

  const entryNarrative = buildEntryNarrative({
    reasoning,
    direction,
    symbol,
    marketRegime,
    htfPattern,
    mtfPattern,
    ltfPattern,
    scalpPattern,
    scalpSubMode,
    scalpMomentumPhase,
    confidence: params.confidence,
    expectedDurationMinutes,
    omegaConsensus,
  });

  return {
    setup_summary: setupSummary,
    entry_narrative: entryNarrative,
    invalidation_price: patternInvalidationPrice ?? stopLoss,
    key_levels: keyLevels.sort((a, b) => (direction === 'sell' ? b.price - a.price : a.price - b.price)),
    expected_direction: direction === 'buy' ? 'up' : 'down',
    trailing_method: 'breakeven',
    regime_at_entry: marketRegime || 'unknown',
    patterns: {
      htf: htfPattern ?? undefined,
      mtf: mtfPattern ?? undefined,
      ltf: ltfPattern ?? undefined
    },
    omega_consensus: omegaConsensus ?? undefined,
    expected_duration_minutes: expectedDurationMinutes,
    scalp_pattern: scalpPattern ?? undefined,
    scalp_sub_mode: scalpSubMode ?? undefined,
    scalp_momentum_phase: scalpMomentumPhase ?? undefined,
    scalp_atr_traveled: scalpAtrTraveled ?? undefined
  };
}

/**
 * Calculate explicit trailing stop options with exact prices.
 * SSOT for trailing SL calculation — returns 3 options with the recommended price.
 */
export function calculateTrailingSLOptions(
  trade: Pick<GoalSessionTrade, 'direction' | 'entry_price' | 'stop_loss' | 'take_profit' | 'symbol' | 'lot_size' | 'position_size'>,
  currentPrice: number,
  midTradePlan: MidTradePlan | null
): TrailingSLOptions {
  const isLong = trade.direction === 'buy';
  const risk = Math.abs(trade.entry_price - trade.stop_loss);
  const lotSize = trade.lot_size || trade.position_size;
  const pipInfo = getCurrencyPipInfo(trade.symbol);
  const pipValue = pipInfo.pipValue;

  // ATR estimate: use risk as proxy (risk ≈ 1x ATR at entry for most setups)
  const atrEstimate = midTradePlan?.atr_at_entry ?? risk;

  // --- OPTION 1: Breakeven trail (exact entry price + 1 pip buffer)
  const breakevenBuffer = pipValue * 1; // 1 pip beyond entry
  const breakevenPrice = isLong
    ? trade.entry_price + breakevenBuffer
    : trade.entry_price - breakevenBuffer;
  const breakevenPriceRounded = roundToSymbolPrecision(trade.symbol, breakevenPrice);
  const breakevenRLocked = calculateRLocked(trade.entry_price, breakevenPriceRounded, risk, isLong);

  // --- OPTION 2: ATR-based trail (current price minus 1x ATR in trade direction)
  let atrOption: TrailingSLOptions['atr'] = null;
  if (atrEstimate > 0) {
    const atrTrailPrice = isLong
      ? currentPrice - atrEstimate
      : currentPrice + atrEstimate;
    const atrPriceRounded = roundToSymbolPrecision(trade.symbol, atrTrailPrice);
    // Only valid if it's better than breakeven
    const isAtrBetterThanBreakeven = isLong
      ? atrPriceRounded > breakevenPriceRounded
      : atrPriceRounded < breakevenPriceRounded;
    if (isAtrBetterThanBreakeven) {
      const atrRLocked = calculateRLocked(trade.entry_price, atrPriceRounded, risk, isLong);
      atrOption = {
        price: atrPriceRounded,
        label: `ATR trail (1x ATR from current price)`,
        locksRMultiple: atrRLocked
      };
    }
  }

  // --- OPTION 3: +1R lock trail (move SL to guarantee +1R profit)
  const oneRLockPrice = isLong
    ? trade.entry_price + risk
    : trade.entry_price - risk;
  const oneRLockRounded = roundToSymbolPrecision(trade.symbol, oneRLockPrice);
  let swingOption: TrailingSLOptions['swing'] = null;

  // Use swing option as +1R lock if price has moved that far
  const priceDiff = isLong
    ? (currentPrice - trade.entry_price)
    : (trade.entry_price - currentPrice);
  const rMultiple = priceDiff / risk;

  if (rMultiple >= 1.0) {
    const swingRLocked = calculateRLocked(trade.entry_price, oneRLockRounded, risk, isLong);
    swingOption = {
      price: oneRLockRounded,
      label: `Lock +1R level (guaranteed profit)`,
      locksRMultiple: swingRLocked
    };
  } else if (rMultiple >= 0.5) {
    // If we're at +0.5R-1R, offer a partial gain lock
    const halfRLockPrice = isLong
      ? trade.entry_price + (risk * 0.5)
      : trade.entry_price - (risk * 0.5);
    const halfRRounded = roundToSymbolPrecision(trade.symbol, halfRLockPrice);
    const halfRLocked = calculateRLocked(trade.entry_price, halfRRounded, risk, isLong);
    swingOption = {
      price: halfRRounded,
      label: `Lock +0.5R gain`,
      locksRMultiple: halfRLocked
    };
  }

  // Determine recommendation
  let recommended: TrailingSLOptions['recommended'] = 'breakeven';
  let recommendedPrice = breakevenPriceRounded;
  let reasoning = 'Move SL to entry price to eliminate risk on this trade.';

  if (rMultiple >= 2.0 && atrOption) {
    recommended = 'atr';
    recommendedPrice = atrOption.price;
    reasoning = `At +${rMultiple.toFixed(1)}R, trail with ATR to stay in the move while protecting gains.`;
  } else if (rMultiple >= 1.5 && swingOption) {
    recommended = 'swing';
    recommendedPrice = swingOption.price;
    reasoning = `At +${rMultiple.toFixed(1)}R, lock in +1R profit minimum while keeping the trade running.`;
  } else if (rMultiple >= 1.0) {
    recommended = 'breakeven';
    recommendedPrice = breakevenPriceRounded;
    reasoning = `Profit secured. Move SL to ${breakevenPriceRounded} to guarantee breakeven at minimum.`;
  }

  return {
    breakeven: {
      price: breakevenPriceRounded,
      label: 'Breakeven trail',
      locksRMultiple: breakevenRLocked
    },
    atr: atrOption,
    swing: swingOption,
    recommended,
    recommendedPrice,
    reasoning
  };
}

/**
 * Evaluate all 13 trigger types deterministically against Alpha's trade plan.
 * Returns the highest-priority trigger that has fired.
 * ZERO LLM calls — pure math against stored plan snapshot.
 */
export function evaluateAllTriggers(
  trade: GoalSessionTrade,
  currentPrice: number,
  midTradePlan: MidTradePlan | null,
  minutesInTrade: number,
  firedTriggers: Set<string>
): TriggerEvaluation {
  const isLong = trade.direction === 'buy';
  const risk = Math.abs(trade.entry_price - trade.stop_loss);
  const priceDiff = isLong
    ? (currentPrice - trade.entry_price)
    : (trade.entry_price - currentPrice);
  const rMultiple = priceDiff / risk;
  const distanceToSL = Math.abs(currentPrice - trade.stop_loss);
  const slProximity = distanceToSL / risk;
  const drawdownPercent = Math.max(0, (-rMultiple) * 100);
  const totalTPDistance = Math.abs(trade.take_profit - trade.entry_price);
  const distanceToTP = Math.abs(currentPrice - trade.take_profit);
  const tpProgress = totalTPDistance > 0 ? 1 - (distanceToTP / totalTPDistance) : 0;

  const invalidationPrice = midTradePlan?.invalidation_price ?? trade.stop_loss;
  const setupSummary = midTradePlan?.setup_summary ?? 'Trade active';
  const regimeAtEntry = midTradePlan?.regime_at_entry ?? 'unknown';
  const expectedDuration = midTradePlan?.expected_duration_minutes ?? 90;

  const slPips = calculatePipDistance(trade.symbol, currentPrice, trade.stop_loss);
  const tpPips = calculatePipDistance(trade.symbol, currentPrice, trade.take_profit);
  const entryPips = calculatePipDistance(trade.symbol, trade.entry_price, currentPrice);

  // ─── PRIORITY 1: Near SL — CRITICAL ────────────────────────────────────────
  if (slProximity < 0.15 && !firedTriggers.has('near_sl')) {
    const slPrice = trade.stop_loss;
    const distPips = Math.abs(slPips).toFixed(1);
    const thesisBreaksAt = invalidationPrice;
    const isThesisBroken = isLong
      ? currentPrice <= invalidationPrice
      : currentPrice >= invalidationPrice;

    return {
      triggered: true,
      triggerType: 'near_sl',
      severity: 'critical',
      primaryMessage: `SL at ${formatPrice(trade.symbol, slPrice)} is ${distPips} pips away — price closing in`,
      subMessage: isThesisBroken
        ? `Alpha's thesis is broken. Original plan required price to stay ${isLong ? 'above' : 'below'} ${formatPrice(trade.symbol, thesisBreaksAt ?? slPrice)}.`
        : `${Math.round(slProximity * 100)}% of SL buffer remaining. Watch for a bounce — thesis holds above ${formatPrice(trade.symbol, thesisBreaksAt ?? slPrice)}.`,
      actionPrice: slPrice,
      actionLabel: 'SL Price',
      thesisIntact: !isThesisBroken,
      urgencyScore: 95,
      color: 'red',
      action: 'risk_alert',
      rMultiple
    };
  }

  // ─── PRIORITY 2: Severe drawdown (70%+) ─────────────────────────────────────
  if (drawdownPercent >= 70 && !firedTriggers.has('severe_drawdown')) {
    const distPips = Math.abs(slPips).toFixed(1);
    return {
      triggered: true,
      triggerType: 'severe_drawdown',
      severity: 'warning',
      primaryMessage: `Down ${drawdownPercent.toFixed(0)}% toward SL — ${distPips} pips to stop`,
      subMessage: `SL at ${formatPrice(trade.symbol, trade.stop_loss)}. Thesis valid if price ${isLong ? 'holds above' : 'stays below'} ${formatPrice(trade.symbol, invalidationPrice ?? trade.stop_loss)}.`,
      actionPrice: trade.stop_loss,
      actionLabel: 'SL Price',
      thesisIntact: drawdownPercent < 90,
      urgencyScore: 90,
      color: 'red',
      action: 'warning',
      rMultiple
    };
  }

  // ─── PRIORITY 3: Moderate drawdown (50-69%) ──────────────────────────────────
  if (drawdownPercent >= 50 && drawdownPercent < 70 && !firedTriggers.has('moderate_drawdown')) {
    const distPips = Math.abs(slPips).toFixed(1);
    return {
      triggered: true,
      triggerType: 'moderate_drawdown',
      severity: 'caution',
      primaryMessage: `Drawdown at ${drawdownPercent.toFixed(0)}% — ${distPips} pips to SL at ${formatPrice(trade.symbol, trade.stop_loss)}`,
      subMessage: `Alpha's setup: ${setupSummary}. Thesis holds if regime remains ${regimeAtEntry}.`,
      actionPrice: trade.stop_loss,
      actionLabel: 'SL Price',
      thesisIntact: true,
      urgencyScore: 75,
      color: 'amber',
      action: 'warning',
      rMultiple
    };
  }

  // ─── PRIORITY 4: Near TP (90%+ progress) ─────────────────────────────────────
  if (tpProgress >= 0.90 && !firedTriggers.has('near_tp')) {
    const tpPipsRem = Math.abs(tpPips).toFixed(1);
    return {
      triggered: true,
      triggerType: 'near_tp',
      severity: 'info',
      primaryMessage: `TP at ${formatPrice(trade.symbol, trade.take_profit)} is ${tpPipsRem} pips away — ${(tpProgress * 100).toFixed(0)}% complete`,
      subMessage: `Consider letting it hit TP or close manually at ${formatPrice(trade.symbol, currentPrice)} now for +${rMultiple.toFixed(1)}R.`,
      actionPrice: trade.take_profit,
      actionLabel: 'TP Price',
      thesisIntact: true,
      urgencyScore: 60,
      color: 'emerald',
      action: 'tp1_timing',
      rMultiple
    };
  }

  // ─── PRIORITY 5: Trail SL opportunity (+2R or better) ────────────────────────
  if (rMultiple >= 2.0 && !firedTriggers.has('trail_sl_2r')) {
    const trailOptions = calculateTrailingSLOptions(trade, currentPrice, midTradePlan);
    return {
      triggered: true,
      triggerType: 'trail_sl_2r',
      severity: 'info',
      primaryMessage: `+${rMultiple.toFixed(1)}R profit — trail SL to ${formatPrice(trade.symbol, trailOptions.recommendedPrice)} to lock in +${trailOptions.swing?.locksRMultiple.toFixed(1) ?? trailOptions.breakeven.locksRMultiple.toFixed(1)}R`,
      subMessage: trailOptions.reasoning,
      actionPrice: trailOptions.recommendedPrice,
      actionLabel: 'Move SL to',
      thesisIntact: true,
      urgencyScore: 70,
      color: 'emerald',
      action: 'trail_sl',
      trailingSLOptions: trailOptions,
      rMultiple
    };
  }

  // ─── PRIORITY 6: Trail SL at +1.5R ───────────────────────────────────────────
  if (rMultiple >= 1.5 && !firedTriggers.has('trail_sl_1.5r')) {
    const trailOptions = calculateTrailingSLOptions(trade, currentPrice, midTradePlan);
    return {
      triggered: true,
      triggerType: 'trail_sl_1.5r',
      severity: 'info',
      primaryMessage: `+${rMultiple.toFixed(1)}R — move SL to ${formatPrice(trade.symbol, trailOptions.breakeven.price)} (breakeven) to eliminate risk`,
      subMessage: `TP at ${formatPrice(trade.symbol, trade.take_profit)} is ${Math.abs(tpPips).toFixed(1)} pips away. Lock in gains by moving SL to entry.`,
      actionPrice: trailOptions.breakeven.price,
      actionLabel: 'Move SL to',
      thesisIntact: true,
      urgencyScore: 65,
      color: 'emerald',
      action: 'trail_sl',
      trailingSLOptions: trailOptions,
      rMultiple
    };
  }

  // ─── PRIORITY 7: TP 70% milestone ────────────────────────────────────────────
  if (tpProgress >= 0.70 && tpProgress < 0.90 && !firedTriggers.has('tp_70_percent')) {
    const tpPipsRem = Math.abs(tpPips).toFixed(1);
    const trailOptions = calculateTrailingSLOptions(trade, currentPrice, midTradePlan);
    return {
      triggered: true,
      triggerType: 'tp_70_percent',
      severity: 'info',
      primaryMessage: `70% to TP — ${tpPipsRem} pips to ${formatPrice(trade.symbol, trade.take_profit)}`,
      subMessage: `Consider moving SL to ${formatPrice(trade.symbol, trailOptions.breakeven.price)} to protect this +${rMultiple.toFixed(1)}R gain while targeting TP.`,
      actionPrice: trailOptions.breakeven.price,
      actionLabel: 'Move SL to',
      thesisIntact: true,
      urgencyScore: 55,
      color: 'blue',
      action: 'tp1_timing',
      trailingSLOptions: trailOptions,
      rMultiple
    };
  }

  // ─── PRIORITY 8: TP 50% milestone ────────────────────────────────────────────
  if (tpProgress >= 0.50 && tpProgress < 0.70 && !firedTriggers.has('tp_50_percent')) {
    const tpPipsRem = Math.abs(tpPips).toFixed(1);
    return {
      triggered: true,
      triggerType: 'tp_50_percent',
      severity: 'info',
      primaryMessage: `Halfway to TP — ${tpPipsRem} pips to ${formatPrice(trade.symbol, trade.take_profit)}`,
      subMessage: `Trade at +${rMultiple.toFixed(1)}R. Move SL to entry (${formatPrice(trade.symbol, trade.entry_price)}) to trade risk-free.`,
      actionPrice: trade.entry_price,
      actionLabel: 'Move SL to breakeven',
      thesisIntact: true,
      urgencyScore: 45,
      color: 'blue',
      action: 'tp1_timing',
      rMultiple
    };
  }

  // ─── PRIORITY 9: Profit +1R milestone ────────────────────────────────────────
  if (rMultiple >= 1.0 && !firedTriggers.has('profit_1r')) {
    const trailOptions = calculateTrailingSLOptions(trade, currentPrice, midTradePlan);
    return {
      triggered: true,
      triggerType: 'profit_1r',
      severity: 'info',
      primaryMessage: `+1R achieved — move SL to ${formatPrice(trade.symbol, trailOptions.breakeven.price)} (entry)`,
      subMessage: `This eliminates all risk on the trade. TP at ${formatPrice(trade.symbol, trade.take_profit)} still ${Math.abs(tpPips).toFixed(1)} pips away.`,
      actionPrice: trailOptions.breakeven.price,
      actionLabel: 'Move SL to',
      thesisIntact: true,
      urgencyScore: 50,
      color: 'emerald',
      action: 'trail_sl',
      trailingSLOptions: trailOptions,
      rMultiple
    };
  }

  // ─── PRIORITY 10: Drawdown -0.50R ────────────────────────────────────────────
  if (rMultiple <= -0.50 && !firedTriggers.has('drawdown_0.50R')) {
    return {
      triggered: true,
      triggerType: 'drawdown_0.50R',
      severity: 'caution',
      primaryMessage: `Down -0.50R — ${Math.abs(slPips).toFixed(1)} pips to SL at ${formatPrice(trade.symbol, trade.stop_loss)}`,
      subMessage: `Alpha's plan remains valid above ${formatPrice(trade.symbol, invalidationPrice ?? trade.stop_loss)}. Current setup: ${setupSummary}.`,
      actionPrice: trade.stop_loss,
      actionLabel: 'SL Price',
      thesisIntact: true,
      urgencyScore: 60,
      color: 'amber',
      action: 'warning',
      rMultiple
    };
  }

  // ─── PRIORITY 11: Drawdown -0.30R ────────────────────────────────────────────
  if (rMultiple <= -0.30 && !firedTriggers.has('drawdown_0.30R')) {
    return {
      triggered: true,
      triggerType: 'drawdown_0.30R',
      severity: 'caution',
      primaryMessage: `Pullback to -0.30R — watching ${formatPrice(trade.symbol, trade.stop_loss)} as SL`,
      subMessage: `Normal retracement. Thesis intact if price ${isLong ? 'holds above' : 'stays below'} ${formatPrice(trade.symbol, invalidationPrice ?? trade.stop_loss)}.`,
      actionPrice: trade.stop_loss,
      actionLabel: 'SL Price',
      thesisIntact: true,
      urgencyScore: 40,
      color: 'amber',
      action: 'hold',
      rMultiple
    };
  }

  // ─── PRIORITY 12: Time exceeded 2x expected ──────────────────────────────────
  if (minutesInTrade > expectedDuration * 2 && !firedTriggers.has('time_exceeded_2x')) {
    return {
      triggered: true,
      triggerType: 'time_exceeded_2x',
      severity: 'caution',
      primaryMessage: `Trade running ${formatMinutes(minutesInTrade)} — 2x expected duration (${expectedDuration}m)`,
      subMessage: rMultiple > 0
        ? `Up +${rMultiple.toFixed(1)}R. Consider closing at ${formatPrice(trade.symbol, currentPrice)} or moving SL to ${formatPrice(trade.symbol, trade.entry_price)}.`
        : `Flat or slightly down. Alpha's setup may have stalled. SL at ${formatPrice(trade.symbol, trade.stop_loss)}.`,
      actionPrice: rMultiple > 0 ? trade.entry_price : trade.stop_loss,
      actionLabel: rMultiple > 0 ? 'Move SL to breakeven' : 'SL Price',
      thesisIntact: rMultiple > -0.5,
      urgencyScore: 50,
      color: 'amber',
      action: rMultiple > 0 ? 'trail_sl' : 'warning',
      rMultiple
    };
  }

  // ─── PRIORITY 13: Trade stalling (small range) ───────────────────────────────
  // (No candle data available in this path, handled via 20-min time check proxy)
  if (minutesInTrade > 20 && Math.abs(rMultiple) < 0.15 && !firedTriggers.has('trade_stalling')) {
    return {
      triggered: true,
      triggerType: 'trade_stalling',
      severity: 'info',
      primaryMessage: `Consolidating near entry after ${formatMinutes(minutesInTrade)}`,
      subMessage: `Price range tight. Watching for breakout ${isLong ? 'above' : 'below'} ${formatPrice(trade.symbol, currentPrice)}. SL at ${formatPrice(trade.symbol, trade.stop_loss)}.`,
      actionPrice: null,
      actionLabel: null,
      thesisIntact: true,
      urgencyScore: 25,
      color: 'blue',
      action: 'hold',
      rMultiple
    };
  }

  // ─── DEFAULT: No trigger — generate standard progress message ─────────────────
  return buildDefaultEvaluation(trade, currentPrice, rMultiple, slPips, tpPips, tpProgress, minutesInTrade, midTradePlan, isLong, risk);
}

function buildDefaultEvaluation(
  trade: GoalSessionTrade,
  currentPrice: number,
  rMultiple: number,
  slPips: number,
  tpPips: number,
  tpProgress: number,
  minutesInTrade: number,
  midTradePlan: MidTradePlan | null,
  isLong: boolean,
  risk: number
): TriggerEvaluation {
  const invalidationPrice = midTradePlan?.invalidation_price ?? trade.stop_loss;
  const setupSummary = midTradePlan?.setup_summary ?? 'Trade active';

  if (rMultiple >= 0.5) {
    return {
      triggered: false,
      triggerType: null,
      severity: 'info',
      primaryMessage: `+${rMultiple.toFixed(1)}R — progressing toward TP at ${formatPrice(trade.symbol, trade.take_profit)} (${Math.abs(tpPips).toFixed(1)} pips away)`,
      subMessage: `SL at ${formatPrice(trade.symbol, trade.stop_loss)} — ${Math.abs(slPips).toFixed(1)} pips. Thesis intact.`,
      actionPrice: null,
      actionLabel: null,
      thesisIntact: true,
      urgencyScore: 30,
      color: 'emerald',
      action: 'hold',
      rMultiple
    };
  }

  if (rMultiple >= 0) {
    return {
      triggered: false,
      triggerType: null,
      severity: 'info',
      primaryMessage: `In profit +${rMultiple.toFixed(1)}R — SL at ${formatPrice(trade.symbol, trade.stop_loss)} (${Math.abs(slPips).toFixed(1)} pips back)`,
      subMessage: `TP at ${formatPrice(trade.symbol, trade.take_profit)} — ${Math.abs(tpPips).toFixed(1)} pips ahead. ${setupSummary}.`,
      actionPrice: null,
      actionLabel: null,
      thesisIntact: true,
      urgencyScore: 20,
      color: 'emerald',
      action: 'hold',
      rMultiple
    };
  }

  // Early stage near entry
  if (Math.abs(rMultiple) < 0.2) {
    return {
      triggered: false,
      triggerType: null,
      severity: 'info',
      primaryMessage: `Near entry (${rMultiple.toFixed(2)}R) — SL at ${formatPrice(trade.symbol, trade.stop_loss)}, TP at ${formatPrice(trade.symbol, trade.take_profit)}`,
      subMessage: `Monitoring for direction. Thesis valid ${isLong ? 'above' : 'below'} ${formatPrice(trade.symbol, invalidationPrice ?? trade.stop_loss)}.`,
      actionPrice: null,
      actionLabel: null,
      thesisIntact: true,
      urgencyScore: 20,
      color: 'blue',
      action: 'hold',
      rMultiple
    };
  }

  // Mild drawdown
  return {
    triggered: false,
    triggerType: null,
    severity: 'info',
    primaryMessage: `${rMultiple.toFixed(1)}R — ${Math.abs(slPips).toFixed(1)} pips to SL at ${formatPrice(trade.symbol, trade.stop_loss)}`,
    subMessage: `Alpha's thesis holds ${isLong ? 'above' : 'below'} ${formatPrice(trade.symbol, invalidationPrice ?? trade.stop_loss)}.`,
    actionPrice: null,
    actionLabel: null,
    thesisIntact: true,
    urgencyScore: 25,
    color: 'amber',
    action: 'hold',
    rMultiple
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calculateRLocked(
  entryPrice: number,
  newSL: number,
  risk: number,
  isLong: boolean
): number {
  const newRisk = isLong ? (newSL - entryPrice) : (entryPrice - newSL);
  // Negative new risk = guaranteed profit territory
  return risk > 0 ? (-newRisk / risk) : 0;
}

function roundToSymbolPrecision(symbol: string, price: number): number {
  const sym = symbol.toUpperCase();
  if (isJPYPair(sym)) return Math.round(price * 1000) / 1000;
  if (isIndex(sym)) return Math.round(price * 10) / 10;
  if (isCrypto(sym)) return Math.round(price * 100) / 100;
  if (sym.includes('XAU') || sym.includes('XAG')) return Math.round(price * 100) / 100;
  return Math.round(price * 100000) / 100000;
}

function formatPrice(symbol: string, price: number): string {
  const sym = symbol.toUpperCase();
  if (isJPYPair(sym)) return price.toFixed(3);
  if (isIndex(sym)) return price.toFixed(1);
  if (isCrypto(sym)) return price.toFixed(2);
  if (sym.includes('XAU') || sym.includes('XAG')) return price.toFixed(2);
  return price.toFixed(5);
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
