/**
 * Safety Enforcer - Hard-Coded Safety Rules
 *
 * Final validation layer that CANNOT be bypassed by any LLM output.
 * Runs POST-decision to enforce absolute safety limits.
 */

import type { TradeDecision } from './llm-execution-brain';

export interface SafetyContext {
  balance: number;
  currentExposure: number; // % of balance already at risk
  openTrades: number;
  dailyDrawdown: number; // % drawdown today
  atr: number;
  currentPrice: number;
}

export interface ValidationResult {
  passed: boolean;
  violations: string[];
  action: 'ALLOW' | 'BLOCK';
  adjustedDecision?: TradeDecision;
  adjustments?: string[];
}

class SafetyEnforcer {
  // HARD-CODED LIMITS - CANNOT BE CHANGED BY LLM
  private readonly MAX_RISK_PER_TRADE = 0.05; // 5%
  private readonly MIN_RISK_PER_TRADE = 0.005; // 0.5%
  private readonly MAX_TOTAL_EXPOSURE = 0.08; // 8%
  private readonly MAX_DAILY_DRAWDOWN = 0.08; // 8%
  private readonly MAX_CONCURRENT_TRADES = 3;
  private readonly MIN_SL_DISTANCE_ATR = 0.5;
  private readonly MAX_SL_DISTANCE_ATR = 3.0;
  private readonly MIN_RR_RATIO = 1.0;
  private readonly TARGET_RR_RATIO = 1.5; // Auto-adjust to this if below MIN

  /**
   * Validate trade decision against hard-coded rules
   */
  validateTrade(
    decision: TradeDecision,
    context: SafetyContext
  ): ValidationResult {
    const violations: string[] = [];
    const adjustments: string[] = [];
    let adjustedDecision = { ...decision };

    // Skip validation for NO_TRADE
    if (decision.action === 'NO_TRADE') {
      return {
        passed: true,
        violations: [],
        action: 'ALLOW',
        adjustments: []
      };
    }

    // 1. Risk per trade validation
    const riskAmount = (decision.risk_pct / 100) * context.balance;
    const riskPct = decision.risk_pct / 100;

    if (riskPct > this.MAX_RISK_PER_TRADE) {
      violations.push(`Risk ${(riskPct * 100).toFixed(2)}% exceeds max ${this.MAX_RISK_PER_TRADE * 100}%`);
    }

    if (riskPct < this.MIN_RISK_PER_TRADE) {
      violations.push(`Risk ${(riskPct * 100).toFixed(2)}% below min ${this.MIN_RISK_PER_TRADE * 100}%`);
    }

    // 2. Total exposure validation
    const newExposure = context.currentExposure + riskPct;
    if (newExposure > this.MAX_TOTAL_EXPOSURE) {
      violations.push(`Total exposure ${(newExposure * 100).toFixed(2)}% exceeds ${this.MAX_TOTAL_EXPOSURE * 100}%`);
    }

    // 3. SL/TP direction validation
    if (decision.action === 'BUY') {
      if (decision.stopLoss >= decision.entry) {
        violations.push('BUY: Stop loss must be below entry');
      }
      if (decision.takeProfit <= decision.entry) {
        violations.push('BUY: Take profit must be above entry');
      }
    } else if (decision.action === 'SELL') {
      if (decision.stopLoss <= decision.entry) {
        violations.push('SELL: Stop loss must be above entry');
      }
      if (decision.takeProfit >= decision.entry) {
        violations.push('SELL: Take profit must below entry');
      }
    }

    // 4. NaN/Infinity checks
    if (!isFinite(decision.entry) || !isFinite(decision.stopLoss) || !isFinite(decision.takeProfit)) {
      violations.push('Invalid price values (NaN/Infinity)');
    }

    if (decision.entry <= 0 || decision.stopLoss <= 0 || decision.takeProfit <= 0) {
      violations.push('Prices must be positive');
    }

    // 5. SL distance validation (prevent too tight or too wide stops)
    const slDistance = Math.abs(adjustedDecision.entry - adjustedDecision.stopLoss);
    const minSlDistance = context.atr * this.MIN_SL_DISTANCE_ATR;
    const maxSlDistance = context.atr * this.MAX_SL_DISTANCE_ATR;

    if (slDistance < minSlDistance) {
      violations.push(`SL too tight: ${slDistance.toFixed(5)} < ${minSlDistance.toFixed(5)} (${this.MIN_SL_DISTANCE_ATR} ATR)`);
    }

    if (slDistance > maxSlDistance) {
      violations.push(`SL too wide: ${slDistance.toFixed(5)} > ${maxSlDistance.toFixed(5)} (${this.MAX_SL_DISTANCE_ATR} ATR)`);
    }

    // 6. Risk:Reward ratio validation with AUTO-ADJUSTMENT
    let tpDistance = Math.abs(adjustedDecision.takeProfit - adjustedDecision.entry);
    let rr = tpDistance / slDistance;

    if (rr < this.TARGET_RR_RATIO) {
      // AUTO-ADJUST: Extend TP to meet TARGET_RR_RATIO (1.5)
      const requiredTpDistance = slDistance * this.TARGET_RR_RATIO;
      const oldTp = adjustedDecision.takeProfit;

      if (adjustedDecision.action === 'BUY') {
        adjustedDecision.takeProfit = adjustedDecision.entry + requiredTpDistance;
      } else {
        adjustedDecision.takeProfit = adjustedDecision.entry - requiredTpDistance;
      }

      adjustments.push(`R:R auto-adjusted from ${rr.toFixed(2)} to ${this.TARGET_RR_RATIO}`);
      adjustments.push(`TP adjusted: ${oldTp.toFixed(5)} → ${adjustedDecision.takeProfit.toFixed(5)}`);

      console.log(`[Safety] 🔧 R:R ${rr.toFixed(2)} adjusted to ${this.TARGET_RR_RATIO}`);
      console.log(`[Safety] 🎯 TP adjusted: ${oldTp.toFixed(5)} → ${adjustedDecision.takeProfit.toFixed(5)}`);

      // Recalculate R:R with new TP
      tpDistance = Math.abs(adjustedDecision.takeProfit - adjustedDecision.entry);
      rr = tpDistance / slDistance;
    }

    // Only flag as violation if even after adjustment it's still below MIN (shouldn't happen)
    if (rr < this.MIN_RR_RATIO) {
      violations.push(`R:R ratio ${rr.toFixed(2)} below absolute min ${this.MIN_RR_RATIO} (after adjustment)`);
    }

    // 7. Maximum position size
    const maxPositionSize = context.balance * this.MAX_RISK_PER_TRADE;
    if (riskAmount > maxPositionSize) {
      violations.push(`Position size $${riskAmount.toFixed(2)} exceeds max $${maxPositionSize.toFixed(2)}`);
    }

    // 8. Daily drawdown limit
    if (context.dailyDrawdown < -this.MAX_DAILY_DRAWDOWN) {
      violations.push(`Daily drawdown ${(context.dailyDrawdown * 100).toFixed(2)}% exceeds ${this.MAX_DAILY_DRAWDOWN * 100}%`);
    }

    // 9. Max concurrent trades
    if (context.openTrades >= this.MAX_CONCURRENT_TRADES) {
      violations.push(`Max ${this.MAX_CONCURRENT_TRADES} concurrent trades reached`);
    }

    // 10. Entry price vs current price sanity check
    const priceDiff = Math.abs(decision.entry - context.currentPrice) / context.currentPrice;
    if (priceDiff > 0.01) { // 1% difference
      violations.push(`Entry price ${decision.entry} too far from current ${context.currentPrice}`);
    }

    const passed = violations.length === 0;

    if (!passed) {
      console.warn('[Safety Enforcer] 🚫 TRADE BLOCKED');
      violations.forEach(v => console.warn(`  - ${v}`));
    } else {
      console.log('[Safety Enforcer] ✅ Safety checks passed');
      if (adjustments.length > 0) {
        console.log('[Safety Enforcer] 🔧 Auto-adjustments applied:');
        adjustments.forEach(a => console.log(`  ✓ ${a}`));
      }
    }

    return {
      passed,
      violations,
      action: passed ? 'ALLOW' : 'BLOCK',
      adjustedDecision: adjustments.length > 0 ? adjustedDecision : undefined,
      adjustments
    };
  }

