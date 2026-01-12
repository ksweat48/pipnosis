import { kellyCriterionSizer, KellyInputs } from './kelly-criterion-sizer';
import { evGatingSystem, EVGateInputs } from './ev-gating-system';
import { goalFeasibilityValidator, GoalFeasibilityInputs } from './goal-feasibility-validator';
import { volatilityAdjustedRisk, VolatilityRiskInputs } from './volatility-adjusted-risk';
import { correlationRiskManager, CorrelationCheckInputs } from './correlation-risk-manager';
import { drawdownProtectionBreaker, DrawdownCheckInputs } from './drawdown-protection-breaker';
import { marketConditionRiskAdjuster, MarketConditionInputs } from './market-condition-risk-adjuster';
import { winRateRROptimizer, WinRateRRInputs } from './winrate-rr-optimizer';
import { progressiveRiskScaling, RiskScalingInputs } from './progressive-risk-scaling';
import { getRiskStrategyProfile } from '../config/risk-strategy-profiles';
import { calculateDollarPerPip } from '../utils/currencyHelpers';
import { TRADING_CONSTANTS } from '../config/trading-constants';

export interface ComprehensiveRiskAssessment {
  approved: boolean;
  recommendedLotSize: number;
  adjustedRiskPercent: number;
  riskScore: number; // 0-100 (higher = more risk)
  confidenceScore: number; // 0-100 (higher = more confident)
  criticalWarnings: string[];
  recommendations: string[];
  detailedBreakdown: {
    kelly: any;
    evGate: any;
    volatility: any;
    correlation: any;
    drawdown: any;
    marketCondition: any;
    winRateRR: any;
    riskScaling: any;
  };
  overallReasoning: string;
}

export interface TradeEvaluationInputs {
  userId: string;
  symbol: string;
  direction: 'long' | 'short';
  currentBalance: number;
  proposedLotSize?: number; // Optional, will be calculated if not provided
  baseRiskPercent?: number; // Default 1%
  stopLossPips?: number;
  takeProfitPips?: number;
  currentATR?: number; // Will be calculated from candles if not provided
  goalSessionId?: string;
  riskMode?: 'low' | 'medium' | 'high'; // Risk strategy profile
}

class ProfessionalRiskManager {
  private readonly DEFAULT_BASE_RISK = 0.01; // 1%

