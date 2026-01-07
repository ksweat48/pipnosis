/**
 * Trade Feasibility Resolver (SSOT)
 *
 * Single authoritative source for determining if a trade style/risk combination
 * is feasible given current market conditions.
 *
 * Runs BEFORE Omega-9 constraint generation to prevent deadlock scenarios.
 *
 * AUTHORITY MODEL (Post-Refactor):
 * - ATR% gates are ADVISORY (quality heuristics, not mathematical blocks)
 * - Spread validation is HARD (mathematical impossibility)
 * - Data staleness is HARD (safety)
 * - RR infeasibility is ADVISORY unless spread makes it mathematically impossible
 * - Alpha has final authority on all ADVISORY constraints
 *
 * Philosophy:
 * - Heuristics guide intelligence
 * - Safety and physics enforce reality
 * - Alpha decides, constraints advise
 */

import type {
  FeasibilityInput,
  FeasibilityResult,
  FeasibilityStatus,
  ResolvedPlan,
  TradeStyle,
  RiskMode,
  AdjustmentReason
} from '../types/trade-feasibility-resolver.types';
import { logger, LogCategory } from '../lib/logger';
import {
  TRADE_CONSTRAINTS,
  getAtrGate,
  getSlFloor
} from '../config/trade-constraints';

export interface ITradeFeasibilityResolver {
  resolve(input: FeasibilityInput): FeasibilityResult;
}

class TradeFeasibilityResolver implements ITradeFeasibilityResolver {
  /**
   * ATR% thresholds moved to centralized config (TRADE_CONSTRAINTS)
   * These are now ADVISORY quality gates, not blocking constraints
   */

