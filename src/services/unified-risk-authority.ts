/**
 * Unified Risk Authority
 *
 * SSOT Authority: Single source of truth for ALL risk assessment and position sizing
 * Consolidates: ProfessionalRiskManager + PCVL + SSOT Preflight
 *
 * CCIP Compliant: Part of trade execution simplification (20260202)
 *
 * Responsibilities:
 * 1. TradeContext validation (SSOT compliance)
 * 2. Position sizing (Kelly + Risk scaling)
 * 3. PCVL validation (pip value contract)
 * 4. Margin sufficiency
 * 5. Risk assessment (Kelly, EV, volatility, correlation)
 *
 * Principles:
 * - Engines validate, Alpha decides
 * - Degrade intelligently (provide warnings, not silent blocks)
 * - Single calculation pass (no duplicate work)
 * - Advisory mode (warnings + minimum viable lot size, not hard blocks)
 */

import type { TradeContext } from '../types/trade-context';
import { validateTradeContext } from '../utils/tradeMath';
import { getCurrencyPipInfo, calculateDollarPerPip, calculatePipDistance, roundLotSize } from '../utils/currencyHelpers';
import { getSymbolConfig } from '../config/symbol-registry';
import { kellyCriterionSizer } from './kelly-criterion-sizer';
import { evGatingSystem } from './ev-gating-system';
import { volatilityAdjustedRisk } from './volatility-adjusted-risk';
import { correlationRiskManager } from './correlation-risk-manager';
import { marketConditionRiskAdjuster } from './market-condition-risk-adjuster';
import { progressiveRiskScaling } from './progressive-risk-scaling';
import { getRiskStrategyProfile } from '../config/risk-strategy-profiles';
import { PCVL_CONFIG } from '../config/pcvl-config';
import { logViolation } from './ssot-violation-logger';
import { prodLogger } from '../lib/production-logger';

export interface RiskAssessmentInputs {
  // Context validation
  tradeContext?: TradeContext;
  symbol: string;

  // Position details
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;

  // User & account
  userId: string;
  currentBalance: number;

  // Risk parameters
  baseRiskPercent?: number;
  riskMode?: 'low' | 'medium' | 'high';
  proposedLotSize?: number;

  // Session context
  goalSessionId?: string;
}

export interface RiskAssessmentResult {
  approved: boolean;
  recommendedLotSize: number;
  adjustedRiskDollars: number;
  trueRiskDollars: number; // From PCVL validation
  riskVariancePercent: number;

  // Validation results
  contextValid: boolean;
  pcvlPassed: boolean;
  marginSufficient: boolean;

  // Advisory data
  criticalWarnings: string[];
  recommendations: string[];
  blockReason?: string;

  // Detailed breakdown (for transparency)
  breakdown: {
    kellyLotSize: number;
    evConfidence: string;
    volatilityAdjustment: number;
    marginRequired: number;
    marginAvailable: number;
  };
}

class UnifiedRiskAuthority {
  private readonly DEFAULT_BASE_RISK = 0.01; // 1%
  private readonly MARGIN_LEVERAGE = 1000; // 1:1000 leverage