  async evaluateTrade(inputs: TradeEvaluationInputs): Promise<ComprehensiveRiskAssessment> {
    const {
      userId,
      symbol,
      direction,
      currentBalance,
      proposedLotSize,
      baseRiskPercent = this.DEFAULT_BASE_RISK,
      stopLossPips,
      takeProfitPips,
      currentATR,
      goalSessionId,
      riskMode = 'medium'
    } = inputs;

    // Get risk profile for floor/ceiling validation
    const riskProfile = getRiskStrategyProfile(riskMode);
    console.log(`[Professional Risk Manager] 🎯 Using ${riskMode.toUpperCase()} risk profile:`, {
      minRisk: riskProfile.riskPercentRange.min,
      maxRisk: riskProfile.riskPercentRange.max,
      baseRisk: riskProfile.baseRiskPercent
    });

    const criticalWarnings: string[] = [];
    const recommendations: string[] = [];
    let approved = true;

    // Step 1: Get historical statistics for Kelly/EV calculations
    const historicalStats = await kellyCriterionSizer.getHistoricalStats(userId, symbol);

    // Step 2: Check drawdown protection FIRST (hard stop overrides everything)
    const drawdownCheck = await drawdownProtectionBreaker.checkDrawdownProtection({
      userId,
      currentBalance,
      goalSessionId
    });

    if (!drawdownCheck.tradingAllowed) {
      return this.buildRejectionResponse(
        'DRAWDOWN HARD STOP',
        drawdownCheck.reasoning,
        drawdownCheck.recommendations,
        { drawdown: drawdownCheck }
      );
    }

    if (drawdownCheck.breachedLevel !== 'none') {
      criticalWarnings.push(...drawdownCheck.recommendations);
    }

    // Step 3: Evaluate win rate vs RR metrics
    const avgWinPips = takeProfitPips || historicalStats.avgWinPips;
    const avgLossPips = stopLossPips || historicalStats.avgLossPips;

    const winRateRR = winRateRROptimizer.optimizeWinRateRR({
      userId,
      currentWinRate: historicalStats.winRate,
      currentAvgWin: avgWinPips,
      currentAvgLoss: avgLossPips
    });

    if (winRateRR.profitabilityScore < 40) {
      criticalWarnings.push('⚠️ Strategy metrics are below profitable threshold');
      recommendations.push(...winRateRR.recommendations);
    }

    // Step 4: Kelly Criterion position sizing
    const kellyInputs: KellyInputs = {
      winRate: historicalStats.winRate,
      avgWinPips,
      avgLossPips,
      currentBalance,
      symbol,
      userId
    };

    const kelly = kellyCriterionSizer.calculateOptimalSize(kellyInputs);

    // Kelly now returns advisory warnings instead of blocking (minimum lot size with warnings)
    if (kelly.advisory) {
      criticalWarnings.push(`⚠️ Kelly: ${kelly.advisory.message}`);
      recommendations.push(kelly.advisory.suggestion);
    }

    // Step 5: EV Gating
    const marketCondition = marketConditionRiskAdjuster.assessMarketCondition({
      symbol,
      timeOfDay: new Date(),
      userId
    });

    const evGateInputs: EVGateInputs = {
      winRate: historicalStats.winRate,
      avgWinPips,
      avgLossPips,
      proposedLotSize: proposedLotSize || kelly.recommendedLotSize,
      symbol,
      userId,
      marketCondition: 'normal',
      sessionQuality: marketCondition.sessionQuality
    };

    const evGate = evGatingSystem.evaluateTrade(evGateInputs);

    // EV Gate is now always approved (advisory mode)
    // Provide warnings based on confidence level
    if (evGate.confidenceLevel === 'very-low') {
      criticalWarnings.push('⚠️ CRITICAL: Negative expected value - strongly consider NO_TRADE');
      recommendations.push(...evGate.recommendations);
    } else if (evGate.confidenceLevel === 'low') {
      criticalWarnings.push('⚠️ Low expected value - marginal trade');
      recommendations.push(...evGate.recommendations);
    }

    // Step 6: Volatility adjustment
    const volatilityInputs: VolatilityRiskInputs = {
      symbol,
      baseRiskPercent,
      currentATR: currentATR || avgLossPips, // Use stop loss as proxy if ATR not available
      userId
    };

    const volatility = await volatilityAdjustedRisk.adjustRiskForVolatility(volatilityInputs);

    if (volatility.volatilityState === 'very-high') {
      criticalWarnings.push(...volatility.warnings);
    }

    // Step 7: Correlation risk check
    const correlationInputs: CorrelationCheckInputs = {
      proposedSymbol: symbol,
      proposedDirection: direction,
      proposedLotSize: proposedLotSize || kelly.recommendedLotSize,
      userId,
      goalSessionId
    };

    const correlation = await correlationRiskManager.checkCorrelationRisk(correlationInputs);

    // Correlation is advisory - provide warnings but don't block
    if (!correlation.approved) {
      criticalWarnings.push('⚠️ ADVISORY: Correlation risk elevated - consider reducing position size');
      criticalWarnings.push(...correlation.warnings);
      // Don't set approved = false - this is advisory only
    }

    // Step 8: Progressive risk scaling
    const riskScalingInputs: RiskScalingInputs = {
      userId,
      baseRiskPercent,
      goalSessionId
    };

    const riskScaling = await progressiveRiskScaling.calculateRiskScaling(riskScalingInputs);

    if (riskScaling.performanceStreak === 'losing' && riskScaling.streakLength >= 3) {
      criticalWarnings.push(...riskScaling.recommendations);
    }

    // Calculate final adjusted risk and lot size
    let finalRiskPercent = baseRiskPercent;

    // Apply all multipliers
    finalRiskPercent *= drawdownCheck.riskReduction;
    finalRiskPercent *= volatility.riskMultiplier;
    finalRiskPercent *= marketCondition.riskMultiplier;
    finalRiskPercent *= riskScaling.scalingMultiplier;

    // Use Kelly if it's more conservative than our adjusted risk
    const kellyRisk = kelly.conservativeFraction;
    finalRiskPercent = Math.min(finalRiskPercent, kellyRisk);

    // CRITICAL: Apply risk profile floor and ceiling
    // Convert percent to decimal for comparison (e.g., 1.5% -> 0.015)
    const minRiskDecimal = riskProfile.riskPercentRange.min / 100;
    const maxRiskDecimal = riskProfile.riskPercentRange.max / 100;

    const beforeFloorCeiling = finalRiskPercent;
    finalRiskPercent = Math.max(minRiskDecimal, Math.min(maxRiskDecimal, finalRiskPercent));

    if (finalRiskPercent !== beforeFloorCeiling) {
      console.log(`[Professional Risk Manager] 🎯 Risk profile ${riskMode.toUpperCase()} adjusted risk: ${(beforeFloorCeiling * 100).toFixed(2)}% → ${(finalRiskPercent * 100).toFixed(2)}%`);

      if (finalRiskPercent === minRiskDecimal) {
        recommendations.push(`Risk profile floor applied: minimum ${riskProfile.riskPercentRange.min}% for ${riskMode} mode`);
      } else if (finalRiskPercent === maxRiskDecimal) {
        recommendations.push(`Risk profile ceiling applied: maximum ${riskProfile.riskPercentRange.max}% for ${riskMode} mode`);
      }
    }

    // Calculate final lot size using SSOT pip values
    const riskAmount = currentBalance * finalRiskPercent;
    const pipValue = calculateDollarPerPip(symbol, 1.0);
    const recommendedLotSize = Math.max(0.01, riskAmount / (avgLossPips * pipValue));
    const roundedLotSize = Math.round(recommendedLotSize * 100) / 100;

    // Apply correlation adjustment
    const finalLotSize = Math.min(roundedLotSize, correlation.maxSafeSize);

    // Calculate risk score (0-100, higher = more risky)
    const riskScore = this.calculateRiskScore({
      drawdownLevel: drawdownCheck.currentDrawdown,
      volatilityState: volatility.volatilityState,
      correlationRisk: correlation.totalCorrelationRisk,
      sessionQuality: marketCondition.liquidityScore,
      evConfidence: evGate.confidenceLevel
    });

    // Calculate confidence score (0-100, higher = more confident)
    const confidenceScore = this.calculateConfidenceScore({
      profitabilityScore: winRateRR.profitabilityScore,
      evConfidence: evGate.confidenceLevel,
      edgeStrength: kelly.edgeStrength,
      scalingConfidence: riskScaling.confidenceLevel
    });

    // Generate overall reasoning
    const overallReasoning = this.generateOverallReasoning({
      approved,
      finalLotSize,
      finalRiskPercent,
      baseRiskPercent,
      riskScore,
      confidenceScore,
      kelly,
      evGate,
      marketCondition,
      correlation
    });

    // Add general recommendations
    if (confidenceScore >= 80) {
      recommendations.push('✅ High confidence setup - proceed with recommended size');
    } else if (confidenceScore >= 60) {
      recommendations.push('Good setup - standard execution');
    } else {
      recommendations.push('⚠️ Lower confidence - consider reducing size further');
    }

    if (riskScore >= 70) {
      recommendations.push('⚠️ High risk environment - be extra cautious');
    }

    return {
      approved,
      recommendedLotSize: finalLotSize,
      adjustedRiskPercent: finalRiskPercent,
      riskScore,
      confidenceScore,
      criticalWarnings,
      recommendations,
      detailedBreakdown: {
        kelly,
        evGate,
        volatility,
        correlation,
        drawdown: drawdownCheck,
        marketCondition,
        winRateRR,
        riskScaling
      },
      overallReasoning
    };
  }

