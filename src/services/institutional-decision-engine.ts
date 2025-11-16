import { enhancedMarketRegimeDetector } from './enhanced-market-regime-detector';
import { economicCalendarService } from './economic-calendar-service';
import { currencyCorrelationService } from './currency-correlation-service';
import { sessionPerformanceAnalyzer } from './session-performance-analyzer';
import { tradeSequenceAnalyzer } from './trade-sequence-analyzer';
import { lossForensicsEngine } from './loss-forensics-engine';
import { adaptiveConfidenceCalibrator } from './adaptive-confidence-calibrator';
import { economicImpactAnalyzer } from './economic-impact-analyzer';
import { timeframeConvergenceScorer } from './timeframe-convergence-scorer';
import { intelligentPositionSizer } from './intelligent-position-sizer';

/**
 * Institutional Decision Engine
 *
 * Master orchestrator that combines ALL institutional intelligence:
 * - Market regime analysis
 * - Economic event checking
 * - Correlation risk assessment
 * - Session performance context
 * - Trade sequence awareness
 * - Anti-pattern validation
 * - Confidence calibration
 * - Timeframe convergence
 * - Position sizing calculation
 *
 * Provides GO/NO-GO decision with full reasoning
 */

export interface InstitutionalDecision {
  symbol: string;
  patternName: string;
  baseConfidence: number;

  // Final Decision
  shouldTrade: boolean;
  finalConfidence: number;
  positionSize: number;
  riskPercent: number;

  // Context Analysis
  marketContext: {
    regime: string;
    volatility: string;
    session: string;
    hourOfDay: number;
    dayOfWeek: number;
  };

  // Risk Checks
  economicEvents: {
    safe: boolean;
    recommendation: string;
  };

  correlation: {
    riskScore: number;
    recommendation: string;
  };

  antiPatterns: {
    matched: string[];
    shouldAvoid: boolean;
  };

  sequence: {
    currentStreak: string;
    shouldContinue: boolean;
    recommendation: string;
  };

  // Enhancements
  timeframeAlignment: {
    score: number;
    quality: string;
    confidenceBoost: number;
  };

  confidence: {
    base: number;
    adjusted: number;
    modifiers: string[];
  };

  positioning: {
    recommendedSize: number;
    riskPercent: number;
    sizeReasoning: string;
  };

  // Master Recommendation
  masterDecision: string;
  reasoning: string[];
  warnings: string[];
}