  /**
   * Comprehensive risk assessment
   * Single pass through all validation layers
   */
  async assessTrade(inputs: RiskAssessmentInputs): Promise<RiskAssessmentResult> {
    const {
      tradeContext,
      symbol,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      userId,
      currentBalance,
      baseRiskPercent = this.DEFAULT_BASE_RISK,
      riskMode = 'medium',
      proposedLotSize,
      goalSessionId
    } = inputs;

    // GOVERNANCE: Input validation (fail loudly on bad data)
    if (currentBalance === undefined || currentBalance === null || isNaN(currentBalance)) {
      prodLogger.error('UnifiedRiskAuthority: currentBalance is invalid', {
        currentBalance,
        userId,
        symbol
      });
      return {
        approved: false,
        recommendedLotSize: 0.01,
        adjustedRiskDollars: 0,
        trueRiskDollars: 0,
        riskVariancePercent: 0,
        contextValid: false,
        pcvlPassed: false,
        marginSufficient: false,
        criticalWarnings: ['CRITICAL: Account balance is undefined or invalid'],
        recommendations: ['Contact support - account data corrupted'],
        blockReason: 'Invalid account balance - cannot assess risk',
        breakdown: {
          kellyLotSize: 0,
          evConfidence: 'blocked',
          volatilityAdjustment: 0,
          marginRequired: 0,
          marginAvailable: 0
        }
      };
    }

    if (entryPrice === undefined || entryPrice === null || isNaN(entryPrice) || entryPrice <= 0) {
      prodLogger.error('UnifiedRiskAuthority: entryPrice is invalid', {
        entryPrice,
        userId,
        symbol
      });
      return {
        approved: false,
        recommendedLotSize: 0.01,
        adjustedRiskDollars: 0,
        trueRiskDollars: 0,
        riskVariancePercent: 0,
        contextValid: false,
        pcvlPassed: false,
        marginSufficient: false,
        criticalWarnings: ['CRITICAL: Entry price is undefined or invalid'],
        recommendations: ['Check market data - price feed may be stale'],
        blockReason: 'Invalid entry price - cannot assess risk',
        breakdown: {
          kellyLotSize: 0,
          evConfidence: 'blocked',
          volatilityAdjustment: 0,
          marginRequired: 0,
          marginAvailable: currentBalance || 0
        }
      };
    }

    if (stopLoss === undefined || stopLoss === null || isNaN(stopLoss) || stopLoss <= 0) {
      prodLogger.error('UnifiedRiskAuthority: stopLoss is invalid', {
        stopLoss,
        userId,
        symbol
      });
      return {
        approved: false,
        recommendedLotSize: 0.01,
        adjustedRiskDollars: 0,
        trueRiskDollars: 0,
        riskVariancePercent: 0,
        contextValid: false,
        pcvlPassed: false,
        marginSufficient: false,
        criticalWarnings: ['CRITICAL: Stop loss is undefined or invalid'],
        recommendations: ['Check Alpha decision output - SL calculation failed'],
        blockReason: 'Invalid stop loss - cannot assess risk',
        breakdown: {
          kellyLotSize: 0,
          evConfidence: 'blocked',
          volatilityAdjustment: 0,
          marginRequired: 0,
          marginAvailable: currentBalance || 0
        }
      };
    }

    if (takeProfit === undefined || takeProfit === null || isNaN(takeProfit) || takeProfit <= 0) {
      prodLogger.error('UnifiedRiskAuthority: takeProfit is invalid', {
        takeProfit,
        userId,
        symbol
      });
      return {
        approved: false,
        recommendedLotSize: 0.01,
        adjustedRiskDollars: 0,
        trueRiskDollars: 0,
        riskVariancePercent: 0,
        contextValid: false,
        pcvlPassed: false,
        marginSufficient: false,
        criticalWarnings: ['CRITICAL: Take profit is undefined or invalid'],
        recommendations: ['Check Alpha decision output - TP calculation failed'],
        blockReason: 'Invalid take profit - cannot assess risk',
        breakdown: {
          kellyLotSize: 0,
          evConfidence: 'blocked',
          volatilityAdjustment: 0,
          marginRequired: 0,
          marginAvailable: currentBalance || 0
        }
      };
    }

    const criticalWarnings: string[] = [];
    const recommendations: string[] = [];
    let approved = true;

    // LAYER 1: TradeContext Validation (SSOT Pre-Flight)
    const contextValidation = await this.validateContext(tradeContext, symbol, userId);
    if (!contextValidation.valid) {
      return {
        approved: false,
        recommendedLotSize: 0.01,
        adjustedRiskDollars: 0,
        trueRiskDollars: 0,
        riskVariancePercent: 0,
        contextValid: false,
        pcvlPassed: false,
        marginSufficient: false,
        criticalWarnings: ['TradeContext validation failed'],
        recommendations: [],
        blockReason: contextValidation.error,
        breakdown: {
          kellyLotSize: 0,
          evConfidence: 'blocked',
          volatilityAdjustment: 0,
          marginRequired: 0,
          marginAvailable: currentBalance
        }
      };
    }

    // LAYER 2: Position Sizing (Kelly + Risk Scaling)
    const riskProfile = getRiskStrategyProfile(riskMode);
    const historicalStats = await kellyCriterionSizer.getHistoricalStats(userId, symbol);

    // Calculate stop distance
    const stopPips = calculatePipDistance(symbol, entryPrice, stopLoss);
    const takeProfitPips = calculatePipDistance(symbol, entryPrice, takeProfit);

    // Kelly position sizing
    const kelly = kellyCriterionSizer.calculateOptimalSize({
      winRate: historicalStats.winRate,
      avgWinPips: takeProfitPips,
      avgLossPips: stopPips,
      currentBalance,
      symbol,
      userId
    });

    if (kelly.advisory) {
      criticalWarnings.push(`Kelly: ${kelly.advisory.message}`);
      recommendations.push(kelly.advisory.suggestion);
    }

    let recommendedLotSize = proposedLotSize || kelly.recommendedLotSize;

    // EV Gating (Advisory mode)
    const marketCondition = marketConditionRiskAdjuster.assessMarketCondition({
      symbol,
      timeOfDay: new Date(),
      userId
    });

    const evGate = evGatingSystem.evaluateTrade({
      winRate: historicalStats.winRate,
      avgWinPips: takeProfitPips,
      avgLossPips: stopPips,
      proposedLotSize: recommendedLotSize,
      symbol,
      userId,
      marketCondition: 'normal',
      sessionQuality: marketCondition.sessionQuality
    });

    if (evGate.confidenceLevel === 'very-low') {
      criticalWarnings.push('Negative expected value - high risk trade');
      recommendations.push(...evGate.recommendations);
    }

    // Volatility adjustment
    const volatilityRisk = await volatilityAdjustedRisk.adjustRiskForVolatility({
      symbol,
      baseRiskPercent,
      currentATR: stopPips,
      userId
    });

    // Progressive scaling - SSOT: progressive-risk-scaling.ts
    const scaledRisk = await progressiveRiskScaling.calculateRiskScaling({
      userId,
      baseRiskPercent: volatilityRisk.adjustedRiskPercent,
      goalSessionId: inputs.goalSessionId,
      lookbackTrades: 10
    });

    // Apply risk scaling to lot size
    const riskDollars = currentBalance * scaledRisk.adjustedRiskPercent;
    const dollarPerPip = calculateDollarPerPip(symbol, recommendedLotSize);

    // Recalculate lot size based on scaled risk
    if (dollarPerPip > 0 && stopPips > 0) {
      const targetDollarPerPip = riskDollars / stopPips;
      const pipInfo = getCurrencyPipInfo(symbol);
      recommendedLotSize = targetDollarPerPip / pipInfo.dollarPerPipPerLot;
      recommendedLotSize = roundLotSize(symbol, recommendedLotSize);
    }

    // LAYER 3: PCVL Validation
    const pcvlResult = this.validatePCVL({
      symbol,
      lotSize: recommendedLotSize,
      stopPips,
      intendedRiskDollars: riskDollars,
      entryPrice,
      stopLoss
    });

    if (!pcvlResult.approved) {
      return {
        approved: false,
        recommendedLotSize,
        adjustedRiskDollars: riskDollars,
        trueRiskDollars: pcvlResult.trueRiskDollars,
        riskVariancePercent: pcvlResult.riskVariancePercent,
        contextValid: true,
        pcvlPassed: false,
        marginSufficient: true,
        criticalWarnings: ['PCVL validation failed'],
        recommendations: [],
        blockReason: pcvlResult.blockReason,
        breakdown: {
          kellyLotSize: kelly.recommendedLotSize,
          evConfidence: evGate.confidenceLevel,
          volatilityAdjustment: volatilityRisk.adjustedRiskPercent,
          marginRequired: recommendedLotSize * this.MARGIN_LEVERAGE,
          marginAvailable: currentBalance
        }
      };
    }

    // LAYER 4: Margin Validation
    const marginRequired = recommendedLotSize * this.MARGIN_LEVERAGE;
    const marginSufficient = currentBalance >= marginRequired;

    if (!marginSufficient) {
      // GOVERNANCE: Defensive null check before .toFixed()
      const marginReqStr = (marginRequired !== undefined && !isNaN(marginRequired)) ? marginRequired.toFixed(2) : '0.00';
      const balanceStr = (currentBalance !== undefined && !isNaN(currentBalance)) ? currentBalance.toFixed(2) : '0.00';
      criticalWarnings.push(`Insufficient margin: Required $${marginReqStr}, Available $${balanceStr}`);
      recommendations.push('Reduce lot size or increase account balance');

      // Reduce lot size to fit available margin
      recommendedLotSize = Math.floor((currentBalance / this.MARGIN_LEVERAGE) * 100) / 100;
      recommendedLotSize = Math.max(0.01, recommendedLotSize); // Minimum 0.01 lots
    }

    // LAYER 5: Correlation Check (Advisory) - SSOT: correlation-risk-manager.ts
    const correlationCheck = await correlationRiskManager.checkCorrelationRisk({
      proposedSymbol: symbol,
      proposedDirection: inputs.direction,
      proposedLotSize: recommendedLotSize,
      userId,
      goalSessionId: inputs.goalSessionId
    });

    // Check total correlation risk (0-1 scale, >0.70 is high risk)
    if (correlationCheck.totalCorrelationRisk > 0.70) {
      criticalWarnings.push(`High correlation risk: ${correlationCheck.correlatedPositions.length} correlated positions`);
      recommendations.push(correlationCheck.recommendation);
    }

    // Final approval
    return {
      approved: true,
      recommendedLotSize,
      adjustedRiskDollars: riskDollars,
      trueRiskDollars: pcvlResult.trueRiskDollars,
      riskVariancePercent: pcvlResult.riskVariancePercent,
      contextValid: true,
      pcvlPassed: true,
      marginSufficient,
      criticalWarnings,
      recommendations,
      breakdown: {
        kellyLotSize: kelly.recommendedLotSize,
        evConfidence: evGate.confidenceLevel,
        volatilityAdjustment: volatilityRisk.adjustedRiskPercent,
        marginRequired,
        marginAvailable: currentBalance
      }
    };
  }

