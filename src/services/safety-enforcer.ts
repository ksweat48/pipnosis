/**
 * Safety Enforcer - Alpha Authority Compliant
 *
 * GOVERNANCE ROLE:
 * - HARD BLOCKS: System integrity violations only (NaN, invalid prices, malformed data)
 * - ADVISORY WARNINGS: Risk metrics that inform Alpha but don't block
 *
 * ALPHA SOVEREIGNTY:
 * Safety Enforcer serves Alpha, doesn't veto Alpha.
 * Only system errors block execution. Risk advisories penalize confidence
 * within governance cap (25% max total penalty).
 */

import { TRADING_CONSTANTS } from '../config/trading-constants';
import type { TradeDecision } from './llm-execution-brain';
import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';
import { tradeValidationService } from './trade-validation-service';
import { advisoryPenaltyAggregator, type AdvisoryPenalty } from './advisory-penalty-aggregator';

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
  passed: boolean;              // Only false for HARD BLOCKS (system errors)
  hardBlocks: string[];         // System integrity violations (blocks execution)
  advisories: string[];         // Risk warnings (doesn't block, penalizes confidence)
  action: 'ALLOW' | 'BLOCK';    // BLOCK only on hard blocks
  adjustedDecision?: TradeDecision;
  adjustments?: string[];
  advisoryPenalties: AdvisoryPenalty[]; // Structured penalties for aggregator
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
   * Validate trade decision against safety rules
   *
   * GOVERNANCE COMPLIANT:
   * - Returns HARD BLOCKS for system integrity violations
   * - Returns ADVISORIES for risk concerns (doesn't block)
   * - Advisory penalties capped at 25% by advisory-penalty-aggregator
   */
  validateTrade(
    decision: TradeDecision,
    context: SafetyContext
  ): ValidationResult {
    const hardBlocks: string[] = [];       // System errors - blocks execution
    const advisories: string[] = [];       // Risk warnings - doesn't block
    const adjustments: string[] = [];
    const advisoryPenalties: AdvisoryPenalty[] = [];
    let adjustedDecision = { ...decision };

    // Skip validation for NO_TRADE (no trade execution)
    if (decision.action === 'NO_TRADE') {
      return {
        passed: true,
        hardBlocks: [],
        advisories: [],
        action: 'ALLOW',
        adjustments: [],
        advisoryPenalties: [],
      };
    }

    // ========================================
    // HARD BLOCKS - System Integrity Only
    // ========================================

    // 1. NaN/Infinity checks (HARD BLOCK)
    if (!isFinite(decision.entry) || !isFinite(decision.stopLoss) || !isFinite(decision.takeProfit)) {
      hardBlocks.push('Invalid price values (NaN/Infinity) - system error');
    }

    if (decision.entry <= 0 || decision.stopLoss <= 0 || decision.takeProfit <= 0) {
      hardBlocks.push('Prices must be positive - malformed order');
    }

    // 2. SL/TP direction validation (HARD BLOCK)
    const validation = tradeValidationService.validateTrade({
      symbol: decision.symbol,
      direction: decision.action === 'BUY' ? 'buy' : 'sell',
      entryPrice: decision.entry,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      lotSize: 1.0 // Default for validation purposes
    });

    if (!validation.isValid) {
      hardBlocks.push(...validation.errors.map(e => `Direction error: ${e}`));
    }

    // 3. Entry price sanity check (HARD BLOCK if > 1% difference)
    const priceDiff = Math.abs(decision.entry - context.currentPrice) / context.currentPrice;
    if (priceDiff > 0.01) { // 1% difference
      hardBlocks.push(`Entry price ${decision.entry} too far from current ${context.currentPrice} - stale data`);
    }

    // ========================================
    // ADVISORIES - Risk Warnings (Don't Block)
    // ========================================

    // 4. Risk per trade (ADVISORY)
    // DEFENSIVE: Handle missing risk_pct (should not happen, but advisory system shouldn't crash)
    if (decision.risk_pct === undefined || decision.risk_pct === null) {
      const advisory = 'Risk percentage not provided by Alpha - using default 1%';
      advisories.push(advisory);
      console.warn('[Safety Enforcer] ⚠️ Missing risk_pct - Alpha should provide complete decisions');
      // Use conservative default
      decision.risk_pct = 1.0;
    }

    const riskAmount = (decision.risk_pct / 100) * context.balance;
    const riskPct = decision.risk_pct / 100;

    if (riskPct > this.MAX_RISK_PER_TRADE) {
      const advisory = `Risk ${(riskPct * 100).toFixed(2)}% exceeds recommended ${this.MAX_RISK_PER_TRADE * 100}%`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:Risk_Too_High',
          advisory,
          10, // -10% confidence
          'risk'
        )
      );
    }

    if (riskPct < this.MIN_RISK_PER_TRADE) {
      advisories.push(`Risk ${(riskPct * 100).toFixed(2)}% below minimum ${this.MIN_RISK_PER_TRADE * 100}% - position too small`);
      // No penalty - just informational
    }

    // 5. Total exposure (ADVISORY)
    const newExposure = context.currentExposure + riskPct;
    if (newExposure > this.MAX_TOTAL_EXPOSURE) {
      const advisory = `Total exposure ${(newExposure * 100).toFixed(2)}% exceeds ${this.MAX_TOTAL_EXPOSURE * 100}%`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:Exposure_High',
          advisory,
          15, // -15% confidence
          'risk'
        )
      );
    }

    // 6. SL distance validation (ADVISORY)
    const slDistance = Math.abs(adjustedDecision.entry - adjustedDecision.stopLoss);
    const minSlDistance = context.atr * this.MIN_SL_DISTANCE_ATR;
    const maxSlDistance = context.atr * this.MAX_SL_DISTANCE_ATR;

    if (slDistance < minSlDistance) {
      const advisory = `SL tight: ${slDistance.toFixed(5)} < ${minSlDistance.toFixed(5)} (${this.MIN_SL_DISTANCE_ATR} ATR)`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:SL_Too_Tight',
          advisory,
          8, // -8% confidence
          'risk'
        )
      );
    }

    if (slDistance > maxSlDistance) {
      const advisory = `SL wide: ${slDistance.toFixed(5)} > ${maxSlDistance.toFixed(5)} (${this.MAX_SL_DISTANCE_ATR} ATR)`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:SL_Too_Wide',
          advisory,
          10, // -10% confidence
          'risk'
        )
      );
    }

    // 7. Risk:Reward ratio (ADVISORY with AUTO-ADJUSTMENT)
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

    // Advisory if R:R is still low (doesn't block)
    if (rr < this.MIN_RR_RATIO) {
      const advisory = `R:R ratio ${rr.toFixed(2)} below recommended ${this.MIN_RR_RATIO}`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:RR_Low',
          advisory,
          12, // -12% confidence
          'risk'
        )
      );
    }

    // 8. Maximum position size (ADVISORY)
    const maxPositionSize = context.balance * this.MAX_RISK_PER_TRADE;
    if (riskAmount > maxPositionSize) {
      const advisory = `Position size $${riskAmount.toFixed(2)} exceeds max $${maxPositionSize.toFixed(2)}`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:Position_Too_Large',
          advisory,
          12, // -12% confidence
          'risk'
        )
      );
    }

    // 9. Daily drawdown limit (ADVISORY)
    if (context.dailyDrawdown < -this.MAX_DAILY_DRAWDOWN) {
      const advisory = `Daily drawdown ${(context.dailyDrawdown * 100).toFixed(2)}% exceeds ${this.MAX_DAILY_DRAWDOWN * 100}%`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:Drawdown_High',
          advisory,
          15, // -15% confidence (serious concern)
          'risk'
        )
      );
    }

    // 10. Max concurrent trades (ADVISORY)
    if (context.openTrades >= this.MAX_CONCURRENT_TRADES) {
      const advisory = `Max ${this.MAX_CONCURRENT_TRADES} concurrent trades reached`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:Max_Trades',
          advisory,
          10, // -10% confidence
          'risk'
        )
      );
    }

    // 11. REGIME-BASED SAFETY CHECKS (ADVISORY)
    if (context.regime) {
      const regime = context.regime;

      // Dead zone advisory (regime oracle should have caught this, but inform Alpha)
      if (regime.avoid_trading) {
        const advisory = `Regime warning: ${regime.reason || 'Unfavorable market conditions'}`;
        advisories.push(advisory);
        advisoryPenalties.push(
          advisoryPenaltyAggregator.createPenalty(
            'Safety:Regime_Unfavorable',
            advisory,
            15, // -15% confidence
            'environment'
          )
        );
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

      // Breakout warning during compression + range
      if (regime.atr_compression && regime.structure === 'range') {
        // Check if this looks like a breakout attempt
        const isNearResistance = context.currentPrice > (adjustedDecision.entry * 0.998);
        const isNearSupport = context.currentPrice < (adjustedDecision.entry * 1.002);
        if ((isNearResistance && adjustedDecision.action === 'BUY') ||
            (isNearSupport && adjustedDecision.action === 'SELL')) {
          const advisory = 'Breakout attempt during ATR compression + range structure';
          advisories.push(advisory);
          advisoryPenalties.push(
            advisoryPenaltyAggregator.createPenalty(
              'Safety:Breakout_Risk',
              advisory,
              12, // -12% confidence
              'environment'
            )
          );
        }
      }
    }

    // 12. ADVERSARIAL-BASED SAFETY CHECKS (ADVISORY)
    if (context.adversarial) {
      const adv = context.adversarial;

      // Severe level: Strong advisory (doesn't block, but high penalty)
      if (adv.level === 'severe') {
        const advisory = `Severe adversarial environment: ${adv.notes}`;
        advisories.push(advisory);
        advisoryPenalties.push(
          advisoryPenaltyAggregator.createPenalty(
            'Safety:Adversarial_Severe',
            advisory,
            20, // -20% confidence (will be capped by aggregator)
            'environment'
          )
        );
        console.log(`[Safety] ⚠️ Severe adversarial environment detected`);
      }

      // Moderate level: 50% risk reduction + advisory
      else if (adv.level === 'moderate') {
        const originalRisk = adjustedDecision.risk_pct;
        adjustedDecision.risk_pct = originalRisk * 0.5;
        adjustments.push(`Risk reduced 50% (adversarial): ${originalRisk.toFixed(2)}% → ${adjustedDecision.risk_pct.toFixed(2)}%`);

        const advisory = `Moderate adversarial environment: ${adv.notes}`;
        advisories.push(advisory);
        advisoryPenalties.push(
          advisoryPenaltyAggregator.createPenalty(
            'Safety:Adversarial_Moderate',
            advisory,
            12, // -12% confidence
            'environment'
          )
        );
        console.log(`[Safety] 🔧 Risk reduced 50% due to moderate adversarial environment`);
      }

      // Mild level: 25% risk reduction OR higher R:R requirement + advisory
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

        const advisory = `Mild adversarial environment: ${adv.notes}`;
        advisories.push(advisory);
        advisoryPenalties.push(
          advisoryPenaltyAggregator.createPenalty(
            'Safety:Adversarial_Mild',
            advisory,
            8, // -8% confidence
            'environment'
          )
        );
      }
    }

    // Only block on HARD BLOCKS (system integrity)
    const passed = hardBlocks.length === 0;

    if (!passed) {
      console.error('[Safety Enforcer] 🚫 SYSTEM ERROR - TRADE BLOCKED');
      hardBlocks.forEach(v => console.error(`  ❌ ${v}`));
    } else {
      console.log('[Safety Enforcer] ✅ System integrity validated');

      if (advisories.length > 0) {
        console.log('[Safety Enforcer] ⚠️ Advisory warnings (Alpha aware):');
        advisories.forEach(a => console.log(`  • ${a}`));
      }

      if (adjustments.length > 0) {
        console.log('[Safety Enforcer] 🔧 Auto-adjustments applied:');
        adjustments.forEach(a => console.log(`  ✓ ${a}`));
      }
    }

    return {
      passed,
      hardBlocks,
      advisories,
      action: passed ? 'ALLOW' : 'BLOCK',
      adjustedDecision: adjustments.length > 0 ? adjustedDecision : undefined,
      adjustments,
      advisoryPenalties,
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
