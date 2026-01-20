/**
 * Safety Enforcer - Hard-Coded Safety Rules
 *
 * Final validation layer that CANNOT be bypassed by any LLM output.
 * Runs POST-decision to enforce absolute safety limits.
 */

import { TRADING_CONSTANTS } from '../config/trading-constants';
import type { TradeDecision } from './llm-execution-brain';
import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';

export interface SafetyContext {
  balance: number;
  currentExposure: number; // % of balance already at risk
  openTrades: number;
  dailyDrawdown: number; // % drawdown today
  atr: number;
  currentPrice: number;
  regime?: RegimeSnapshot; // Market regime for enhanced safety checks
  adversarial?: AdversarialSignal; // Adversarial environment detection
}

export interface ValidationResult {
  passed: boolean;
  violations: string[];
  action: 'ALLOW' | 'BLOCK';
  adjustedDecision?: TradeDecision;
  adjustments?: string[];
}

class SafetyEnforcer {
  // HARD-CODED LIMITS - SSOT from trading-constants.ts
  private readonly MAX_RISK_PER_TRADE = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE;
  private readonly MIN_RISK_PER_TRADE = TRADING_CONSTANTS.RISK_PERCENTAGES.MIN_PER_TRADE;
  private readonly MAX_TOTAL_EXPOSURE = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_TOTAL_EXPOSURE;
  private readonly MAX_DAILY_DRAWDOWN = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_DAILY_DRAWDOWN;
  private readonly MAX_CONCURRENT_TRADES = TRADING_CONSTANTS.POSITION_LIMITS.MAX_OPEN_TRADES;
  private readonly MIN_SL_DISTANCE_ATR = TRADING_CONSTANTS.ATR_MULTIPLIERS.MIN_SL_DISTANCE;
  private readonly MAX_SL_DISTANCE_ATR = TRADING_CONSTANTS.ATR_MULTIPLIERS.STOP_LOSS_WIDE;
  private readonly MIN_RR_RATIO = TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM;
  private readonly TARGET_RR_RATIO = TRADING_CONSTANTS.RISK_REWARD_RATIOS.TARGET;

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

    // Skip validation for NO_TRADE (no trade execution)
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

    // 11. REGIME-BASED SAFETY CHECKS
    if (context.regime) {
      const regime = context.regime;

      // Block dead zone trades (regime oracle should have caught this, but double-check)
      if (regime.avoid_trading) {
        violations.push(`Regime block: ${regime.reason || 'Unfavorable market conditions'}`);
      }

      // Apply risk reduction for high volatility
      if (regime.is_high_risk_regime && regime.risk_reduction_factor < 1.0) {
        const originalRisk = adjustedDecision.risk_pct;
        adjustedDecision.risk_pct = originalRisk * regime.risk_reduction_factor;
        adjustments.push(`Risk reduced: ${originalRisk.toFixed(2)}% → ${adjustedDecision.risk_pct.toFixed(2)}% (high volatility)`);
        console.log(`[Safety] 🔧 Risk auto-reduced due to regime (factor: ${regime.risk_reduction_factor})`);
      }

      // Widen stops for high wick risk (stop hunting protection)
      if (regime.wick_risk === 'high') {
        const originalSL = adjustedDecision.stopLoss;
        const slDirection = adjustedDecision.action === 'BUY' ? -1 : 1;
        const widening = slDistance * 0.20; // 20% wider
        adjustedDecision.stopLoss = adjustedDecision.entry + (slDirection * (slDistance + widening));
        adjustments.push(`SL widened 20% for high wick risk: ${originalSL.toFixed(5)} → ${adjustedDecision.stopLoss.toFixed(5)}`);
        console.log(`[Safety] 🔧 SL widened due to high wick risk`);
      }

      // Higher R:R requirement during volatile opens
      if ((regime.session === 'ny_open' || regime.session_open) && regime.volatility_score > 75) {
        const currentRR = tpDistance / slDistance;
        if (currentRR < 2.0) {
          const requiredTpDistance = slDistance * 2.0;
          const oldTp = adjustedDecision.takeProfit;
          if (adjustedDecision.action === 'BUY') {
            adjustedDecision.takeProfit = adjustedDecision.entry + requiredTpDistance;
          } else {
            adjustedDecision.takeProfit = adjustedDecision.entry - requiredTpDistance;
          }
          adjustments.push(`R:R increased to 2.0 for volatile session open: ${currentRR.toFixed(2)} → 2.0`);
          console.log(`[Safety] 🔧 R:R increased for volatile session open`);
        }
      }

      // Block breakouts during compression + range
      if (regime.atr_compression && regime.structure === 'range') {
        // Check if this looks like a breakout attempt
        const isNearResistance = context.currentPrice > (adjustedDecision.entry * 0.998);
        const isNearSupport = context.currentPrice < (adjustedDecision.entry * 1.002);
        if ((isNearResistance && adjustedDecision.action === 'BUY') ||
            (isNearSupport && adjustedDecision.action === 'SELL')) {
          violations.push('Breakout blocked: ATR compression + range structure');
        }
      }
    }

    // 12. ADVERSARIAL-BASED SAFETY CHECKS
    if (context.adversarial) {
      const adv = context.adversarial;

      // Severe level: HARD BLOCK
      if (adv.level === 'severe') {
        violations.push(`Adversarial environment: ${adv.notes}`);
        console.log(`[Safety] 🚫 BLOCKED by adversarial detector: ${adv.level}`);
      }

      // Moderate level: 50% risk reduction
      else if (adv.level === 'moderate') {
        const originalRisk = adjustedDecision.risk_pct;
        adjustedDecision.risk_pct = originalRisk * 0.5;
        adjustments.push(`Risk reduced 50% (adversarial): ${originalRisk.toFixed(2)}% → ${adjustedDecision.risk_pct.toFixed(2)}%`);
        console.log(`[Safety] 🔧 Risk reduced 50% due to moderate adversarial environment`);
      }

      // Mild level: 25% risk reduction OR higher R:R requirement
      else if (adv.level === 'mild') {
        const currentRR = tpDistance / slDistance;

        if (currentRR < 1.8) {
          // Require minimum 1.8 R:R for mild adversarial
          const requiredTpDistance = slDistance * 1.8;
          const oldTp = adjustedDecision.takeProfit;

          if (adjustedDecision.action === 'BUY') {
            adjustedDecision.takeProfit = adjustedDecision.entry + requiredTpDistance;
          } else {
            adjustedDecision.takeProfit = adjustedDecision.entry - requiredTpDistance;
          }

          adjustments.push(`R:R increased to 1.8 (adversarial): ${currentRR.toFixed(2)} → 1.8`);
          console.log(`[Safety] 🔧 R:R increased due to mild adversarial environment`);
        } else {
          // If R:R already good, reduce risk by 25%
          const originalRisk = adjustedDecision.risk_pct;
          adjustedDecision.risk_pct = originalRisk * 0.75;
          adjustments.push(`Risk reduced 25% (adversarial): ${originalRisk.toFixed(2)}% → ${adjustedDecision.risk_pct.toFixed(2)}%`);
          console.log(`[Safety] 🔧 Risk reduced 25% due to mild adversarial environment`);
        }
      }
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
