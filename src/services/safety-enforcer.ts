/**
 * Safety Enforcer - Alpha Authority Compliant (PHASE 1 GOVERNANCE FIX - 2026-02-02)
 *
 * GOVERNANCE ROLE:
 * - HARD BLOCKS: System integrity violations only (NaN, invalid prices, malformed data)
 * - ADVISORY WARNINGS: Risk metrics that inform Alpha but don't block
 *
 * ALPHA SOVEREIGNTY ENFORCEMENT (SSOT + CCIP Compliance):
 * ✅ Safety Enforcer serves Alpha, NEVER mutates Alpha's decisions
 * ✅ Only system errors block execution
 * ✅ Risk advisories penalize confidence within governance cap (30% max per ALPHA_IDENTITY.MAX_ADVISORY_PENALTY)
 * ✅ NO AUTO-ADJUSTMENTS - All recommendations returned to Alpha for re-evaluation
 *
 * PHASE 1 FIXES (2026-02-02):
 * - Removed 9 mutation sites that violated Alpha authority
 * - Converted TP/SL/Risk auto-adjustments to pure advisories
 * - Alpha now receives recommendations, decides whether to apply them
 * - Maintains full audit trail of all safety checks
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
  advisoryPenalties: AdvisoryPenalty[]; // Structured penalties for aggregator

  // ⚠️ DEPRECATED (2026-02-02): adjustedDecision and adjustments removed
  // Safety Enforcer no longer mutates Alpha's decisions
  // All recommendations are now returned via advisories and advisoryPenalties
  // Alpha receives recommendations and decides whether to apply them
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
   * GOVERNANCE COMPLIANT (PHASE 1 FIX - 2026-02-02):
   * - Returns HARD BLOCKS for system integrity violations
   * - Returns ADVISORIES for risk concerns (doesn't block)
   * - Advisory penalties capped at 30% per ALPHA_IDENTITY.MAX_ADVISORY_PENALTY
   * - NO MUTATIONS: Alpha's decision is NEVER modified
   */
  validateTrade(
    decision: TradeDecision,
    context: SafetyContext
  ): ValidationResult {
    const hardBlocks: string[] = [];       // System errors - blocks execution
    const advisories: string[] = [];       // Risk warnings - doesn't block
    const advisoryPenalties: AdvisoryPenalty[] = [];

    // Skip validation for NO_TRADE (no trade execution)
    if (decision.action === 'NO_TRADE') {
      return {
        passed: true,
        hardBlocks: [],
        advisories: [],
        action: 'ALLOW',
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
    const slDistance = Math.abs(decision.entry - decision.stopLoss);
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

    // 7. Risk:Reward ratio (ADVISORY ONLY - NO AUTO-ADJUSTMENT)
    const tpDistance = Math.abs(decision.takeProfit - decision.entry);
    const rr = tpDistance / slDistance;

    // ✅ GOVERNANCE FIX (2026-02-02): Removed auto-adjustment mutation
    // Previously: Safety Enforcer auto-adjusted TP to meet TARGET_RR_RATIO
    // Now: Advisory only - Alpha receives recommendation and decides
    if (rr < this.TARGET_RR_RATIO) {
      const requiredTpDistance = slDistance * this.TARGET_RR_RATIO;
      const suggestedTp = decision.action === 'BUY'
        ? decision.entry + requiredTpDistance
        : decision.entry - requiredTpDistance;

      const advisory = `R:R below target: ${rr.toFixed(2)} < ${this.TARGET_RR_RATIO}. Consider TP ${suggestedTp.toFixed(5)}`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:RR_Below_Target',
          advisory,
          8, // -8% confidence (moderate concern)
          'risk'
        )
      );
    }

    // Advisory if R:R is critically low (doesn't block)
    if (rr < this.MIN_RR_RATIO) {
      const advisory = `R:R ratio ${rr.toFixed(2)} below minimum ${this.MIN_RR_RATIO} - high risk`;
      advisories.push(advisory);
      advisoryPenalties.push(
        advisoryPenaltyAggregator.createPenalty(
          'Safety:RR_Critical',
          advisory,
          15, // -15% confidence (serious concern)
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

      if (regime.is_high_risk_regime) {
        const advisory = `High volatility regime detected: Consider reducing position size`;
        advisories.push(advisory);
        advisoryPenalties.push(
          advisoryPenaltyAggregator.createPenalty(
            'Safety:High_Volatility_Risk',
            advisory,
            12,
            'environment'
          )
        );
      }

      // ✅ GOVERNANCE FIX (2026-02-02): SL widening advisory only
      // Previously: Auto-widened SL without Alpha re-approval
      // Now: Advisory recommendation - Alpha decides
      if (regime.wick_risk === 'high') {
        const slDirection = decision.action === 'BUY' ? -1 : 1;
        const widening = slDistance * 0.20; // 20% wider
        const suggestedSL = decision.entry + (slDirection * (slDistance + widening));
        const advisory = `High wick risk detected: Consider widening SL from ${decision.stopLoss.toFixed(5)} to ${suggestedSL.toFixed(5)} (+20% stop hunting protection)`;
        advisories.push(advisory);
        advisoryPenalties.push(
          advisoryPenaltyAggregator.createPenalty(
            'Safety:High_Wick_Risk',
            advisory,
            10, // -10% confidence
            'environment'
          )
        );
      }

      // ✅ GOVERNANCE FIX (2026-02-02): TP extension advisory only
      // Previously: Auto-extended TP to 2.0 R:R for volatile opens
      // Now: Advisory recommendation - Alpha decides
      if ((regime.session === 'ny_open' || regime.session_open) && regime.volatility_score > 75) {
        const currentRR = tpDistance / slDistance;
        if (currentRR < 2.0) {
          const requiredTpDistance = slDistance * 2.0;
          const suggestedTp = decision.action === 'BUY'
            ? decision.entry + requiredTpDistance
            : decision.entry - requiredTpDistance;
          const advisory = `Volatile session open: Consider increasing R:R from ${currentRR.toFixed(2)} to 2.0 (TP ${suggestedTp.toFixed(5)})`;
          advisories.push(advisory);
          advisoryPenalties.push(
            advisoryPenaltyAggregator.createPenalty(
              'Safety:Volatile_Open_RR',
              advisory,
              8, // -8% confidence
              'environment'
            )
          );
        }
      }

      // Breakout warning during compression + range
      if (regime.atr_compression && regime.structure === 'range') {
        // Check if this looks like a breakout attempt
        const isNearResistance = context.currentPrice > (decision.entry * 0.998);
        const isNearSupport = context.currentPrice < (decision.entry * 1.002);
        if ((isNearResistance && decision.action === 'BUY') ||
            (isNearSupport && decision.action === 'SELL')) {
          const advisory = 'Breakout attempt during ATR compression + range structure - false breakout risk';
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

      // ✅ GOVERNANCE FIX (2026-02-02): Moderate adversarial advisory only
      // Previously: Auto-reduced risk by 50% without Alpha re-approval
      // Now: Advisory recommendation - Alpha decides
      else if (adv.level === 'moderate') {
        const suggestedRisk = decision.risk_pct * 0.5;
        const advisory = `Moderate adversarial environment: ${adv.notes}. Consider reducing risk from ${decision.risk_pct.toFixed(2)}% to ${suggestedRisk.toFixed(2)}% (50% reduction)`;
        advisories.push(advisory);
        advisoryPenalties.push(
          advisoryPenaltyAggregator.createPenalty(
            'Safety:Adversarial_Moderate',
            advisory,
            15, // -15% confidence (serious concern)
            'environment'
          )
        );
      }

      // ✅ GOVERNANCE FIX (2026-02-02): Mild adversarial advisory only
      // Previously: Auto-adjusted TP or risk without Alpha re-approval
      // Now: Advisory recommendation - Alpha decides
      else if (adv.level === 'mild') {
        const currentRR = tpDistance / slDistance;

        if (currentRR < 1.8) {
          // Suggest minimum 1.8 R:R for mild adversarial
          const requiredTpDistance = slDistance * 1.8;
          const suggestedTp = decision.action === 'BUY'
            ? decision.entry + requiredTpDistance
            : decision.entry - requiredTpDistance;

          const advisory = `Mild adversarial environment: ${adv.notes}. Consider increasing R:R from ${currentRR.toFixed(2)} to 1.8 (TP ${suggestedTp.toFixed(5)})`;
          advisories.push(advisory);
          advisoryPenalties.push(
            advisoryPenaltyAggregator.createPenalty(
              'Safety:Adversarial_Mild_RR',
              advisory,
              10, // -10% confidence
              'environment'
            )
          );
        } else {
          // If R:R already good, suggest risk reduction
          const suggestedRisk = decision.risk_pct * 0.75;
          const advisory = `Mild adversarial environment: ${adv.notes}. Consider reducing risk from ${decision.risk_pct.toFixed(2)}% to ${suggestedRisk.toFixed(2)}% (25% reduction)`;
          advisories.push(advisory);
          advisoryPenalties.push(
            advisoryPenaltyAggregator.createPenalty(
              'Safety:Adversarial_Mild_Risk',
              advisory,
              8, // -8% confidence
              'environment'
            )
          );
        }
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
        console.log(`[Safety Enforcer] ⚠️  ${advisories.length} advisory warnings (Alpha will evaluate):`);
        advisories.forEach(a => console.log(`  • ${a}`));
      }

      if (advisoryPenalties.length > 0) {
        const totalPenalty = advisoryPenalties.reduce((sum, p) => sum + p.penaltyPercent, 0);
        console.log(`[Safety Enforcer] 📊 Total advisory penalty: -${totalPenalty.toFixed(1)}% confidence`);
      }
    }

    return {
      passed,
      hardBlocks,
      advisories,
      action: passed ? 'ALLOW' : 'BLOCK',
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
