/**
 * Alpha Advanced Pattern Library - Priority 1 & 2 Upgrades
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALPHA PROFESSIONAL PATTERN RECOGNITION & BEHAVIOR ADAPTATION
 * ═══════════════════════════════════════════════════════════════════
 *
 * This file contains advanced pattern recognition rules, regime adaptations,
 * and session-specific behaviors for Alpha's trading decisions.
 *
 * PRIORITY 1 (Highest ROI):
 * - M1 Pattern Library for Entry Timing
 * - Regime-Style Adaptation Matrix
 * - Failed Setup Recognition Patterns
 *
 * PRIORITY 2 (High ROI):
 * - Liquidity Context Integration
 * - Session Behavior Profiles
 *
 * SSOT COMPLIANCE:
 * All Alpha behavioral patterns must reference this file.
 *
 * CCIP TRACKING:
 * Changes to this file must be logged in ccip_tier7_tracking table
 * Migration: 20260217_120000_alpha_advanced_patterns_upgrade.sql
 * ═══════════════════════════════════════════════════════════════════
 */

export type M1PatternType =
  | 'EXHAUSTION_SEQUENCE'
  | 'REJECTION_WICK'
  | 'CONSOLIDATION_COIL'
  | 'PULLBACK_COMPLETE'
  | 'MOMENTUM_CONTINUATION';

export type RegimeType = 'TRENDING' | 'RANGING' | 'VOLATILE_EXPANSION' | 'COMPRESSED';

export type SessionName =
  | 'LONDON_OPEN'
  | 'LONDON_ACTIVE'
  | 'NY_OPEN'
  | 'OVERLAP'
  | 'NY_AFTERNOON'
  | 'NY_LUNCH'
  | 'DEAD_ZONE'
  | 'ASIA_CONSOLIDATION';

export type LiquidityPosition = 'ABOVE' | 'BELOW' | 'AT_LEVEL' | 'DISPERSED';

/**
 * ═══════════════════════════════════════════════════════════════════
 * PRIORITY 1A: M1 PATTERN LIBRARY FOR ENTRY TIMING
 * ═══════════════════════════════════════════════════════════════════
 *
 * M1 patterns provide micro-level context for entry timing decisions.
 * These patterns help Alpha determine if immediate entry is optimal
 * or if waiting for a pullback is more advantageous.
 */
