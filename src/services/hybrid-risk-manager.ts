import { supabase } from '@/lib/supabase';

/**
 * HYBRID RISK MANAGEMENT SYSTEM
 *
 * Hard Safety Rails (Non-negotiable):
 * - Max 5% risk per trade
 * - Max 8% total session exposure
 * - Max 3 concurrent open trades
 *
 * Soft Dynamic Adjustments:
 * - Auto-reduce risk by 50% if drawdown >= 3%
 * - Block new trades if daily loss remaining <= 2%
 * - A-grade only mode when daily goal 90% complete
 *
 * LLM has FULL autonomy inside these rails to:
 * - Scale risk (0-5%)
 * - Adjust R:R ratios
 * - Respond to volatility
 * - Respect market structure
 */

// ============================================================
// HARD LIMITS (NON-NEGOTIABLE)
// ============================================================

export const HARD_RISK_LIMITS = {
  MAX_RISK_PER_TRADE_PCT: 5.0,           // Maximum risk per single trade
  MAX_TOTAL_SESSION_EXPOSURE_PCT: 8.0,   // Maximum total open exposure
  MAX_OPEN_TRADES: 3,                     // Maximum concurrent positions
  MIN_RISK_REWARD_RATIO: 1.5,            // Minimum R:R for any trade
  MAX_TRADE_DURATION_MINUTES: 1440,      // 24 hours maximum hold
  MIN_CONFIDENCE_THRESHOLD: 70,          // Minimum confidence to execute
} as const;

// ============================================================
// SOFT ADJUSTMENT TRIGGERS
// ============================================================

export const SOFT_ADJUSTMENT_TRIGGERS = {
  DRAWDOWN_RISK_REDUCTION_THRESHOLD: 3.0,    // Reduce risk at 3% drawdown
  DRAWDOWN_RISK_REDUCTION_FACTOR: 0.5,       // Cut risk by 50%
  DAILY_LOSS_CRITICAL_REMAINING_PCT: 2.0,    // Block trades if < 2% loss remaining
  DAILY_GOAL_A_GRADE_THRESHOLD_PCT: 90.0,    // A-grade only at 90% goal complete
} as const;

// ============================================================
// INTERFACES
// ============================================================

export interface HybridRiskLimits {
  maxRiskPerTradePct: number;
  maxTotalSessionExposurePct: number;
  maxOpenTrades: number;
  minRiskRewardRatio: number;
  minConfidenceThreshold: number;
}

export interface SessionExposureState {
  userId: string;
  openTradesCount: number;
  totalOpenRiskPct: number;
  remainingExposureCapacityPct: number;
  openTrades: ActiveTradeInfo[];
}

export interface ActiveTradeInfo {
  tradeId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  riskPct: number;
  openedAt: Date;
}

export interface RiskContextForLLM {
  // Hard Limits
  hardLimits: HybridRiskLimits;

  // Current Exposure
  totalOpenRiskPct: number;
  openTradesCount: number;
  remainingCapacityPct: number;

  // Account State
  drawdownPct: number;
  dailyLossRemainingPct: number;
  dailyGoalRemainingPct: number;

  // Dynamic Adjustments Active
  drawdownRiskReductionActive: boolean;
  effectiveMaxRiskPct: number; // Adjusted based on drawdown
  dailyLossLimitCritical: boolean;
  aGradeOnlyMode: boolean;

  // Recent Performance
  recentPerformance: {
    winRate: number;
    profitFactor: number;
    winStreak: number;
    lossStreak: number;
    last10TradesWinRate: number;
  };
}

export interface RiskValidationResult {
  isValid: boolean;
  violations: string[];
  adjustedRiskPct?: number;
  warnings?: string[];
}

// ============================================================
// HYBRID RISK MANAGER CLASS
// ============================================================

class HybridRiskManager {

  /**
   * Get current session exposure state
   */
  async getSessionExposure(userId: string, sessionId: string): Promise<SessionExposureState> {
    try {
      // Query all open trades for this user in current session
      const { data: openTrades, error } = await supabase
        .from('trade_history')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (error) {
        console.error('[Hybrid Risk] Error fetching open trades:', error);
        return this.getEmptyExposureState(userId);
      }

      if (!openTrades || openTrades.length === 0) {
        return this.getEmptyExposureState(userId);
      }

      // Calculate total open risk
      let totalOpenRiskPct = 0;
      const activeTrades: ActiveTradeInfo[] = [];

      for (const trade of openTrades) {
        const riskPct = trade.risk_percent || 0;
        totalOpenRiskPct += riskPct;

        activeTrades.push({
          tradeId: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          entryPrice: trade.entry_price,
          stopLoss: trade.stop_loss,
          riskPct: riskPct,
          openedAt: new Date(trade.opened_at)
        });
      }

      const remainingCapacity = Math.max(0, HARD_RISK_LIMITS.MAX_TOTAL_SESSION_EXPOSURE_PCT - totalOpenRiskPct);

      return {
        userId,
        openTradesCount: openTrades.length,
        totalOpenRiskPct,
        remainingExposureCapacityPct: remainingCapacity,
        openTrades: activeTrades
      };
    } catch (error) {
      console.error('[Hybrid Risk] Exception getting session exposure:', error);
      return this.getEmptyExposureState(userId);
    }
  }

