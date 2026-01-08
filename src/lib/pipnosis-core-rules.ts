/**
 * Pipnosis Core Trading Rules
 *
 * These rules define the non-negotiable identity of Pipnosis as a short-term intraday AI trader.
 * NO MODULE, USER INPUT, OR LLM RESPONSE CAN OVERRIDE THESE RULES.
 *
 * Philosophy:
 * - Pipnosis specializes in trades lasting minutes to a few hours
 * - NEVER holds positions overnight or multi-day
 * - Tries to reach user goals in ONE high-quality trade, uses backup trades only if needed
 * - Prioritizes high-probability, fast-execution setups
 *
 * Goal Intelligence Philosophy:
 * - Capital survival and efficiency always override goal urgency
 * - Alpha does not chase goals — Alpha engineers outcomes
 * - Confidence affects WHETHER to trade, not HOW tight the stops are
 * - Goal classification determines execution psychology, not just risk percentage
 * - Final position size = MIN(goal-optimal, risk-safe)
 */

export const PIPNOSIS_CORE_RULES = {
  // DURATION PHILOSOPHY (v2.0):
  // - Time is a SCORING SIGNAL, not a rejection constraint
  // - NEVER hard-block trades due to time/duration
  // - Use style upgrades + reward/penalty model instead

  // Duration Target Bands (for learning/scoring, NOT blocking)
  STYLE_DURATION_BANDS: {
    SCALP: { min: 0.33, max: 2.0 },           // 20min - 2hrs (reward band)
    MICRO_INTRADAY: { min: 1.0, max: 6.0 },   // 1hr - 6hrs (reward band)
    INTRADAY: { min: 2.0, max: 10.0 },        // 2hrs - 10hrs (reward band)
  } as const,

  // Auto-upgrade thresholds (NEVER block, just upgrade style)
  STYLE_UPGRADE_THRESHOLDS: {
    SCALP_TO_MICRO_HOURS: 2.0,       // >2h expected → upgrade to MICRO_INTRADAY
    MICRO_TO_INTRADAY_HOURS: 6.0,    // >6h expected → upgrade to INTRADAY
    PENALTY_THRESHOLD_HOURS: 10.0,   // >10h expected → apply penalty, STILL EXECUTE
  } as const,

  // Legacy constants (kept for backward compatibility, NOT used for blocking)
  TRADE_DURATION_MAX_HOURS: 24,           // Removed as hard block - now just learning signal
  TRADE_DURATION_MAX_MINUTES: 1440,       // 24 hours - NOT a block, just tracking
  TRADE_DURATION_TARGET_MIN_HOURS: 0.33,  // 20 minutes minimum target
  TRADE_DURATION_TARGET_MAX_HOURS: 2.0,   // 2 hours target for scalp
  TRADE_DURATION_PREFERRED_MAX_HOURS: 2,  // Preferred maximum for scalp
  TRADE_DURATION_WARNING_HOURS: 4,        // Advisory warning, NOT block
  TRADE_DURATION_MIN_HOURS: 1,            // Kept for compatibility

  TRADE_STYLE: 'scalp_and_intraday_only' as const,
  GOAL_COMPLETION_METHOD: 'multiple_small_trades' as const,
  ALLOW_SWING_TRADES: false,
  ALLOW_OVERNIGHT_HOLDS: false,
  ALLOW_MULTI_DAY_POSITIONS: false,

  // Updated volatility map for duration estimation (NOT blocking)
  TRADE_DURATION_VOLATILITY_MAP: {
    low: { min: 0.33, preferred: 1.5, max: 10.0 },    // Conservative allows longer
    medium: { min: 0.33, preferred: 1.0, max: 6.0 },  // Moderate micro-intraday
    high: { min: 0.17, preferred: 0.75, max: 2.0 }    // Aggressive scalp
  } as const,

  SESSION_LIQUIDITY_MULTIPLIERS: {
    london_ny_overlap: 0.8,
    london: 1.0,
    newyork: 1.0,
    asian: 1.5
  } as const,

  DURATION_PROGRESS_ALERTS: {
    warning_at_percent: 50,
    consider_action_at_percent: 75,
    trailing_stop_at_percent: 85,
    force_close_at_percent: 100
  } as const,

  MIN_TRADES_PER_GOAL: 3,

  PRIMARY_TIMEFRAMES: ['M1', 'M5', 'M15', 'H1'] as const,
  PROHIBITED_TIMEFRAMES: ['D1', 'W1', 'MN1'] as const,

  SCAN_FREQUENCY_MINUTES: 5,
  SCAN_FREQUENCY_AGGRESSIVE_MINUTES: 5,

  MAX_SINGLE_TRADE_PROFIT_PERCENT: 2.5,

  NOTIFICATION_COUNTDOWN_MIN_SECONDS: 60,
  NOTIFICATION_COUNTDOWN_MAX_SECONDS: 180,

  AUTO_CLOSE_ON_DURATION_EXCEEDED: false,  // DISABLED - time is scoring signal only
  ENFORCE_END_OF_DAY_CLOSURE: true,        // Weekend/market close is still enforced (actual closure)
  END_OF_DAY_CLOSE_BUFFER_MINUTES: 30,

  GOAL_INTELLIGENCE: {
    MODE_THRESHOLDS: {
      PRECISION_MAX_PERCENT: 2.0,
      EXECUTION_MAX_PERCENT: 10.0,
      CAMPAIGN_MAX_PERCENT: 30.0,
    },

    CONFIDENCE_PRINCIPLES: {
      CONFIDENCE_GATES_EXECUTION: true,
      CONFIDENCE_DOES_NOT_AFFECT_STOP_WIDTH: true,
      STOPS_ARE_STRUCTURE_BASED: true,
      THRESHOLDS: {
        NO_TRADE_BELOW: 70,
        STANDARD_EXECUTION: 85,
        CONSIDER_ADDING: 95,
        AGGRESSIVE_MANAGEMENT: 98,
      },
    },

    CAPITAL_EFFICIENCY: {
      GOAL_SCALING_ACTIVE_BELOW_PERCENT: 2.0,
      GOAL_RISK_MULTIPLIER_MAX: 1.5,
      PREVENT_EGO_TRADING: true,
      FINAL_SIZE_RULE: 'MIN(goal_optimal, risk_safe)' as const,
    },

    MODE_BEHAVIORS: {
      precision: {
        description: 'Surgical execution - one clean trade',
        expectedTrades: 1,
        psychology: 'precision_beats_power',
        overtradeRisk: 'high',
      },
      execution: {
        description: 'Professional discipline - 2-4 quality trades',
        expectedTrades: 3,
        psychology: 'quality_over_speed',
        overtradeRisk: 'medium',
      },
      campaign: {
        description: 'Multi-session consistency - patience required',
        expectedTrades: 8,
        psychology: 'time_not_aggression',
        overtradeRisk: 'low',
      },
      growth: {
        description: 'Capital problem - execution blocked',
        expectedTrades: 0,
        psychology: 'honest_limitation',
        overtradeRisk: 'n/a',
      },
    } as const,
  } as const,
} as const;