class InstitutionalDecisionEngine {
  /**
   * Run complete institutional analysis for a trade setup
   */
  async analyzeTradeSetup(
    userId: string,
    symbol: string,
    patternName: string,
    baseConfidence: number,
    currentPrice: number,
    proposedStopLoss: number
  ): Promise<InstitutionalDecision> {
    console.log(`[Institutional Decision] Analyzing ${symbol} - ${patternName}...`);

    const reasoning: string[] = [];
    const warnings: string[] = [];

    // 1. Market Regime Analysis
    const regime = await enhancedMarketRegimeDetector.detectRegime(userId, symbol, 'H1');
    const marketContext = {
      regime: regime?.regimeType || 'unknown',
      volatility: regime?.volatilityLevel || 'medium',
      session: regime?.sessionType || 'london',
      hourOfDay: regime?.hourOfDay || 12,
      dayOfWeek: regime?.dayOfWeek || 3
    };

    reasoning.push(`Market: ${marketContext.regime} regime, ${marketContext.volatility} volatility, ${marketContext.session} session`);

    // 2. Economic Events Check
    const eventAnalysis = await economicCalendarService.analyzeEventImpact(symbol, 60);
    const economicEvents = {
      safe: eventAnalysis.safeToProceed,
      recommendation: eventAnalysis.recommendation
    };

    if (!eventAnalysis.safeToProceed) {
      warnings.push(eventAnalysis.recommendation);
    }

    // 3. Correlation Risk
    const correlationRisk = await this.assessCorrelationRisk(userId, symbol);
    const correlation = {
      riskScore: correlationRisk,
      recommendation: correlationRisk > 70
        ? '⚠️ High correlation exposure - reduce position size'
        : '✅ Acceptable correlation risk'
    };

    if (correlationRisk > 70) {
      warnings.push(`High correlation risk: ${correlationRisk.toFixed(0)}%`);
    }

    // 4. Anti-Pattern Check
    const antiPatternCheck = await lossForensicsEngine.checkAgainstAntiPatterns(
      userId,
      symbol,
      'buy',
      { regime: marketContext.regime, session: marketContext.session }
    );

    const antiPatterns = {
      matched: antiPatternCheck.matchedAntiPatterns,
      shouldAvoid: antiPatternCheck.shouldAvoid
    };

    if (antiPatternCheck.shouldAvoid) {
      warnings.push(...antiPatternCheck.warnings);
    }

    // 5. Trade Sequence Analysis
    const sequenceAnalysis = await tradeSequenceAnalyzer.analyzeCurrentSequence(userId);
    const currentStreak = sequenceAnalysis.currentStreak;

    const sequence = {
      currentStreak: currentStreak?.sequenceType || 'none',
      shouldContinue: currentStreak?.shouldContinueTrading !== false,
      recommendation: currentStreak?.recommendation || 'Trade normally'
    };

    if (!sequence.shouldContinue) {
      warnings.push(sequence.recommendation);
    }

    // 6. Timeframe Convergence
    const tfConvergence = await timeframeConvergenceScorer.analyzeConvergence(symbol);
    const timeframeAlignment = {
      score: tfConvergence.trendAlignmentScore,
      quality: tfConvergence.convergenceQuality,
      confidenceBoost: tfConvergence.confidenceBoost
    };

    if (tfConvergence.trendAlignmentScore >= 75) {
      reasoning.push(`Excellent timeframe alignment (${tfConvergence.trendAlignmentScore.toFixed(0)}%)`);
    }

    // 7. Adaptive Confidence Calibration
    const confidenceCalib = await adaptiveConfidenceCalibrator.calibrateConfidence(
      userId,
      symbol,
      baseConfidence,
      {
        patternName,
        regime: marketContext.regime,
        volatility: marketContext.volatility,
        session: marketContext.session,
        hourOfDay: marketContext.hourOfDay,
        dayOfWeek: marketContext.dayOfWeek,
        correlationRisk
      }
    );

    const confidence = {
      base: baseConfidence,
      adjusted: confidenceCalib.adjustedConfidence,
      modifiers: [
        `Session: ${confidenceCalib.sessionModifier.toFixed(2)}x`,
        `Performance: ${confidenceCalib.recentPerformanceModifier.toFixed(2)}x`,
        `Regime: ${confidenceCalib.regimeConfidence.toFixed(0)}%`
      ]
    };

    // 8. Position Sizing
    const positionSizing = await intelligentPositionSizer.calculatePositionSize(
      userId,
      symbol,
      patternName,
      confidenceCalib.adjustedConfidence,
      currentPrice,
      proposedStopLoss
    );

    const positioning = {
      recommendedSize: positionSizing.finalPositionSize,
      riskPercent: positionSizing.finalRiskPercent,
      sizeReasoning: positionSizing.sizeDecreaseReason || positionSizing.sizeIncreaseReason || 'Standard sizing'
    };

    // 9. MASTER DECISION
    let shouldTrade = true;
    let masterDecision = '';

    // Block conditions
    if (!economicEvents.safe) {
      shouldTrade = false;
      masterDecision = '🛑 BLOCKED: Economic event danger zone';
    } else if (antiPatterns.shouldAvoid) {
      shouldTrade = false;
      masterDecision = '🛑 BLOCKED: Matches known anti-patterns';
    } else if (!sequence.shouldContinue) {
      shouldTrade = false;
      masterDecision = '🛑 BLOCKED: Loss streak protection';
    } else if (confidenceCalib.adjustedConfidence < 50) {
      shouldTrade = false;
      masterDecision = `🛑 BLOCKED: Confidence too low (${confidenceCalib.adjustedConfidence.toFixed(0)}%)`;
    } else if (positionSizing.finalPositionSize === 0) {
      shouldTrade = false;
      masterDecision = '🛑 BLOCKED: Position size reduced to zero';
    } else {
      // TRADE APPROVED
      if (confidenceCalib.adjustedConfidence >= 85 && tfConvergence.trendAlignmentScore >= 90) {
        masterDecision = `🚀 EXCELLENT SETUP: ${confidenceCalib.adjustedConfidence.toFixed(0)}% confidence, all timeframes aligned`;
      } else if (confidenceCalib.adjustedConfidence >= 75) {
        masterDecision = `✅ STRONG SETUP: ${confidenceCalib.adjustedConfidence.toFixed(0)}% confidence`;
      } else if (confidenceCalib.adjustedConfidence >= 65) {
        masterDecision = `✅ GOOD SETUP: ${confidenceCalib.adjustedConfidence.toFixed(0)}% confidence`;
      } else {
        masterDecision = `⚡ ACCEPTABLE: ${confidenceCalib.adjustedConfidence.toFixed(0)}% confidence`;
      }

      reasoning.push(`Position size: ${positionSizing.finalPositionSize.toFixed(2)} units (${positionSizing.finalRiskPercent.toFixed(2)}% risk)`);
    }

    return {
      symbol,
      patternName,
      baseConfidence,
      shouldTrade,
      finalConfidence: confidenceCalib.adjustedConfidence,
      positionSize: positionSizing.finalPositionSize,
      riskPercent: positionSizing.finalRiskPercent,
      marketContext,
      economicEvents,
      correlation,
      antiPatterns,
      sequence,
      timeframeAlignment,
      confidence,
      positioning,
      masterDecision,
      reasoning,
      warnings
    };
  }