  /**
   * Validate if a new trade can be opened
   */
  async validateNewTrade(
    userId: string,
    sessionId: string,
    requestedRiskPct: number,
    confidence: number,
    riskRewardRatio: number
  ): Promise<RiskValidationResult> {
    const violations: string[] = [];
    const warnings: string[] = [];

    // Get current exposure
    const exposure = await this.getSessionExposure(userId, sessionId);

    // HARD LIMIT 1: Max concurrent trades
    if (exposure.openTradesCount >= HARD_RISK_LIMITS.MAX_OPEN_TRADES) {
      violations.push(`Already at max concurrent trades (${HARD_RISK_LIMITS.MAX_OPEN_TRADES})`);
    }

    // HARD LIMIT 2: Max risk per trade
    if (requestedRiskPct > HARD_RISK_LIMITS.MAX_RISK_PER_TRADE_PCT) {
      violations.push(`Risk ${requestedRiskPct}% exceeds max per trade (${HARD_RISK_LIMITS.MAX_RISK_PER_TRADE_PCT}%)`);
    }

    // HARD LIMIT 3: Total session exposure
    const totalExposureAfterTrade = exposure.totalOpenRiskPct + requestedRiskPct;
    if (totalExposureAfterTrade > HARD_RISK_LIMITS.MAX_TOTAL_SESSION_EXPOSURE_PCT) {
      violations.push(
        `Total exposure ${totalExposureAfterTrade.toFixed(1)}% would exceed max (${HARD_RISK_LIMITS.MAX_TOTAL_SESSION_EXPOSURE_PCT}%). ` +
        `Current: ${exposure.totalOpenRiskPct.toFixed(1)}%, Remaining: ${exposure.remainingExposureCapacityPct.toFixed(1)}%`
      );
    }

    // HARD LIMIT 4: Minimum R:R ratio
    if (riskRewardRatio < HARD_RISK_LIMITS.MIN_RISK_REWARD_RATIO) {
      violations.push(`Risk:Reward ${riskRewardRatio.toFixed(2)} below minimum ${HARD_RISK_LIMITS.MIN_RISK_REWARD_RATIO}`);
    }

    // HARD LIMIT 5: Minimum confidence
    if (confidence < HARD_RISK_LIMITS.MIN_CONFIDENCE_THRESHOLD) {
      violations.push(`Confidence ${confidence}% below minimum ${HARD_RISK_LIMITS.MIN_CONFIDENCE_THRESHOLD}%`);
    }

    // Get dynamic adjustments
    const riskContext = await this.getRiskContextForLLM(userId, sessionId, exposure);

    // SOFT ADJUSTMENT: Risk reduction due to drawdown
    let adjustedRiskPct = requestedRiskPct;
    if (riskContext.drawdownRiskReductionActive) {
      adjustedRiskPct = requestedRiskPct * SOFT_ADJUSTMENT_TRIGGERS.DRAWDOWN_RISK_REDUCTION_FACTOR;
      warnings.push(
        `Risk reduced from ${requestedRiskPct}% to ${adjustedRiskPct.toFixed(1)}% due to ${riskContext.drawdownPct.toFixed(1)}% drawdown`
      );
    }

    // SOFT BLOCK: Daily loss limit critical
    if (riskContext.dailyLossLimitCritical) {
      violations.push(
        `Daily loss limit critical (${riskContext.dailyLossRemainingPct.toFixed(1)}% remaining). No new trades allowed.`
      );
    }

    // SOFT WARNING: A-grade only mode
    if (riskContext.aGradeOnlyMode) {
      warnings.push(
        `Daily goal ${riskContext.dailyGoalRemainingPct.toFixed(1)}% remaining - only A-grade setups recommended`
      );
    }

    return {
      isValid: violations.length === 0,
      violations,
      adjustedRiskPct: adjustedRiskPct !== requestedRiskPct ? adjustedRiskPct : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Get complete risk context for LLM decision making
   */
  async getRiskContextForLLM(
    userId: string,
    sessionId: string,
    exposureState?: SessionExposureState
  ): Promise<RiskContextForLLM> {
    // Get exposure if not provided
    const exposure = exposureState || await this.getSessionExposure(userId, sessionId);

    // Get account state
    const accountState = await this.getAccountState(userId);

    // Get recent performance
    const recentPerformance = await this.getRecentPerformance(userId);

    // Calculate dynamic adjustments
    const drawdownRiskReductionActive = accountState.drawdownPct >= SOFT_ADJUSTMENT_TRIGGERS.DRAWDOWN_RISK_REDUCTION_THRESHOLD;
    const effectiveMaxRiskPct = drawdownRiskReductionActive
      ? HARD_RISK_LIMITS.MAX_RISK_PER_TRADE_PCT * SOFT_ADJUSTMENT_TRIGGERS.DRAWDOWN_RISK_REDUCTION_FACTOR
      : HARD_RISK_LIMITS.MAX_RISK_PER_TRADE_PCT;

    const dailyLossLimitCritical = accountState.dailyLossRemainingPct <= SOFT_ADJUSTMENT_TRIGGERS.DAILY_LOSS_CRITICAL_REMAINING_PCT;
    const aGradeOnlyMode = accountState.dailyGoalProgressPct >= SOFT_ADJUSTMENT_TRIGGERS.DAILY_GOAL_A_GRADE_THRESHOLD_PCT;

    return {
      hardLimits: {
        maxRiskPerTradePct: HARD_RISK_LIMITS.MAX_RISK_PER_TRADE_PCT,
        maxTotalSessionExposurePct: HARD_RISK_LIMITS.MAX_TOTAL_SESSION_EXPOSURE_PCT,
        maxOpenTrades: HARD_RISK_LIMITS.MAX_OPEN_TRADES,
        minRiskRewardRatio: HARD_RISK_LIMITS.MIN_RISK_REWARD_RATIO,
        minConfidenceThreshold: HARD_RISK_LIMITS.MIN_CONFIDENCE_THRESHOLD
      },
      totalOpenRiskPct: exposure.totalOpenRiskPct,
      openTradesCount: exposure.openTradesCount,
      remainingCapacityPct: exposure.remainingExposureCapacityPct,
      drawdownPct: accountState.drawdownPct,
      dailyLossRemainingPct: accountState.dailyLossRemainingPct,
      dailyGoalRemainingPct: 100 - accountState.dailyGoalProgressPct,
      drawdownRiskReductionActive,
      effectiveMaxRiskPct,
      dailyLossLimitCritical,
      aGradeOnlyMode,
      recentPerformance
    };
  }

  /**
   * Apply post-LLM safety clamp
   */
  async applySafetyClamp(
    userId: string,
    sessionId: string,
    llmRiskPct: number,
    llmConfidence: number,
    llmRiskReward: number
  ): Promise<{
    clampedRiskPct: number;
    isAllowed: boolean;
    violations: string[];
    adjustments: string[];
  }> {
    const adjustments: string[] = [];
    const violations: string[] = [];

    // Get risk context
    const riskContext = await this.getRiskContextForLLM(userId, sessionId);

    // Clamp risk to hard maximum
    let clampedRiskPct = Math.min(llmRiskPct, riskContext.effectiveMaxRiskPct);
    if (clampedRiskPct !== llmRiskPct) {
      adjustments.push(`Risk clamped from ${llmRiskPct}% to ${clampedRiskPct}% (effective max: ${riskContext.effectiveMaxRiskPct}%)`);
    }

    // Validate with hard limits
    const validationResult = await this.validateNewTrade(
      userId,
      sessionId,
      clampedRiskPct,
      llmConfidence,
      llmRiskReward
    );

    return {
      clampedRiskPct,
      isAllowed: validationResult.isValid,
      violations: validationResult.violations,
      adjustments: [
        ...adjustments,
        ...(validationResult.warnings || [])
      ]
    };
  }

  /**
   * Get account state (drawdown, daily limits)
   */
  private async getAccountState(userId: string): Promise<{
    drawdownPct: number;
    dailyLossRemainingPct: number;
    dailyGoalProgressPct: number;
  }> {
    try {
      // Get user profile for balance info
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('initial_balance')
        .eq('id', userId)
        .maybeSingle();

      const initialBalance = profile?.initial_balance || 10000;

      // Get current balance from latest trade or user_balance
      const { data: balance } = await supabase
        .from('user_balance')
        .select('current_balance, peak_balance, daily_pnl, daily_goal')
        .eq('user_id', userId)
        .maybeSingle();

      const currentBalance = balance?.current_balance || initialBalance;
      const peakBalance = balance?.peak_balance || initialBalance;
      const dailyPnl = balance?.daily_pnl || 0;
      const dailyGoal = balance?.daily_goal || 100;

      // Calculate drawdown
      const drawdownPct = peakBalance > 0
        ? ((peakBalance - currentBalance) / peakBalance) * 100
        : 0;

      // Calculate daily loss remaining (assuming max loss is 5% of account)
      const maxDailyLoss = currentBalance * 0.05;
      const dailyLossRemainingPct = ((maxDailyLoss + dailyPnl) / currentBalance) * 100;

      // Calculate daily goal progress
      const dailyGoalProgressPct = dailyGoal > 0
        ? Math.min(100, Math.max(0, (dailyPnl / dailyGoal) * 100))
        : 0;

      return {
        drawdownPct: Math.max(0, drawdownPct),
        dailyLossRemainingPct: Math.max(0, dailyLossRemainingPct),
        dailyGoalProgressPct
      };
    } catch (error) {
      console.error('[Hybrid Risk] Error getting account state:', error);
      return {
        drawdownPct: 0,
        dailyLossRemainingPct: 100,
        dailyGoalProgressPct: 0
      };
    }
  }

  /**
   * Get recent performance metrics
   */
  private async getRecentPerformance(userId: string): Promise<{
    winRate: number;
    profitFactor: number;
    winStreak: number;
    lossStreak: number;
    last10TradesWinRate: number;
  }> {
    try {
      // Get last 50 trades
      const { data: trades } = await supabase
        .from('trade_history')
        .select('pnl, status')
        .eq('user_id', userId)
        .in('status', ['closed', 'stopped', 'target_hit'])
        .order('closed_at', { ascending: false })
        .limit(50);

      if (!trades || trades.length === 0) {
        return {
          winRate: 50,
          profitFactor: 1.0,
          winStreak: 0,
          lossStreak: 0,
          last10TradesWinRate: 50
        };
      }

      const wins = trades.filter(t => t.pnl > 0);
      const losses = trades.filter(t => t.pnl < 0);
      const winRate = (wins.length / trades.length) * 100;

      const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
      const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 1.0;

      // Calculate streaks
      let winStreak = 0;
      let lossStreak = 0;
      for (const trade of trades) {
        if (trade.pnl > 0) {
          winStreak++;
          lossStreak = 0;
        } else if (trade.pnl < 0) {
          lossStreak++;
          winStreak = 0;
        }
        if (winStreak > 0 || lossStreak > 0) break;
      }

      // Last 10 trades win rate
      const last10 = trades.slice(0, 10);
      const last10Wins = last10.filter(t => t.pnl > 0).length;
      const last10TradesWinRate = last10.length > 0 ? (last10Wins / last10.length) * 100 : 50;

      return {
        winRate,
        profitFactor,
        winStreak,
        lossStreak,
        last10TradesWinRate
      };
    } catch (error) {
      console.error('[Hybrid Risk] Error getting recent performance:', error);
      return {
        winRate: 50,
        profitFactor: 1.0,
        winStreak: 0,
        lossStreak: 0,
        last10TradesWinRate: 50
      };
    }
  }

  /**
   * Get empty exposure state
   */
  private getEmptyExposureState(userId: string): SessionExposureState {
    return {
      userId,
      openTradesCount: 0,
      totalOpenRiskPct: 0,
      remainingExposureCapacityPct: HARD_RISK_LIMITS.MAX_TOTAL_SESSION_EXPOSURE_PCT,
      openTrades: []
    };
  }

  /**
   * Log risk decision for audit trail
   */
  async logRiskDecision(
    userId: string,
    sessionId: string,
    decision: 'allowed' | 'blocked' | 'adjusted',
    details: {
      requestedRiskPct: number;
      finalRiskPct: number;
      violations?: string[];
      adjustments?: string[];
    }
  ): Promise<void> {
    try {
      await supabase.from('risk_decision_log').insert({
        user_id: userId,
        session_id: sessionId,
        decision,
        requested_risk_pct: details.requestedRiskPct,
        final_risk_pct: details.finalRiskPct,
        violations: details.violations || [],
        adjustments: details.adjustments || [],
        created_at: new Date().toISOString()
      });
    } catch (error) {
      // Non-critical, just log
      console.error('[Hybrid Risk] Failed to log risk decision:', error);
    }
  }
}

export const hybridRiskManager = new HybridRiskManager();