/**
 * INTRADAY-ONLY TRADE STYLES
 * NO SWING TRADES. NO POSITION TRADES. Pipnosis is intraday-only.
 */
export type TradeStyle = 'scalp' | 'micro' | 'intraday';
export type ValidTimeframe = typeof PIPNOSIS_CORE_RULES.PRIMARY_TIMEFRAMES[number];
export type ProhibitedTimeframe = typeof PIPNOSIS_CORE_RULES.PROHIBITED_TIMEFRAMES[number];

export interface TradeValidationResult {
  isValid: boolean;
  violations: string[];
  adjustments?: {
    suggestedDuration?: number;
    suggestedTimeframe?: ValidTimeframe;
    suggestedPositionSize?: number;
  };
}

export class PipnosisCoreRules {
  static validateTradeStyle(style: TradeStyle): TradeValidationResult {
    const violations: string[] = [];

    // Hard block any attempt to use non-intraday styles
    if (!['scalp', 'micro', 'intraday'].includes(style)) {
      violations.push(`SWING TRADES NOT ALLOWED: Pipnosis is intraday-only. Use scalp, micro, or intraday styles only.`);
      return {
        isValid: false,
        violations,
        adjustments: {
          suggestedDuration: PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60
        }
      };
    }

    return { isValid: true, violations: [] };
  }