  /**
   * Main resolver entry point
   */
  resolve(input: FeasibilityInput): FeasibilityResult {
    logger.info(
      LogCategory.AI_TRADING,
      `[Feasibility Resolver] Analyzing ${input.symbol}: ${input.requestedStyle} style, ${input.requestedRiskMode} risk, ATR ${input.atrPercent.toFixed(3)}%`
    );

    const adjustments: FeasibilityResult['adjustments'] = [];
    const blockers: FeasibilityResult['blockers'] = [];

    // Step 1: Check data quality
    if (this.isDataStale(input)) {
      return this.buildNoTradeResult(
        'DATA_STALE_OR_MISSING',
        'Market data is stale or missing. Cannot evaluate feasibility safely.',
        adjustments
      );
    }

    // Step 2: Check spread impact
    const spreadCheck = this.validateSpread(input);
    if (spreadCheck.blocker) {
      blockers.push(spreadCheck.blocker);
    }

    // Step 3: Validate style against ATR% gates (ADVISORY ONLY)
    let resolvedStyle = input.requestedStyle;
    let resolvedRiskMode = input.requestedRiskMode;

    const styleValid = this.isStyleValid(
      input.assetClass,
      resolvedStyle,
      input.atrPercent
    );

    if (!styleValid) {
      // ADVISORY: Suggest auto-switching to less aggressive style
      const switchResult = this.autoSwitchStyle(
        input.assetClass,
        resolvedStyle,
        input.atrPercent,
        input.policy.allowAutoSwitchStyle
      );

      if (switchResult.newStyle && input.policy.allowAutoSwitchStyle) {
        // Auto-switch enabled - adjust to better style
        adjustments.push({
          field: 'style',
          from: resolvedStyle,
          to: switchResult.newStyle,
          reason: 'LOW_VOLATILITY_FOR_STYLE'
        });
        resolvedStyle = switchResult.newStyle;
        logger.info(
          LogCategory.AI_TRADING,
          `[Feasibility Resolver] ADVISORY: Auto-switched ${input.requestedStyle} → ${switchResult.newStyle} due to low ATR ${input.atrPercent.toFixed(2)}%`
        );
      } else {
        // No auto-switch - add advisory warning but DO NOT BLOCK
        const gate = getAtrGate(input.assetClass, resolvedStyle);
        adjustments.push({
          field: 'style',
          from: resolvedStyle,
          to: resolvedStyle, // No change
          reason: 'LOW_VOLATILITY_FOR_STYLE',
          advisory: true,
          detail: `⚠️ ADVISORY: ${resolvedStyle} typically requires ATR >= ${(gate * 100).toFixed(2)}%, current: ${(input.atrPercent * 100).toFixed(2)}%. Consider INTRADAY for current volatility. Alpha may proceed with justification.`
        });
        logger.warn(
          LogCategory.AI_TRADING,
          `[Feasibility Resolver] ADVISORY WARNING: ${resolvedStyle} below optimal ATR gate (${(gate * 100).toFixed(2)}% vs ${(input.atrPercent * 100).toFixed(2)}%). Proceeding with advisory.`
        );
      }
    }

    // Step 4: Get initial SL/TP constraints for the resolved style/risk
    const slMinPercent = this.getSlMinPercent(input.assetClass, resolvedRiskMode);
    const tpMaxAtrMultiple = input.policy.maxTpAtrMultiple;

    // Step 5: Calculate RR feasibility
    const tpCeilingPercent = input.atrPercent * tpMaxAtrMultiple;
    const rrAchievable = slMinPercent > 0 ? tpCeilingPercent / slMinPercent : 0;
    const rrFeasible = rrAchievable >= input.policy.minRR;

    logger.info(
      LogCategory.AI_TRADING,
      `[Feasibility Resolver] RR Check: TP ceiling ${tpCeilingPercent.toFixed(2)}% / SL floor ${slMinPercent.toFixed(2)}% = ${rrAchievable.toFixed(2)}:1 (min: ${input.policy.minRR}:1)`
    );

    if (!rrFeasible && blockers.length === 0) {
      // Try adjustment cascade
      const cascadeResult = this.adjustmentCascade(
        input,
        resolvedStyle,
        resolvedRiskMode,
        slMinPercent,
        tpMaxAtrMultiple,
        adjustments
      );

      resolvedStyle = cascadeResult.style;
      resolvedRiskMode = cascadeResult.riskMode;

      if (cascadeResult.finalSlMinPercent && cascadeResult.finalRR) {
        // Cascade succeeded - update final constraints
        const finalPlan = this.buildResolvedPlan(
          resolvedStyle,
          resolvedRiskMode,
          cascadeResult.finalSlMinPercent,
          tpMaxAtrMultiple,
          cascadeResult.finalRR
        );

        return this.buildSuccessResult(
          'ADJUSTED',
          finalPlan,
          adjustments,
          this.buildUserMessage(input, adjustments, blockers, 'ADJUSTED'),
          {
            requestedStyleValid: styleValid,
            rrFeasible: true,
            rrAchievable: cascadeResult.finalRR,
            tpCeilingPercent,
            slFloorPercent: cascadeResult.finalSlMinPercent,
            spreadImpact: spreadCheck.impactPercent
          }
        );
      } else {
        // Cascade couldn't achieve target RR - add ADVISORY warning but proceed
        adjustments.push({
          field: 'rr',
          from: rrAchievable,
          to: rrAchievable,
          reason: 'RR_BELOW_TARGET',
          advisory: true,
          detail: `⚠️ ADVISORY: R:R ${rrAchievable.toFixed(2)}:1 below professional target ${input.policy.minRR}:1. TP ceiling ${tpCeilingPercent.toFixed(2)}% / SL floor ${slMinPercent.toFixed(2)}%. Alpha may proceed with explicit justification.`
        });
        logger.warn(
          LogCategory.AI_TRADING,
          `[Feasibility Resolver] ADVISORY: RR ${rrAchievable.toFixed(2)}:1 below target ${input.policy.minRR}:1. Proceeding with Alpha's discretion.`
        );
      }
    }

    // Step 6: Handle HARD blockers only (spread, data staleness)
    if (blockers.length > 0 || spreadCheck.blocker) {
      const allBlockers = [...blockers];
      if (spreadCheck.blocker) {
        allBlockers.push(spreadCheck.blocker);
      }

      return {
        status: 'NO_TRADE',
        adjustments,
        userMessage: this.buildUserMessage(input, adjustments, allBlockers, 'NO_TRADE'),
        blockers: allBlockers,
        tryAlternatives: {
          betterVolatilityNeeded: true,
          suggestedMinAtrPercent: getAtrGate(input.assetClass, 'INTRADAY')
        },
        diagnostics: {
          requestedStyleValid: styleValid,
          rrFeasible,
          rrAchievable,
          tpCeilingPercent,
          slFloorPercent: slMinPercent,
          spreadImpact: spreadCheck.impactPercent
        }
      };
    }

    // Step 7: Success - build final plan
    const finalPlan = this.buildResolvedPlan(
      resolvedStyle,
      resolvedRiskMode,
      slMinPercent,
      tpMaxAtrMultiple,
      input.policy.minRR
    );

    const status: FeasibilityStatus = adjustments.length > 0 ? 'ADJUSTED' : 'OK';

    return this.buildSuccessResult(
      status,
      finalPlan,
      adjustments,
      this.buildUserMessage(input, adjustments, blockers, status),
      {
        requestedStyleValid: styleValid,
        rrFeasible: true,
        rrAchievable,
        tpCeilingPercent,
        slFloorPercent: slMinPercent,
        spreadImpact: spreadCheck.impactPercent
      }
    );
  }