  private buildRejectionResponse(
    reason: string,
    details: string,
    recommendations: string[],
    breakdown: any
  ): ComprehensiveRiskAssessment {
    return {
      approved: false,
      recommendedLotSize: 0,
      adjustedRiskPercent: 0,
      riskScore: 100,
      confidenceScore: 0,
      criticalWarnings: [`🛑 TRADE REJECTED: ${reason}`, details],
      recommendations,
      detailedBreakdown: breakdown,
      overallReasoning: `Trade rejected due to ${reason}. ${details}`
    };
  }

  private calculateRiskScore(inputs: {
    drawdownLevel: number;
    volatilityState: string;
    correlationRisk: number;
    sessionQuality: number;
    evConfidence: string;
  }): number {
    let score = 0;

    // Drawdown component (0-30 points)
    score += inputs.drawdownLevel * 150; // 20% drawdown = 30 points

    // Volatility component (0-25 points)
    const volatilityScores = {
      'very-low': 5,
      'low': 10,
      'normal': 15,
      'high': 20,
      'very-high': 25
    };
    score += volatilityScores[inputs.volatilityState as keyof typeof volatilityScores] || 15;

    // Correlation component (0-25 points)
    score += inputs.correlationRisk * 25;

    // Session quality component (0-15 points, inverted)
    score += (1 - inputs.sessionQuality) * 15;

    // EV confidence component (0-5 points, inverted)
    const evScores = { 'high': 0, 'medium': 2, 'low': 4, 'very-low': 5 };
    score += evScores[inputs.evConfidence as keyof typeof evScores] || 3;

    return Math.min(100, Math.max(0, score));
  }