export const M1_ENTRY_PATTERNS = {
  EXHAUSTION_SEQUENCE: {
    name: 'Exhaustion Sequence',
    description: '3+ consecutive same-direction M1 candles WITHOUT pullback',
    signal: 'PULLBACK_EXPECTED',
    confidence: 'HIGH',
    reasoning: 'Micro momentum exhaustion signals imminent retracement',
    detection_rules: [
      '3+ consecutive same-direction M1 candles',
      'No opposing candle bodies in sequence',
      'Volume steady or declining on final candles',
      'Distance > 0.15 ATR without pause'
    ],
    recommended_action: 'Wait for 2-3 reversal candles, then enter on continuation',
    typical_pullback_depth: '30-50% of the M1 impulse',
  },

  REJECTION_WICK: {
    name: 'Rejection Wick',
    description: 'Last M1 candle shows rejection wick (wick > 1.5x body)',
    signal: 'EXHAUSTION_DETECTED',
    confidence: 'MEDIUM_HIGH',
    reasoning: 'Price tested level and rejected, retracement likely',
    detection_rules: [
      'Last M1 candle has wick > 1.5x body size',
      'Wick direction opposes the trend',
      'Body closes away from extreme',
      'Volume spike on rejection'
    ],
    recommended_action: 'Wait for retrace to test 50% of rejection candle',
    typical_pullback_depth: '40-60% of rejection candle range',
  },

  CONSOLIDATION_COIL: {
    name: 'Consolidation Coil',
    description: 'M1 range < 0.1 ATR for 5+ candles',
    signal: 'BREAKOUT_PENDING',
    confidence: 'MEDIUM',
    reasoning: 'Coiling price action precedes directional breakout',
    detection_rules: [
      '5+ consecutive M1 candles in tight range',
      'Range < 0.1 ATR',
      'Progressively tighter ranges (compression)',
      'Volume declining during consolidation'
    ],
    recommended_action: 'Prepare for breakout, enter on first decisive M1 close',
    typical_pullback_depth: 'Minimal - breakouts tend to run',
  },

  PULLBACK_COMPLETE: {
    name: 'Pullback Already Complete',
    description: '2-3 reversal M1 candles followed by continuation',
    signal: 'GOOD_ENTRY_NOW',
    confidence: 'HIGH',
    reasoning: 'Micro pullback already occurred, continuation confirmed',
    detection_rules: [
      '2-3 opposing-direction M1 candles visible',
      'Pullback depth 30-50% of prior impulse',
      'Continuation candles forming (same direction as trend)',
      'Price holding above/below key micro level'
    ],
    recommended_action: 'Enter immediately - optimal entry timing',
    typical_pullback_depth: 'N/A - pullback already happened',
  },

  MOMENTUM_CONTINUATION: {
    name: 'Momentum Continuation',
    description: 'Strong momentum with increasing volume, no exhaustion signs',
    signal: 'CONTINUATION_ENTRY',
    confidence: 'MEDIUM_HIGH',
    reasoning: 'Breakaway momentum, waiting risks missing the move',
    detection_rules: [
      'Consecutive M1 candles with increasing momentum',
      'Volume expanding on each candle',
      'No rejection wicks forming',
      'Breaking through structural levels cleanly'
    ],
    recommended_action: 'Continuation entry justified - enter into momentum',
    typical_pullback_depth: 'Minimal or none - catch the wave',
  },
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════
 * PRIORITY 1B: REGIME-STYLE ADAPTATION MATRIX
 * ═══════════════════════════════════════════════════════════════════
 *
 * CCIP-2026-0330B — GOVERNANCE REFORM:
 * This matrix provides Alpha with market context by regime and style.
 * confidence_adjustment values are ADVISORY CONTEXT ONLY — they are passed
 * as raw information for Alpha to reason about. No code path may apply
 * these as arithmetic deductions to Alpha's output confidence score.
 *
 * Positive adjustments reflect historically stronger alignment between
 * regime and style — Alpha considers this one data point among many.
 * There are NO negative confidence deductions in this matrix.
 * Alpha reads regime context and self-weights his conviction honestly.
 *
 * SSOT: CCIP-2026-0329A removed all advisory deductions. This reform
 * extends that governance principle to regime-based adjustments.
 */
export const REGIME_STYLE_ADAPTATIONS = {
  SCALP: {
    TRENDING: {
      tp_target_range: '1.5-2.0 ATR',
      strategy: 'Ride momentum continuations',
      entry_bias: 'Continuation entries preferred',
      confidence_adjustment: 0,
      stop_adjustment: 'Standard',
      notes: 'Target extended moves on the trend direction — momentum continuation at M5 scale.',
    },
    RANGING: {
      tp_target_range: '0.8-1.2 ATR',
      strategy: 'Fade extremes toward mean',
      entry_bias: 'Counter-trend at boundaries',
      confidence_adjustment: 0,
      stop_adjustment: 'Tight (range breakdown risk)',
      notes: 'Ranging regime: boundary fades have edge. Mid-range entries have lower structural basis. Alpha reads the specific boundary quality and decides.',
    },
    VOLATILE_EXPANSION: {
      tp_target_range: '1.8-2.5 ATR',
      strategy: 'Capture volatility expansion',
      entry_bias: 'Structural anchors after initial expansion candle',
      confidence_adjustment: 0,
      stop_adjustment: 'Widen by 20% to clear expanded ATR range',
      notes: 'Volatile expansion: larger M5 legs available. SL must clear the expanded ATR. Alpha reads structure and selects TP at nearest M5 structural level.',
    },
    COMPRESSED: {
      tp_target_range: '0.5-1.0 ATR',
      strategy: 'Mean reversion scalps at compression extremes',
      entry_bias: 'Fade micro deviations at structural edges',
      confidence_adjustment: 0,
      stop_adjustment: 'Very tight — compression means small range',
      notes: 'Compression: reduced pip range per leg. Alpha selects TP at nearest reachable M5 structural level — not maximum possible extension.',
    },
  },

  MICRO_INTRADAY: {
    TRENDING: {
      tp_target_range: 'TP1: M15 structure, TP2: H1 structure extended',
      strategy: 'Use continuation entries, target H1 structure',
      entry_bias: 'Pullback to M15 support/resistance',
      confidence_adjustment: +5,
      stop_adjustment: 'Standard to slightly wide',
      notes: 'Trend regime alignment with MICRO_INTRADAY: H1 trend + M15 entry is the highest-probability structural combination for this style.',
    },
    RANGING: {
      tp_target_range: 'TP1: Mid-range, TP2: Opposite boundary',
      strategy: 'Fade M15 extremes toward VWAP',
      entry_bias: 'Counter-trend at range edges',
      confidence_adjustment: 0,
      stop_adjustment: 'Just outside range boundary',
      notes: 'Ranging M15: oscillation trades at boundaries have structural basis. Alpha selects the range boundary as the structural anchor.',
    },
    VOLATILE_EXPANSION: {
      tp_target_range: 'TP1: Standard M15, TP2: H1 with caution',
      strategy: 'Trade structural levels — volatility creates larger legs',
      entry_bias: 'Structural anchor required — momentum alone is insufficient',
      confidence_adjustment: 0,
      stop_adjustment: 'Widen by 25% to clear expanded ATR',
      notes: 'Volatile expansion at M15 scale: larger moves are available but SL must clear the expanded range. Alpha reads whether structure is present before entering.',
    },
    COMPRESSED: {
      tp_target_range: 'TP1: 1.5-2.0 R:R, TP2: 2.0-2.5 R:R',
      strategy: 'Conservative TP selection — take what the compressed range offers',
      entry_bias: 'Structural levels only — avoid ambiguous mid-range entries',
      confidence_adjustment: 0,
      stop_adjustment: 'Slightly tighter',
      notes: 'Compression reduces M15 leg size. Alpha selects TP at the nearest credible M15 structural level rather than projecting a full-range target.',
    },
  },

  INTRADAY: {
    TRENDING: {
      tp_target_range: 'TP1: H1 structure, TP2: H4 structure',
      strategy: 'Target H4 structure, hold through noise',
      entry_bias: 'H1 pullbacks with H4 confirmation',
      confidence_adjustment: +10,
      stop_adjustment: 'Standard',
      notes: 'Trending regime with INTRADAY style: highest structural alignment. H4 and H1 moving in the same direction — campaign targets are structurally supported.',
    },
    RANGING: {
      tp_target_range: 'TP1: Mid-range, TP2: Opposite H1 boundary',
      strategy: 'Trade H1 boundaries, tight TP1 at mid-range',
      entry_bias: 'Range extremes with H4 validation',
      confidence_adjustment: 0,
      stop_adjustment: 'Just outside H1 range',
      notes: 'H1 ranging: boundary trades at H1 extremes have the clearest structural basis. Alpha identifies the range high and low and selects entry near boundary.',
    },
    VOLATILE_EXPANSION: {
      tp_target_range: 'TP1: Conservative H1, TP2: Standard H4',
      strategy: 'Trade structural levels — volatile expansion creates H1-scale legs',
      entry_bias: 'Structural anchor + directional commitment required',
      confidence_adjustment: 0,
      stop_adjustment: 'Widen by 30% to clear expanded ATR',
      notes: 'Volatile expansion creates larger H1 moves. SL must reflect the expanded ATR. Alpha reads whether the H1 structure is directionally committed before entering.',
    },
    COMPRESSED: {
      tp_target_range: 'TP1: 2.0-2.5 R:R, TP2: 2.5-3.0 R:R',
      strategy: 'Conservative TP targets — compressed range reduces move expectations',
      entry_bias: 'Major H1 structural levels only',
      confidence_adjustment: 0,
      stop_adjustment: 'Slightly tighter',
      notes: 'H1 compression means smaller delivered moves. Alpha selects TP at the nearest H1 structural level the compressed range is willing to deliver to.',
    },
  },
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════
 * PRIORITY 1C: MARKET CONDITION ADVISORY PATTERNS
 * ═══════════════════════════════════════════════════════════════════
 *
 * CCIP-2026-0330B — GOVERNANCE REFORM:
 * These patterns are ADVISORY CONTEXT passed to Alpha for his reasoning.
 * They describe market conditions that historically carry lower follow-through.
 * Alpha reads this context and decides. No pattern here produces an automatic
 * NO_TRADE. Alpha is the ONLY authority that may output NO_TRADE.
 *
 * SSOT: LEGITIMATE_BLOCK_CONDITIONS in alpha-identity.ts defines the exhaustive
 * list of conditions that can prevent trade execution. Pattern matching is not
 * on that list and never will be.
 */
export const MARKET_CONDITION_ADVISORY = {
  SCALP: {
    CHOP_DETECTED: {
      name: 'M5 Inside Bar Sequence',
      description: '3+ consecutive M5 inside bars',
      advisory_signal: 'COMPRESSION_OBSERVED',
      reasoning: 'Inside bar sequence indicates price compression — breakout direction is unresolved. Alpha reads this as a coiling setup or a low-conviction environment and decides accordingly.',
      detection_rules: [
        '3+ consecutive M5 inside bars',
        'Each candle range smaller than previous',
        'No clear breakout direction',
      ],
    },
    WHIPSAW: {
      name: 'M5 Whipsaw Pattern',
      description: 'Alternating UP/DOWN M5 candles for 5+ periods',
      advisory_signal: 'ERRATIC_PRICE_ACTION',
      reasoning: 'Alternating candles indicate noise without structure. Alpha weighs this as a low-structure environment and adjusts his conviction accordingly — ranging setups at boundaries may still have edge.',
      detection_rules: [
        '5+ alternating direction M5 candles',
        'No consecutive same-direction moves',
        'Range-bound with high noise',
      ],
    },
    MID_RANGE_DRIFT: {
      name: 'M5 Mid-Range No Bias',
      description: 'Price at mid-range between S/R with no clear bias',
      advisory_signal: 'MIDRANGE_LOCATION',
      reasoning: 'Mid-range location reduces structural edge. Alpha reads this as a location problem — boundary setups on this same structure may have higher probability than mid-range entries.',
      detection_rules: [
        'Price equidistant from support and resistance',
        'No momentum in either direction',
        'No clear structural invalidation levels',
      ],
    },
  },

  MICRO_INTRADAY: {
    EXTENDED_CONSOLIDATION: {
      name: 'M15 Consolidation > 3 Hours',
      description: 'M15 consolidation exceeding 3 hours without H1 confirmation',
      advisory_signal: 'EXTENDED_RANGE_BOUND',
      reasoning: 'Prolonged M15 consolidation increases fakeout risk on breakout entries. Alpha reads this as a context signal — coil breakout setups or range extremes may still present edge; this observation informs his confidence, not his decision.',
      detection_rules: [
        'M15 range-bound for 3+ hours',
        'H1 candle not showing directional bias',
        'No clear H1 structural level nearby',
      ],
    },
    VOLUME_DIVERGENCE: {
      name: 'M15 Momentum Divergence',
      description: 'Price makes new high/low but volume declining',
      advisory_signal: 'MOMENTUM_DIVERGENCE_OBSERVED',
      reasoning: 'Declining volume on price extension is an exhaustion signal. Alpha reads this as reduced follow-through probability — it informs his TP selection and confidence, not his entry decision.',
      detection_rules: [
        'Price extending to new high/low',
        'Volume declining on each successive M15 candle',
        'No institutional buying/selling visible',
      ],
    },
    STRUCTURE_CONFLICT: {
      name: 'H1 Near Major S/R Without M15 Confirmation',
      description: 'H1 approaching major level but M15 showing no reaction',
      advisory_signal: 'CONFIRMATION_LAG',
      reasoning: 'H1 approaching major level without M15 reaction indicates the level has not yet been tested at the entry timeframe. Alpha reads this as a timing observation — he may choose wait_pullback or push_confirmation entry_mode.',
      detection_rules: [
        'H1 within 0.3 ATR of major S/R level',
        'M15 candles showing indecision or opposing direction',
        'No clear M15 confirmation candle pattern',
      ],
    },
  },

  INTRADAY: {
    SESSION_END_PROXIMITY: {
      name: 'H1 Near Session Close',
      description: 'Less than 2 hours to major session end',
      advisory_signal: 'SESSION_TIME_COMPRESSED',
      reasoning: 'Limited session time compresses the available hold window. Alpha reads this as a TP selection constraint — he may select a closer structural target that fits the remaining window rather than passing on the trade.',
      detection_rules: [
        'Less than 2 hours until London/NY close',
        'H1 thesis requires 3+ hours to reach TP',
        'Risk of gap/reversal at session change',
      ],
    },
    EXTENDED_RANGE: {
      name: 'H1 Consolidation > 6 Hours',
      description: 'H1 consolidation exceeding 6 hours',
      advisory_signal: 'PROLONGED_RANGE_BOUND',
      reasoning: 'Extended H1 consolidation indicates institutional indecision. Alpha reads this as context for his phase read — range boundary setups or pre-breakout positioning may still present structural edge.',
      detection_rules: [
        'H1 trading in tight range for 6+ hours',
        'H4 candle showing no directional commitment',
        'No catalyst visible to break range',
      ],
    },
    TIMEFRAME_CONFLICT: {
      name: 'H4 Conflicting With H1',
      description: 'H1 and H4 showing opposing directional bias',
      advisory_signal: 'MTF_CONFLICT_OBSERVED',
      reasoning: 'H1 and H4 conflict is a Q12/Q4 type disagreement — it reduces structural alignment but does not eliminate edge. Alpha records both readings and resolves in thesis_coherence_statement per CCIP-2026-0327D.',
      detection_rules: [
        'H1 showing bullish structure',
        'H4 showing bearish structure (or vice versa)',
        'No clear resolution signal on either timeframe',
      ],
    },
  },
} as const;

/**
 * @deprecated Use MARKET_CONDITION_ADVISORY instead.
 * CCIP-2026-0330B: FAILED_SETUP_PATTERNS renamed and reframed as advisory context.
 * This alias is preserved for any existing import references. All consumers
 * must treat these entries as advisory context — not as NO_TRADE triggers.
 */
export const FAILED_SETUP_PATTERNS = MARKET_CONDITION_ADVISORY;

/**
 * ═══════════════════════════════════════════════════════════════════
 * PRIORITY 2A: LIQUIDITY CONTEXT INTEGRATION
 * ═══════════════════════════════════════════════════════════════════
 *
 * Liquidity pool positioning and trading playbook.
 */
export const LIQUIDITY_PLAYBOOK: Record<LiquidityPosition, {
  position: LiquidityPosition;
  description: string;
  bullish_interpretation: string;
  bearish_interpretation: string;
  recommended_strategy: { for_longs: string; for_shorts: string };
  tp_placement: string;
  stop_placement: string;
}> = {
  ABOVE: {
    position: 'ABOVE',
    description: 'Liquidity pool clustered ABOVE current price',
    bullish_interpretation: 'Magnet for price - target for longs',
    bearish_interpretation: 'Potential stop run area before reversal',
    recommended_strategy: {
      for_longs: 'Target liquidity pool as TP - price drawn upward',
      for_shorts: 'Be cautious - liquidity may pull price higher first',
    },
    tp_placement: 'Place TP at BOTTOM edge of liquidity cluster',
    stop_placement: 'Avoid placing stops just below cluster (stop run risk)',
  },

  BELOW: {
    position: 'BELOW',
    description: 'Liquidity pool clustered BELOW current price',
    bullish_interpretation: 'Potential stop run area before continuation up',
    bearish_interpretation: 'Magnet for price - target for shorts',
    recommended_strategy: {
      for_longs: 'Be cautious - liquidity may pull price lower first',
      for_shorts: 'Target liquidity pool as TP - price drawn downward',
    },
    tp_placement: 'Place TP at TOP edge of liquidity cluster',
    stop_placement: 'Avoid placing stops just above cluster (stop run risk)',
  },

  AT_LEVEL: {
    position: 'AT_LEVEL',
    description: 'Price currently AT a liquidity concentration',
    bullish_interpretation: 'Potential sweep and reclaim for long entry',
    bearish_interpretation: 'Potential sweep and reclaim for short entry',
    recommended_strategy: {
      for_longs: 'Wait for sweep below, then reclaim above for entry',
      for_shorts: 'Wait for sweep above, then rejection below for entry',
    },
    tp_placement: 'Target next liquidity pool in direction of trade',
    stop_placement: 'Behind the liquidity pool (invalidation level)',
  },

  DISPERSED: {
    position: 'DISPERSED',
    description: 'Clean price area with minimal liquidity clusters',
    bullish_interpretation: 'Low resistance zone - price can move freely',
    bearish_interpretation: 'Low support zone - price can fall freely',
    recommended_strategy: {
      for_longs: 'Favorable for continuation - minimal overhead resistance',
      for_shorts: 'Favorable for continuation - minimal downside support',
    },
    tp_placement: 'Target next structural level or liquidity pool',
    stop_placement: 'Standard structural placement',
  },
};

/**
 * ═══════════════════════════════════════════════════════════════════
 * PRIORITY 2B: SESSION BEHAVIOR PROFILES
 * ═══════════════════════════════════════════════════════════════════
 *
 * Session-specific behaviors for each trading style.
 */
export const SESSION_PROFILES = {
  SCALP: {
    LONDON_OPEN: {
      session: 'LONDON_OPEN' as SessionName,
      time_utc: '07:00-09:00',
      characteristics: 'High volatility, wider M5 swings',
      typical_m5_leg: '30-50 pips',
      strategy: 'Expect larger M5 moves - adjust TP targets upward',
      confidence_adjustment: 0,
      notes: 'Prime scalping time - momentum strong',
    },
    NY_OPEN: {
      session: 'NY_OPEN' as SessionName,
      time_utc: '13:30-15:00',
      characteristics: 'Momentum continuation, trend following',
      typical_m5_leg: '25-40 pips',
      strategy: 'Follow trends, continuation bias preferred',
      confidence_adjustment: 0,
      notes: 'NY continuation often extends London direction',
    },
    DEAD_ZONE: {
      session: 'DEAD_ZONE' as SessionName,
      time_utc: '22:00-01:00',
      characteristics: 'Low volume, tight ranges, whipsaw risk',
      typical_m5_leg: '10-20 pips',
      strategy: 'Tighten TP targets to 15-25 pips, avoid holding',
      confidence_adjustment: 0,
      notes: 'Reduced liquidity and narrower M5 legs — Alpha incorporates this into honest confidence rating. No system penalty applied.',
    },
  },

  MICRO_INTRADAY: {
    LONDON_ACTIVE: {
      session: 'LONDON_ACTIVE' as SessionName,
      time_utc: '08:00-12:00',
      characteristics: 'M15 respects structure, higher follow-through',
      strategy: 'Structural trades have high probability',
      confidence_adjustment: +5,
      notes: 'Institutional flow visible on M15',
    },
    OVERLAP: {
      session: 'OVERLAP' as SessionName,
      time_utc: '12:00-15:00',
      characteristics: 'Strongest intraday moves, London + NY active',
      strategy: 'Widen TP2 targets - extended moves likely',
      confidence_adjustment: +5,
      notes: 'Peak liquidity = best execution and follow-through',
    },
    NY_LUNCH: {
      session: 'NY_LUNCH' as SessionName,
      time_utc: '17:00-19:00',
      characteristics: 'Consolidation bias, reduced momentum',
      strategy: 'Wait for NY afternoon session, avoid mid-lunch entries',
      confidence_adjustment: 0,
      notes: 'Reduced momentum and consolidation tendency — Alpha incorporates this into honest confidence rating. No system penalty applied.',
    },
  },

  INTRADAY: {
    ASIA_CONSOLIDATION: {
      session: 'ASIA_CONSOLIDATION' as SessionName,
      time_utc: '00:00-07:00',
      characteristics: 'Range-bound H1, consolidation before London',
      strategy: 'Identify range boundaries — range extremes and boundary fades carry structural edge',
      confidence_adjustment: 0,
      notes: 'Asia range sets boundaries for London open — INTRADAY trades at Asia range extremes have defined structural anchors. Alpha reads the H1 phase honestly and trades what is present. No system penalty applied.',
    },
    LONDON_BREAKOUT: {
      session: 'LONDON_OPEN' as SessionName,
      time_utc: '07:00-10:00',
      characteristics: 'H1 breakout from Asia range',
      strategy: 'High probability H1 continuation after clean break',
      confidence_adjustment: +10,
      notes: 'Asia consolidation → London breakout = strong thesis',
    },
    NY_REVERSAL_RISK: {
      session: 'NY_AFTERNOON' as SessionName,
      time_utc: '15:00-20:00',
      characteristics: 'Reversal potential from London trend',
      strategy: 'Tighten TP1 if holding from London, lock partials',
      confidence_adjustment: 0,
      notes: 'NY can reverse London moves - partial profit taking advised',
    },
  },
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════
 * HELPER FUNCTIONS FOR PATTERN DETECTION
 * ═══════════════════════════════════════════════════════════════════
 */

export function detectM1Pattern(
  m1Candles: Array<{ direction: 'UP' | 'DOWN', range: number, wick: number, body: number }>,
  atr: number
): { pattern: M1PatternType | null, signal: string, reasoning: string } {
  if (!m1Candles || m1Candles.length < 3) {
    return { pattern: null, signal: 'INSUFFICIENT_DATA', reasoning: 'Need at least 3 M1 candles for pattern detection' };
  }

  // Check for exhaustion sequence (3+ consecutive same direction)
  const last3 = m1Candles.slice(-3);
  const allSameDirection = last3.every(c => c.direction === last3[0].direction);
  if (allSameDirection && last3.length >= 3) {
    return {
      pattern: 'EXHAUSTION_SEQUENCE',
      signal: 'PULLBACK_EXPECTED',
      reasoning: `${last3.length} consecutive ${last3[0].direction} M1 candles without pullback - exhaustion likely`,
    };
  }

  // Check for rejection wick
  const lastCandle = m1Candles[m1Candles.length - 1];
  if (lastCandle.wick > lastCandle.body * 1.5) {
    return {
      pattern: 'REJECTION_WICK',
      signal: 'EXHAUSTION_DETECTED',
      reasoning: `Large rejection wick (${(lastCandle.wick / lastCandle.body).toFixed(1)}x body) signals reversal`,
    };
  }

  // Check for consolidation coil
  const last5 = m1Candles.slice(-5);
  const avgRange = last5.reduce((sum, c) => sum + c.range, 0) / last5.length;
  if (avgRange < atr * 0.1 && last5.length >= 5) {
    return {
      pattern: 'CONSOLIDATION_COIL',
      signal: 'BREAKOUT_PENDING',
      reasoning: `Tight M1 consolidation (avg range ${(avgRange / atr * 100).toFixed(0)}% of ATR) - breakout imminent`,
    };
  }

  // Check for pullback complete
  const hasReversalFollowedByContinuation =
    m1Candles.length >= 5 &&
    m1Candles.slice(-5, -2).some(c => c.direction !== lastCandle.direction) &&
    m1Candles.slice(-2).every(c => c.direction === lastCandle.direction);

  if (hasReversalFollowedByContinuation) {
    return {
      pattern: 'PULLBACK_COMPLETE',
      signal: 'GOOD_ENTRY_NOW',
      reasoning: 'Pullback visible in M1, continuation forming - optimal entry timing',
    };
  }

  return { pattern: null, signal: 'NO_CLEAR_PATTERN', reasoning: 'M1 structure neutral or unclear' };
}

export function getRegimeAdaptation(style: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY', regime: RegimeType) {
  return REGIME_STYLE_ADAPTATIONS[style][regime];
}

export function getSessionProfile(style: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY', session: SessionName) {
  const profiles = SESSION_PROFILES[style];
  return Object.values(profiles).find(p => p.session === session) || null;
}

export function getLiquidityStrategy(position: LiquidityPosition, tradeDirection: 'BUY' | 'SELL') {
  const entry = LIQUIDITY_PLAYBOOK[position];
  if (!entry) return 'No liquidity context available';
  return tradeDirection === 'BUY'
    ? entry.recommended_strategy.for_longs
    : entry.recommended_strategy.for_shorts;
}