  /**
   * Check if requested style meets ADVISORY ATR% threshold
   */
  private isStyleValid(
    assetClass: FeasibilityInput['assetClass'],
    style: TradeStyle,
    atrPercent: number
  ): boolean {
    const gate = getAtrGate(assetClass, style);
    return atrPercent >= gate;
  }

  /**
   * Get minimum SL percentage for asset class + risk mode (ADVISORY)
   * Uses centralized configuration
   */
  private getSlMinPercent(
    assetClass: FeasibilityInput['assetClass'],
    riskMode: RiskMode
  ): number {
    return getSlFloor(assetClass, riskMode);
  }

  /**
   * Auto-switch style if current style is below ADVISORY threshold
   * Returns suggestion, does not enforce
   */
  private autoSwitchStyle(
    assetClass: FeasibilityInput['assetClass'],
    currentStyle: TradeStyle,
    atrPercent: number,
    allowAutoSwitch: boolean
  ): { newStyle: TradeStyle | null; advisoryMessage?: string } {
    if (!allowAutoSwitch) {
      return {
        newStyle: null,
        advisoryMessage: `Style switching disabled. ${currentStyle} below recommended ATR threshold.`
      };
    }

    // Try cascade: SCALP → INTRADAY (No SWING - Pipnosis is intraday-only)
    const cascade: TradeStyle[] = ['SCALP', 'INTRADAY'];
    const currentIndex = cascade.indexOf(currentStyle);

    for (let i = currentIndex + 1; i < cascade.length; i++) {
      const candidateStyle = cascade[i];
      if (this.isStyleValid(assetClass, candidateStyle, atrPercent)) {
        logger.info(
          LogCategory.AI_TRADING,
          `[Feasibility Resolver] Auto-switch suggestion: ${currentStyle} → ${candidateStyle}`
        );
        return { newStyle: candidateStyle };
      }
    }

    const intradayGate = getAtrGate(assetClass, 'INTRADAY');
    return {
      newStyle: null,
      advisoryMessage: `Even INTRADAY style requires ATR >= ${(intradayGate * 100).toFixed(2)}%, current: ${(atrPercent * 100).toFixed(2)}%. Market volatility too low for execution.`
    };
  }