  static validateTradeDuration(durationMinutes: number): TradeValidationResult {
    const violations: string[] = [];
    const maxMinutes = PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES;

    if (durationMinutes > maxMinutes) {
      violations.push(
        `Trade duration of ${durationMinutes} minutes exceeds maximum allowed ${maxMinutes} minutes (${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS} hours).`
      );
      return {
        isValid: false,
        violations,
        adjustments: {
          suggestedDuration: PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60
        }
      };
    }

    return { isValid: true, violations: [] };
  }

  static validateTimeframe(timeframe: string): TradeValidationResult {
    const violations: string[] = [];
    const upper = timeframe.toUpperCase();

    if (PIPNOSIS_CORE_RULES.PROHIBITED_TIMEFRAMES.includes(upper as ProhibitedTimeframe)) {
      violations.push(
        `Timeframe ${timeframe} is prohibited. Pipnosis only trades on: ${PIPNOSIS_CORE_RULES.PRIMARY_TIMEFRAMES.join(', ')}`
      );
      return {
        isValid: false,
        violations,
        adjustments: {
          suggestedTimeframe: 'M15'
        }
      };
    }

    return { isValid: true, violations: [] };
  }

  static validateGoalCompletionStrategy(
    goalAmount: number,
    proposedTradeCount: number,
    accountBalance: number
  ): TradeValidationResult {
    const violations: string[] = [];

    if (proposedTradeCount < PIPNOSIS_CORE_RULES.MIN_TRADES_PER_GOAL) {
      violations.push(
        `Goal must be completed with at least ${PIPNOSIS_CORE_RULES.MIN_TRADES_PER_GOAL} trades. Proposed: ${proposedTradeCount}`
      );
    }

    const avgProfitPerTrade = goalAmount / proposedTradeCount;
    const profitPercentPerTrade = (avgProfitPerTrade / accountBalance) * 100;

    if (profitPercentPerTrade > PIPNOSIS_CORE_RULES.MAX_SINGLE_TRADE_PROFIT_PERCENT) {
      violations.push(
        `Average profit per trade (${profitPercentPerTrade.toFixed(2)}%) exceeds safe limit of ${PIPNOSIS_CORE_RULES.MAX_SINGLE_TRADE_PROFIT_PERCENT}%. Increase trade count.`
      );
    }

    if (violations.length > 0) {
      const minSafeTrades = Math.ceil(
        goalAmount / (accountBalance * (PIPNOSIS_CORE_RULES.MAX_SINGLE_TRADE_PROFIT_PERCENT / 100))
      );

      return {
        isValid: false,
        violations,
        adjustments: {
          suggestedDuration: minSafeTrades
        }
      };
    }

    return { isValid: true, violations: [] };
  }

  static isOvernightHold(entryTime: Date, currentTime: Date): boolean {
    const entryDay = entryTime.toDateString();
    const currentDay = currentTime.toDateString();
    return entryDay !== currentDay;
  }