  /**
   * Validate TradeContext (SSOT Pre-Flight)
   */
  private async validateContext(
    context: TradeContext | undefined,
    symbol: string,
    userId: string
  ): Promise<{ valid: boolean; error?: string }> {
    const validation = validateTradeContext(context);

    if (!validation.valid) {
      await logViolation({
        violationType: validation.violationType || 'UNKNOWN',
        symbol,
        attemptedOperation: 'risk_assessment',
        callLocation: 'unified-risk-authority',
        blocked: true,
        errorDetails: {
          error: validation.error,
          violationType: validation.violationType,
          timestamp: new Date().toISOString()
        }
      });

      return {
        valid: false,
        error: validation.error
      };
    }

    return { valid: true };
  }

  /**
   * Validate PCVL (Position Contract)
   */
  private validatePCVL(params: {
    symbol: string;
    lotSize: number;
    stopPips: number;
    intendedRiskDollars: number;
    entryPrice: number;
    stopLoss: number;
  }): {
    approved: boolean;
    trueRiskDollars: number;
    riskVariancePercent: number;
    blockReason?: string;
  } {
    const { symbol, lotSize, stopPips, intendedRiskDollars, entryPrice, stopLoss } = params;

    // Get pip info
    const pipInfo = getCurrencyPipInfo(symbol);
    const symbolConfig = getSymbolConfig(symbol);

    // Calculate true risk
    const dollarPerPip = calculateDollarPerPip(symbol, lotSize);
    const trueRiskDollars = stopPips * dollarPerPip;

    // Calculate variance
    const riskVariancePercent = ((trueRiskDollars - intendedRiskDollars) / intendedRiskDollars) * 100;

    // Check variance threshold
    if (Math.abs(riskVariancePercent) > PCVL_CONFIG.max_risk_variance_percent) {
      // GOVERNANCE: Defensive null check before .toFixed()
      const varianceStr = (riskVariancePercent !== undefined && !isNaN(riskVariancePercent)) ? riskVariancePercent.toFixed(2) : '0.00';
      const intendedStr = (intendedRiskDollars !== undefined && !isNaN(intendedRiskDollars)) ? intendedRiskDollars.toFixed(2) : '0.00';
      const trueStr = (trueRiskDollars !== undefined && !isNaN(trueRiskDollars)) ? trueRiskDollars.toFixed(2) : '0.00';

      return {
        approved: false,
        trueRiskDollars,
        riskVariancePercent,
        blockReason: `Risk variance ${varianceStr}% exceeds ±${PCVL_CONFIG.max_risk_variance_percent}%. Intended: $${intendedStr}, Actual: $${trueStr}`
      };
    }

    // Check lot size range
    const minLot = symbolConfig?.minLotSize || 0.01;
    const maxLot = symbolConfig?.maxLotSize || 5.0;

    if (lotSize < minLot || lotSize > maxLot) {
      // GOVERNANCE: Defensive null check before .toFixed()
      const lotSizeStr = (lotSize !== undefined && !isNaN(lotSize)) ? lotSize.toFixed(3) : '0.000';
      return {
        approved: false,
        trueRiskDollars,
        riskVariancePercent,
        blockReason: `Lot size ${lotSizeStr} outside broker limits [${minLot}-${maxLot}]`
      };
    }

    return {
      approved: true,
      trueRiskDollars,
      riskVariancePercent
    };
  }

  /**
   * Quick margin check (for pre-validation)
   */
  checkMargin(lotSize: number, accountBalance: number): boolean {
    const marginRequired = lotSize * this.MARGIN_LEVERAGE;
    return accountBalance >= marginRequired;
  }
}

export const unifiedRiskAuthority = new UnifiedRiskAuthority();