  /**
   * REPAIR CASCADE: Try multiple adjustments to find viable trade
   * Philosophy: "Reduced profit > NO_TRADE"
   *
   * Cascade order:
   * 1. TP reduction (accept smaller profit)
   * 2. Risk downgrade (tighter stops)
   * 3. SL relaxation (crypto only)
   * 4. TP1-only mode (partial profit target)
   * 5. Style upgrade (longer duration)
   *
   * Only gives up if ALL repairs fail
   */
  private adjustmentCascade(
    input: FeasibilityInput,
    currentStyle: TradeStyle,
    currentRiskMode: RiskMode,
    currentSlMin: number,
    tpMaxMultiple: number,
    adjustments: FeasibilityResult['adjustments']
  ): {
    style: TradeStyle;
    riskMode: RiskMode;
    finalSlMinPercent?: number;
    finalRR?: number;
    advisory?: string;
    repairUsed?: string; // Track which repair succeeded
  } {
    logger.info(
      LogCategory.AI_TRADING,
      `[Repair Cascade] Starting repair sequence for ${input.symbol} (RR target: ${input.policy.minRR}:1)`
    );

    // REPAIR 1: TP Reduction (accept smaller profit)
    // Try reducing TP from 12x to 8x, 6x, 4x ATR
    const tpReductionCandidates = [8, 6, 4, 3];
    for (const reducedTpMultiple of tpReductionCandidates) {
      if (reducedTpMultiple < tpMaxMultiple) {
        const candidateTpCeiling = input.atrPercent * reducedTpMultiple;
        const candidateRR = currentSlMin > 0 ? candidateTpCeiling / currentSlMin : 0;

        if (candidateRR >= input.policy.minRR) {
          adjustments.push({
            field: 'tp.maxAtrMultiple',
            from: tpMaxMultiple,
            to: reducedTpMultiple,
            reason: 'RR_INFEASIBLE',
            advisory: false,
            detail: `Reduced TP from ${tpMaxMultiple}x to ${reducedTpMultiple}x ATR to achieve ${candidateRR.toFixed(2)}:1 R:R`
          });

          logger.info(
            LogCategory.AI_TRADING,
            `[Repair Cascade] ✅ REPAIR 1 SUCCESS: TP reduction ${tpMaxMultiple}x → ${reducedTpMultiple}x ATR (RR now ${candidateRR.toFixed(2)}:1)`
          );

          return {
            style: currentStyle,
            riskMode: currentRiskMode,
            finalSlMinPercent: currentSlMin,
            finalRR: candidateRR,
            repairUsed: 'TP_REDUCTION'
          };
        }
      }
    }
    logger.info(LogCategory.AI_TRADING, `[Repair Cascade] ❌ REPAIR 1 FAILED: TP reduction didn't achieve target R:R`);

    // REPAIR 2: Risk Downgrade (tighter stops)
    if (input.policy.allowAutoDowngradeRisk) {
      const riskCascade: RiskMode[] = ['HIGH', 'MEDIUM', 'LOW'];
      const currentRiskIndex = riskCascade.indexOf(currentRiskMode);

      for (let i = currentRiskIndex + 1; i < riskCascade.length; i++) {
        const candidateRiskMode = riskCascade[i];
        const candidateSlMin = this.getSlMinPercent(input.assetClass, candidateRiskMode);
        const candidateTpCeiling = input.atrPercent * tpMaxMultiple;
        const candidateRR = candidateSlMin > 0 ? candidateTpCeiling / candidateSlMin : 0;

        if (candidateRR >= input.policy.minRR) {
          adjustments.push({
            field: 'riskMode',
            from: currentRiskMode,
            to: candidateRiskMode,
            reason: 'RR_INFEASIBLE'
          });

          logger.info(
            LogCategory.AI_TRADING,
            `[Repair Cascade] ✅ REPAIR 2 SUCCESS: Risk downgrade ${currentRiskMode} → ${candidateRiskMode} (RR now ${candidateRR.toFixed(2)}:1)`
          );

          return {
            style: currentStyle,
            riskMode: candidateRiskMode,
            finalSlMinPercent: candidateSlMin,
            finalRR: candidateRR,
            repairUsed: 'RISK_DOWNGRADE'
          };
        }
      }
      logger.info(LogCategory.AI_TRADING, `[Repair Cascade] ❌ REPAIR 2 FAILED: Risk downgrade didn't achieve target R:R`);
    }

    // REPAIR 3: Bounded SL Relaxation (CRYPTO HIGH only)
    if (
      input.policy.allowBoundedSlRelaxation &&
      input.assetClass === 'CRYPTO' &&
      currentRiskMode === 'HIGH' &&
      currentStyle === 'INTRADAY'
    ) {
      const relaxedSlMin = Math.max(0.25, 2.5 * input.atrPercent); // Floor: max(0.25%, 2.5×ATR%)
      const tpCeiling = input.atrPercent * tpMaxMultiple;
      const relaxedRR = relaxedSlMin > 0 ? tpCeiling / relaxedSlMin : 0;

      if (relaxedRR >= input.policy.minRR && relaxedSlMin < currentSlMin) {
        adjustments.push({
          field: 'sl.minPercent',
          from: currentSlMin,
          to: relaxedSlMin,
          reason: 'SL_FLOOR_TOO_HIGH'
        });

        logger.info(
          LogCategory.AI_TRADING,
          `[Repair Cascade] ✅ REPAIR 3 SUCCESS: SL relaxation ${currentSlMin.toFixed(2)}% → ${relaxedSlMin.toFixed(2)}% (RR now ${relaxedRR.toFixed(2)}:1)`
        );

        return {
          style: currentStyle,
          riskMode: currentRiskMode,
          finalSlMinPercent: relaxedSlMin,
          finalRR: relaxedRR,
          repairUsed: 'SL_RELAXATION'
        };
      }
      logger.info(LogCategory.AI_TRADING, `[Repair Cascade] ❌ REPAIR 3 FAILED: SL relaxation didn't achieve target R:R`);
    }

    // REPAIR 4: TP1-Only Mode (partial profit, lower target)
    // Accept just TP1 (typically 50% of full TP) to achieve lower but viable R:R
    const tp1Multiple = Math.max(2, tpMaxMultiple * 0.4); // TP1 at 40% of original TP
    const tp1TpCeiling = input.atrPercent * tp1Multiple;
    const tp1RR = currentSlMin > 0 ? tp1TpCeiling / currentSlMin : 0;

    if (tp1RR >= input.policy.minRR * 0.7) { // Accept 70% of target R:R for TP1-only
      adjustments.push({
        field: 'tp.mode',
        from: 'FULL_TP',
        to: 'TP1_ONLY',
        reason: 'RR_INFEASIBLE',
        advisory: false,
        detail: `Using TP1-only mode (${tp1Multiple.toFixed(1)}x ATR) to achieve ${tp1RR.toFixed(2)}:1 R:R`
      });

      logger.info(
        LogCategory.AI_TRADING,
        `[Repair Cascade] ✅ REPAIR 4 SUCCESS: TP1-only mode at ${tp1Multiple.toFixed(1)}x ATR (RR ${tp1RR.toFixed(2)}:1)`
      );

      return {
        style: currentStyle,
        riskMode: currentRiskMode,
        finalSlMinPercent: currentSlMin,
        finalRR: tp1RR,
        repairUsed: 'TP1_ONLY'
      };
    }
    logger.info(LogCategory.AI_TRADING, `[Repair Cascade] ❌ REPAIR 4 FAILED: TP1-only mode didn't achieve acceptable R:R`);

    // REPAIR 5: Style Upgrade (longer duration, more room to breathe)
    // Only try if we're currently at SCALP
    if (currentStyle === 'SCALP' && input.policy.allowAutoSwitchStyle) {
      const upgradedStyle: TradeStyle = 'INTRADAY';
      if (this.isStyleValid(input.assetClass, upgradedStyle, input.atrPercent)) {
        adjustments.push({
          field: 'style',
          from: currentStyle,
          to: upgradedStyle,
          reason: 'LOW_VOLATILITY_FOR_STYLE',
          advisory: false,
          detail: `Upgraded from ${currentStyle} to ${upgradedStyle} for better feasibility`
        });

        logger.info(
          LogCategory.AI_TRADING,
          `[Repair Cascade] ✅ REPAIR 5 SUCCESS: Style upgrade ${currentStyle} → ${upgradedStyle}`
        );

        // Recalculate with upgraded style
        const upgradedSlMin = this.getSlMinPercent(input.assetClass, currentRiskMode);
        const upgradedTpCeiling = input.atrPercent * tpMaxMultiple;
        const upgradedRR = upgradedSlMin > 0 ? upgradedTpCeiling / upgradedSlMin : 0;

        return {
          style: upgradedStyle,
          riskMode: currentRiskMode,
          finalSlMinPercent: upgradedSlMin,
          finalRR: upgradedRR,
          repairUsed: 'STYLE_UPGRADE'
        };
      }
      logger.info(LogCategory.AI_TRADING, `[Repair Cascade] ❌ REPAIR 5 FAILED: Style upgrade not valid for current ATR`);
    }

    // ALL REPAIRS FAILED - Return advisory with best available
    const maxRR = ((input.atrPercent * tpMaxMultiple) / currentSlMin).toFixed(2);
    logger.warn(
      LogCategory.AI_TRADING,
      `[Repair Cascade] ⚠️  ALL REPAIRS EXHAUSTED: Best achievable R:R is ${maxRR}:1 (target: ${input.policy.minRR}:1)`
    );

    return {
      style: currentStyle,
      riskMode: currentRiskMode,
      advisory: `⚠️ ADVISORY: Repair cascade exhausted. Cannot achieve professional target ${input.policy.minRR}:1 R:R. TP ceiling ${(input.atrPercent * tpMaxMultiple).toFixed(2)}% / SL floor ${currentSlMin.toFixed(2)}% yields maximum R:R ${maxRR}:1. Alpha may proceed with lower R:R if setup quality justifies it.`,
      repairUsed: 'NONE'
    };
  }

