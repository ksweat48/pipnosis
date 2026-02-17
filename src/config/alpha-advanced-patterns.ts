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
 * Different market regimes require different trading approaches.
 * This matrix tells Alpha how to adapt each style based on regime.
 */
export const REGIME_STYLE_ADAPTATIONS = {
  SCALP: {
    TRENDING: {
      tp_target_range: '1.5-2.0 ATR',
      strategy: 'Ride momentum continuations',
      entry_bias: 'Continuation entries preferred',
      confidence_adjustment: 0,
      stop_adjustment: 'Standard',
      notes: 'Target extended moves, don\'t fade the trend',
    },
    RANGING: {
      tp_target_range: '0.8-1.2 ATR',
      strategy: 'Fade extremes toward mean',
      entry_bias: 'Counter-trend at boundaries',
      confidence_adjustment: -5,
      stop_adjustment: 'Tight (range breakdown risk)',
      notes: 'Scalp the oscillation, quick in and out',
    },
    VOLATILE_EXPANSION: {
      tp_target_range: '1.8-2.5 ATR',
      strategy: 'Capture volatility expansion',
      entry_bias: 'Wait for pullbacks',
      confidence_adjustment: -10,
      stop_adjustment: 'Widen by 20%',
      notes: 'Whipsaw risk high - demand better entries',
    },
    COMPRESSED: {
      tp_target_range: '0.5-1.0 ATR',
      strategy: 'Mean reversion scalps',
      entry_bias: 'Fade micro deviations',
      confidence_adjustment: -5,
      stop_adjustment: 'Very tight',
      notes: 'Reduced profit expectation, higher win rate target',
    },
  },

  MICRO_INTRADAY: {
    TRENDING: {
      tp_target_range: 'TP1: M15 structure, TP2: H1 structure extended',
      strategy: 'Use continuation entries, target H1 structure',
      entry_bias: 'Pullback to M15 support/resistance',
      confidence_adjustment: +5,
      stop_adjustment: 'Standard to slightly wide',
      notes: 'Trend alignment = higher confidence, wider TP2',
    },
    RANGING: {
      tp_target_range: 'TP1: Mid-range, TP2: Opposite boundary',
      strategy: 'Fade M15 extremes toward VWAP',
      entry_bias: 'Counter-trend at range edges',
      confidence_adjustment: 0,
      stop_adjustment: 'Just outside range boundary',
      notes: 'Range-bound M15 = oscillation trading',
    },
    VOLATILE_EXPANSION: {
      tp_target_range: 'TP1: Standard M15, TP2: H1 with caution',
      strategy: 'Demand H1 confirmation before entry',
      entry_bias: 'Wait for M15 structure to settle',
      confidence_adjustment: -10,
      stop_adjustment: 'Widen by 25%',
      notes: 'False breakout risk - require multi-timeframe alignment',
    },
    COMPRESSED: {
      tp_target_range: 'TP1: 1.5-2.0 R:R, TP2: 2.0-2.5 R:R',
      strategy: 'Tight TP targets, avoid ambitious projections',
      entry_bias: 'Structural levels only',
      confidence_adjustment: -5,
      stop_adjustment: 'Slightly tighter',
      notes: 'Reduced profit potential - take what market offers',
    },
  },

  INTRADAY: {
    TRENDING: {
      tp_target_range: 'TP1: H1 structure, TP2: H4 structure',
      strategy: 'Target H4 structure, hold through noise',
      entry_bias: 'H1 pullbacks with H4 confirmation',
      confidence_adjustment: +10,
      stop_adjustment: 'Standard',
      notes: 'Strong trends = hold for campaign target',
    },
    RANGING: {
      tp_target_range: 'TP1: Mid-range, TP2: Opposite H1 boundary',
      strategy: 'Trade H1 boundaries, tight TP1 at mid-range',
      entry_bias: 'Range extremes with H4 validation',
      confidence_adjustment: 0,
      stop_adjustment: 'Just outside H1 range',
      notes: 'H1 ranging = defined risk/reward',
    },
    VOLATILE_EXPANSION: {
      tp_target_range: 'TP1: Conservative H1, TP2: Standard H4',
      strategy: 'Wait for H1 confirmation, avoid premature entries',
      entry_bias: 'Multi-candle H1 confirmation required',
      confidence_adjustment: -10,
      stop_adjustment: 'Widen by 30%',
      notes: 'Volatility expansion = wait for structure clarity',
    },
    COMPRESSED: {
      tp_target_range: 'TP1: 2.0-2.5 R:R, TP2: 2.5-3.0 R:R',
      strategy: 'Reduced profit targets, focus on high probability',
      entry_bias: 'Major H1 structural levels only',
      confidence_adjustment: -5,
      stop_adjustment: 'Slightly tighter',
      notes: 'Compression = smaller moves, adjust expectations',
    },
  },
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════
 * PRIORITY 1C: FAILED SETUP RECOGNITION PATTERNS
 * ═══════════════════════════════════════════════════════════════════
 *
 * Pattern recognition for common failure modes.
 * These patterns trigger automatic NO_TRADE to avoid low-probability setups.
 */
export const FAILED_SETUP_PATTERNS = {
  SCALP: {
    CHOP_DETECTED: {
      name: 'M5 Inside Bar Sequence',
      description: '3+ consecutive M5 inside bars',
      action: 'NO_TRADE',
      reasoning: 'Indecision pattern - no directional edge',
      detection_rules: [
        '3+ consecutive M5 inside bars',
        'Each candle range smaller than previous',
        'No clear breakout direction',
      ],
    },
    WHIPSAW: {
      name: 'M5 Whipsaw Pattern',
      description: 'Alternating UP/DOWN M5 candles for 5+ periods',
      action: 'NO_TRADE',
      reasoning: 'Erratic price action - no trend or structure',
      detection_rules: [
        '5+ alternating direction M5 candles',
        'No consecutive same-direction moves',
        'Range-bound with high noise',
      ],
    },
    MID_RANGE_DRIFT: {
      name: 'M5 Mid-Range No Bias',
      description: 'Price at mid-range between S/R with no clear bias',
      action: 'NO_TRADE',
      reasoning: 'No structural edge - equal probability both directions',
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
      action: 'NO_TRADE',
      reasoning: 'Fakeout risk high - wait for H1 directional commitment',
      detection_rules: [
        'M15 range-bound for 3+ hours',
        'H1 candle not showing directional bias',
        'No clear H1 structural level nearby',
      ],
    },
    VOLUME_DIVERGENCE: {
      name: 'M15 Momentum Divergence',
      description: 'Price makes new high/low but volume declining',
      action: 'NO_TRADE',
      reasoning: 'Exhaustion signal - momentum not supporting price',
      detection_rules: [
        'Price extending to new high/low',
        'Volume declining on each successive M15 candle',
        'No institutional buying/selling visible',
      ],
    },
    STRUCTURE_CONFLICT: {
      name: 'H1 Near Major S/R Without M15 Confirmation',
      description: 'H1 approaching major level but M15 showing no reaction',
      action: 'NO_TRADE',
      reasoning: 'Rejection risk - no M15 confirmation of direction',
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
      action: 'NO_TRADE',
      reasoning: 'Insufficient time for thesis to develop',
      detection_rules: [
        'Less than 2 hours until London/NY close',
        'H1 thesis requires 3+ hours to reach TP',
        'Risk of gap/reversal at session change',
      ],
    },
    EXTENDED_RANGE: {
      name: 'H1 Consolidation > 6 Hours',
      description: 'H1 consolidation exceeding 6 hours',
      action: 'NO_TRADE',
      reasoning: 'Range-bound market - wait for H4 structural shift',
      detection_rules: [
        'H1 trading in tight range for 6+ hours',
        'H4 candle showing no directional commitment',
        'No catalyst visible to break range',
      ],
    },
    TIMEFRAME_CONFLICT: {
      name: 'H4 Conflicting With H1',
      description: 'H1 and H4 showing opposing directional bias',
      action: 'NO_TRADE',
      reasoning: 'Thesis broken - multi-timeframe alignment required',
      detection_rules: [
        'H1 showing bullish structure',
        'H4 showing bearish structure (or vice versa)',
        'No clear resolution signal on either timeframe',
      ],
    },
  },
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════
 * PRIORITY 2A: LIQUIDITY CONTEXT INTEGRATION
 * ═══════════════════════════════════════════════════════════════════
 *
 * Liquidity pool positioning and trading playbook.
 */
export const LIQUIDITY_PLAYBOOK = {
  POOL_ABOVE: {
    position: 'ABOVE' as LiquidityPosition,
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

  POOL_BELOW: {
    position: 'BELOW' as LiquidityPosition,
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
    position: 'AT_LEVEL' as LiquidityPosition,
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

  CLEAN_ZONE: {
    position: 'DISPERSED' as LiquidityPosition,
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
} as const;

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
      confidence_adjustment: -10,
      notes: 'Reduced profit potential - scale expectations',
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
      confidence_adjustment: -10,
      notes: 'Often dead zone for M15 structure trades',
    },
  },

  INTRADAY: {
    ASIA_CONSOLIDATION: {
      session: 'ASIA_CONSOLIDATION' as SessionName,
      time_utc: '00:00-07:00',
      characteristics: 'Range-bound H1, consolidation before London',
      strategy: 'Identify range, prepare for London breakout',
      confidence_adjustment: -5,
      notes: 'Asia range sets boundaries for London open',
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
  const playbook = LIQUIDITY_PLAYBOOK;

  if (position === 'ABOVE') {
    return tradeDirection === 'BUY'
      ? playbook.POOL_ABOVE.recommended_strategy.for_longs
      : playbook.POOL_ABOVE.recommended_strategy.for_shorts;
  }

  if (position === 'BELOW') {
    return tradeDirection === 'BUY'
      ? playbook.POOL_BELOW.recommended_strategy.for_longs
      : playbook.POOL_BELOW.recommended_strategy.for_shorts;
  }

  if (position === 'AT_LEVEL') {
    return tradeDirection === 'BUY'
      ? playbook.AT_LEVEL.recommended_strategy.for_longs
      : playbook.AT_LEVEL.recommended_strategy.for_shorts;
  }

  return playbook.CLEAN_ZONE.recommended_strategy[tradeDirection === 'BUY' ? 'for_longs' : 'for_shorts'];
}