  static shouldAutoClosePosition(
    entryTime: Date,
    currentTime: Date
  ): { shouldClose: boolean; reason?: string; durationInfo?: { minutes: number; hours: number } } {
    const durationMinutes = (currentTime.getTime() - entryTime.getTime()) / 60000;
    const durationHours = durationMinutes / 60;

    // ARCHITECTURAL CHANGE: Duration NEVER triggers auto-close
    // Only weekend/market closure triggers auto-close
    // Duration is tracked for learning/scoring purposes only

    if (PIPNOSIS_CORE_RULES.ENFORCE_END_OF_DAY_CLOSURE) {
      const endOfDay = new Date(currentTime);
      endOfDay.setHours(23, 59 - PIPNOSIS_CORE_RULES.END_OF_DAY_CLOSE_BUFFER_MINUTES, 0, 0);

      if (currentTime >= endOfDay) {
        return {
          shouldClose: true,
          reason: 'End of day market closure (weekend)',
          durationInfo: { minutes: durationMinutes, hours: durationHours }
        };
      }
    }

    // Duration exceeded is now just tracking info, NOT a close trigger
    return {
      shouldClose: false,
      durationInfo: { minutes: durationMinutes, hours: durationHours }
    };
  }

  static calculateCountdownDuration(
    timeframe: string,
    volatility: 'low' | 'medium' | 'high'
  ): number {
    const baseSeconds = {
      M1: 60,
      M5: 120,
      M15: 150,
      H1: 180
    };

    const tfUpper = timeframe.toUpperCase();
    let seconds = baseSeconds[tfUpper as keyof typeof baseSeconds] || 120;

    if (volatility === 'high') {
      seconds = Math.max(PIPNOSIS_CORE_RULES.NOTIFICATION_COUNTDOWN_MIN_SECONDS, seconds - 30);
    }

    return Math.min(
      PIPNOSIS_CORE_RULES.NOTIFICATION_COUNTDOWN_MAX_SECONDS,
      Math.max(PIPNOSIS_CORE_RULES.NOTIFICATION_COUNTDOWN_MIN_SECONDS, seconds)
    );
  }

  static breakGoalIntoSmallTrades(
    goalAmount: number,
    accountBalance: number,
    riskMode: 'low' | 'medium' | 'high'
  ): {
    targetTradeCount: number;
    avgProfitPerTrade: number;
    maxProfitPerTrade: number;
    minProfitPerTrade: number;
  } {
    const maxProfitPercent = PIPNOSIS_CORE_RULES.MAX_SINGLE_TRADE_PROFIT_PERCENT;
    const maxProfitPerTrade = accountBalance * (maxProfitPercent / 100);

    // NOTE: riskMode now means "exposure_level" (capital exposure cap)
    // NOT behavioral constraints on AI psychology
    // These multipliers affect position sizing only
    const exposureMultipliers = {
      low: 0.5,      // Conservative: 50% of max per trade
      medium: 0.75,  // Moderate: 75% of max per trade
      high: 1.0      // Aggressive: 100% of max per trade
    };

    const targetAvgProfit = maxProfitPerTrade * exposureMultipliers[riskMode];

    // STRATEGY: Try to achieve goal in ONE trade first
    // If goal is achievable in 1 trade with acceptable risk, aim for that
    // Otherwise, calculate backup trade count
    let targetTradeCount = 1;

    // If goal exceeds what we can safely do in one trade, plan for multiple
    if (goalAmount > targetAvgProfit) {
      targetTradeCount = Math.max(
        PIPNOSIS_CORE_RULES.MIN_TRADES_PER_GOAL,
        Math.ceil(goalAmount / targetAvgProfit)
      );
    }

    const avgProfitPerTrade = goalAmount / targetTradeCount;

    return {
      targetTradeCount,
      avgProfitPerTrade,
      maxProfitPerTrade: targetAvgProfit * 1.5,
      minProfitPerTrade: targetAvgProfit * 0.5
    };
  }

