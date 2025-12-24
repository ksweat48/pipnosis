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
  // Core Duration Rules (Pure Intraday Specialist)
  TRADE_DURATION_MAX_HOURS: 8,           // Absolute maximum (hard block)
  TRADE_DURATION_MAX_MINUTES: 480,       // 8 hours in minutes
  TRADE_DURATION_TARGET_MIN_HOURS: 0.33, // 20 minutes minimum target
  TRADE_DURATION_TARGET_MAX_HOURS: 2.0,  // 2 hours maximum target
  TRADE_DURATION_PREFERRED_MAX_HOURS: 2, // Preferred maximum
  TRADE_DURATION_WARNING_HOURS: 4,       // Warn at 4 hours
  TRADE_DURATION_BLOCK_HOURS: 6,         // Block at 6+ hours expected
  TRADE_DURATION_MIN_HOURS: 1,           // Kept for compatibility

  TRADE_STYLE: 'scalp_and_intraday_only' as const,
  GOAL_COMPLETION_METHOD: 'multiple_small_trades' as const,
  ALLOW_SWING_TRADES: false,
  ALLOW_OVERNIGHT_HOLDS: false,
  ALLOW_MULTI_DAY_POSITIONS: false,

  // Updated volatility map for intraday focus
  TRADE_DURATION_VOLATILITY_MAP: {
    low: { min: 0.33, preferred: 1.5, max: 2.0 },     // 20min-2hr for conservative
    medium: { min: 0.33, preferred: 1.0, max: 2.0 },  // 20min-2hr for moderate
    high: { min: 0.17, preferred: 0.75, max: 1.5 }    // 10min-1.5hr for aggressive
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

  AUTO_CLOSE_ON_DURATION_EXCEEDED: true,
  ENFORCE_END_OF_DAY_CLOSURE: true,
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

export type TradeStyle = 'scalp' | 'intraday' | 'swing' | 'position';
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

    if (style === 'swing' || style === 'position') {
      violations.push(`Pipnosis does not support ${style} trades. Only scalp and intraday trades are allowed.`);
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
  ): { shouldClose: boolean; reason?: string } {
    const durationMinutes = (currentTime.getTime() - entryTime.getTime()) / 60000;

    if (durationMinutes > PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES) {
      return {
        shouldClose: true,
        reason: `Trade exceeded maximum duration of ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS} hours`
      };
    }

    if (this.isOvernightHold(entryTime, currentTime)) {
      return {
        shouldClose: true,
        reason: 'Overnight holds are not permitted'
      };
    }

    if (PIPNOSIS_CORE_RULES.ENFORCE_END_OF_DAY_CLOSURE) {
      const endOfDay = new Date(currentTime);
      endOfDay.setHours(23, 59 - PIPNOSIS_CORE_RULES.END_OF_DAY_CLOSE_BUFFER_MINUTES, 0, 0);

      if (currentTime >= endOfDay) {
        return {
          shouldClose: true,
          reason: 'End of day closure enforcement'
        };
      }
    }

    return { shouldClose: false };
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
- You ONLY execute trades lasting 1-10 hours (extended from 6 for better TP fills)
- You are DURATION-AWARE: choose realistic TPs that can fill within time constraints
- You NEVER hold positions overnight or multi-day
- You NEVER suggest swing trades or long-term positions
- You aim to complete user goals in ONE high-quality trade first, taking backup trades only if needed based on market conditions
- You specialize in scalping and intraday opportunities

TRADING CONSTRAINTS:
- Maximum trade duration: ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS} hours
- Preferred trade duration: ${PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS} hours or less
- Minimum trade duration: ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MIN_HOURS} hour
- Primary timeframes: ${PIPNOSIS_CORE_RULES.PRIMARY_TIMEFRAMES.join(', ')}
- Never use: ${PIPNOSIS_CORE_RULES.PROHIBITED_TIMEFRAMES.join(', ')}
- All positions must close before end of trading day

DURATION AWARENESS:
- Low volatility: Expect 2-10 hour TP fills (slow markets need more time)
- Medium volatility: Expect 1-8 hour TP fills (standard intraday)
- High volatility: Expect 1-6 hour TP fills (fast markets fill quickly)
- Session liquidity affects fill time (London/NY faster, Asian slower)
- NEVER choose TPs that require more than allowed duration to fill

GOAL COMPLETION PHILOSOPHY:
- Attempt to achieve goals in single trades when possible; only use multiple trades if the goal exceeds safe single-trade limits
- Execute multiple safe trades rather than risky large trades
- Accumulate consistent wins over time
- Minimum ${PIPNOSIS_CORE_RULES.MIN_TRADES_PER_GOAL} trades per goal
- Maximum ${PIPNOSIS_CORE_RULES.MAX_SINGLE_TRADE_PROFIT_PERCENT}% profit per single trade

Your recommendations must ALWAYS comply with these rules. If a market condition or user request conflicts with these rules, adjust your recommendation to fit within these constraints.`;
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