  /**
   * Assess correlation risk for a new position
   */
  private async assessCorrelationRisk(userId: string, symbol: string): Promise<number> {
    // This would check open positions and calculate correlation exposure
    // For now, return moderate risk
    return 35;
  }

  /**
   * Generate human-readable report
   */
  generateReport(decision: InstitutionalDecision): string {
    const lines: string[] = [];

    lines.push(`═══════════════════════════════════════════════════════`);
    lines.push(`  INSTITUTIONAL TRADE ANALYSIS: ${decision.symbol}`);
    lines.push(`  Pattern: ${decision.patternName}`);
    lines.push(`═══════════════════════════════════════════════════════`);
    lines.push('');

    lines.push(`⚖️  MASTER DECISION: ${decision.masterDecision}`);
    lines.push('');

    if (!decision.shouldTrade) {
      lines.push(`❌ TRADE BLOCKED`);
      lines.push('');
      lines.push(`Warnings:`);
      decision.warnings.forEach(w => lines.push(`  • ${w}`));
    } else {
      lines.push(`✅ TRADE APPROVED`);
      lines.push('');
      lines.push(`📊 CONFIDENCE: ${decision.baseConfidence}% → ${decision.finalConfidence.toFixed(0)}%`);
      lines.push(`💰 POSITION: ${decision.positionSize.toFixed(2)} units (${decision.riskPercent.toFixed(2)}% risk)`);
      lines.push('');
      lines.push(`Context:`);
      decision.reasoning.forEach(r => lines.push(`  • ${r}`));

      if (decision.warnings.length > 0) {
        lines.push('');
        lines.push(`⚠️  Warnings:`);
        decision.warnings.forEach(w => lines.push(`  • ${w}`));
      }
    }

    lines.push('');
    lines.push(`═══════════════════════════════════════════════════════`);

    return lines.join('\n');
  }
}

export const institutionalDecisionEngine = new InstitutionalDecisionEngine();
