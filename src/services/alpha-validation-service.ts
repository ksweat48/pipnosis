/**
 * Alpha Validation Service
 *
 * Implements: "Engines validate. Alpha decides. Trades degrade intelligently."
 *
 * This service validates Alpha's decisions and categorizes issues:
 *
 * HARD BLOCKS (immediate rejection):
 * - Wrong-side SL/TP (geometry invalid)
 * - Missing required fields
 * - Stale/missing data
 * - Market closed
 * - NaN values
 * - Zero distances
 *
 * SOFT VIOLATIONS (trigger Alpha Repair):
 * - R:R below minimum
 * - TP exceeds maximum pips
 * - SL too wide/tight (but geometrically valid)
 * - Risk exceeds maximum
 * - Goal infeasible (but partial trade possible)
 *
 * NO silent corrections. NO engine-invented values.
 * Only Alpha decides SL/TP/risk.
 */

import { logger } from '../lib/logger';
import { calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';
import type {
  PreRepairValidation,
  AlphaRepairViolation,
  HardBlockResult,
  AllowedHardBlock,
} from '../types/alpha-repair';
import { logViolation } from './ssot-violation-logger';

interface ValidationInput {
  symbol: string;
  action: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  risk_pct: number;
  confidence: number;
}

interface ValidationConstraints {
  minRR?: number;
  maxRR?: number;
  minSLPips?: number;
  maxSLPips?: number;
  minTPPips?: number;
  maxTPPips?: number;
  minRiskPct?: number;
  maxRiskPct?: number;
  userGoalDollars?: number;
  maxFeasibleDollars?: number;
}

interface ValidationContext {
  currentPrice: number;
  atr?: number;
  pipInfo: ReturnType<typeof getCurrencyPipInfo>;
  sessionId?: string;
  userId?: string;
}

class AlphaValidationService {
  /**
   * Validate Alpha's decision
   * Returns hard block OR soft violations for repair
   */
  async validate(
    decision: ValidationInput,
    constraints: ValidationConstraints,
    context: ValidationContext
  ): Promise<PreRepairValidation> {
    // Phase 1: Check hard blocks (immediate rejection)
    const hardBlock = this.checkHardBlocks(decision, context);
    if (hardBlock) {
      // Log SSOT violation for hard geometry errors
      if (hardBlock.ssotViolationType) {
        await this.logSSotViolation(
          hardBlock.ssotViolationType,
          hardBlock.reason,
          decision,
          context
        );
      }

      return {
        hardBlocked: true,
        hardBlockResult: hardBlock,
        softViolations: [],
        constraints: {},
        guidance: {},
      };
    }

    // Phase 2: Check soft violations (repair opportunities)
    const softViolations = this.checkSoftViolations(decision, constraints, context);

    // Phase 3: Generate guidance for repair
    const guidance = this.generateRepairGuidance(decision, constraints, context);

    logger.info(
      `[Alpha Validation] ${decision.symbol}: ` +
      `${hardBlock ? 'HARD BLOCKED' : `${softViolations.length} soft violations`}`
    );

    return {
      hardBlocked: false,
      softViolations,
      constraints,
      guidance,
    };
  }

  /**
   * Check for hard blocks (geometry, missing data, invalid states)
   */
  private checkHardBlocks(
    decision: ValidationInput,
    context: ValidationContext
  ): HardBlockResult | null {
    const { symbol, action, direction, entry, stopLoss, takeProfit } = decision;

    // 1. Check for NaN values
    if (isNaN(entry) || isNaN(stopLoss) || isNaN(takeProfit)) {
      return {
        blocked: true,
        reason: 'NaN value detected in entry, SL, or TP',
        violationType: 'NAN_VALUES',
        loggingRequired: true,
        ssotViolationType: 'ALPHA_NAN_VALUE',
      };
    }

    // 2. Check for missing required fields
    if (!entry || !stopLoss || !takeProfit) {
      return {
        blocked: true,
        reason: 'Missing required fields: entry, stopLoss, or takeProfit',
        violationType: 'MISSING_REQUIRED_FIELDS',
        loggingRequired: true,
        ssotViolationType: 'ALPHA_MISSING_FIELDS',
      };
    }

    // 3. Check for zero distances
    if (entry === stopLoss) {
      return {
        blocked: true,
        reason: 'Entry equals Stop Loss (zero distance)',
        violationType: 'GEOMETRY_INVALID',
        loggingRequired: true,
        ssotViolationType: 'ALPHA_ENTRY_EQUALS_SL',
      };
    }

    if (entry === takeProfit) {
      return {
        blocked: true,
        reason: 'Entry equals Take Profit (zero distance)',
        violationType: 'GEOMETRY_INVALID',
        loggingRequired: true,
        ssotViolationType: 'ALPHA_ENTRY_EQUALS_TP',
      };
    }

    // 4. Check SL geometry (CRITICAL - wrong side is hard block)
    const isBuy = direction === 'BUY';
    const slOnWrongSide = (isBuy && stopLoss >= entry) || (!isBuy && stopLoss <= entry);

    if (slOnWrongSide) {
      return {
        blocked: true,
        reason: `Stop Loss on WRONG SIDE: ${action} with Entry=${entry.toFixed(5)}, SL=${stopLoss.toFixed(5)}`,
        violationType: 'GEOMETRY_INVALID',
        loggingRequired: true,
        ssotViolationType: 'ALPHA_SL_WRONG_SIDE',
      };
    }

    // 5. Check TP geometry (CRITICAL - wrong side is hard block)
    const tpOnWrongSide = (isBuy && takeProfit <= entry) || (!isBuy && takeProfit >= entry);

    if (tpOnWrongSide) {
      return {
        blocked: true,
        reason: `Take Profit on WRONG SIDE: ${action} with Entry=${entry.toFixed(5)}, TP=${takeProfit.toFixed(5)}`,
        violationType: 'GEOMETRY_INVALID',
        loggingRequired: true,
        ssotViolationType: 'ALPHA_TP_WRONG_SIDE',
      };
    }

    // No hard blocks
    return null;
  }

  /**
   * Check for soft violations (repair opportunities)
   */
  private checkSoftViolations(
    decision: ValidationInput,
    constraints: ValidationConstraints,
    context: ValidationContext
  ): AlphaRepairViolation[] {
    const violations: AlphaRepairViolation[] = [];
    const { symbol, entry, stopLoss, takeProfit, risk_pct } = decision;
    const { pipInfo } = context;

    // Calculate distances
    const slPips = calculatePipDistance(symbol, Math.abs(entry - stopLoss));
    const tpPips = calculatePipDistance(symbol, Math.abs(takeProfit - entry));
    const rr = tpPips / slPips;

    // 1. Check R:R constraints
    if (constraints.minRR !== undefined && rr < constraints.minRR) {
      violations.push({
        type: 'RR_BELOW_MIN',
        severity: 'HIGH',
        description: `R:R ${rr.toFixed(2)}:1 is below minimum ${constraints.minRR}:1`,
        currentValue: rr,
        constraint: { min: constraints.minRR, unit: 'ratio' },
      });
    }

    if (constraints.maxRR !== undefined && rr > constraints.maxRR) {
      violations.push({
        type: 'RR_BELOW_MIN', // Repurpose for max too
        severity: 'MEDIUM',
        description: `R:R ${rr.toFixed(2)}:1 exceeds maximum ${constraints.maxRR}:1`,
        currentValue: rr,
        constraint: { max: constraints.maxRR, unit: 'ratio' },
      });
    }

    // 2. Check SL pip constraints
    if (constraints.minSLPips !== undefined && slPips < constraints.minSLPips) {
      violations.push({
        type: 'SL_TOO_TIGHT',
        severity: 'HIGH',
        description: `SL ${slPips.toFixed(1)} pips is below minimum ${constraints.minSLPips} pips`,
        currentValue: slPips,
        constraint: { min: constraints.minSLPips, unit: 'pips' },
      });
    }

    if (constraints.maxSLPips !== undefined && slPips > constraints.maxSLPips) {
      violations.push({
        type: 'SL_TOO_WIDE',
        severity: 'MEDIUM',
        description: `SL ${slPips.toFixed(1)} pips exceeds maximum ${constraints.maxSLPips} pips`,
        currentValue: slPips,
        constraint: { max: constraints.maxSLPips, unit: 'pips' },
      });
    }

    // 3. Check TP pip constraints
    if (constraints.maxTPPips !== undefined && tpPips > constraints.maxTPPips) {
      violations.push({
        type: 'TP_EXCEEDS_MAX',
        severity: 'MEDIUM',
        description: `TP ${tpPips.toFixed(1)} pips exceeds maximum ${constraints.maxTPPips} pips`,
        currentValue: tpPips,
        constraint: { max: constraints.maxTPPips, unit: 'pips' },
      });
    }

    // 4. Check risk constraints
    if (constraints.maxRiskPct !== undefined && risk_pct > constraints.maxRiskPct) {
      violations.push({
        type: 'RISK_EXCEEDS_MAX',
        severity: 'HIGH',
        description: `Risk ${risk_pct.toFixed(2)}% exceeds maximum ${constraints.maxRiskPct}%`,
        currentValue: risk_pct,
        constraint: { max: constraints.maxRiskPct, unit: 'percent' },
      });
    }

    // 5. Check goal feasibility (if provided)
    if (
      constraints.userGoalDollars !== undefined &&
      constraints.maxFeasibleDollars !== undefined &&
      constraints.maxFeasibleDollars < constraints.userGoalDollars
    ) {
      violations.push({
        type: 'GOAL_INFEASIBLE',
        severity: 'MEDIUM',
        description: `User goal $${constraints.userGoalDollars} exceeds market feasibility $${constraints.maxFeasibleDollars}`,
        currentValue: constraints.maxFeasibleDollars,
        constraint: { max: constraints.maxFeasibleDollars, unit: 'dollars' },
      });
    }

    return violations;
  }

  /**
   * Generate repair guidance for Alpha
   */
  private generateRepairGuidance(
    decision: ValidationInput,
    constraints: ValidationConstraints,
    context: ValidationContext
  ): PreRepairValidation['guidance'] {
    const guidance: PreRepairValidation['guidance'] = {};
    const { entry, stopLoss } = decision;
    const { pipInfo, atr } = context;

    // Suggest SL range based on ATR if available
    if (atr && constraints.minSLPips && constraints.maxSLPips) {
      const atrPips = atr / pipInfo.pipValue;
      const suggestedSLPips = Math.max(
        constraints.minSLPips,
        Math.min(constraints.maxSLPips, atrPips * 1.5)
      );

      const isBuy = decision.direction === 'BUY';
      const slDistance = suggestedSLPips * pipInfo.pipValue;

      guidance.suggestedSLRange = {
        min: isBuy ? entry - (constraints.maxSLPips * pipInfo.pipValue) : entry,
        max: isBuy ? entry - (constraints.minSLPips * pipInfo.pipValue) : entry + (constraints.maxSLPips * pipInfo.pipValue),
      };
    }

    // Suggest TP range based on R:R and SL
    if (constraints.minRR && constraints.maxRR) {
      const slDistance = Math.abs(entry - stopLoss);
      const minTpDistance = slDistance * constraints.minRR;
      const maxTpDistance = slDistance * constraints.maxRR;

      const isBuy = decision.direction === 'BUY';
      guidance.suggestedTPRange = {
        min: isBuy ? entry + minTpDistance : entry - maxTpDistance,
        max: isBuy ? entry + maxTpDistance : entry - minTpDistance,
      };
    }

    // Degradation options if goal is infeasible
    if (
      constraints.userGoalDollars !== undefined &&
      constraints.maxFeasibleDollars !== undefined &&
      constraints.maxFeasibleDollars < constraints.userGoalDollars
    ) {
      guidance.degradationOptions = [
        `Accept $${constraints.maxFeasibleDollars.toFixed(0)} (best available setup)`,
        `Wait for better market conditions to pursue $${constraints.userGoalDollars.toFixed(0)} goal`,
        `Trade half position ($${(constraints.maxFeasibleDollars / 2).toFixed(0)}) with reduced risk`,
      ];
    }

    return guidance;
  }

  /**
   * Log SSOT violation for analytics
   *
   * SSOT Compliance: Uses correct ViolationLogEntry interface matching database schema.
   * All required fields (symbol, attemptedOperation, callLocation) are provided.
   */
  private async logSSotViolation(
    violationType: string,
    reason: string,
    decision: ValidationInput,
    context: ValidationContext
  ): Promise<void> {
    try {
      await logViolation({
        violationType: violationType,
        symbol: decision.symbol,
        attemptedOperation: 'alpha_validation',
        callLocation: 'alpha-validation-service',
        blocked: true,
        errorDetails: {
          reason,
          action: decision.action,
          entry: decision.entry,
          stopLoss: decision.stopLoss,
          takeProfit: decision.takeProfit,
          direction: decision.direction,
          confidence: decision.confidence,
          risk_pct: decision.risk_pct,
          userId: context.userId,
          sessionId: context.sessionId,
          currentPrice: context.currentPrice,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('[Alpha Validation] Failed to log SSOT violation:', error);
      // Don't throw - logging failures never block validation
    }
  }
}

export const alphaValidationService = new AlphaValidationService();