  /**
   * Get safety limits summary
   */
  getSafetyLimits(): Record<string, any> {
    return {
      maxRiskPerTrade: `${this.MAX_RISK_PER_TRADE * 100}%`,
      minRiskPerTrade: `${this.MIN_RISK_PER_TRADE * 100}%`,
      maxTotalExposure: `${this.MAX_TOTAL_EXPOSURE * 100}%`,
      maxDailyDrawdown: `${this.MAX_DAILY_DRAWDOWN * 100}%`,
      maxConcurrentTrades: this.MAX_CONCURRENT_TRADES,
      minSLDistance: `${this.MIN_SL_DISTANCE_ATR} ATR`,
      maxSLDistance: `${this.MAX_SL_DISTANCE_ATR} ATR`,
      minRRRatio: this.MIN_RR_RATIO
    };
  }

  /**
   * Check if user can open new trade
   */
  canOpenTrade(context: SafetyContext): { can: boolean; reason?: string } {
    if (context.openTrades >= this.MAX_CONCURRENT_TRADES) {
      return {
        can: false,
        reason: `Maximum ${this.MAX_CONCURRENT_TRADES} trades already open`
      };
    }

    if (context.currentExposure >= this.MAX_TOTAL_EXPOSURE) {
      return {
        can: false,
        reason: `Maximum exposure ${this.MAX_TOTAL_EXPOSURE * 100}% reached`
      };
    }

    if (context.dailyDrawdown < -this.MAX_DAILY_DRAWDOWN) {
      return {
        can: false,
        reason: `Daily drawdown limit ${this.MAX_DAILY_DRAWDOWN * 100}% reached`
      };
    }

    return { can: true };
  }
}

export const safetyEnforcer = new SafetyEnforcer();