  /**
   * Validate spread impact
   */
  private validateSpread(input: FeasibilityInput): {
    blocker?: { reason: AdjustmentReason; detail: string };
    impactPercent?: number;
  } {
    if (!input.spreadPercent || !input.atrPercent) {
      return {};
    }

    const spreadImpact = (input.spreadPercent / input.atrPercent) * 100;

    // Spread consuming >30% of ATR is problematic
    if (spreadImpact > 30) {
      return {
        blocker: {
          reason: 'HIGH_SPREAD_VS_ATR',
          detail: `Spread (${input.spreadPercent.toFixed(3)}%) consuming ${spreadImpact.toFixed(0)}% of ATR - execution unreliable`
        },
        impactPercent: spreadImpact
      };
    }

    // Absolute spread >0.5% is too high for any asset
    if (input.spreadPercent > 0.5) {
      return {
        blocker: {
          reason: 'ABSOLUTE_SPREAD_TOO_HIGH',
          detail: `Spread ${input.spreadPercent.toFixed(2)}% exceeds 0.5% - avoid trading`
        },
        impactPercent: spreadImpact
      };
    }

    return { impactPercent: spreadImpact };
  }

  /**
   * Check if data is stale
   */
  private isDataStale(input: FeasibilityInput): boolean {
    if (!input.dataQuality) {
      return false;
    }

    const MAX_PRICE_AGE_MS = 300000; // 5 minutes
    const MAX_ATR_AGE_MS = 3600000;  // 1 hour

    if (input.dataQuality.priceAgeMs && input.dataQuality.priceAgeMs > MAX_PRICE_AGE_MS) {
      logger.warn(
        LogCategory.AI_TRADING,
        `[Feasibility Resolver] Price data stale: ${(input.dataQuality.priceAgeMs / 1000).toFixed(0)}s old`
      );
      return true;
    }

    if (input.dataQuality.atrAgeMs && input.dataQuality.atrAgeMs > MAX_ATR_AGE_MS) {
      logger.warn(
        LogCategory.AI_TRADING,
        `[Feasibility Resolver] ATR data stale: ${(input.dataQuality.atrAgeMs / 60000).toFixed(0)}min old`
      );
      return true;
    }

    return false;
  }

