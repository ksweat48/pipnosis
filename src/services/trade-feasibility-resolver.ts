/**
 * Trade Feasibility Resolver (SSOT)
 *
 * Single authoritative source for determining if a trade style/risk combination
 * is feasible given current market conditions.
 *
 * Runs BEFORE Omega-9 constraint generation to prevent deadlock scenarios.
 *
 * Philosophy:
 * - ATR% gates determine if a style is valid
 * - RR math validates if constraints can coexist
 * - Auto-adjustments stay within safe bounds
 * - Transparent explanations for all decisions
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

export interface ITradeFeasibilityResolver {
  resolve(input: FeasibilityInput): FeasibilityResult;
}

class TradeFeasibilityResolver implements ITradeFeasibilityResolver {
  /**
   * ATR% thresholds for style validity (asset-class aware)
   */
  private readonly ATR_GATES = {
    CRYPTO: {
      SCALP: 0.20,      // 0.20% minimum for crypto scalping
      INTRADAY: 0.10,   // 0.10% minimum for crypto intraday
      SWING: 0.05       // 0.05% minimum for crypto swing
    },
    FOREX: {
      SCALP: 0.05,      // 0.05% minimum for forex scalping
      INTRADAY: 0.03,   // 0.03% minimum for forex intraday
      SWING: 0.02       // 0.02% minimum for forex swing
    },
    METAL: {
      SCALP: 0.08,      // Metals have moderate volatility
      INTRADAY: 0.05,
      SWING: 0.03
    },
    INDEX: {
      SCALP: 0.06,
      INTRADAY: 0.04,
      SWING: 0.02
    }
  };

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

    // Step 3: Validate style against ATR% gates
    let resolvedStyle = input.requestedStyle;
    let resolvedRiskMode = input.requestedRiskMode;

    const styleValid = this.isStyleValid(
      input.assetClass,
      resolvedStyle,
      input.atrPercent
    );

    if (!styleValid) {
      // Try auto-switching to less aggressive style
      const switchResult = this.autoSwitchStyle(
        input.assetClass,
        resolvedStyle,
        input.atrPercent,
        input.policy.allowAutoSwitchStyle
      );

      if (switchResult.newStyle) {
        adjustments.push({
          field: 'style',
          from: resolvedStyle,
          to: switchResult.newStyle,
          reason: 'LOW_VOLATILITY_FOR_STYLE'
        });
        resolvedStyle = switchResult.newStyle;
      } else {
        // Style switch not possible/allowed - may need to block
        blockers.push({
          reason: 'LOW_VOLATILITY_FOR_STYLE',
          detail: switchResult.blockMessage || `${resolvedStyle} requires ATR >= ${this.getAtrGate(input.assetClass, resolvedStyle).toFixed(2)}%, current: ${input.atrPercent.toFixed(2)}%`
        });
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

      if (cascadeResult.blocker) {
        blockers.push(cascadeResult.blocker);
      } else if (cascadeResult.finalSlMinPercent && cascadeResult.finalRR) {
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
      }
    }

    // Step 6: Handle blockers
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
          suggestedMinAtrPercent: this.getAtrGate(input.assetClass, 'INTRADAY')
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
   * Check if requested style is valid for current ATR%
   */
  private isStyleValid(
    assetClass: FeasibilityInput['assetClass'],
    style: TradeStyle,
    atrPercent: number
  ): boolean {
    const gate = this.getAtrGate(assetClass, style);
    return atrPercent >= gate;
  }

  /**
   * Get ATR% gate for a given asset class and style
   */
  private getAtrGate(
    assetClass: FeasibilityInput['assetClass'],
    style: TradeStyle
  ): number {
    return this.ATR_GATES[assetClass]?.[style] || 0.05;
  }

  /**
   * Get minimum SL percentage for asset class + risk mode
   */
  private getSlMinPercent(
    assetClass: FeasibilityInput['assetClass'],
    riskMode: RiskMode
  ): number {
    // Default SL floors by asset class and risk mode
    const SL_FLOORS: Record<string, number> = {
      'CRYPTO:HIGH': 0.50,
      'CRYPTO:MEDIUM': 1.00,
      'CRYPTO:LOW': 2.00,
      'FOREX:HIGH': 0.05,
      'FOREX:MEDIUM': 0.08,
      'FOREX:LOW': 0.12,
      'METAL:HIGH': 0.15,
      'METAL:MEDIUM': 0.25,
      'METAL:LOW': 0.40,
      'INDEX:HIGH': 0.10,
      'INDEX:MEDIUM': 0.15,
      'INDEX:LOW': 0.25
    };

    return SL_FLOORS[`${assetClass}:${riskMode}`] || 0.50;
  }

  /**
   * Auto-switch style if current style is invalid
   */
  private autoSwitchStyle(
    assetClass: FeasibilityInput['assetClass'],
    currentStyle: TradeStyle,
    atrPercent: number,
    allowAutoSwitch: boolean
  ): { newStyle: TradeStyle | null; blockMessage?: string } {
    if (!allowAutoSwitch) {
      return {
        newStyle: null,
        blockMessage: `Style switching disabled. ${currentStyle} requires higher volatility.`
      };
    }

    // Try cascade: SCALP → INTRADAY → SWING
    const cascade: TradeStyle[] = ['SCALP', 'INTRADAY', 'SWING'];
    const currentIndex = cascade.indexOf(currentStyle);

    for (let i = currentIndex + 1; i < cascade.length; i++) {
      const candidateStyle = cascade[i];
      if (this.isStyleValid(assetClass, candidateStyle, atrPercent)) {
        logger.info(
          LogCategory.AI_TRADING,
          `[Feasibility Resolver] Auto-switched: ${currentStyle} → ${candidateStyle}`
        );
        return { newStyle: candidateStyle };
      }
    }

    return {
      newStyle: null,
      blockMessage: `Even SWING style requires ATR >= ${this.getAtrGate(assetClass, 'SWING').toFixed(2)}%, current: ${atrPercent.toFixed(2)}%`
    };
  }

  /**
   * Adjustment cascade: Try style → risk → SL relaxation
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
    blocker?: { reason: AdjustmentReason; detail: string };
  } {
    // Try 1: Downgrade risk mode (reduces SL floor)
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
            `[Feasibility Resolver] Risk downgraded: ${currentRiskMode} → ${candidateRiskMode} (RR now ${candidateRR.toFixed(2)}:1)`
          );

          return {
            style: currentStyle,
            riskMode: candidateRiskMode,
            finalSlMinPercent: candidateSlMin,
            finalRR: candidateRR
          };
        }
      }
    }

    // Try 2: Bounded SL relaxation (CRYPTO HIGH only, when auto-switched to INTRADAY)
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
          `[Feasibility Resolver] Bounded SL relaxation: ${currentSlMin.toFixed(2)}% → ${relaxedSlMin.toFixed(2)}% (RR now ${relaxedRR.toFixed(2)}:1)`
        );

        return {
          style: currentStyle,
          riskMode: currentRiskMode,
          finalSlMinPercent: relaxedSlMin,
          finalRR: relaxedRR
        };
      }
    }

    // All adjustments failed - return blocker
    return {
      style: currentStyle,
      riskMode: currentRiskMode,
      blocker: {
        reason: 'RR_INFEASIBLE',
        detail: `Cannot achieve ${input.policy.minRR}:1 R:R. TP ceiling ${(input.atrPercent * tpMaxMultiple).toFixed(2)}% too low for SL floor ${currentSlMin.toFixed(2)}%. Maximum R:R: ${((input.atrPercent * tpMaxMultiple) / currentSlMin).toFixed(2)}:1`
      }
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