  private calculateConfidenceScore(inputs: {
    profitabilityScore: number;
    evConfidence: string;
    edgeStrength: string;
    scalingConfidence: string;
  }): number {
    let score = 0;

    // Profitability score (0-40 points)
    score += inputs.profitabilityScore * 0.4;

    // EV confidence (0-25 points)
    const evScores = { 'high': 25, 'medium': 18, 'low': 10, 'very-low': 5 };
    score += evScores[inputs.evConfidence as keyof typeof evScores] || 15;

    // Edge strength (0-20 points)
    const edgeScores = { 'strong': 20, 'moderate': 15, 'weak': 8, 'negative': 0 };
    score += edgeScores[inputs.edgeStrength as keyof typeof edgeScores] || 10;

    // Scaling confidence (0-15 points)
    const scalingScores = { 'high': 15, 'medium': 10, 'low': 5 };
    score += scalingScores[inputs.scalingConfidence as keyof typeof scalingScores] || 10;

    return Math.min(100, Math.max(0, score));
  }

  private generateOverallReasoning(inputs: any): string {
    const {
      approved,
      finalLotSize,
      finalRiskPercent,
      baseRiskPercent,
      riskScore,
      confidenceScore,
      kelly,
      evGate,
      marketCondition,
      correlation
    } = inputs;

    let reasoning = `${approved ? '✅ TRADE APPROVED' : '❌ TRADE REJECTED'}. `;
    reasoning += `Recommended lot size: ${finalLotSize.toFixed(2)} lots. `;
    reasoning += `Risk: ${(finalRiskPercent * 100).toFixed(2)}% `;

    if (finalRiskPercent !== baseRiskPercent) {
      reasoning += `(adjusted from ${(baseRiskPercent * 100).toFixed(2)}%) `;
    }

    reasoning += `Risk Score: ${riskScore.toFixed(0)}/100. `;
    reasoning += `Confidence: ${confidenceScore.toFixed(0)}/100. `;
    reasoning += `Kelly edge: ${kelly.edgeStrength}. `;
    reasoning += `EV: ${evGate.expectedValue.toFixed(1)} pips/trade (${evGate.confidenceLevel}). `;
    reasoning += `Session: ${marketCondition.sessionQuality}. `;
    reasoning += `Correlation risk: ${(correlation.totalCorrelationRisk * 100).toFixed(0)}%.`;

    return reasoning;
  }

  async validateGoal(inputs: GoalFeasibilityInputs): Promise<any> {
    return await goalFeasibilityValidator.validateGoal(inputs);
  }

  async checkTotalExposure(
    userId: string,
    accountBalance: number,
    newTradeRiskDollars?: number
  ): Promise<{
    canTrade: boolean;
    currentExposurePercent: number;
    remainingCapacityPercent: number;
    remainingCapacityDollars: number;
    blockReason?: string;
  }> {
    const { supabase } = await import('../lib/supabase');

    const { data: openPositions, error } = await supabase
      .from('positions')
      .select('risk_amount, symbol')
      .eq('user_id', userId)
      .eq('status', 'open');

    if (error) {
      console.error('[Professional Risk Manager] Error fetching open positions:', error);
      return {
        canTrade: true,
        currentExposurePercent: 0,
        remainingCapacityPercent: 10,
        remainingCapacityDollars: accountBalance * 0.1,
      };
    }

    const currentTotalRisk = openPositions?.reduce(
      (sum, pos) => sum + (pos.risk_amount || 0),
      0
    ) || 0;

    const proposedTotalRisk = newTradeRiskDollars
      ? currentTotalRisk + newTradeRiskDollars
      : currentTotalRisk;

    const currentExposurePercent = (currentTotalRisk / accountBalance) * 100;
    const proposedExposurePercent = (proposedTotalRisk / accountBalance) * 100;

    // SSOT: Platform maximum total exposure from trading-constants.ts (20%)
    const maxExposurePercent = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_TOTAL_EXPOSURE * 100;
    const canTrade = proposedExposurePercent <= maxExposurePercent;

    const remainingCapacityPercent = Math.max(
      0,
      maxExposurePercent - currentExposurePercent
    );
    const remainingCapacityDollars = (remainingCapacityPercent / 100) * accountBalance;

    console.log('[Professional Risk Manager] 📊 Total Exposure Check:', {
      currentExposurePercent: currentExposurePercent.toFixed(2) + '%',
      proposedExposurePercent: proposedExposurePercent.toFixed(2) + '%',
      canTrade,
      openPositionCount: openPositions?.length || 0,
    });

    return {
      canTrade,
      currentExposurePercent,
      remainingCapacityPercent,
      remainingCapacityDollars,
      blockReason: canTrade
        ? undefined
        : `Total exposure would exceed ${maxExposurePercent}% maximum (current: ${currentExposurePercent.toFixed(1)}%, proposed: ${proposedExposurePercent.toFixed(1)}%)`,
    };
  }
}

export const professionalRiskManager = new ProfessionalRiskManager();