  /**
   * Build resolved plan
   */
  private buildResolvedPlan(
    style: TradeStyle,
    riskMode: RiskMode,
    slMinPercent: number,
    tpMaxAtrMultiple: number,
    minRR: number
  ): ResolvedPlan {
    return {
      style,
      riskMode,
      sl: {
        minPercent: slMinPercent,
        maxPercent: undefined // Could add max based on asset class
      },
      tp: {
        maxAtrMultiple: tpMaxAtrMultiple
      },
      rr: {
        min: minRR
      }
    };
  }

  /**
   * Build success result
   */
  private buildSuccessResult(
    status: 'OK' | 'ADJUSTED',
    plan: ResolvedPlan,
    adjustments: FeasibilityResult['adjustments'],
    userMessage: string,
    diagnostics: FeasibilityResult['diagnostics']
  ): FeasibilityResult {
    return {
      status,
      plan,
      adjustments,
      userMessage,
      diagnostics
    };
  }

  /**
   * Build NO_TRADE result
   */
  private buildNoTradeResult(
    reason: AdjustmentReason,
    detail: string,
    adjustments: FeasibilityResult['adjustments']
  ): FeasibilityResult {
    return {
      status: 'NO_TRADE',
      adjustments,
      userMessage: detail,
      blockers: [{ reason, detail }]
    };
  }