  static getSystemIdentityPrompt(): string {
    return `You are Pipnosis, an elite duration-aware intraday AI trading system.

CORE IDENTITY (NON-NEGOTIABLE):
- You ALWAYS attempt a trade if profit is mathematically possible
- You NEVER hard-block trades due to time, duration, session, or expected time-to-fill
- TIME IS A SCORING SIGNAL, NOT A REJECTION CONSTRAINT
- Partial success is ALWAYS better than NO_TRADE
- You specialize in scalping and intraday opportunities with automatic style upgrades

ALPHA AUTHORITY PRINCIPLES:
- Always attempt a trade when profit is achievable
- Reduce TP if full goal is infeasible - NEVER refuse
- Execute partial-profit trades over refusing
- Switch styles dynamically based on market conditions
- Learn from reward/penalty outcomes

STYLE UPGRADE MODEL (NOT BLOCKING):
- SCALP: 20min-2hrs target → if >2h expected, AUTO-UPGRADE to MICRO_INTRADAY
- MICRO_INTRADAY: 1hr-6hrs target → if >6h expected, AUTO-UPGRADE to INTRADAY
- INTRADAY: 2hrs-10hrs target → if >10h expected, APPLY PENALTY but STILL EXECUTE

TRADING PREFERENCES:
- Primary timeframes: ${PIPNOSIS_CORE_RULES.PRIMARY_TIMEFRAMES.join(', ')}
- Never use: ${PIPNOSIS_CORE_RULES.PROHIBITED_TIMEFRAMES.join(', ')}
- Weekend market closures are enforced (actual market closure, not arbitrary time limit)

DURATION AWARENESS (SCORING ONLY):
- Low volatility: Expect longer fills → upgrade style, don't block
- High volatility: Expect faster fills → reward for staying in band
- Session liquidity affects confidence scoring, not execution permission
- NEVER choose to NOT trade due to duration concerns alone

LEGITIMATE NO_TRADE CONDITIONS (ONLY THESE):
- Market actually closed (weekend, holiday)
- Data stale or invalid (>5min price, >1hr ATR)
- SL/TP mathematically invalid (wrong side, zero distance)
- Guaranteed negative EV (spread consumes all potential)

GOAL COMPLETION PHILOSOPHY:
- Attempt to achieve goals in single trades when possible
- If goal exceeds capacity, reduce target - NEVER refuse
- Partial progress toward goal is success
- Minimum ${PIPNOSIS_CORE_RULES.MIN_TRADES_PER_GOAL} trades per goal (guidance, not block)
- Maximum ${PIPNOSIS_CORE_RULES.MAX_SINGLE_TRADE_PROFIT_PERCENT}% profit per single trade (guidance, not block)

Your role is to ENGINEER OUTCOMES, not refuse opportunities. Any situation where profit is possible should result in trade execution with appropriate style/penalty adjustments.`;
  }

  static validateLLMResponse(response: any): TradeValidationResult {
    const violations: string[] = [];

    if (response.timeHorizon) {
      const horizon = response.timeHorizon.toLowerCase();
      if (horizon.includes('day') || horizon.includes('week') || horizon.includes('swing') || horizon.includes('position')) {
        violations.push(`LLM suggested prohibited time horizon: ${response.timeHorizon}. Must be short-term only.`);
      }
    }

    if (response.holdDuration) {
      const duration = parseFloat(response.holdDuration);
      if (duration > PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS) {
        violations.push(`LLM suggested hold duration ${duration} hours exceeds maximum ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS} hours.`);
      }
    }

    if (response.timeframe) {
      const validation = this.validateTimeframe(response.timeframe);
      if (!validation.isValid) {
        violations.push(...validation.violations);
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
      adjustments: violations.length > 0 ? {
        suggestedDuration: PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60,
        suggestedTimeframe: 'M15'
      } : undefined
    };
  }

  static enforcementLog(violation: string, action: string): void {
    console.warn(`[Pipnosis Core Rules] VIOLATION: ${violation}`);
    console.warn(`[Pipnosis Core Rules] ACTION: ${action}`);
  }
}

export const pipnosisRules = new PipnosisCoreRules();