  /**
   * Build user-facing message
   */
  private buildUserMessage(
    input: FeasibilityInput,
    adjustments: FeasibilityResult['adjustments'],
    blockers: FeasibilityResult['blockers'],
    status: FeasibilityStatus
  ): string {
    if (status === 'OK') {
      return `Trade setup is feasible as requested: ${input.requestedStyle} style with ${input.requestedRiskMode} risk.`;
    }

    if (status === 'ADJUSTED') {
      const changes = adjustments.map(adj => {
        if (adj.field === 'style') {
          return `switched from ${adj.from} to ${adj.to} style`;
        }
        if (adj.field === 'riskMode') {
          return `reduced risk from ${adj.from} to ${adj.to}`;
        }
        if (adj.field === 'sl.minPercent') {
          return `adjusted stop loss to ${(adj.to as number).toFixed(2)}%`;
        }
        return `adjusted ${adj.field}`;
      }).join(', ');

      return `Current market volatility (ATR ${input.atrPercent.toFixed(2)}%) doesn't support your original setup. I've automatically ${changes} to maintain professional risk/reward standards.`;
    }

    // NO_TRADE
    if (input.goalContext?.targetProfitUsd) {
      const blockReasons = blockers.map(b => b.detail).join('; ');
      return `I can't find a professional setup for your $${input.goalContext.targetProfitUsd} goal in current market conditions. ${blockReasons}. Consider: waiting for volatility to increase, scanning different pairs, or adjusting your risk tolerance.`;
    }

    return `Market volatility is too low to support a professional risk/reward setup under your selected mode. No trade placed. ${blockers.map(b => b.detail).join('; ')}`;
  }
}

export const tradeFeasibilityResolver = new TradeFeasibilityResolver();
