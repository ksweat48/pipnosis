/**
 * Alpha Coordinator - The Decision Maker
 *
 * Responsibilities:
 * - Collect votes from 6 Omega specialists
 * - Weight votes by confidence and trader personality
 * - Adjust weights based on market regime
 * - Make final arbitrated decision
 * - Handle conflicts intelligently
 *
 * Uses ultra-compressed prompts for cost efficiency
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALPHA FINAL AUTHORITY PRINCIPLE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Alpha is the ONLY decision-maker. No rule-based system may block trades.
 *
 * Authority Hierarchy:
 * 0. Freshness Gate = P0 CIRCUIT BREAKER (operates BEFORE Alpha)
 *    - Validates intelligence age (Omega/Alpha cache)
 *    - Validates price drift (signal vs current)
 *    - Validates realtime price freshness
 *    - BLOCKS execution if data is stale (P0 safety)
 *    - This is NOT a trading decision, it's data integrity
 *
 * 1. Rule-based modules (Regime Oracle, Adversarial Detector) = ADVISORS ONLY
 *    - Provide risk modifiers (0.55x - 1.0x confidence)
 *    - Flag dangerous conditions
 *    - CANNOT block trades
 *
 * 2. Omega Council (6 specialists) = Technical advisors
 *    - Vote with confidence levels
 *    - Provide domain expertise
 *    - CANNOT block trades
 *
 * 3. Alpha Coordinator = FINAL AUTHORITY (THIS MODULE)
 *    - Synthesizes ALL inputs
 *    - Chooses symbol, direction, SL/TP
 *    - Decides IF trade should happen
 *    - Can override any recommendation if justified
 *
 * 4. Omega-9 Hallucination = ONLY safety module allowed to block (after Alpha)
 *    - Validates execution parameters AFTER Alpha decides
 *    - Blocks only catastrophic errors
 *    - Ensures R:R ratios, position sizing
 *
 * Dead Zone Example:
 * - EURUSD at 22:00 UTC (dead zone):
 *   - Regime Oracle: "55% confidence multiplier (low liquidity)"
 *   - Omega Risk: "NO_TRADE - spread risk high"
 *   - Alpha: Sees full context, decides trade is still valid
 *   - Result: Trade executes with reduced position size
 *
 * - USDJPY at 23:00 UTC (Tokyo active):
 *   - Regime Oracle: "100% confidence (Tokyo session active)"
 *   - No dead zone penalty applied
 *   - Alpha proceeds normally
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import { openAIClient } from '../services/openai-client';
import { sanitizeAndParse, tryParseLLMResponse } from '../services/llm-response-sanitizer';
import type { OmegaVote } from './omega/trend';
import type { Omega8Vote, Omega9ValidationResult } from '../types/omega';
import type { TraderScore } from '../services/ai-identity';
import { omega9Hallucination, type Omega9Input } from './omega9-hallucination-brain';
import { omega10Scheduler } from '../services/omega10-scheduler';
import { llmTokenTracker } from '../services/llm-token-tracker';
import { globalIntelligenceProvider } from '../services/global-intelligence-provider';
import { professionalRiskManager } from '../services/professional-risk-manager';
import { alphaIntelligenceAggregator, type AlphaIntelligenceSnapshot } from '../services/alpha-intelligence-aggregator';
import { alphaLearningFeedback } from '../services/alpha-learning-feedback';
import { alphaThoughtStream } from '../services/alpha-thought-stream';
import type { ATRValue } from '../types/atr';
import { supabase } from '../lib/supabase';
import type { AdversarialSignal } from '../services/adversarial-detector';
import type { RegimeSnapshot } from '../services/regime-oracle';
import { rrSuccessTracker } from '../services/rr-success-tracker';
import { formatRiskProfileForLLM, getOmegaWeights } from '../config/risk-strategy-profiles';
import { timeToFillCalculator, type TimeToFillInput } from '../services/time-to-fill-calculator';
import { dailyNarrativeBuilder, type DailyNarrative } from '../services/daily-narrative-builder';
import { multiSymbolRanker, type SymbolScore } from '../services/multi-symbol-ranker';
import { riskAwareStopCalculator, type StopLossCalculation } from '../services/risk-aware-stop-calculator';
import { multiTimeframePatternIntelligence, type PatternIntelligenceResult } from '../services/multi-timeframe-pattern-intelligence';
import { patternLiquidityAdapter } from '../services/pattern-liquidity-adapter';
import { eliteProfitTargetCalculator, type LiquidityZone, type TPCalculationResult } from '../services/profit-target-calculator';
import { tp1ProbabilityCalculator, type TP1Result } from '../services/tp1-probability-calculator';
import { calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { EntryIntentClassifier } from '../services/entry-intent-classifier';
import { omega9ConstraintProvider } from '../services/omega9-constraint-provider';
import { alphaRevisionHandler } from '../services/alpha-revision-handler';
import type { Omega9Constraints } from '../types/omega9-constraints';
import { getRecommendedConsensusCount, calculateConsensusStrengthModifier, getConsensusDescription } from '../services/omega-consensus-advisory';
import { tradeExecutionFreshnessGate } from '../services/trade-execution-freshness-gate';
import { tradeFeasibilityResolver } from '../services/trade-feasibility-resolver';
import type { AssetClass, TradeStyle as FeasibilityTradeStyle } from '../types/trade-feasibility-resolver.types';
import { isCrypto, isIndex, isXAUUSD } from '../utils/currencyHelpers';
import { calculateSessionContext } from '../utils/marketHours';
import type { EntrySpec, AlphaOutputFormat, StyleDisplayName } from '../types/entry';
import { ALPHA_IDENTITY, getAlphaSystemPrompt, getEntryMode } from '../config/alpha-identity';
import { getDisplayNameFromStyle } from '../config/trade-styles';
import { getStylePromptContext } from '../config/style-personalities';
import { microRegimeClassifier, type MicroRegimeClassification, type MicroRegimeCandle } from '../services/micro-regime-classifier';
import { liquidityIntentAnalyzer, type LiquidityIntentModel } from '../services/liquidity-intent-analyzer';
import { narrativeCoherenceValidator, type NarrativeValidation } from '../services/narrative-coherence-validator';
import { logViolation } from '../services/ssot-violation-logger';
import { sharedIntelligenceCoordinator } from '../services/shared-intelligence-coordinator';
import { extractRegimeSignature } from '../services/regime-signature-extractor';
import { parseStructuredAlphaResponse } from '../services/alpha-thesis-parser';
import type { AlphaMarketThesis, RegimeSignature } from '../types/alpha-thesis';
import { m5SwingAnalyzer, type M5SwingContext } from '../services/m5-swing-analyzer';
import { alphaGeometryValidator } from '../services/alpha-geometry-validator';
import { getExecutionEnvelope, validateTPSLAgainstEnvelope } from '../config/style-execution-envelopes';
import { TRADING_CONSTANTS } from '../config/trading-constants';

/**
 * Helper: Determine asset class from symbol
 */
function getAssetClass(symbol: string): AssetClass {
  if (isCrypto(symbol)) return 'CRYPTO';
  if (isIndex(symbol)) return 'INDEX';
  if (isXAUUSD(symbol)) return 'METAL';
  return 'FOREX';
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * DECOUPLED RISK AND STYLE
 * ═══════════════════════════════════════════════════════════════════
 *
 * CRITICAL ARCHITECTURAL CHANGE:
 * Risk and Style are now INDEPENDENT dimensions:
 *
 * RISK MODE (controls MONEY exposure):
 * - HIGH: 8-10% max session loss, 0.5:1 min R:R, 50% confidence penalty cap
 * - MEDIUM: 5-7% max session loss, 1.0:1 min R:R, 40% confidence penalty cap
 * - LOW: 2-4% max session loss, 1.2:1 min R:R, 30% confidence penalty cap
 *
 * TRADE STYLE (controls TIME preference):
 * - SCALP: 20 minutes to 2 hours expected duration
 * - MICRO_INTRADAY: 1 hour to 6 hours expected duration
 * - INTRADAY: 2 hours to 10 hours expected duration
 * - SWING: Multi-session (days)
 *
 * Philosophy:
 * - A user can be HIGH risk (aggressive money) with SWING style (patient timing)
 * - A user can be LOW risk (conservative money) with SCALP style (quick timing)
 * - Risk defines position size and loss tolerance
 * - Style defines hold time and session constraints (advisory only)
 *
 * Default Style Selection (when user doesn't specify):
 * - Based on session context and time availability
 * - NOT based on risk mode
 * ═══════════════════════════════════════════════════════════════════
 */

export interface OmegaCouncilVotes {
  trend: OmegaVote | null;
  scalper: OmegaVote | null;
  confirmation: OmegaVote | null;
  reversal: OmegaVote | null;
  volatility: OmegaVote | null;
  risk: OmegaVote | null;
  omega8: Omega8Vote | null;
}

export interface MarketContext {
  symbol: string;
  regime: string;      // bull/bear/side
  volatility: string;  // low/med/high
  price: number;
  /**
   * Average True Range with explicit timeframe tracking
   * Now uses typed ATRValue for SSOT compliance
   * See /src/types/atr.ts for details
   *
   * ⚠️ Always stored as price difference - convert to pips using: atrPips = atr / pipValue
   */
  atr: number | ATRValue; // Accept both during migration period
  atr20?: number | ATRValue;  // Short-term ATR (typically M5 or M15) for volatility regime detection
  atr100?: number | ATRValue; // Long-term ATR (typically H1 or H4) for volatility regime detection
}

export interface GoalContext {
  hasGoal: boolean;
  currentBalance: number;
  targetGoal: number;
  currentProgress: number;
  remainingGoal: number;
  goalPercentage: number; // e.g., 0.077% for $200 from $258k
  pipsNeededEstimate: number; // Rough estimate for context
  riskMode?: 'low' | 'medium' | 'high'; // User's selected risk tolerance
  riskPercent?: number; // Actual risk percentage (3%, 5%, 10%)
  sessionId?: string; // Goal session ID for progress thought emissions (optional)
  tradeStyle?: string; // User's selected trade style from goal session (scalper, micro, intraday)
}

export interface AlphaOverride {
  override_type: 'adversarial_block' | 'regime_avoid' | 'risk_limit' | 'drawdown_stop' | 'correlation_limit' | 'manipulation_block';
  original_recommendation: string;
  alpha_decision: string;
  statistical_justification: string;
  expected_edge: number;
}

export interface AlphaDecision {
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  decision: 'BUY' | 'SELL' | 'NO_TRADE';
  entry: number;
  stopLoss: number;
  takeProfit: number; // Legacy field - maps to tp2Price
  tp1Price?: number | null; // Conservative high-probability target (80%+ likely)
  tp1Confidence?: number; // 0-100 probability score for TP1
  tp1Reasoning?: string; // Alpha's explanation for TP1 placement
  tp2Price?: number; // Full profit target (standard TP)
  tp2Reasoning?: string; // Alpha's explanation for TP2 placement
  confidence: number;
  reasoning: string;
  omega_summary: string;
  omega_votes?: OmegaCouncilVotes;
  omega8_liquidity_bias?: string;
  omega8_direction_support?: string;
  omega9_validation?: Omega9ValidationResult;
  omega10_applied?: boolean;
  symbol?: string;
  timestamp?: Date;
  risk_pct?: number;
  resolvedStyle?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
  omegaConsensusPercent?: number;
  expectedFillTimeHours?: number;
  atrPercent?: number;
  goal_context?: GoalContext;
  override?: AlphaOverride;
  intelligence_snapshot?: Partial<AlphaIntelligenceSnapshot>;
  adversarial_advisory?: AdversarialSignal;
  regime_advisory?: RegimeSnapshot;
  entry_spec?: EntrySpec; // NEW: Alpha's explicit entry specification
  thesis?: string; // Trade thesis type (momentum_scalp, liquidity_sweep_reversal, etc.)
  style_intent?: string; // Style intent (SCALP, MICRO_INTRADAY, INTRADAY)
  execution_preference?: string; // Execution preference (IMMEDIATE, WAIT_PULLBACK, WAIT_CONFIRMATION)
  acceptable_profit_range?: { minUSD: number; idealUSD: number }; // Expected profit range
  entry_intent?: {
    intent_type: 'immediate_momentum' | 'pullback_to_vwap' | 'pullback_to_support' | 'break_and_retest' | 'range_extreme' | 'retest_structure';
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    entry_zone_min: number;
    entry_zone_max: number;
    timeout_minutes: number;
  };
  wait_condition?: {
    target_entry_zone_min: number;
    target_entry_zone_max: number;
    invalidation_price: number;
    wait_reasoning: string;
    expected_wait_minutes?: number;
  };
  confidenceAdjustments?: Array<{
    source: string;
    proposedMultiplier: number;
    wasApplied: boolean;
    reason: string;
  }>;
  // Phase 1-4 Upgrades: Micro-regime, Liquidity Intent, Narrative Coherence
  microRegime?: MicroRegimeClassification;
  liquidityIntent?: LiquidityIntentModel;
  narrativeValidation?: NarrativeValidation;
  // Phase 5: Multi-Timeframe Pattern Intelligence
  patternIntelligence?: {
    htfPattern: string | null;
    htfIntent: string;
    mtfPattern: string | null;
    mtfIntent: string;
    ltfPattern: string | null;
    ltfIntent: string;
    alignmentScore: number;
    overallIntent: string;
    directionBias: string;
    confidenceBoosts: Array<{ reason: string; amount: number }>;
    confidencePenalties: Array<{ reason: string; amount: number }>;
    liquidityTargets: number[];
    invalidationPoint: { price: number; reasoning: string } | null;
    warnings: string[];
  };
}

/**
 * Helper: Extract ATR value from MarketContext (supports both legacy number and typed ATRValue)
 */
function extractATRValue(atr: number | ATRValue | undefined): number {
  if (atr === undefined) return 0;
  return typeof atr === 'number' ? atr : atr.value;
}

/**
 * Helper: Extract ATR timeframe from MarketContext (if available)
 */
function extractATRTimeframe(atr: number | ATRValue | undefined): string | undefined {
  if (atr === undefined || typeof atr === 'number') return undefined;
  return atr.timeframe;
}

/**
 * Helper: Log ATR usage with timeframe info
 */
function logATRUsage(context: string, atr: number | ATRValue | undefined): void {
  const value = extractATRValue(atr);
  const timeframe = extractATRTimeframe(atr);

  if (timeframe) {
    console.log(`[Alpha Coordinator] ${context}: ${value.toFixed(5)} (${timeframe})`);
  } else {
    console.warn(`[Alpha Coordinator] ${context}: ${value.toFixed(5)} (legacy raw ATR - update to typed ATRValue)`);
  }
}

class AlphaCoordinatorBrain {
  /**
   * Calculate Omega confidence spread (standard deviation)
   * High spread = disagreement, tighten R:R
   * Low spread = consensus, can use wider R:R
   */
  private calculateConfidenceSpread(votes: OmegaCouncilVotes): {
    stdDev: number;
    avgConfidence: number;
    isHighAgreement: boolean;
  } {
    const confidences: number[] = [];

    if (votes.trend) confidences.push(votes.trend.confidence);
    if (votes.scalper) confidences.push(votes.scalper.confidence);
    if (votes.confirmation) confidences.push(votes.confirmation.confidence);
    if (votes.reversal) confidences.push(votes.reversal.confidence);
    if (votes.volatility) confidences.push(votes.volatility.confidence);
    if (votes.risk) confidences.push(votes.risk.confidence);
    if (votes.omega8) confidences.push(votes.omega8.confidence);

    if (confidences.length === 0) {
      return { stdDev: 0, avgConfidence: 0, isHighAgreement: false };
    }

    // Calculate mean
    const mean = confidences.reduce((sum, val) => sum + val, 0) / confidences.length;

    // Calculate standard deviation
    const squaredDiffs = confidences.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / confidences.length;
    const stdDev = Math.sqrt(variance);

    // High agreement = low std dev (< 10)
    const isHighAgreement = stdDev < 10;

    return { stdDev, avgConfidence: mean, isHighAgreement };
  }

  /**
   * Detect volatility expansion/compression
   * Expanding volatility = trending market, wider TP viable
   * Compressing volatility = ranging market, tighten TP
   */
  private detectVolatilityRegime(marketContext: MarketContext): {
    regime: 'expanding' | 'compressing' | 'stable';
    ratio: number;
    recommendation: string;
  } {
    // Extract ATR values (support both legacy number and typed ATRValue)
    const atr20Value = extractATRValue(marketContext.atr20);
    const atr100Value = extractATRValue(marketContext.atr100);

    // If we don't have ATR20/ATR100, return stable
    if (!atr20Value || !atr100Value) {
      return {
        regime: 'stable',
        ratio: 1.0,
        recommendation: 'Use standard R:R (2.0-2.5:1)'
      };
    }

    const ratio = atr20Value / atr100Value;

    // Log timeframe info for debugging
    const atr20Timeframe = extractATRTimeframe(marketContext.atr20);
    const atr100Timeframe = extractATRTimeframe(marketContext.atr100);
    if (atr20Timeframe && atr100Timeframe) {
      console.log(`[Alpha Volatility Regime] ATR20 (${atr20Timeframe}): ${atr20Value.toFixed(5)} | ATR100 (${atr100Timeframe}): ${atr100Value.toFixed(5)} | Ratio: ${ratio.toFixed(2)}`);
    }

    // Expanding: ATR20 > ATR100 by 15%+
    if (ratio > 1.15) {
      return {
        regime: 'expanding',
        ratio,
        recommendation: 'Volatility expanding - wider TP viable (2.5-3.5:1)'
      };
    }

    // Compressing: ATR20 < ATR100 by 15%+
    if (ratio < 0.85) {
      return {
        regime: 'compressing',
        ratio,
        recommendation: 'Volatility compressing - tighten TP (1.5-2.0:1)'
      };
    }

    return {
      regime: 'stable',
      ratio,
      recommendation: 'Volatility stable - standard R:R (2.0-2.5:1)'
    };
  }

  /**
   * Consolidate stop quality score from Omega-8 and Omega-9
   * Returns a unified quality score 0-100
   */
  private calculateStopQualityScore(
    omega8Vote: Omega8Vote | null,
    omega9Validation: Omega9ValidationResult | null
  ): {
    score: number;
    recommendation: string;
  } {
    let qualityScore = 50; // Start neutral

    // Omega-8 liquidity assessment
    if (omega8Vote) {
      if (omega8Vote.liquidity_bias === 'clean') {
        qualityScore += 25; // Well-protected stop
      } else if (omega8Vote.liquidity_bias === 'stoprun_risk') {
        qualityScore -= 30; // Exposed stop
      } else if (omega8Vote.liquidity_bias === 'reaccumulation') {
        qualityScore += 10; // Decent protection
      } else if (omega8Vote.liquidity_bias === 'distribution') {
        qualityScore -= 15; // Risky area
      }
    }

    // Omega-9 validation flags
    if (omega9Validation) {
      if (omega9Validation.pass) {
        qualityScore += 15; // Passed validation
      }
      // Penalize for each flag
      qualityScore -= (omega9Validation.flags.length * 5);
    }

    // Clamp to 0-100
    qualityScore = Math.max(0, Math.min(100, qualityScore));

    // Generate recommendation
    let recommendation = '';
    if (qualityScore >= 70) {
      recommendation = 'High quality stop - use wider TP (2.5-3.5:1)';
    } else if (qualityScore >= 40) {
      recommendation = 'Moderate stop quality - standard TP (2.0-2.5:1)';
    } else {
      recommendation = 'Exposed stop - tighten TP (1.5-2.0:1)';
    }

    return { score: qualityScore, recommendation };
  }

  /**
   * Coordinate Omega votes and make final decision
   * Alpha has FULL AUTHORITY - can override any Omega recommendation
   */
  async coordinate(
    votes: OmegaCouncilVotes,
    marketContext: MarketContext,
    traderScore: TraderScore,
    userId?: string,
    conflictInfo?: {
      hasConflict: boolean;
      conflictType: 'HARD' | 'SOFT' | 'NONE';
      severity: string;
      conflictDescription: string;
    },
    goalContext?: GoalContext,
    adversarialSignal?: AdversarialSignal,
    regimeSnapshot?: RegimeSnapshot,
    fullCandles?: any[]
  ): Promise<AlphaDecision> {
    // Extract sessionId from goalContext for progress thoughts (optional)
    const sessionId = goalContext?.sessionId;

    // Load full intelligence snapshot for comprehensive decision-making
    let intelligenceSnapshot: AlphaIntelligenceSnapshot | null = null;
    if (userId) {
      // Emit progress thought (non-blocking, advisory only)
      if (sessionId) {
        alphaThoughtStream.emitAlphaLoadingSnapshot(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit loading snapshot thought:', err);
        });
      }

      try {
        intelligenceSnapshot = await alphaIntelligenceAggregator.getFullIntelligenceSnapshot(userId, marketContext.symbol);
        console.log('[Alpha Coordinator] 🧠 Loaded full intelligence snapshot');
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to load intelligence snapshot:', error);
      }
    }

    // Declare risk mode at function scope (used throughout function)
    const riskMode = goalContext?.riskMode || 'medium';

    // Calculate vote weights (with Omega-10 overrides if available)
    const weights = await this.calculateWeights(votes, marketContext, traderScore, riskMode, userId);

    // Calculate weighted consensus score
    const consensus = this.calculateWeightedConsensus(votes, weights);
    console.log(`[Alpha Coordinator] 📊 Weighted Consensus: ${consensus.direction} ${consensus.score.toFixed(1)}% (${consensus.agreementCount}/${consensus.totalVotes} Omegas)`);

    // Calculate consensus strength modifier and advisory recommendation
    const recommendedConsensusCount = getRecommendedConsensusCount(riskMode);
    const consensusStrengthModifier = calculateConsensusStrengthModifier(consensus.agreementCount, riskMode);
    const consensusDescription = getConsensusDescription(riskMode);
    console.log(`[Alpha Coordinator] 🎯 Consensus Advisory: ${recommendedConsensusCount}/7 recommended for ${riskMode} risk | Actual: ${consensus.agreementCount}/7 | Strength Modifier: ${consensusStrengthModifier > 0 ? '+' : ''}${(consensusStrengthModifier * 100).toFixed(1)}%`);

    // Fire-and-forget thought stream emissions
    if (sessionId && userId) {
      alphaThoughtStream.emitAlphaPlatformIntel(sessionId, userId, marketContext.symbol).catch(() => {});
      alphaThoughtStream.emitAlphaNarrative(sessionId, userId, marketContext.symbol).catch(() => {});
      if (goalContext) {
        alphaThoughtStream.emitAlphaRiskCheck(sessionId, userId, marketContext.symbol).catch(() => {});
      }
    }

    // Parallelize all independent data fetches
    const [platformIntelligence, dailyNarrative, riskResult, rrResult] = await Promise.all([
      this.fetchPlatformIntelligence(marketContext.symbol),
      dailyNarrativeBuilder.build(marketContext.symbol, marketContext.price),
      (userId && goalContext) ? professionalRiskManager.evaluateTrade({
        userId,
        symbol: marketContext.symbol,
        direction: consensus.direction === 'BUY' ? 'long' : 'short',
        currentBalance: goalContext.currentBalance,
        baseRiskPercent: 0.01,
        currentATR: extractATRValue(marketContext.atr),
        goalSessionId: undefined
      }).catch(err => { console.error('[Alpha Coordinator] Failed to get risk assessment:', err); return null; }) : Promise.resolve(null),
      userId ? rrSuccessTracker.getRecentPerformanceSummary(userId, marketContext.symbol)
        .catch(err => { console.error('[Alpha Coordinator] Failed to fetch R:R performance:', err); return null; }) : Promise.resolve(null)
    ]);

    // Build risk context from parallel result
    let riskAssessment = riskResult;
    let riskContext = '';
    if (riskAssessment) {
      riskContext = `\n📊 PROFESSIONAL RISK ASSESSMENT (Advisory):\n`;
      riskContext += `Risk Score: ${riskAssessment.riskScore.toFixed(0)}/100 | Confidence: ${riskAssessment.confidenceScore.toFixed(0)}/100\n`;
      riskContext += `Recommended Lot Size: ${riskAssessment.recommendedLotSize.toFixed(2)} lots\n`;
      riskContext += `Adjusted Risk: ${(riskAssessment.adjustedRiskPercent * 100).toFixed(2)}%\n`;
      if (riskAssessment.criticalWarnings.length > 0) {
        riskContext += `⚠️ WARNINGS:\n`;
        riskAssessment.criticalWarnings.slice(0, 3).forEach((w: string) => {
          riskContext += `  - ${w}\n`;
        });
      }
      riskContext += `Reasoning: ${riskAssessment.overallReasoning}\n`;
    }

    // Build compressed context
    const context = this.buildCoordinationContext(votes, weights, marketContext, traderScore, consensus, platformIntelligence);

    // Build conflict context
    let conflictContext = '';
    if (conflictInfo && conflictInfo.hasConflict) {
      conflictContext = `\n⚠️ OMEGA CONFLICT DETECTED:\nType: ${conflictInfo.conflictType} | Severity: ${conflictInfo.severity}\n${conflictInfo.conflictDescription}\n\nYou have authority to override if justified.\n`;
    }

    // Build advisory context (Adversarial Detector + Regime Oracle)
    let advisoryContext = this.buildAdvisoryContext(adversarialSignal, regimeSnapshot);

    // Build R:R performance context from parallel result
    let rrPerformanceContext = '';
    if (rrResult && rrResult.length > 100) {
      rrPerformanceContext = `\n${rrResult}\n`;
    }

    // Calculate enhanced intelligence signals
    const confidenceSpread = this.calculateConfidenceSpread(votes);
    const volatilityRegime = this.detectVolatilityRegime(marketContext);
    const stopQuality = this.calculateStopQualityScore(votes.omega8, null); // omega9 validation happens later

    // Build goal context with RISK PROFILE STRATEGY (if trading with a goal)
    let goalContextText = '';
    let riskProfileText = '';
    if (goalContext && goalContext.hasGoal) {
      const riskPercent = goalContext.riskPercent || 5;
      const recentATR = extractATRValue(marketContext.atr) || 60; // Extract value with fallback

      // Add comprehensive risk profile strategy (riskMode already declared at function scope)
      riskProfileText = formatRiskProfileForLLM(riskMode);

      const styleDirective = goalContext.tradeStyle
        ? `\nTRADE STYLE: ${goalContext.tradeStyle.toUpperCase()} (full style identity and duration constraints provided below)\n`
        : '';
      goalContextText = `\nGOAL: $${goalContext.currentBalance.toFixed(0)} -> +$${goalContext.targetGoal.toFixed(0)} (${goalContext.goalPercentage.toFixed(3)}% gain) | Progress: $${goalContext.currentProgress.toFixed(0)}/${goalContext.targetGoal.toFixed(0)} | Remaining: $${goalContext.remainingGoal.toFixed(0)}\n${riskProfileText}${styleDirective}\n`;
    }

    // Build intelligence context
    let intelligenceContext = this.buildIntelligenceContext(intelligenceSnapshot);

    // Fetch recent trades for context (NEW FEATURE)
    let recentTradesContext = '';
    if (userId) {
      try {
        const { data: recentTrades } = await supabase
          .from('goal_session_trades')
          .select('symbol, direction, profit_loss, close_reason, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(3);

        if (recentTrades && recentTrades.length > 0) {
          recentTradesContext = `\n📈 RECENT TRADES (Last 3):\n`;
          recentTrades.forEach((trade, idx) => {
            const result = trade.profit_loss > 0 ? 'WIN' : trade.profit_loss < 0 ? 'LOSS' : 'BE';
            const emoji = result === 'WIN' ? '✅' : result === 'LOSS' ? '❌' : '⚪';
            recentTradesContext += `${idx + 1}. ${emoji} ${trade.symbol} ${trade.direction} → ${result} ($${trade.profit_loss.toFixed(2)}) - ${trade.close_reason}\n`;
          });
        }
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to fetch recent trades:', error);
      }
    }

    // Build daily narrative context for institutional intelligence
    let dailyNarrativeContext = '';
    if (dailyNarrative) {
      dailyNarrativeContext = `\n📅 DAILY NARRATIVE (Institutional Context):\n`;
      dailyNarrativeContext += `Range: ${dailyNarrative.dailyRange.toFixed(1)} pips | Position: ${dailyNarrative.rangePosition.toFixed(0)}% of range\n`;
      dailyNarrativeContext += `Daily Bias: ${dailyNarrative.dailyBias.toUpperCase()} | Structure: ${dailyNarrative.structureQuality}\n`;
      dailyNarrativeContext += `Session: ${dailyNarrative.currentSession} | ${dailyNarrative.intradayContext}\n`;
      if (dailyNarrative.liquiditySweeps.asianLowSwept || dailyNarrative.liquiditySweeps.asianHighSwept) {
        dailyNarrativeContext += `Liquidity: ${dailyNarrative.liquiditySweeps.asianLowSwept ? 'Asian low swept' : ''} ${dailyNarrative.liquiditySweeps.asianHighSwept ? 'Asian high swept' : ''}\n`;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 1: MICRO-REGIME CLASSIFICATION
    // ═══════════════════════════════════════════════════════════════════
    let microRegime: MicroRegimeClassification | null = null;
    let microRegimeContext = '';

    if (fullCandles && fullCandles.length >= 50) {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaMicroRegime(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit micro-regime thought:', err);
        });
      }
      try {
        // Convert candles to format expected by classifier
        const regimeCandles: MicroRegimeCandle[] = fullCandles.map(c => ({
          time: new Date(c.open_time).getTime(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0
        }));

        microRegime = await microRegimeClassifier.classify(regimeCandles);

        if (microRegime) {
          console.log(`[Alpha Coordinator] 🎯 Micro-Regime: ${microRegime.regime} | Direction: ${microRegime.direction} | Confidence: ${microRegime.confidence}% | Modifier: ${microRegime.confidenceModifier > 0 ? '+' : ''}${microRegime.confidenceModifier}%`);

          microRegimeContext = `\n🎯 MICRO-REGIME CLASSIFICATION:\n`;
          microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          microRegimeContext += `Regime: ${microRegime.regime.toUpperCase().replace(/_/g, ' ')} (${microRegime.confidence}% confidence)\n`;
          microRegimeContext += `Direction: ${microRegime.direction.toUpperCase()}\n`;
          microRegimeContext += `Confidence Modifier: ${microRegime.confidenceModifier > 0 ? '+' : ''}${microRegime.confidenceModifier}%\n\n`;
          microRegimeContext += `📊 Behavioral Pattern:\n${microRegime.description}\n\n`;
          microRegimeContext += `💡 Trading Adjustment:\n${microRegime.tradingAdjustment}\n\n`;
          microRegimeContext += `🔮 Expected Behavior:\n${microRegime.behavioralExpectation}\n\n`;
          microRegimeContext += `📈 Technical Indicators:\n`;
          microRegimeContext += `  • ATR Expansion: ${microRegime.indicators.atrExpansion.toFixed(2)}x\n`;
          microRegimeContext += `  • EMA Displacement: ${microRegime.indicators.emaDisplacement.toFixed(2)}%\n`;
          microRegimeContext += `  • RSI: ${microRegime.indicators.rsi.toFixed(0)}\n`;
          microRegimeContext += `  • Volume: ${microRegime.indicators.volumeProfile}\n`;
          microRegimeContext += `  • Range Compression: ${microRegime.indicators.rangeCompression.toFixed(2)}x\n`;
          microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        }
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to classify micro-regime:', error);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 2: LIQUIDITY INTENT ANALYSIS
    // ═══════════════════════════════════════════════════════════════════
    let liquidityIntent: LiquidityIntentModel | null = null;
    let liquidityIntentContext = '';

    // Analyze liquidity intent if Omega-8 detected patterns
    if (votes.omega8 && votes.omega8.patterns && fullCandles && fullCandles.length >= 10) {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaLiquidityIntent(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit liquidity intent thought:', err);
        });
      }
      try {
        const omega8Candles = fullCandles.slice(-20).map(c => ({
          time: new Date(c.open_time).getTime(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0
        }));

        const atrValue = extractATRValue(marketContext.atr);

        liquidityIntent = liquidityIntentAnalyzer.analyzeLiquidityIntent(
          votes.omega8.patterns,
          omega8Candles,
          atrValue,
          votes.omega8.sweep_details
        );

        if (liquidityIntent && liquidityIntent.overallConviction > 0) {
          console.log(`[Alpha Coordinator] 🎯 Liquidity Intent: ${liquidityIntent.trapped} | Predator: ${liquidityIntent.predatorDirection} | Conviction: ${liquidityIntent.overallConviction}%`);

          liquidityIntentContext = `\n🎯 LIQUIDITY INTENT ANALYSIS:\n`;
          liquidityIntentContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          liquidityIntentContext += `Trapped Participants: ${liquidityIntent.trapped.toUpperCase().replace(/_/g, ' ')}\n`;
          liquidityIntentContext += `Vulnerability: ${liquidityIntent.vulnerability.toUpperCase().replace(/_/g, ' ')}\n`;
          liquidityIntentContext += `Predator Direction: ${liquidityIntent.predatorDirection.toUpperCase()}\n`;
          liquidityIntentContext += `Hunt Zone Status: ${liquidityIntent.huntZoneStatus.toUpperCase()}\n`;
          liquidityIntentContext += `Cascade Distance: ${liquidityIntent.expectedCascadeDistance.toFixed(1)} ATR\n`;
          liquidityIntentContext += `Cascade Confidence: ${liquidityIntent.cascadeConfidence}%\n`;
          liquidityIntentContext += `Sweep Recency: ${liquidityIntent.sweepRecency} candles ago\n`;
          liquidityIntentContext += `Entry Window: ${liquidityIntent.optimalEntryWindow.toUpperCase().replace(/_/g, ' ')}\n`;
          liquidityIntentContext += `Overall Conviction: ${liquidityIntent.overallConviction}%\n\n`;
          liquidityIntentContext += `💡 Stop Placement Guidance:\n${liquidityIntent.stopPlacementGuidance}\n\n`;
          liquidityIntentContext += `🔮 Reasoning:\n${liquidityIntent.reasoning}\n`;
          liquidityIntentContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        }
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to analyze liquidity intent:', error);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 5: MULTI-TIMEFRAME PATTERN INTELLIGENCE
    // ═══════════════════════════════════════════════════════════════════
    let patternIntelligence: PatternIntelligenceResult | null = null;
    let patternContext = '';
    if (consensus.direction !== 'NO_TRADE' && consensus.direction !== 'MIXED') {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaPatternAnalysis(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit pattern analysis thought:', err);
        });
      }
      try {
        const tradeDirection = consensus.direction === 'BUY' ? 'long' : 'short';

        console.log('[Alpha Coordinator] 🔍 Analyzing multi-timeframe patterns...');

        // Run pattern intelligence analysis
        patternIntelligence = await multiTimeframePatternIntelligence.analyzePatterns({
          symbol: marketContext.symbol,
          riskMode,
          baseConfidence: consensus.score,
          tradeDirection,
          liquidityIntentConfirms: liquidityIntent ? liquidityIntent.overallConviction >= 70 : false,
        });

        console.log(`[Alpha Coordinator] 📊 Pattern Analysis Complete:`, {
          htfIntent: patternIntelligence.intentAnalysis.htf.intent,
          mtfIntent: patternIntelligence.intentAnalysis.mtf.intent,
          ltfIntent: patternIntelligence.intentAnalysis.ltf.intent,
          alignment: patternIntelligence.intentAnalysis.alignmentScore,
          confidenceAdjustment: patternIntelligence.confidenceAdjustment.totalAdjustment,
          finalConfidence: patternIntelligence.finalConfidence,
        });

        // Format for LLM prompt
        patternContext = '\n' + multiTimeframePatternIntelligence.formatForAlphaPrompt(patternIntelligence);

      } catch (error) {
        console.error('[Alpha Coordinator] Failed to analyze patterns:', error);
      }
    }

    // Detect liquidity zones for Elite TP System (now enhanced with pattern intelligence)
    let liquidityZones: LiquidityZone[] = [];
    let liquidityContext = '';
    if (fullCandles && fullCandles.length > 0 && consensus.direction !== 'NO_TRADE' && consensus.direction !== 'MIXED') {
      const direction = consensus.direction === 'BUY' ? 'long' : 'short';
      liquidityZones = eliteProfitTargetCalculator.detectLiquidityZones(
        fullCandles,
        marketContext.price,
        direction
      );

      // Enhance liquidity zones with pattern-identified targets
      if (patternIntelligence && patternIntelligence.liquidityTargets.length > 0) {
        const patternZones = patternLiquidityAdapter.convertToLiquidityZones(
          patternIntelligence,
          marketContext.symbol,
          marketContext.price
        );

        // Merge pattern zones with standard liquidity zones (dedupe by price)
        for (const patternZone of patternZones) {
          const isDuplicate = liquidityZones.some(
            z => Math.abs(z.price - patternZone.price) < patternZone.price * 0.001
          );
          if (!isDuplicate) {
            liquidityZones.push(patternZone);
          }
        }

        console.log(`[Alpha Coordinator] 🎯 Added ${patternZones.length} pattern liquidity zones to standard zones`);
      }

      if (liquidityZones.length > 0) {
        liquidityContext = `\n🎯 ELITE TP SYSTEM - LIQUIDITY ZONES:\n`;
        liquidityContext += `Direction: ${direction.toUpperCase()}\n`;
        liquidityZones.slice(0, 5).forEach((zone, idx) => {
          liquidityContext += `${idx + 1}. ${zone.type.toUpperCase()} @ ${zone.price.toFixed(5)} (${zone.distance_pips.toFixed(1)} pips, ${zone.strength})\n`;
        });
        liquidityContext += `Use these zones for TP placement (prioritize strong liquidity pools)\n`;
      }
    }

    // Detect market volatility level (needed by both SL and TP calculations)
    let marketVolatilityLevel: 'low' | 'normal' | 'high' = 'normal';
    if (marketContext.volatility === 'high') {
      marketVolatilityLevel = 'high';
    } else if (marketContext.volatility === 'low') {
      marketVolatilityLevel = 'low';
    }

    // Calculate professional stop-loss anchor for Alpha
    let stopLossAnchor: StopLossCalculation | null = null;
    let stopLossDirective = '';
    if (consensus.direction !== 'NO_TRADE' && consensus.direction !== 'MIXED') {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaStopCalculation(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit stop calculation thought:', err);
        });
      }
      const entryPrice = marketContext.price;
      const direction = consensus.direction === 'BUY' ? 'buy' : 'sell';

      // riskMode already declared at function scope
      // Extract ATR value for stop loss calculation
      const atrForStopLoss = extractATRValue(marketContext.atr);
      logATRUsage('Stop-Loss calculation', marketContext.atr);

      stopLossAnchor = riskAwareStopCalculator.calculateStopLoss({
        symbol: marketContext.symbol,
        entryPrice,
        direction,
        riskMode,
        atr: atrForStopLoss, // Pass raw value for backward compatibility
        marketVolatility: marketVolatilityLevel
      });

      console.log(`[Alpha Coordinator] 🎯 Stop-Loss Anchor Calculated: ${stopLossAnchor.stopLossPrice.toFixed(5)} (${stopLossAnchor.stopLossPips.toFixed(1)} pips, ${stopLossAnchor.atrMultiplier.toFixed(2)}x ATR)`);
    }

    // ✅ FEASIBILITY RESOLVER (SSOT) - Runs BEFORE constraint generation
    // Validates if requested style/risk is feasible given current market conditions
    let feasibilityResult = null;
    let resolvedPlan = null;
    let computedAtrPercent = 0;

    if (consensus.direction !== 'NO_TRADE' && consensus.direction !== 'MIXED' && consensus.direction !== 'WAIT') {
      const assetClass = getAssetClass(marketContext.symbol);

      // SSOT: Use user's chosen style for feasibility check (same as tradeStyle resolved above)
      const PRE_STYLE_MAP: Record<string, 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'> = {
        'scalper': 'SCALP', 'SCALPER': 'SCALP', 'scalp': 'SCALP', 'SCALP': 'SCALP',
        'micro': 'MICRO_INTRADAY', 'MICRO': 'MICRO_INTRADAY', 'MICRO_INTRADAY': 'MICRO_INTRADAY',
        'intraday': 'INTRADAY', 'INTRADAY': 'INTRADAY', 'day': 'INTRADAY',
      };
      const requestedStyle = goalContext?.tradeStyle
        ? (PRE_STYLE_MAP[goalContext.tradeStyle] || 'SCALP')
        : 'SCALP';

      const atrValue = extractATRValue(marketContext.atr);
      const atrPercent = (atrValue / marketContext.price) * 100;
      computedAtrPercent = atrPercent;
      logATRUsage('Feasibility check', marketContext.atr);

      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaFeasibility(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit feasibility thought:', err);
        });
      }

      console.log(`[Alpha Coordinator] 🔍 Feasibility Check: ${requestedStyle} style with ${riskMode.toUpperCase()} risk on ${assetClass}`);
      console.log(`[Alpha Coordinator] 📊 Market ATR: ${atrValue.toFixed(5)} (${atrPercent.toFixed(3)}%)`);

      feasibilityResult = tradeFeasibilityResolver.resolve({
        symbol: marketContext.symbol,
        assetClass,
        requestedStyle,
        requestedRiskMode: riskMode.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH',
        price: marketContext.price,
        atrAbs: atrValue, // Use already extracted atrValue from above
        atrPercent,
        goalContext: goalContext ? {
          targetProfitUsd: goalContext.remainingGoal,
          maxTrades: 5,
          timeHorizon: 'TODAY'
        } : undefined,
        policy: {
          minRR: TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM,
          maxTpAtrMultiple: 12,
          minSlPercentByAssetRisk: {
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
          },
          allowAutoDowngradeRisk: true,
          allowAutoSwitchStyle: true,
          allowBoundedSlRelaxation: true
        }
      });

      console.log(`[Alpha Coordinator] ✅ Feasibility Status: ${feasibilityResult.status}`);
      console.log(`[Alpha Coordinator] 💬 ${feasibilityResult.userMessage}`);

      if (feasibilityResult.status === 'NO_TRADE') {
        console.warn('[Alpha Coordinator] ⛔ Trade blocked by feasibility resolver');
        console.warn(`[Alpha Coordinator] Blockers: ${feasibilityResult.blockers?.map(b => b.detail).join('; ')}`);

        // Return NO_TRADE decision with explanation
        return {
          action: 'NO_TRADE',
          entry: marketContext.price,
          stopLoss: 0,
          takeProfit: 0,
          confidence: 0,
          reasoning: feasibilityResult.userMessage,
          tradeQuality: 'POOR',
          adjustments: feasibilityResult.adjustments,
          constraints: null,
          hasConflict: false,
          omega9Result: null,
          conflictResolution: null,
          riskPercentage: 0,
          positionSize: 0,
          rrRatio: 0,
          estimatedDurationMinutes: 0,
          entryIntentClassification: null,
          stopLossAnchor: null,
          takeProfitCalculation: null
        };
      }

      if (feasibilityResult.status === 'ADJUSTED') {
        console.log('[Alpha Coordinator] ⚙️ Auto-adjustments applied:');
        feasibilityResult.adjustments.forEach(adj => {
          console.log(`  • ${adj.field}: ${adj.from} → ${adj.to} (${adj.reason})`);
        });
      }

      resolvedPlan = feasibilityResult.plan;
    }

    // Generate Omega-9 constraints (constraint-first approach)
    // Now receives resolved plan from feasibility resolver
    let omega9Constraints: Omega9Constraints | null = null;
    let constraintsText = '';

    // SSOT: User's chosen style is IMMUTABLE - never override with defaults
    const USER_STYLE_MAP: Record<string, 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'> = {
      'scalper': 'SCALP', 'SCALPER': 'SCALP', 'scalp': 'SCALP', 'SCALP': 'SCALP',
      'micro': 'MICRO_INTRADAY', 'MICRO': 'MICRO_INTRADAY', 'MICRO_INTRADAY': 'MICRO_INTRADAY',
      'intraday': 'INTRADAY', 'INTRADAY': 'INTRADAY', 'day': 'INTRADAY',
    };
    const userChosenStyle = goalContext?.tradeStyle
      ? USER_STYLE_MAP[goalContext.tradeStyle]
      : undefined;
    let tradeStyle: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' =
      userChosenStyle || resolvedPlan?.style || 'SCALP';

    console.log(`[Alpha Coordinator] [Style SSOT] User chose: ${goalContext?.tradeStyle || 'none'} => Canonical: ${tradeStyle} (IMMUTABLE)`);

    if (consensus.direction !== 'NO_TRADE' && consensus.direction !== 'MIXED' && consensus.direction !== 'WAIT') {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaConstraints(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit constraints thought:', err);
        });
      }

      const sessionContext = calculateSessionContext();
      console.log(`[Alpha Coordinator] Session Context: ${sessionContext.sessionName} (${sessionContext.sessionTimeRemainingMinutes}min remaining)`);

      omega9Constraints = omega9ConstraintProvider.generateConstraints({
        symbol: marketContext.symbol,
        entry: marketContext.price,
        direction: consensus.direction as 'BUY' | 'SELL',
        atr: extractATRValue(marketContext.atr),
        riskMode,
        tradeStyle,  // CRITICAL: Pass trade style for session constraint behavior
        currentSession: sessionContext.currentSession,
        sessionTimeRemainingMinutes: sessionContext.sessionTimeRemainingMinutes,
        volatilityRegime: marketContext.volatility as 'low' | 'medium' | 'high',
        proposedStopLoss: stopLossAnchor?.stopLossPrice,
        resolvedPlan: resolvedPlan ? {
          slMinPercent: resolvedPlan.sl.minPercent,
          tpMaxAtrMultiple: resolvedPlan.tp.maxAtrMultiple,
          minRR: resolvedPlan.rr.min
        } : undefined
      });

      constraintsText = omega9ConstraintProvider.formatConstraintsForPrompt(omega9Constraints);
    }

    const stylePersonality = getStylePromptContext(tradeStyle);
    const styleEnvelope = getExecutionEnvelope(tradeStyle);
    const styleIdentityPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE IDENTITY CONTRACT: ${tradeStyle}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${stylePersonality}

EXECUTION ENVELOPE (HARD CONSTRAINTS):
- Timeframe: ${styleEnvelope.timeframe}
- Target Candles: ${styleEnvelope.targetCandles.min}-${styleEnvelope.targetCandles.max}
- TP Range: ${styleEnvelope.tpPips.min}-${styleEnvelope.tpPips.max} pips
- SL Range: ${styleEnvelope.slPips.min}-${styleEnvelope.slPips.max} pips
- Expected Duration: ${styleEnvelope.typicalDuration.min}-${styleEnvelope.typicalDuration.max} minutes
- Entry Mode: ${styleEnvelope.entryMode}

DURATION FILTERING (MANDATORY):
You MUST select setups that fit within the ${tradeStyle} duration band (${styleEnvelope.typicalDuration.min}-${styleEnvelope.typicalDuration.max} min).
- BEFORE choosing TP/SL, estimate how long the trade will take to reach target
- If the best available setup would take longer than ${styleEnvelope.typicalDuration.max} minutes, return NO_TRADE
- Do NOT propose trades that belong to a longer-duration style
- Think in ${styleEnvelope.timeframe} terms: target ${styleEnvelope.targetCandles.min}-${styleEnvelope.targetCandles.max} ${styleEnvelope.timeframe} candles
- Scanner will re-evaluate next cycle if no ${tradeStyle}-appropriate setup exists now
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    // Build Elite Trader Stop-Loss Directive
    if (stopLossAnchor) {
      stopLossDirective = `

STOP-LOSS ANCHOR:
• ATR: ${extractATRValue(marketContext.atr).toFixed(5)} (${(extractATRValue(marketContext.atr) / getCurrencyPipInfo(marketContext.symbol).pipValue).toFixed(1)} pips)
• Volatility: ${marketVolatilityLevel.toUpperCase()} | Risk: ${riskMode.toUpperCase()}
• Recommended SL: ${stopLossAnchor.stopLossPrice.toFixed(5)} (${stopLossAnchor.stopLossPips.toFixed(1)} pips, ${stopLossAnchor.atrMultiplier.toFixed(2)}x ATR)
• Profile Range: ${stopLossAnchor.profileMinPips}-${stopLossAnchor.profileMaxPips} pips
• Rationale: ${stopLossAnchor.reasoning}

You may accept, tighten, widen, or relocate to a superior technical level. State why if you deviate.
Rules: Stop outside noise range, beyond structure. Min 5 pips from entry. Must survive normal price behavior.

TAKE-PROFIT RULES:
• R:R < 1.0 = Omega-9 HARD BLOCK. Target R:R >= 1.5.
• Place TP at liquidity zones (order clusters > psychological levels > structure).
• If liquidity exists beyond structure, target liquidity.
• Default: single TP. Partials only with explicit multi-zone reasoning.
• If estimated duration exceeds style band, return NO_TRADE. Do NOT silently upgrade style.
`;
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGIME-BASED THESIS CACHING INTEGRATION
    // ═══════════════════════════════════════════════════════════════════
    // Generate regime signature from market context
    const regimeSignature = extractRegimeSignature(
      marketContext.symbol,
      marketContext,
      votes,
      regimeSnapshot
    );

    // Check cache for existing thesis
    let cachedThesis: AlphaMarketThesis | null = null;
    let cachedThesisPrompt = '';

    try {
      // Attempt to get cached thesis from database
      cachedThesis = await sharedIntelligenceCoordinator.getAlphaThesis(
        marketContext.symbol,
        regimeSignature,
        null, // First call to check cache only
        async () => {
          // This won't be called on cache hit - we'll handle fresh generation separately
          throw new Error('Cache check only');
        }
      );

      if (cachedThesis && cachedThesis.fromCache) {
        const ageMinutes = Math.round(cachedThesis.cacheAgeSeconds / 60);
        cachedThesisPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 CACHED MARKET THESIS (Age: ${ageMinutes}min)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The following thesis was generated ${ageMinutes} minutes ago for the same regime:

Direction Bias: ${cachedThesis.directionBias}
Regime: ${cachedThesis.regime}
Narrative: ${cachedThesis.narrative}
Liquidity Context: ${cachedThesis.liquidityContext || 'Not specified'}
Confidence Band: ${cachedThesis.confidenceBand}

INSTRUCTIONS:
1. Review this thesis against CURRENT market conditions
2. If market structure is UNCHANGED → Accept and reuse (say "ACCEPTED_THESIS")
3. If market has CHANGED → Reject and generate fresh analysis (say "REJECT_THESIS: [reason]")

Only accept if the thesis is still valid. Be conservative.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] 💾 Cached thesis available (${ageMinutes}min old)`);
      }
    } catch (error) {
      // Cache miss or error - will generate fresh
      console.log('[Alpha Coordinator] 💭 No cached thesis - will generate fresh');
      cachedThesis = null;
    }

    // ═══════════════════════════════════════════════════════════════════
    // M5 SCALP CONTEXT (ADVISORY - ONLY FOR SCALP STYLE)
    // ═══════════════════════════════════════════════════════════════════
    let m5ContextPrompt = '';
    if (getDisplayNameFromStyle(tradeStyle) === 'SCALP') {
      try {
        const m5Context = await m5SwingAnalyzer.getRecentSwings(
          marketContext.symbol,
          50
        );

        m5ContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 M5 SCALP CONTEXT (${marketContext.symbol}) - ADVISORY GUIDANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are trading M5 price action. Use this context to inform your TP/SL decisions:

M5 Statistics (Recent Behavior):
• Avg M5 Swing: ${m5Context.avgSwingPips} pips
• Recent M5 Swings: ${m5Context.recentSwings.join(', ')} pips
• Current M5 Progress: ${(m5Context.currentSwingProgress * 100).toFixed(0)}% through typical swing
• M5 ATR: ${m5Context.m5ATR} pips (baseline stop size)

Session Context:
• Session: ${m5Context.session}
• Typical ${m5Context.session} M5 Range: ${m5Context.sessionTypicalRange}

Reference Ranges (GUIDANCE, not limits):
• Suggested TP Range: ${m5Context.suggestedTPRange[0]}-${m5Context.suggestedTPRange[1]} pips
• Suggested SL Range: ${m5Context.suggestedSLRange[0]}-${m5Context.suggestedSLRange[1]} pips

IMPORTANT REMINDERS:
- These are REFERENCE RANGES based on recent M5 behavior
- You have FULL AUTHORITY to exceed them with justification
- Think in M5 terms: target ONE M5 leg, not H1 pools
- If you exceed typical M5 range (>60 pips TP), explain why
- EQS may be adjusted for unusual ranges (soft penalty, not block)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] 📊 M5 Context: ${m5Context.avgSwingPips} pip avg, ${m5Context.session} session`);
      } catch (error) {
        console.warn('[Alpha Coordinator] ⚠️ Failed to fetch M5 context:', error);
        // Non-blocking - continue without M5 context
      }
    }

    const prompt = `${getAlphaSystemPrompt()}
${styleIdentityPrompt}
${cachedThesisPrompt}
${m5ContextPrompt}

🎯 CORE MANDATE (PROFESSIONAL SNIPER MODE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISION PHILOSOPHY:
1. Execute immediately (BUY/SELL) when profit is mathematically possible and strategy is sound
2. Use NO_TRADE when setup not ready or no viable edge exists
3. Consider continuation entries when momentum is strong
4. Scanner will re-evaluate next cycle - no need to "wait" manually

CONFIDENCE BANDS (ADVISORY):
- ${ALPHA_IDENTITY.CONFIDENCE_BANDS.EXCELLENT.min}+%: Excellent setup - execute with conviction
- ${ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.min}-${ALPHA_IDENTITY.CONFIDENCE_BANDS.SOLID.max}%: Solid setup - strong execution candidate
- ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}-${ALPHA_IDENTITY.CONFIDENCE_BANDS.ACCEPTABLE.max}%: Acceptable setup - evaluate entry quality
- Below ${ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE}%: Weak edge - return NO_TRADE

EQS THRESHOLDS (ADVISORY GUIDANCE - NOT MANDATORY):
These are GUIDELINES for entry quality, NOT hard blocks:
- SCALP: ${ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.EXECUTE_IMMEDIATELY}+ ideal, ${ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.SCALP.WAIT_PULLBACK.min}+ acceptable
- MICRO_INTRADAY: ${ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.EXECUTE_IMMEDIATELY}+ ideal, ${ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.MICRO_INTRADAY.WAIT_PULLBACK.min}+ acceptable
- INTRADAY: ${ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.EXECUTE_IMMEDIATELY}+ ideal, ${ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS.INTRADAY.WAIT_PULLBACK.min}+ acceptable

YOU MAY OVERRIDE these thresholds when:
✓ Strong momentum justifies continuation entry
✓ Opportunity cost of waiting is high
✓ Alternative entry strategy (continuation/breakout) is superior
✓ Price action suggests pullback unlikely

ADVISORY SYSTEMS (GUIDANCE ONLY - NEVER BLOCK):
- Regime Oracle: Max ${ALPHA_IDENTITY.ADVISORY_SYSTEMS.REGIME_ORACLE.maxConfidencePenalty}% penalty
- Adversarial Detector: Max ${ALPHA_IDENTITY.ADVISORY_SYSTEMS.ADVERSARIAL_DETECTOR.maxConfidencePenalty}% penalty
- Session Constraints: Max ${ALPHA_IDENTITY.ADVISORY_SYSTEMS.SESSION_CONSTRAINTS.maxConfidencePenalty}% penalty
- Combined Maximum: ${ALPHA_IDENTITY.MAX_ADVISORY_PENALTY}% penalty
- You may OVERRIDE any advisory with statistical justification

LEGITIMATE NO_TRADE CONDITIONS (ONLY THESE):
${ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.map(c => `- ${c}`).join('\n')}

ALPHA MENTALITY:
- Professional snipers make context-based decisions
- Execute when edge exists with viable strategy
- Continuation entries capture momentum when pullback unlikely
- Guidelines inform decisions, they don't make them
- Compare relative opportunities when scanning multiple pairs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${context}

WEIGHTED CONSENSUS: ${consensus.direction} ${consensus.score.toFixed(1)}% (${consensus.agreementCount}/${consensus.totalVotes} agree)

🎯 CONSENSUS STRENGTH ANALYSIS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Risk Mode: ${riskMode.toUpperCase()} (${consensusDescription})
Advisory Minimum: ${recommendedConsensusCount}/7 Omegas
Actual Consensus: ${consensus.agreementCount}/7 Omegas
Strength Modifier: ${consensusStrengthModifier > 0 ? '+' : ''}${(consensusStrengthModifier * 100).toFixed(1)}% confidence adjustment

${consensus.agreementCount === 7 ? '🏆 UNANIMOUS (7/7) - Maximum consensus strength' :
  consensus.agreementCount === 6 ? '✅ STRONG (6/7) - High agreement' :
  consensus.agreementCount >= recommendedConsensusCount ? '✓ MEETS ADVISORY - Adequate consensus' :
  '⚠️ BELOW ADVISORY - Proceed with caution'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${conflictContext}${advisoryContext}${riskContext}${rrPerformanceContext}${recentTradesContext}${dailyNarrativeContext}${microRegimeContext}${liquidityIntentContext}${patternContext}${intelligenceContext}${goalContextText}${liquidityContext}${constraintsText}${stopLossDirective}

🎯 ALPHA DECISION INTELLIGENCE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Omega Weighted Contributions:
${this.buildWeightedVoteSummary(votes, weights, consensus)}

📈 Market Intelligence:
  Confidence Spread: ${confidenceSpread.stdDev.toFixed(1)}% (Avg: ${confidenceSpread.avgConfidence.toFixed(0)}%) → ${confidenceSpread.isHighAgreement ? '✅ HIGH CONSENSUS - wider R:R viable (2.5-3.5:1)' : '⚠️ DISAGREEMENT - tighten to 1.5-2.0:1'}
  Volatility: ${volatilityRegime.regime.toUpperCase()} ${volatilityRegime.ratio !== 1.0 ? `(${volatilityRegime.ratio.toFixed(2)}x)` : ''} → ${volatilityRegime.recommendation}
  Stop Quality: ${stopQuality.score}/100 → ${stopQuality.recommendation}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NARRATIVE (MANDATORY for BUY/SELL):
Include "market_narrative" - single sentence with: cause-effect + price destination + participant behavior.
Example: "Swept Asian lows, trapped retail shorts, BOS confirms long - targeting 1.0850 resistance."
Penalty: No narrative = -30% confidence. Weak = -15%. Strong = 0%.

Actions: BUY (bullish edge), SELL (bearish edge), NO_TRADE (no edge or setup not ready).
When scanning multiple pairs, EXECUTE the best opportunity. Scanner re-evaluates next cycle.
BUY: SL < Entry < TP | SELL: TP < Entry < SL

Return PURE JSON only:
{
  "action": "BUY|SELL|NO_TRADE",
  "entry": 12345.67,
  "stopLoss": 12300.00,
  "takeProfit": 12400.00,
  "trade_confidence": 75,
  "entry_quality_score": 80,
  "entry_mode": "immediate",
  "style": "SCALP",
  "marketThesis": "Brief market analysis (30-50 words)",
  "reasoning": "Brief execution reasoning",
  "market_narrative": "Single-sentence cause-effect thesis",
  "override": { "type": "none", "justification": "" }
}`;

    // Emit final progress thought before LLM call (this is the 6.3s phase)
    if (sessionId && userId) {
      alphaThoughtStream.emitAlphaFinalDecision(sessionId, userId, marketContext.symbol).catch(err => {
        console.warn('[Alpha Coordinator] Failed to emit final decision thought:', err);
      });
    }

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Alpha Coordinator. Synthesize Omega votes. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 300,
          requestType: 'alpha_coordination',
          endpoint: 'alpha-coordinator'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'Alpha',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'alpha_coordination',
        userId: userId,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';

      // ═══════════════════════════════════════════════════════════════════
      // EXTRACT AND CACHE MARKET THESIS
      // ═══════════════════════════════════════════════════════════════════
      let parsedJSON: any = {};
      try {
        // ✅ SSOT FIX: Use centralized sanitizer
        parsedJSON = sanitizeAndParse(content, 'alpha market thesis');

        // Extract market thesis from response
        const marketThesisText = parsedJSON.marketThesis || parsedJSON.reasoning || '';

        // Check if Alpha accepted or rejected the cached thesis
        const thesisAccepted = marketThesisText.includes('ACCEPTED_THESIS');
        const thesisRejected = marketThesisText.includes('REJECT_THESIS');

        if (cachedThesis && thesisRejected) {
          console.log('[Alpha Coordinator] ❌ Alpha rejected cached thesis');
          // Rejection logging handled by shared intelligence coordinator
        } else if (cachedThesis && thesisAccepted) {
          console.log('[Alpha Coordinator] ✅ Alpha accepted cached thesis');
        } else if (!cachedThesis && marketThesisText) {
          // Fresh thesis generation - cache it
          const directionBias = parsedJSON.action === 'BUY' ? 'BUY' :
                               parsedJSON.action === 'SELL' ? 'SELL' : 'NEUTRAL';

          // Store thesis in cache (fire-and-forget to avoid blocking execution)
          sharedIntelligenceCoordinator.getAlphaThesis(
            marketContext.symbol,
            regimeSignature,
            cachedThesis,
            async () => ({
              thesis: {
                directionBias: directionBias as 'BUY' | 'SELL' | 'NEUTRAL',
                narrative: marketThesisText,
                regime: regimeSnapshot?.category || 'unknown',
                liquidityContext: parsedJSON.market_narrative || undefined,
                confidenceBand: parsedJSON.trade_confidence > 70 ? 'strong' as const :
                               parsedJSON.trade_confidence > 50 ? 'medium' as const : 'weak' as const,
                thesisSummary: marketThesisText.substring(0, 100)
              },
              thesisRejected: false
            })
          ).catch(err => {
            logger.error('[Alpha Coordinator] Failed to cache thesis', { error: err });
          });

          console.log('[Alpha Coordinator] 💾 Caching fresh market thesis');
        }
      } catch (parseError) {
        logger.warn('[Alpha Coordinator] Failed to parse thesis from response', {
          error: parseError instanceof Error ? parseError.message : 'Unknown error'
        });
      }

      let decision = this.parseDecision(
        content,
        marketContext.price,
        extractATRValue(marketContext.atr),
        marketContext.symbol,
        stopLossAnchor,
        liquidityZones,
        fullCandles,
        marketContext,
        riskMode,
        goalContext,
        regimeSnapshot,
        userId,
        sessionId,
        tradeStyle
      );

      // CONSTRAINT-FIRST VALIDATION (Phase 1: Check violations, Phase 2: Revision loop, Phase 3: Auto-correction)
      if (decision.action !== 'NO_TRADE' && decision.action !== 'WAIT' && omega9Constraints) {
        console.log('[Alpha Coordinator] 🔍 Checking decision against constraints...');

        // Validate decision against constraints
        const violations = omega9ConstraintProvider.validateAgainstConstraints(
          {
            entry: decision.entry,
            stopLoss: decision.stopLoss,
            takeProfit: decision.takeProfit,
            direction: decision.action as 'BUY' | 'SELL'
          },
          omega9Constraints,
          marketContext.symbol
        );

        if (violations.length > 0) {
          console.log(`[Alpha Coordinator] ⚠️ ${violations.length} constraint violation(s) detected`);

          // Phase 2: Trigger revision loop (ONE OPPORTUNITY for Alpha to adjust)
          const revisionResponse = await alphaRevisionHandler.requestRevision(
            decision,
            violations,
            omega9Constraints,
            marketContext.symbol,
            userId
          );

          if (revisionResponse.revised && revisionResponse.revisedDecision) {
            console.log('[Alpha Coordinator] ✅ Alpha revised decision');
            // Update decision with revised values
            decision.stopLoss = revisionResponse.revisedDecision.stopLoss;
            decision.takeProfit = revisionResponse.revisedDecision.takeProfit;
            decision.confidence = revisionResponse.revisedDecision.confidence;
            decision.reasoning = revisionResponse.revisedDecision.reasoning;

            // Apply small confidence boost for accepting revision (+5%)
            decision.confidence = Math.min(100, decision.confidence + 5);
            decision.reasoning += ` [Revised based on constraints: ${revisionResponse.revisionReasoning}]`;
          } else {
            // ALPHA AUTHORITY PRINCIPLE: If Alpha declined revision, block the trade
            // Do NOT silently correct. Only Alpha decides SL/TP.
            console.log('[Alpha Coordinator] ❌ Alpha declined revision - blocking trade');
            console.log('[Alpha Coordinator] Constraint violations unresolved:');
            violations.forEach(v => console.log(`  - ${v.message}`));

            // Block trade
            decision.action = 'NO_TRADE';
            decision.decision = 'NO_TRADE';
            decision.confidence = 0;
            decision.reasoning = `Constraint violations not resolved by Alpha: ${violations.map(v => v.message).join('; ')}`;

            // Log SSOT violation for learning and prompt improvement (fire-and-forget)
            logViolation({
              violationType: 'ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED',
              symbol: marketContext.symbol,
              attemptedOperation: 'constraint_validation',
              callLocation: 'coordinator-alpha.constraint_validation',
              blocked: true,
              errorDetails: {
                severity: 'high',
                violations: violations.map(v => ({ type: v.type, message: v.message, severity: v.severity })),
                originalDecision: {
                  action: decision.action,
                  entry: decision.entry,
                  stopLoss: decision.stopLoss,
                  takeProfit: decision.takeProfit,
                  risk_pct: decision.risk_pct,
                  confidence: decision.confidence
                },
                userId: userId || null,
                sessionId: goalContext?.sessionId || null,
                resolution: 'blocked_no_repair'
              }
            }).catch(error => {
              console.error('[Alpha Coordinator] Failed to log SSOT violation:', error);
            });
          }
        } else {
          console.log('[Alpha Coordinator] ✅ Decision within all constraints');
        }
      }

      // Add decision field for compatibility
      decision.decision = decision.action;
      decision.symbol = marketContext.symbol;
      decision.timestamp = new Date();

      // Add Phase 1-4 upgrades to decision
      if (microRegime) {
        decision.microRegime = microRegime;
      }
      if (liquidityIntent && liquidityIntent.overallConviction > 0) {
        decision.liquidityIntent = liquidityIntent;
      }
      // Note: narrativeValidation is already set by parseDecision()

      // Add Phase 5: Pattern Intelligence
      if (patternIntelligence) {
        decision.patternIntelligence = {
          htfPattern: patternIntelligence.htfScan.primaryPattern?.patternType || null,
          htfIntent: patternIntelligence.intentAnalysis.htf.intent,
          mtfPattern: patternIntelligence.mtfScan.primaryPattern?.patternType || null,
          mtfIntent: patternIntelligence.intentAnalysis.mtf.intent,
          ltfPattern: patternIntelligence.ltfScan.primaryPattern?.patternType || null,
          ltfIntent: patternIntelligence.intentAnalysis.ltf.intent,
          alignmentScore: patternIntelligence.intentAnalysis.alignmentScore,
          overallIntent: patternIntelligence.intentAnalysis.overallIntent,
          directionBias: patternIntelligence.intentAnalysis.directionBias,
          confidenceBoosts: patternIntelligence.confidenceAdjustment.boosts,
          confidencePenalties: patternIntelligence.confidenceAdjustment.penalties,
          liquidityTargets: patternIntelligence.liquidityTargets,
          invalidationPoint: patternIntelligence.invalidationPoint,
          warnings: patternIntelligence.intentAnalysis.conflictWarnings,
        };
        console.log('[Alpha Coordinator] ✅ Pattern intelligence attached to decision');
      }

      // Log Alpha's stop placement vs anchor (Enhanced Stop Tracking)
      if (decision.action !== 'NO_TRADE' && stopLossAnchor) {
        // Use centralized pip calculation for consistency across all symbols (forex, crypto, indices)
        const alphaSLPips = calculatePipDistance(marketContext.symbol, decision.entry, decision.stopLoss);
        const anchorSLPips = stopLossAnchor.stopLossPips;
        const deviation = alphaSLPips - anchorSLPips;
        const deviationPercent = (deviation / anchorSLPips) * 100;

        console.log('[Alpha Stop Analysis] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`[Stop Anchor]  Provided: ${stopLossAnchor.stopLossPrice.toFixed(5)} (${anchorSLPips.toFixed(1)} pips, ${stopLossAnchor.atrMultiplier.toFixed(2)}x ATR)`);
        console.log(`[Alpha Choice] Chose:    ${decision.stopLoss.toFixed(5)} (${alphaSLPips.toFixed(1)} pips)`);

        if (Math.abs(deviationPercent) < 5) {
          console.log(`[Validation]   ✅ ACCEPTED ANCHOR (deviation: ${deviationPercent.toFixed(1)}%)`);
        } else if (deviation > 0) {
          console.log(`[Validation]   ⬆️  WIDENED by ${Math.abs(deviation).toFixed(1)} pips (+${deviationPercent.toFixed(1)}%)`);
        } else {
          console.log(`[Validation]   ⬇️  TIGHTENED by ${Math.abs(deviation).toFixed(1)} pips (${deviationPercent.toFixed(1)}%)`);
        }

        // Check if within profile range
        if (alphaSLPips < stopLossAnchor.profileMinPips) {
          console.log(`[Validation]   ⚠️  BELOW profile minimum (${stopLossAnchor.profileMinPips} pips) - risky`);
        } else if (alphaSLPips > stopLossAnchor.profileMaxPips) {
          console.log(`[Validation]   ⚠️  ABOVE profile maximum (${stopLossAnchor.profileMaxPips} pips) - too wide`);
        } else {
          console.log(`[Validation]   ✅ Within profile range (${stopLossAnchor.profileMinPips}-${stopLossAnchor.profileMaxPips} pips)`);
        }

        console.log('[Alpha Stop Analysis] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      }

      decision.omega_summary = this.generateOmegaSummary(votes, weights);
      decision.omega_votes = votes;
      decision.omegaConsensusPercent = consensus.score;
      decision.atrPercent = computedAtrPercent;

      // Add goal context if provided
      if (goalContext) {
        decision.goal_context = goalContext;
      }

      // Add advisory signals to decision
      if (adversarialSignal) {
        decision.adversarial_advisory = adversarialSignal;
      }
      if (regimeSnapshot) {
        decision.regime_advisory = regimeSnapshot;
      }

      // Add intelligence snapshot summary
      if (intelligenceSnapshot) {
        decision.intelligence_snapshot = {
          overrideHistory: intelligenceSnapshot.overrideHistory,
          calibrationData: intelligenceSnapshot.calibrationData,
          reasoningPatterns: intelligenceSnapshot.reasoningPatterns.slice(0, 3),
          executionQuality: intelligenceSnapshot.executionQuality
        };
      }

      // Check if Alpha overrode any recommendations
      const parsed = response.choices[0]?.message?.content || '{}';
      try {
        // ✅ SSOT FIX: Use centralized sanitizer
        const rawDecision = tryParseLLMResponse(parsed, 'alpha override decision') || {};
        if (rawDecision.override && rawDecision.override.type && rawDecision.override.type !== 'none') {
          const overrideInfo: AlphaOverride = {
            override_type: rawDecision.override.type,
            original_recommendation: adversarialSignal?.recommended_action || regimeSnapshot?.reason || 'Unknown',
            alpha_decision: decision.action,
            statistical_justification: rawDecision.override.justification || decision.reasoning,
            expected_edge: 0 // Will be calculated based on outcome
          };
          decision.override = overrideInfo;

          // Log override for learning
          if (userId) {
            await this.logOverride(
              userId,
              `decision_${Date.now()}`,
              overrideInfo,
              votes,
              marketContext,
              goalContext?.hasGoal ? 'goal_session_id' : undefined
            );
          }

          console.log(`[Alpha Coordinator] ⚡ OVERRIDE DETECTED: ${overrideInfo.override_type}`);
          console.log(`[Alpha Coordinator] Justification: ${overrideInfo.statistical_justification}`);
        }
      } catch (parseError) {
        // Override parsing failed, continue without it
      }

      // Check Omega-10 recommendations (ADVISORY - reduced penalty)
      if (userId) {
        const omega10Analysis = await omega10Scheduler.getLatestAnalysis(userId);
        if (omega10Analysis && omega10Analysis.riskHorizon.level === 'high') {
          console.log('[Alpha Coordinator] ⚠️ Omega-10 risk horizon: HIGH - advisory caution');
          decision.confidence = Math.max(0, decision.confidence - 5);
          decision.omega10_applied = true;
          decision.reasoning += ' [Omega-10: High risk horizon advisory]';
        }
      }

      if (votes.omega8) {
        decision.omega8_liquidity_bias = votes.omega8.liquidity_bias;
        decision.omega8_direction_support = votes.omega8.direction_support;

        if (votes.omega8.liquidity_bias === 'stoprun_risk') {
          decision.confidence = Math.max(0, decision.confidence - 15);
          console.log('[Alpha Coordinator] Omega-8 flags stop-run risk (no BOS) - reducing confidence');
        } else if (votes.omega8.liquidity_bias === 'stoprun_entry') {
          decision.confidence = Math.min(100, decision.confidence + 10);
          console.log('[Alpha Coordinator] Omega-8 confirms stop-run WITH BOS - good entry setup, boosting confidence');
        }
      }

      // Omega-9 validation (final safety check) - skip for WAIT since we're not executing yet
      if (decision.action !== 'NO_TRADE') {
        console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('[Alpha Coordinator] 📋 ALPHA\'S DECISION (Before Omega-9):');
        console.log(`[Alpha Coordinator]   Action: ${decision.action}`);
        console.log(`[Alpha Coordinator]   Entry: ${decision.entry.toFixed(5)}`);
        console.log(`[Alpha Coordinator]   Stop Loss: ${decision.stopLoss.toFixed(5)}`);
        console.log(`[Alpha Coordinator]   Take Profit: ${decision.takeProfit.toFixed(5)}`);
        console.log(`[Alpha Coordinator]   Confidence: ${decision.confidence}%`);
        console.log(`[Alpha Coordinator]   R:R Ratio: ${(Math.abs(decision.takeProfit - decision.entry) / Math.abs(decision.entry - decision.stopLoss)).toFixed(2)}`);
        console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('[Alpha Coordinator] 🛡️ Running Omega-9 validation (Mathematical Safety Only)...');

        const omega9Input: Omega9Input = {
          alphaDecision: decision,
          omegaVotes: votes,
          marketContext: {
            price: marketContext.price,
            atr: marketContext.atr,
            symbol: marketContext.symbol
          },
          safetyRules: {
            maxRiskPct: 5,
            minRR: TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM,
            maxExposure: 10
          }
        };

        const validation = await omega9Hallucination.validate(omega9Input);
        decision.omega9_validation = validation;

        // Recalculate stop quality now that we have Omega-9 results
        const finalStopQuality = this.calculateStopQualityScore(votes.omega8, validation);
        console.log(`[Alpha Coordinator] 🛡️ Final Stop Quality: ${finalStopQuality.score}/100`);

        // Check for RED ZONE hard block - CANNOT BE OVERRIDDEN
        if (validation.safety_zone === 'RED' && !validation.pass) {
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('[Alpha Coordinator] 🚨 OMEGA-9 RED ZONE HARD BLOCK');
          console.log('[Alpha Coordinator] ❌ Alpha\'s decision was BLOCKED by Omega-9');
          console.log(`[Alpha Coordinator] ❌ Reason: ${validation.reasoning}`);
          console.log('[Alpha Coordinator] ❌ This trade violates mathematical survival limits');
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: marketContext.price,
            stopLoss: marketContext.price,
            takeProfit: marketContext.price,
            confidence: 0,
            reasoning: `🚨 OMEGA-9 VETO (RED ZONE): ${validation.reasoning}. Alpha's decision blocked due to mathematical survival violation.`,
            omega_summary: decision.omega_summary,
            omega8_liquidity_bias: decision.omega8_liquidity_bias,
            omega8_direction_support: decision.omega8_direction_support,
            omega9_validation: validation
          };
        }

        // Check for other validation failures
        if (!validation.pass) {
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('[Alpha Coordinator] ❌ OMEGA-9 BLOCKED TRADE');
          console.log('[Alpha Coordinator] ❌ Alpha\'s decision was BLOCKED by Omega-9');
          console.log(`[Alpha Coordinator] ❌ Reason: ${validation.reasoning}`);
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: marketContext.price,
            stopLoss: marketContext.price,
            takeProfit: marketContext.price,
            confidence: 0,
            reasoning: `❌ OMEGA-9 VETO: ${validation.reasoning}. Alpha's decision blocked due to mathematical safety violation.`,
            omega_summary: decision.omega_summary,
            omega8_liquidity_bias: decision.omega8_liquidity_bias,
            omega8_direction_support: decision.omega8_direction_support,
            omega9_validation: validation
          };
        }

        // Log safety zone status
        if (validation.safety_zone) {
          const zoneEmoji = validation.safety_zone === 'GREEN' ? '✅' : validation.safety_zone === 'YELLOW' ? '⚡' : validation.safety_zone === 'ORANGE' ? '⚠️' : '🚨';
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`[Alpha Coordinator] ${zoneEmoji} OMEGA-9 VALIDATION RESULT`);
          console.log(`[Alpha Coordinator] ${zoneEmoji} Safety Zone: ${validation.safety_zone} | Safety Score: ${validation.safety_evaluation?.safety_score || 0}/100`);

          if (validation.safety_zone === 'GREEN') {
            console.log('[Alpha Coordinator] ✅ Alpha\'s decision APPROVED by Omega-9 (no modifications)');
          } else if (validation.safety_zone === 'ORANGE') {
            console.log('[Alpha Coordinator] ⚠️ ORANGE ZONE: Alpha\'s decision APPROVED with advisory caution');
            console.log('[Alpha Coordinator] ⚠️ Trade requires Alpha override reasoning');
          } else if (validation.safety_zone === 'YELLOW') {
            console.log('[Alpha Coordinator] ⚡ YELLOW ZONE: Alpha\'s decision APPROVED with advisory warning');
            console.log('[Alpha Coordinator] ⚡ Suboptimal conditions detected, proceeding with caution');
          }
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }

        // Apply Omega-9 corrections if provided (Mathematical repairs only)
        const hasCorrections = validation.corrections.sl !== null || validation.corrections.tp !== null;
        if (hasCorrections) {
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('[Alpha Coordinator] 🔧 OMEGA-9 APPLIED MATHEMATICAL CORRECTIONS');
          console.log('[Alpha Coordinator] (Catastrophic positioning error detected and repaired)');
        }

        if (validation.corrections.sl !== null) {
          console.log(`[Alpha Coordinator] 🔧 Stop Loss: ${decision.stopLoss.toFixed(5)} → ${validation.corrections.sl.toFixed(5)}`);
          decision.stopLoss = validation.corrections.sl;
        }
        if (validation.corrections.tp !== null) {
          console.log(`[Alpha Coordinator] 🔧 Take Profit: ${decision.takeProfit.toFixed(5)} → ${validation.corrections.tp.toFixed(5)}`);
          decision.takeProfit = validation.corrections.tp;
        }

        if (hasCorrections) {
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }

        // Apply confidence adjustment
        if (validation.confidence_adjustment !== 0) {
          const oldConfidence = decision.confidence;
          decision.confidence = Math.max(0, Math.min(100, decision.confidence + validation.confidence_adjustment));
          console.log(`[Alpha Coordinator] 📊 Confidence adjusted: ${oldConfidence}% → ${decision.confidence}% (${validation.confidence_adjustment > 0 ? '+' : ''}${validation.confidence_adjustment}%)`);
        }

        if (!hasCorrections) {
          console.log('[Alpha Coordinator] ✅ Omega-9 validation passed (no modifications to Alpha\'s decision)');
        }
      }

      // Time-to-Fill validation (CRITICAL FOR INTRADAY FOCUS) - skip for WAIT
      if (decision.action !== 'NO_TRADE') {
        console.log('[Alpha Coordinator] ⏱️  Running Time-to-Fill validation...');

        const tpDistancePips = calculatePipDistance(marketContext.symbol, decision.entry, decision.takeProfit);
        // CRITICAL FIX: Convert ATR from price value to pips
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);
        const atrPips = extractATRValue(marketContext.atr) / pipInfo.pipValue;

        const { currentSession } = calculateSessionContext();

        const timeToFill = timeToFillCalculator.calculate({
          tpDistancePips,
          atrPips,
          currentSession,
          symbol: marketContext.symbol
        });

        console.log(`[Alpha Coordinator] ⏱️  Expected fill: ${timeToFill.expectedMinutes}min (${timeToFill.viability})`);
        console.log(`[Alpha Coordinator] ⏱️  ${timeToFill.reasoning}`);

        decision.expectedFillTimeHours = timeToFill.expectedMinutes / 60;
        decision.reasoning += ` [Expected fill: ${timeToFill.expectedMinutes}min - ${timeToFill.viability}]`;

        if (timeToFill.recommendedAction === 'REJECT') {
          console.log('[Alpha Coordinator] ⚠️ TIME-TO-FILL: Execution Eligibility Gate will evaluate');
        } else if (timeToFill.recommendedAction === 'CAUTION') {
          console.log('[Alpha Coordinator] ⚠️ TIME-TO-FILL WARNING: Approaching extended duration');
        } else if (timeToFill.viability === 'OPTIMAL') {
          console.log('[Alpha Coordinator] ✅ TIME-TO-FILL OPTIMAL: Perfect for intraday');
        }
      }

      console.log('[Alpha Coordinator] Decision:', decision.action);
      console.log('[Alpha Coordinator] Confidence:', decision.confidence);
      console.log('[Alpha Coordinator] Reasoning:', decision.reasoning);
      console.log('[Alpha Coordinator] Omega Summary:', decision.omega_summary);

      if (decision.action !== 'NO_TRADE') {
        try {
          // Extract recent candles and calculate VWAP for entry quality analysis
          let recentCandles: Array<{
            open: number;
            high: number;
            low: number;
            close: number;
            timestamp: number;
          }> | undefined = undefined;
          let vwap: number | undefined = undefined;

          if (fullCandles && fullCandles.length > 0) {
            // Take last 10 candles for analysis
            const candleSlice = fullCandles.slice(-10);

            // Convert to entry quality format
            recentCandles = candleSlice.map((c: any) => ({
              open: c.open || c.o || 0,
              high: c.high || c.h || 0,
              low: c.low || c.l || 0,
              close: c.close || c.c || 0,
              timestamp: c.timestamp || c.time || Date.now()
            }));

            // Calculate VWAP from recent candles (volume-weighted average price)
            // If volume not available, use typical price average as approximation
            let sumTypicalPrice = 0;
            let sumVolume = 0;

            for (const candle of candleSlice) {
              const typicalPrice = ((candle.high || candle.h || 0) + (candle.low || candle.l || 0) + (candle.close || candle.c || 0)) / 3;
              const volume = candle.volume || candle.v || 1; // Default to 1 if no volume
              sumTypicalPrice += typicalPrice * volume;
              sumVolume += volume;
            }

            vwap = sumVolume > 0 ? sumTypicalPrice / sumVolume : undefined;

            if (vwap) {
              console.log(`[Alpha Coordinator] 📊 Calculated VWAP: ${vwap.toFixed(5)} from ${candleSlice.length} candles`);
            }
          }

          // Classify entry intent with quality rules (async with adaptive zones)
          const entryIntent = await EntryIntentClassifier.classifyEntryIntent(
            decision,
            marketContext,
            votes,
            vwap,
            microRegime?.regime
          );

          if (entryIntent) {
            decision.entry_intent = entryIntent;
            console.log(`[Alpha Coordinator] 🎯 Entry intent: ${entryIntent.intent_type} (${entryIntent.urgency})`);

            // Log adaptive zone details if available
            if (entryIntent.zone_type && entryIntent.micro_regime_used) {
              console.log(`[Alpha Coordinator] 🎯 Adaptive Zones: ${entryIntent.zone_type.toUpperCase()} zone for ${entryIntent.micro_regime_used} regime`);
              console.log(`[Alpha Coordinator]    Primary Zone: ${entryIntent.primary_zone_min?.toFixed(5)} - ${entryIntent.primary_zone_max?.toFixed(5)}`);
              console.log(`[Alpha Coordinator]    Secondary Zone: ${entryIntent.secondary_zone_min?.toFixed(5)} - ${entryIntent.secondary_zone_max?.toFixed(5)}`);
              console.log(`[Alpha Coordinator]    Reachability: ${entryIntent.zone_reachability_distance_pips?.toFixed(2)} pips from current price`);
              console.log(`[Alpha Coordinator]    Position Size: ${((entryIntent.position_size_multiplier || 1.0) * 100).toFixed(0)}% of standard size`);
              if (entryIntent.zone_downgrade_applied) {
                console.log(`[Alpha Coordinator]    ⚠️ Zone downgraded due to reachability constraints`);
              }
            }

            // Log entry quality violations
            if (entryIntent.quality_violations && entryIntent.quality_violations.length > 0) {
              console.log(`[Alpha Coordinator] 🛡️ Entry Quality Assessment:`);
              entryIntent.quality_violations.forEach(violation => {
                const emoji = violation.severity === 'BLOCK' ? '🚫' : violation.severity === 'WARN' ? '⚠️' : '📉';
                console.log(`[Alpha Coordinator]   ${emoji} ${violation.rule}: ${violation.reason}`);
                console.log(`[Alpha Coordinator]      → Suggested: ${violation.suggestedAction}`);
              });

              if (entryIntent.adjusted_by_quality_rules) {
                console.log(`[Alpha Coordinator] ✅ Entry parameters adjusted by quality rules`);
              }
            }
          }
        } catch (error) {
          console.error('[Alpha Coordinator] Failed to classify entry intent:', error);
        }
      }

      // CRITICAL: Apply confidence calibration based on historical accuracy
      // This ensures Alpha's confidence reflects actual win rates, not just predicted
      if (decision.action !== 'NO_TRADE' && decision.confidence > 0) {
        try {
          const rawConfidence = decision.confidence;
          // Derive market condition from regime (trending vs ranging)
          const marketCondition = marketContext.regime === 'side' ? 'ranging' : 'trending';
          const calibratedConfidence = await alphaLearningFeedback.getCalibratedConfidence(
            userId,
            rawConfidence,
            marketCondition,
            marketContext.symbol
          );

          if (calibratedConfidence !== rawConfidence) {
            console.log(`[Alpha Coordinator] 🎯 Confidence calibration applied: ${rawConfidence.toFixed(1)}% → ${calibratedConfidence.toFixed(1)}%`);
            decision.confidence = calibratedConfidence;
            decision.reasoning += ` [Calibrated from ${rawConfidence.toFixed(0)}% based on historical accuracy]`;
          }
        } catch (error) {
          console.error('[Alpha Coordinator] Failed to apply confidence calibration:', error);
          // Continue with uncalibrated confidence rather than block the trade
        }
      }

      return decision;
    } catch (error) {
      console.error('[Alpha Coordinator] Error:', error);
      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: marketContext.price,
        stopLoss: marketContext.price,
        takeProfit: marketContext.price,
        confidence: 0,
        reasoning: 'Coordination failed',
        omega_summary: 'Error in coordination'
      };
    }
  }

  /**
   * Calculate weighted consensus from Omega votes
   */
  private calculateWeightedConsensus(
    votes: OmegaCouncilVotes,
    weights: Record<string, number>
  ): {
    direction: 'BUY' | 'SELL' | 'NO_TRADE' | 'MIXED' | 'WAIT';
    score: number;
    agreementCount: number;
    totalVotes: number;
    strongAgreement: boolean;
  } {
    let buyScore = 0;
    let sellScore = 0;
    let noTradeScore = 0;
    let totalWeight = 0;
    let buyCount = 0;
    let sellCount = 0;
    let noTradeCount = 0;
    let totalVotes = 0;

    const voteEntries = [
      { name: 'trend', vote: votes.trend, weight: weights.trend ?? 0 },
      { name: 'scalper', vote: votes.scalper, weight: weights.scalper ?? 0 },
      { name: 'confirmation', vote: votes.confirmation, weight: weights.confirmation ?? 0 },
      { name: 'reversal', vote: votes.reversal, weight: weights.reversal ?? 0 },
      { name: 'volatility', vote: votes.volatility, weight: weights.volatility ?? 0 },
      { name: 'risk', vote: votes.risk, weight: (weights.risk ?? 0) * 0.5 }, // Reduce Risk weight to advisory level
      { name: 'omega8', vote: votes.omega8, weight: weights.omega8 ?? 0 }
    ];

    for (const entry of voteEntries) {
      if (!entry.vote) continue;

      totalVotes++;
      const weightedConfidence = (entry.weight ?? 0) * entry.vote.confidence;
      totalWeight += (entry.weight ?? 0);

      if (entry.vote.vote === 'BUY') {
        buyScore += weightedConfidence;
        buyCount++;
      } else if (entry.vote.vote === 'SELL') {
        sellScore += weightedConfidence;
        sellCount++;
      } else {
        noTradeScore += weightedConfidence;
        noTradeCount++;
      }
    }

    // Normalize scores
    if (totalWeight > 0) {
      buyScore = (buyScore / totalWeight);
      sellScore = (sellScore / totalWeight);
      noTradeScore = (noTradeScore / totalWeight);
    }

    // Determine direction
    let direction: 'BUY' | 'SELL' | 'NO_TRADE' | 'MIXED' = 'NO_TRADE';
    let score = noTradeScore;
    let agreementCount = noTradeCount;

    if (buyScore > sellScore && buyScore > noTradeScore) {
      direction = 'BUY';
      score = buyScore;
      agreementCount = buyCount;
    } else if (sellScore > buyScore && sellScore > noTradeScore) {
      direction = 'SELL';
      score = sellScore;
      agreementCount = sellCount;
    } else if (buyScore > 50 && sellScore > 50) {
      direction = 'MIXED';
      score = Math.max(buyScore, sellScore);
      agreementCount = Math.max(buyCount, sellCount);
    }

    // Strong agreement = 3+ Omegas agree AND weighted score > 50%
    // LOWERED from 55% to 50% to reduce paralysis and allow Alpha override authority
    // Alpha can override between 45-55% with high conviction reasoning
    const strongAgreement = agreementCount >= 3 && score >= 50;

    return {
      direction,
      score,
      agreementCount,
      totalVotes,
      strongAgreement
    };
  }

  /**
   * Calculate vote weights based on regime, personality, and RISK MODE
   * Includes Omega-10 meta-reasoning overrides
   *
   * CRITICAL: Risk mode determines BASE weights (scalper dominant for aggressive, swing for conservative)
   */
  private async calculateWeights(
    votes: OmegaCouncilVotes,
    marketContext: MarketContext,
    traderScore: TraderScore,
    riskMode: 'low' | 'medium' | 'high',
    userId?: string
  ): Promise<Record<string, number>> {
    // Start with risk profile base weights
    const riskProfileWeights = getOmegaWeights(riskMode);

    console.log(`[Alpha Coordinator] 🎯 Applying ${riskMode.toUpperCase()} risk profile base weights:`, riskProfileWeights);

    const weights: Record<string, number> = {
      trend: riskProfileWeights.trend ?? 1.0,
      scalper: riskProfileWeights.scalper ?? 1.0,
      confirmation: riskProfileWeights.confirmation ?? 1.0,
      reversal: riskProfileWeights.reversal ?? 1.0,
      volatility: riskProfileWeights.volatility ?? 1.0,
      risk: riskProfileWeights.risk ?? 1.0,
      omega8: 1.0  // Omega8 weighted separately
    };

    // Adjust by market regime (multiplicative to preserve risk profile intent)
    if (marketContext.regime === 'bull' || marketContext.regime === 'bear') {
      weights.trend = (weights.trend ?? 1.0) * 1.3;      // Trending - boost trend specialist
      weights.confirmation = (weights.confirmation ?? 1.0) * 1.2;      // Structure matters in trends
      weights.scalper = (weights.scalper ?? 1.0) * 0.9;    // Slightly reduce scalping in strong trends
    } else if (marketContext.regime === 'side') {
      weights.scalper = (weights.scalper ?? 1.0) * 1.3;    // Ranging - boost scalper
      weights.reversal = (weights.reversal ?? 1.0) * 1.2;   // Reversals common in ranges
      weights.trend = (weights.trend ?? 1.0) * 0.9;      // Slightly reduce trend following
    }

    // Adjust by volatility (multiplicative)
    if (marketContext.volatility === 'high') {
      weights.volatility = (weights.volatility ?? 1.0) * 1.4; // Boost volatility specialist
      weights.risk = (weights.risk ?? 1.0) * 1.3;       // Risk is critical in volatility
      weights.scalper = (weights.scalper ?? 1.0) * 0.8;    // Scalping riskier in high vol
    } else if (marketContext.volatility === 'low') {
      weights.scalper = (weights.scalper ?? 1.0) * 1.2;    // Scalping good in low vol
      weights.volatility = (weights.volatility ?? 1.0) * 0.95;
    }

    // Adjust by trader personality
    if (traderScore.confidence_level === 'aggressive') {
      weights.scalper = (weights.scalper ?? 1.0) * 1.2;
      weights.reversal = (weights.reversal ?? 1.0) * 1.1;
      weights.risk = (weights.risk ?? 1.0) * 0.9;
    } else if (traderScore.confidence_level === 'cautious') {
      weights.risk = (weights.risk ?? 1.0) * 1.5;     // Risk is VERY important
      weights.confirmation = (weights.confirmation ?? 1.0) * 1.2;   // Structure confirmation
      weights.scalper = (weights.scalper ?? 1.0) * 0.8;
    }

    // Losing streak - weight risk more heavily (but still advisory)
    if (traderScore.win_rate < 0.5) {
      weights.risk = (weights.risk ?? 1.0) * 1.3;
    }

    // High score - trust trend more
    if (traderScore.current_score >= 85) {
      weights.trend = (weights.trend ?? 1.0) * 1.2;
    }

    // Risk remains advisory - do NOT enforce minimum weight
    // Line 807 applies 0.5x multiplier to keep Risk advisory, not blocking

    // Omega-8 OrderFlow adjustments
    if (votes.omega8 && votes.omega8.confidence >= 70) {
      weights.omega8 = 1.5;  // High confidence orderflow analysis
    }
    if (marketContext.regime === 'side') {
      weights.omega8 = (weights.omega8 ?? 1.0) * 1.2;  // Boost in ranging markets (stop-run risk higher)
    }
    if (marketContext.volatility === 'high') {
      weights.omega8 = (weights.omega8 ?? 1.0) * 1.15;  // Boost in high volatility (liquidity matters more)
    }
    if (traderScore.confidence_level === 'cautious') {
      weights.omega8 = (weights.omega8 ?? 1.0) * 1.1;  // Cautious traders value liquidity analysis
    }

    // Omega-10 Meta-Reasoning Overrides (System-Level Intelligence)
    if (userId) {
      const omega10Overrides = await omega10Scheduler.getActiveOverrides(userId);
      if (Object.keys(omega10Overrides).length > 0) {
        console.log('[Alpha Coordinator] 🧠 Applying Omega-10 meta-reasoning overrides...');
        for (const [omegaName, multiplier] of Object.entries(omega10Overrides)) {
          if (weights[omegaName] !== undefined) {
            const originalWeight = weights[omegaName];
            weights[omegaName] *= multiplier;
            console.log(`[Alpha Coordinator]   - ${omegaName}: ${originalWeight.toFixed(2)} → ${weights[omegaName].toFixed(2)} (${multiplier}x)`);
          }
        }
      }
    }

    return weights;
  }

  /**
   * Build compressed coordination context
   */
  /**
   * Fetch platform-wide intelligence for symbol
   */
  private async fetchPlatformIntelligence(symbol: string): Promise<string> {
    try {
      const [symbolIntel, topPatterns, platformStats] = await Promise.all([
        globalIntelligenceProvider.getSymbolIntelligence(symbol),
        globalIntelligenceProvider.getGlobalPatternsForSymbol(symbol, 20),
        globalIntelligenceProvider.getPlatformStats()
      ]);

      const parts: string[] = [];
      parts.push('📊 PLATFORM INTELLIGENCE (Collective Learning from All Users):');

      if (symbolIntel && symbolIntel.total_trades_platform_wide >= 30) {
        parts.push(`${symbol}: ${symbolIntel.total_trades_platform_wide} trades platform-wide | WR: ${symbolIntel.platform_win_rate.toFixed(1)}% | PF: ${symbolIntel.platform_profit_factor.toFixed(2)}`);

        if (symbolIntel.intelligence_quality_score >= 70) {
          parts.push(`✅ High-quality intelligence (Score: ${symbolIntel.intelligence_quality_score})`);
        }
      } else {
        parts.push(`${symbol}: Limited platform data (new symbol or low volume)`);
      }

      if (topPatterns && topPatterns.length > 0) {
        const validated = topPatterns.filter(p => p.sample_size_adequate);
        if (validated.length > 0) {
          const best = validated[0];
          parts.push(`Top Pattern: ${best.pattern_name} | WR: ${best.win_rate.toFixed(1)}% | PF: ${best.profit_factor.toFixed(2)} (${best.total_occurrences} samples)`);
        }
      }

      if (platformStats) {
        parts.push(`Platform: ${platformStats.total_trades_analyzed} trades analyzed | ${platformStats.total_patterns_discovered} patterns discovered`);
      }

      return parts.join('\n');
    } catch (error) {
      console.error('[Alpha] Error fetching platform intelligence:', error);
      return '📊 Platform intelligence unavailable';
    }
  }

  private buildCoordinationContext(
    votes: OmegaCouncilVotes,
    weights: Record<string, number>,
    marketContext: MarketContext,
    traderScore: TraderScore,
    consensus: any,
    platformIntelligence?: string
  ): string {
    const parts: string[] = [];

    parts.push(`Market: ${marketContext.symbol} | ${marketContext.regime} | ${marketContext.volatility} vol`);
    parts.push(`Price: ${marketContext.price} | ATR: ${extractATRValue(marketContext.atr)}`);
    parts.push(`Trader: ${traderScore.confidence_level} (Score: ${traderScore.current_score}, Win Rate: ${(traderScore.win_rate * 100).toFixed(1)}%)`);

    if (platformIntelligence) {
      parts.push('');
      parts.push(platformIntelligence);
    }

    parts.push('');
    parts.push('Omega Votes (weighted):');

    const voteEntries = [
      { name: 'Trend', vote: votes.trend, weight: weights.trend },
      { name: 'Scalper', vote: votes.scalper, weight: weights.scalper },
      { name: 'Confirmation', vote: votes.confirmation, weight: weights.confirmation },
      { name: 'Reversal', vote: votes.reversal, weight: weights.reversal },
      { name: 'Volatility', vote: votes.volatility, weight: weights.volatility },
      { name: 'Risk', vote: votes.risk, weight: weights.risk },
      { name: 'OrderFlow', vote: votes.omega8, weight: weights.omega8 }
    ];

    for (const entry of voteEntries) {
      if (entry.vote) {
        const baseInfo = `${entry.name} (${entry.weight.toFixed(1)}x): ${entry.vote.vote} @ ${entry.vote.confidence}% - ${entry.vote.reasoning}`;

        // Add Omega-8 specific details
        if (entry.name === 'OrderFlow' && votes.omega8) {
          parts.push(`${baseInfo} | Liq: ${votes.omega8.liquidity_bias}`);
        } else {
          parts.push(baseInfo);
        }
      } else {
        parts.push(`${entry.name} (${entry.weight.toFixed(1)}x): UNAVAILABLE`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Build weighted vote summary showing each Omega's contribution
   */
  private buildWeightedVoteSummary(
    votes: OmegaCouncilVotes,
    weights: Record<string, number>,
    consensus: any
  ): string {
    const parts: string[] = [];

    const voteEntries = [
      { name: 'Trend', vote: votes.trend, weight: weights.trend },
      { name: 'Scalper', vote: votes.scalper, weight: weights.scalper },
      { name: 'Confirmation', vote: votes.confirmation, weight: weights.confirmation },
      { name: 'Reversal', vote: votes.reversal, weight: weights.reversal },
      { name: 'Volatility', vote: votes.volatility, weight: weights.volatility },
      { name: 'Risk', vote: votes.risk, weight: weights.risk },
      { name: 'OrderFlow', vote: votes.omega8, weight: weights.omega8 }
    ];

    for (const entry of voteEntries) {
      if (entry.vote) {
        const weightedContribution = (entry.weight * entry.vote.confidence / 100).toFixed(1);
        const voteIcon = entry.vote.vote === 'BUY' ? '📈' : entry.vote.vote === 'SELL' ? '📉' : '⏸️';
        parts.push(`  ${voteIcon} ${entry.name} (${entry.weight.toFixed(1)}x): ${entry.vote.vote} ${entry.vote.confidence}% → ${weightedContribution} pts`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Generate omega vote summary
   */
  private generateOmegaSummary(votes: OmegaCouncilVotes, weights: Record<string, number>): string {
    const summary: string[] = [];

    let buyVotes = 0;
    let sellVotes = 0;
    let noTradeVotes = 0;

    for (const [key, vote] of Object.entries(votes)) {
      if (vote) {
        if (vote.vote === 'BUY') buyVotes++;
        else if (vote.vote === 'SELL') sellVotes++;
        else noTradeVotes++;
      }
    }

    summary.push(`Council: ${buyVotes} BUY, ${sellVotes} SELL, ${noTradeVotes} NO_TRADE`);

    if (votes.risk && votes.risk.vote === 'NO_TRADE') {
      summary.push(`⚠️ Risk specialist vetoed (${votes.risk.reasoning})`);
    }

    if (votes.omega8) {
      if (votes.omega8.liquidity_bias === 'stoprun_risk') {
        summary.push(`⚠️ OrderFlow: Stop-run risk detected`);
      } else if (votes.omega8.liquidity_bias === 'clean') {
        summary.push(`✓ OrderFlow: Clean liquidity`);
      } else {
        summary.push(`OrderFlow: ${votes.omega8.liquidity_bias}`);
      }
    }

    return summary.join(' | ');
  }

  /**
   * Parse Alpha decision with MINIMAL corrections (only catastrophic errors)
   * Elite Trader Directive educates Alpha - we trust professional judgment
   */
  private parseDecision(
    response: string,
    currentPrice: number,
    atr: number,
    symbol: string,
    stopLossAnchor: StopLossCalculation | null = null,
    liquidityZones: LiquidityZone[] = [],
    fullCandles: any[] = [],
    marketContext?: MarketContext,
    riskMode: 'low' | 'medium' | 'high' = 'medium',
    goalContext?: GoalContext,
    regimeSnapshot?: RegimeSnapshot,
    userId?: string,
    sessionId?: string,
    tradeStyle: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' = 'SCALP'
  ): AlphaDecision {
    try {
      // ✅ SSOT FIX: Use centralized sanitizer (handles markdown, comment removal, and JSON extraction)
      // Step 1: Remove JavaScript-style comments before sanitization
      let cleaned = response
        .replace(/\/\/[^\n]*/g, '')           // Remove single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, '');    // Remove multi-line comments

      // Step 2: Sanitize with centralized logic (handles markdown, JSON extraction)
      let parsed: any;
      try {
        parsed = sanitizeAndParse(cleaned, 'alpha decision response');
      } catch (parseError) {
        // Enhanced error logging
        console.error('[Alpha Coordinator] Failed to parse Alpha decision response');
        console.error('Raw response preview:', response.substring(0, 500));
        console.error('After comment removal:', cleaned.substring(0, 500));
        throw parseError;
      }

      // Validate and sanitize action
      let action = parsed.action || 'NO_TRADE';
      if (!['BUY', 'SELL', 'NO_TRADE'].includes(action)) {
        console.warn(`[Alpha Coordinator] Invalid action "${action}" - converting to NO_TRADE`);
        action = 'NO_TRADE';
      }

      // Extract new Alpha output format fields
      const tradeConfidence = parsed.trade_confidence ?? parsed.confidence ?? 0;
      const entryQualityScore = parsed.entry_quality_score ?? 0;
      const entryMode = parsed.entry_mode ?? 'wait_confirmation';

      // SSOT: User's chosen style is IMMUTABLE - LLM cannot override it
      // tradeStyle was already resolved from user's choice at function scope
      const resolvedStyle = tradeStyle;

      // Extract thesis-aware fields (Phase 2: Integration)
      const thesis = parsed.thesis || null;
      const styleIntent = parsed.style_intent || null;
      const executionPreference = parsed.execution_preference || null;
      const acceptableProfitRange = parsed.acceptable_profit_range || null;

      // ═══════════════════════════════════════════════════════════════════
      // CALCULATE RISK PERCENTAGE (SSOT)
      // ═══════════════════════════════════════════════════════════════════
      // Risk percentage calculation priority:
      // 1. LLM response (if provided)
      // 2. Goal context risk percentage (dollar risk / balance)
      // 3. Risk mode defaults (LOW=0.5%, MEDIUM=1%, HIGH=2%)
      let riskPct: number;

      if (parsed.risk_pct !== undefined && parsed.risk_pct > 0) {
        // LLM provided risk percentage
        riskPct = parsed.risk_pct;
        console.log(`[Alpha Coordinator] 📊 Risk: ${riskPct.toFixed(2)}% (from LLM)`);
      } else if (goalContext?.riskPercent) {
        // Use goal context risk percentage
        riskPct = goalContext.riskPercent;
        console.log(`[Alpha Coordinator] 📊 Risk: ${riskPct.toFixed(2)}% (from goal context)`);
      } else {
        // Use risk mode defaults
        const riskDefaults = { low: 0.5, medium: 1.0, high: 2.0 };
        riskPct = riskDefaults[riskMode];
        console.log(`[Alpha Coordinator] 📊 Risk: ${riskPct.toFixed(2)}% (${riskMode} mode default)`);
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 4: NARRATIVE COHERENCE VALIDATION
      // ═══════════════════════════════════════════════════════════════════
      let narrativeValidation: NarrativeValidation | null = null;
      let adjustedConfidence = tradeConfidence;

      // Validate narrative for BUY/SELL actions
      if (action === 'BUY' || action === 'SELL') {
        const marketNarrative = parsed.market_narrative;
        narrativeValidation = narrativeCoherenceValidator.validate(marketNarrative);

        console.log(`[Alpha Coordinator] 📖 Narrative Quality: ${narrativeValidation.qualityTier.toUpperCase()} | Strength: ${narrativeValidation.strengthScore}/100 | Penalty: ${narrativeValidation.confidencePenalty}%`);
        console.log(`[Alpha Coordinator] 📖 Narrative: "${narrativeValidation.narrative || '(none)'}"`);

        // Apply confidence penalty
        adjustedConfidence = Math.max(0, tradeConfidence + narrativeValidation.confidencePenalty);

        // Cap confidence at 69% if narrative doesn't pass gate
        if (!narrativeValidation.passesGate) {
          adjustedConfidence = Math.min(adjustedConfidence, 69);
          console.warn(`[Alpha Coordinator] ⚠️ Narrative quality below threshold - confidence capped at 69%`);
        }

        console.log(`[Alpha Coordinator] 📊 Confidence adjustment: ${tradeConfidence}% → ${adjustedConfidence}% (narrative penalty: ${narrativeValidation.confidencePenalty}%)`);
      }

      // If NO_TRADE, return simple response
      if (action === 'NO_TRADE') {
        return {
          action,
          decision: action,
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: Math.min(100, Math.max(0, tradeConfidence)),
          reasoning: parsed.reasoning || 'No reasoning provided',
          omega_summary: '',
          resolvedStyle,
          risk_pct: riskPct, // SSOT: Always provide risk percentage
          thesis: thesis || undefined,
          style_intent: styleIntent || undefined,
          execution_preference: executionPreference || undefined,
          acceptable_profit_range: acceptableProfitRange || undefined,
          entry_spec: {
            entry_quality_score: entryQualityScore,
            entry_mode: entryMode,
            style: resolvedStyle,
          },
          narrativeValidation: narrativeValidation || undefined
        };
      }

      // REMOVED: WAIT action handling
      // Alpha now only returns BUY, SELL, or NO_TRADE
      // If setup not ready, return NO_TRADE and scanner will re-evaluate

      // Get LLM values with defensive null checks
      // CRITICAL FIX: Explicit null/undefined check to prevent database insertion errors
      // parsed.entry could be null, undefined, or 0 - only fallback if null/undefined
      let entry = (parsed.entry !== null && parsed.entry !== undefined) ? parsed.entry : currentPrice;
      let stopLoss = parsed.stopLoss;
      let takeProfit = parsed.takeProfit;
      const isBuy = action === 'BUY';

      // Additional safety check: ensure entry is a valid number
      if (typeof entry !== 'number' || isNaN(entry) || entry <= 0) {
        console.error(`[Alpha Coordinator] 🚨 INVALID ENTRY PRICE: ${entry} (type: ${typeof entry})`);
        console.error(`[Alpha Coordinator] Falling back to currentPrice: ${currentPrice}`);
        entry = currentPrice;
      }

      // ═══════════════════════════════════════════════════════════════════
      // GEOMETRY VALIDATION (SSOT: alpha-geometry-validator.ts)
      // ═══════════════════════════════════════════════════════════════════
      // CRITICAL: This layer ONLY validates + logs + blocks. NO auto-correction.
      // Alpha's decision authority is maintained - we detect errors but never modify values.

      const geometryValidation = alphaGeometryValidator.validate({
        symbol,
        direction: action as 'BUY' | 'SELL',
        entryPrice: entry,
        stopLoss,
        takeProfit,
        currentMarketPrice: currentPrice,

        // Context for learning
        alphaConfidence: parsed.confidence || 0,
        narrativeQuality: narrativeValidation?.quality,
        narrativeText: parsed.reasoning,
        eqsScore: undefined, // Will be calculated later
        tradeStyle: parsed.style,
        marketRegime: regimeSnapshot?.currentRegime,
        volatilityLevel: regimeSnapshot?.volatilityRegime,
        sessionContext: undefined, // Could add if available

        // Tracking
        userId: userId,
        sessionId: sessionId,
        scanAttemptId: undefined,

        // LLM metadata
        promptVersion: 'v2.0-geometry-reinforced',
        modelUsed: 'gpt-4o-mini',
        tokensUsed: undefined // Track if available
      });

      if (geometryValidation.corrected && geometryValidation.correctedValues) {
        const originalSL = stopLoss;
        const originalTP = takeProfit;
        stopLoss = geometryValidation.correctedValues.stopLoss;
        takeProfit = geometryValidation.correctedValues.takeProfit;

        console.warn(
          `[Alpha Coordinator] GEOMETRY RECOVERY: SL/TP label swap corrected for ${action} ${symbol}. ` +
          `Original: SL=${originalSL?.toFixed(5)}, TP=${originalTP?.toFixed(5)} -> ` +
          `Corrected: SL=${stopLoss.toFixed(5)}, TP=${takeProfit.toFixed(5)}`
        );

        logViolation({
          violationType: 'ALPHA_GEOMETRY_AUTO_CORRECTED',
          symbol,
          attemptedOperation: 'parse_decision',
          callLocation: 'coordinator-alpha.parseDecision',
          blocked: false,
          errorDetails: {
            recoveryType: geometryValidation.recoveryType,
            direction: action,
            entry,
            originalSL,
            originalTP,
            correctedSL: stopLoss,
            correctedTP: takeProfit,
            resolution: 'auto_corrected_label_swap'
          }
        }).catch(error => {
          console.error('[Alpha Coordinator] Failed to log geometry recovery to SSOT:', error);
        });
      }

      if (!geometryValidation.valid) {
        console.error(`[Alpha Coordinator] GEOMETRY ERROR: ${geometryValidation.errorMessage}`);
        console.error(`[Alpha Coordinator] ${action} trade: Entry=${entry.toFixed(5)}, SL=${stopLoss?.toFixed(5)}, TP=${takeProfit?.toFixed(5)}`);
        console.error(`[Alpha Coordinator] Expected: SL ${geometryValidation.expectedGeometry?.slSide}, TP ${geometryValidation.expectedGeometry?.tpSide}`);
        console.error(`[Alpha Coordinator] Error logged to alpha_geometry_errors: ${geometryValidation.errorLogId}`);

        logViolation({
          violationType: `ALPHA_${geometryValidation.errorType}`,
          symbol,
          attemptedOperation: 'parse_decision',
          callLocation: 'coordinator-alpha.parseDecision',
          blocked: true,
          errorDetails: {
            severity: geometryValidation.severity,
            action,
            direction: isBuy ? 'BUY' : 'SELL',
            entry,
            stopLoss,
            takeProfit,
            expectedGeometry: geometryValidation.expectedGeometry,
            errorMessage: geometryValidation.errorMessage,
            resolution: 'hard_blocked'
          }
        }).catch(error => {
          console.error('[Alpha Coordinator] Failed to log geometry violation to SSOT:', error);
        });

        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: 0,
          reasoning: `BLOCKED: ${geometryValidation.errorMessage}`,
          omega_summary: '',
          risk_pct: riskPct,
          narrativeValidation: narrativeValidation || undefined
        };
      }

      console.log(`[Alpha Coordinator] Geometry validation passed`);

      // Additional sanity check for minimum pip distance (< 5 pips survival minimum)
      const MIN_SURVIVAL_PIPS = 5;
      if (stopLoss) {
        const stopDistancePips = calculatePipDistance(symbol, entry, stopLoss);
        if (stopDistancePips < MIN_SURVIVAL_PIPS) {
          console.error(`[Alpha Coordinator] 🚨 Stop distance ${stopDistancePips.toFixed(1)} pips < ${MIN_SURVIVAL_PIPS} pips minimum`);
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: currentPrice,
            stopLoss: currentPrice,
            takeProfit: currentPrice,
            confidence: 0,
            reasoning: `BLOCKED: Stop distance ${stopDistancePips.toFixed(1)} pips below ${MIN_SURVIVAL_PIPS} pip survival minimum`,
            omega_summary: '',
            risk_pct: riskPct,
            narrativeValidation: narrativeValidation || undefined
          };
        }
      }

      let slDistance = Math.abs(entry - stopLoss);
      let tpDistance = Math.abs(takeProfit - entry);
      let rr = slDistance > 0 ? tpDistance / slDistance : 0;
      let slPips = calculatePipDistance(symbol, entry, stopLoss);
      let tpPips = calculatePipDistance(symbol, entry, takeProfit);

      console.log(`[Alpha Decision] Stop: ${slPips.toFixed(1)} pips | TP: ${tpPips.toFixed(1)} pips | R:R: ${rr.toFixed(2)}:1`);

      // ═══════════════════════════════════════════════════════════════════
      // STYLE ENVELOPE TP ENFORCEMENT (SSOT: style-execution-envelopes.ts)
      // ═══════════════════════════════════════════════════════════════════
      // Alpha decides direction and entry. System enforces style bounds.
      // If LLM returns a TP beyond the style envelope, cap it.
      // Trades degrade intelligently - they do not silently over-extend.
      const styleEnvelope = getExecutionEnvelope(resolvedStyle);
      if (tpPips > styleEnvelope.tpPips.max) {
        const originalTP = takeProfit;
        const originalTPPips = tpPips;
        const pipInfo = getCurrencyPipInfo(symbol);
        const cappedDistance = styleEnvelope.tpPips.max * pipInfo.pipValue;

        takeProfit = isBuy
          ? entry + cappedDistance
          : entry - cappedDistance;

        tpPips = styleEnvelope.tpPips.max;
        tpDistance = Math.abs(takeProfit - entry);
        rr = slDistance > 0 ? tpDistance / slDistance : 0;

        console.warn(
          `[Alpha Envelope] TP CAPPED: ${originalTPPips.toFixed(1)} pips → ${tpPips.toFixed(1)} pips ` +
          `(${resolvedStyle} max: ${styleEnvelope.tpPips.max}). ` +
          `Original: ${originalTP.toFixed(5)}, Capped: ${takeProfit.toFixed(5)}`
        );

        logViolation({
          violationType: 'STYLE_ENVELOPE_TP_CAP',
          symbol,
          attemptedOperation: 'tp_style_enforcement',
          callLocation: 'coordinator-alpha.parseDecision',
          blocked: false,
          errorDetails: {
            style: resolvedStyle,
            originalTP,
            cappedTP: takeProfit,
            originalTPPips: originalTPPips,
            cappedTPPips: tpPips,
            envelopeMax: styleEnvelope.tpPips.max,
            entry,
            direction: isBuy ? 'BUY' : 'SELL',
            resolution: 'capped_to_envelope'
          }
        }).catch(() => {});
      }

      // STYLE ENVELOPE SL ENFORCEMENT (SSOT: style-execution-envelopes.ts)
      if (slPips > styleEnvelope.slPips.max) {
        const originalSL = stopLoss;
        const originalSLPips = slPips;
        const pipInfo = getCurrencyPipInfo(symbol);
        const cappedSLDistance = styleEnvelope.slPips.max * pipInfo.pipValue;

        stopLoss = isBuy
          ? entry - cappedSLDistance
          : entry + cappedSLDistance;

        slPips = styleEnvelope.slPips.max;
        slDistance = Math.abs(stopLoss - entry);
        rr = slDistance > 0 ? tpDistance / slDistance : 0;

        console.warn(
          `[Alpha Envelope] SL CAPPED: ${originalSLPips.toFixed(1)} pips -> ${slPips.toFixed(1)} pips ` +
          `(${resolvedStyle} max: ${styleEnvelope.slPips.max}). ` +
          `Original: ${originalSL.toFixed(5)}, Capped: ${stopLoss.toFixed(5)}`
        );

        logViolation({
          violationType: 'STYLE_ENVELOPE_SL_CAP',
          symbol,
          attemptedOperation: 'sl_style_enforcement',
          callLocation: 'coordinator-alpha.parseDecision',
          blocked: false,
          errorDetails: {
            style: resolvedStyle,
            originalSL,
            cappedSL: stopLoss,
            originalSLPips,
            cappedSLPips: styleEnvelope.slPips.max,
            envelopeMax: styleEnvelope.slPips.max,
            entry,
            direction: isBuy ? 'BUY' : 'SELL',
            resolution: 'capped_to_envelope'
          }
        }).catch(() => {});
      }

      // Full envelope validation logging (both SL and TP)
      const envelopeValidation = validateTPSLAgainstEnvelope(resolvedStyle, tpPips, Math.abs(calculatePipDistance(symbol, entry, stopLoss)));
      if (!envelopeValidation.valid) {
        console.warn(`[Alpha Envelope] Remaining violations after enforcement: ${envelopeValidation.violations.join('; ')}`);
      }

      let tp1Result: TP1Result | null = null;
      let tp2Price = takeProfit;
      let tp2Reasoning = `Full profit target at ${tpPips.toFixed(1)} pips (${rr.toFixed(2)}:1 R:R)`;

      if (liquidityZones.length > 0 && fullCandles && fullCandles.length > 0) {
        try {
          tp1Result = tp1ProbabilityCalculator.calculateTP1({
            symbol,
            entryPrice: entry,
            stopLoss,
            direction: isBuy ? 'long' : 'short',
            atr: marketContext?.atr || atr,
            atr20: marketContext?.atr20,
            atr100: marketContext?.atr100,
            liquidityZones,
            recentCandles: fullCandles.slice(-50),
            rsi: fullCandles[fullCandles.length - 1]?.rsi,
            ema20: fullCandles[fullCandles.length - 1]?.ema20,
            ema50: fullCandles[fullCandles.length - 1]?.ema50
          });

          if (tp1Result.feasible && tp1Result.tp1Price) {
            console.log(`[Alpha TP1/TP2] TP1 calculated: ${tp1Result.tp1Price.toFixed(5)} (${tp1Result.tp1Confidence}% confidence)`);
            console.log(`[Alpha TP1/TP2] ${tp1Result.tp1Reasoning}`);
          } else {
            console.log(`[Alpha TP1/TP2] No high-probability TP1 available: ${tp1Result.tp1Reasoning}`);
          }
        } catch (error) {
          console.error('[Alpha TP1/TP2] Error calculating TP1:', error);
        }
      }

      if (!tp1Result?.feasible || !tp1Result?.tp1Price) {
        const fallbackTP1Distance = Math.min(slDistance, tpDistance * 0.6);
        const fallbackTP1Price = isBuy
          ? entry + fallbackTP1Distance
          : entry - fallbackTP1Distance;

        const fallbackTP1Pips = calculatePipDistance(symbol, entry, fallbackTP1Price);
        tp1Result = {
          feasible: true,
          tp1Price: fallbackTP1Price,
          tp1Confidence: 65,
          tp1Reasoning: `Conservative partial target (${fallbackTP1Pips.toFixed(1)} pips, 60% of full TP)`,
          atrMultiplier: null,
          liquidityZoneUsed: null,
          estimatedTimeToFillMinutes: null
        };
        console.log(`[Alpha TP1/TP2] TP1 fallback: ${fallbackTP1Price.toFixed(5)} (${fallbackTP1Pips.toFixed(1)} pips)`);
      }

      // INVARIANT: TP1 must be between entry and TP2 (closer to entry)
      if (tp1Result?.tp1Price && tp2Price) {
        const tp1Dist = Math.abs(tp1Result.tp1Price - entry);
        const tp2Dist = Math.abs(tp2Price - entry);
        if (tp1Dist >= tp2Dist) {
          const correctedTP1 = isBuy
            ? entry + (tp2Dist * 0.6)
            : entry - (tp2Dist * 0.6);
          console.warn(`[Alpha TP1/TP2] TP1 (${tp1Dist.toFixed(5)}) >= TP2 (${tp2Dist.toFixed(5)}), correcting TP1 to 60% of TP2 distance`);
          tp1Result.tp1Price = correctedTP1;
          tp1Result.tp1Reasoning = `Corrected: TP1 set to 60% of TP2 distance to maintain proper partial ordering`;
        }
      }

      return {
        action,
        decision: action,
        entry,
        stopLoss,
        takeProfit, // Legacy field for backward compatibility
        tp1Price: tp1Result?.feasible ? tp1Result.tp1Price : null,
        tp1Confidence: tp1Result?.tp1Confidence || null,
        tp1Reasoning: tp1Result?.tp1Reasoning || null,
        tp2Price,
        tp2Reasoning,
        confidence: Math.round(Math.min(100, Math.max(0, adjustedConfidence))),
        reasoning: parsed.reasoning || 'No reasoning provided',
        omega_summary: '',
        resolvedStyle,
        risk_pct: riskPct, // SSOT: Always provide risk percentage
        thesis: thesis || undefined,
        style_intent: styleIntent || undefined,
        execution_preference: executionPreference || undefined,
        acceptable_profit_range: acceptableProfitRange || undefined,
        entry_spec: {
          entry_quality_score: entryQualityScore,
          entry_mode: entryMode,
          style: resolvedStyle,
        },
        narrativeValidation: narrativeValidation || undefined
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Alpha Coordinator] ❌ Parse error:', errorMsg);
      console.error('[Alpha Coordinator] Symbol:', symbol);
      console.error('[Alpha Coordinator] This is likely an LLM response formatting issue');

      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: currentPrice,
        stopLoss: currentPrice,
        takeProfit: currentPrice,
        confidence: 0,
        reasoning: `LLM response parse failed: ${errorMsg.substring(0, 100)}`,
        omega_summary: '',
        risk_pct: 1.0, // Default for error case
        narrativeValidation: undefined
      };
    }
  }

  /**
   * Build advisory context from Adversarial Detector and Regime Oracle
   */
  private buildAdvisoryContext(adversarial?: AdversarialSignal, regime?: RegimeSnapshot): string {
    if (!adversarial && !regime) {
      return '';
    }

    const parts: string[] = ['\n📡 ADVISORY SIGNALS (Your authority to override):'];

    if (adversarial) {
      parts.push(`\nAdversarial Detector:`);
      parts.push(`  Level: ${adversarial.level} (Score: ${adversarial.suspicion_score}/100)`);
      parts.push(`  Recommendation: ${adversarial.recommended_action}`);
      if (adversarial.patterns.length > 0) {
        parts.push(`  Patterns: ${adversarial.patterns.join(', ')}`);
      }
      if (adversarial.stop_run_classification && adversarial.stop_run_classification.type !== 'none') {
        parts.push(`  Stop-Run: ${adversarial.stop_run_classification.type} (${adversarial.stop_run_classification.candles_ago} candles ago)`);
        parts.push(`  BOS: ${adversarial.stop_run_classification.has_bos ? 'Yes ✓' : 'No'}`);
      }
    }

    if (regime) {
      parts.push(`\nRegime Oracle:`);
      parts.push(`  Session: ${regime.session} ${regime.session_open ? '(open)' : ''}`);
      parts.push(`  Structure: ${regime.structure} | Bias: ${regime.market_bias}`);
      parts.push(`  Volatility: ${regime.volatility_score}/100 (${regime.atr_compression ? 'compressed' : regime.atr_expansion ? 'expanding' : 'normal'})`);
      parts.push(`  Risk Factor: ${(regime.risk_reduction_factor * 100).toFixed(0)}%`);
      if (regime.avoid_trading) {
        parts.push(`  ⚠️ AVOID recommended (but you can override): ${regime.reason || 'No specific reason'}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Build intelligence context from platform-wide learning
   * ENHANCED: Now provides ACTIONABLE behavioral guidance, not just summaries
   */
  private buildIntelligenceContext(intelligence?: AlphaIntelligenceSnapshot | null): string {
    if (!intelligence) {
      return '';
    }

    const parts: string[] = ['\n🧠 ALPHA INTELLIGENCE (Learned Performance Data):'];

    // ACTIONABLE: Platform patterns with FAVOR/AVOID guidance
    if (intelligence.platformPatterns.topPerformingPatterns.length > 0 || intelligence.platformPatterns.failingPatterns.length > 0) {
      parts.push('\n📊 PATTERN PERFORMANCE (Historical Evidence):');

      // Show top 3 winning patterns
      const topPatterns = intelligence.platformPatterns.topPerformingPatterns.slice(0, 3);
      if (topPatterns.length > 0) {
        parts.push('  ✅ FAVOR (Proven Winners):');
        topPatterns.forEach(p => {
          parts.push(`    • ${p.patternId}: ${p.winRate.toFixed(1)}% WR, ${p.avgRMultiple.toFixed(2)}R (n=${p.sampleSize})`);
        });
      }

      // Show top 3 losing patterns
      const failingPatterns = intelligence.platformPatterns.failingPatterns.slice(0, 3);
      if (failingPatterns.length > 0) {
        parts.push('  ❌ AVOID (Proven Losers):');
        failingPatterns.forEach(p => {
          parts.push(`    • ${p.patternId}: ${p.winRate.toFixed(1)}% WR, ${p.avgRMultiple.toFixed(2)}R (n=${p.sampleSize})`);
        });
      }
    }

    // ACTIONABLE: Confidence calibration with behavioral guidance
    const calibrationKeys = Object.keys(intelligence.calibrationData);
    if (calibrationKeys.length > 0) {
      parts.push('\n🎯 CONFIDENCE CALIBRATION (Accuracy Check):');

      // Find buckets with significant miscalibration
      const miscalibrations: Array<{bucket: number, actual: number, error: number}> = [];
      for (const [bucketStr, data] of Object.entries(intelligence.calibrationData)) {
        if (data.sampleSize >= 10 && data.calibrationError > 10) {
          miscalibrations.push({
            bucket: parseInt(bucketStr),
            actual: data.actualWinRate,
            error: data.calibrationError
          });
        }
      }

      if (miscalibrations.length > 0) {
        parts.push('  ⚠️ CALIBRATION WARNINGS:');
        miscalibrations.forEach(m => {
          if (m.actual < m.bucket) {
            parts.push(`    • Your ${m.bucket}% confidence trades actually win ${m.actual.toFixed(0)}% (${m.error.toFixed(0)}% overconfident)`);
          } else {
            parts.push(`    • Your ${m.bucket}% confidence trades actually win ${m.actual.toFixed(0)}% (${m.error.toFixed(0)}% underconfident)`);
          }
        });
        parts.push('    → Confidence will be auto-calibrated based on this data');
      } else {
        parts.push('  ✅ Confidence well-calibrated (within 10% of predicted)');
      }
    }

    // ACTIONABLE: Meta insights with concrete adjustments
    if (intelligence.metaInsights.length > 0) {
      parts.push('\n💡 KEY INSIGHTS (Actionable Adjustments):');
      intelligence.metaInsights.slice(0, 3).forEach(insight => {
        if (insight.validated) {
          parts.push(`  ✅ ${insight.description}`);
          parts.push(`     → ${insight.actionableAdjustment}`);
        }
      });
    }

    // Execution quality
    if (intelligence.executionQuality.avgSlippage > 0) {
      parts.push(`  Execution: ${intelligence.executionQuality.avgSlippage.toFixed(2)} pips avg slippage`);
      if (intelligence.executionQuality.slHuntingSuspected) {
        parts.push(`    ⚠️ SL hunting suspected in recent executions`);
      }
    }

    if (intelligence.counterfactualInsights.sampleSize >= 5) {
      const cf = intelligence.counterfactualInsights;
      parts.push('\n🔄 COUNTERFACTUAL ANALYSIS (What-If Learning):');
      if (cf.bestSlMultiplier !== null) {
        parts.push(`  Optimal SL multiplier: ${cf.bestSlMultiplier.toFixed(2)}x (from ${cf.sampleSize} trades)`);
      }
      if (cf.bestTpMultiplier !== null) {
        parts.push(`  Optimal TP multiplier: ${cf.bestTpMultiplier.toFixed(2)}x`);
      }
      if (cf.earlyExitRecommended) {
        parts.push('  → Pattern: Early exits would have improved outcomes');
      }
      if (cf.holdLongerRecommended) {
        parts.push('  → Pattern: Holding longer would have improved outcomes');
      }
      if (cf.topRecommendation) {
        parts.push(`  Latest: ${cf.topRecommendation}`);
      }
    }

    const zml = intelligence.zoneMetaLearning;
    const hasZoneData = Object.keys(zml.zoneTypeSuccessRates).length > 0 || zml.reachabilityRate > 0;
    if (hasZoneData) {
      parts.push('\n📍 ZONE PERFORMANCE (Entry Zone Learning):');
      const successRates = Object.entries(zml.zoneTypeSuccessRates);
      if (successRates.length > 0) {
        parts.push('  Execution rates by zone type:');
        successRates.forEach(([zoneType, rate]) => {
          parts.push(`    • ${zoneType}: ${(rate * 100).toFixed(0)}% execution rate`);
        });
      }
      if (zml.reachabilityRate > 0) {
        parts.push(`  Reachability: ${(zml.reachabilityRate * 100).toFixed(0)}% | Downgrade rate: ${(zml.downgradeRate * 100).toFixed(0)}%`);
      }
      const unreachable = Object.entries(zml.unreachableByRegime).filter(([, rate]) => rate > 0.3);
      if (unreachable.length > 0) {
        parts.push('  ⚠️ High unreachability regimes:');
        unreachable.forEach(([regime, rate]) => {
          parts.push(`    • ${regime}: ${(rate * 100).toFixed(0)}% unreachable — prefer tighter zones`);
        });
      }
    }

    if (intelligence.tpCalibration) {
      parts.push('\n' + intelligence.tpCalibration);
    }

    const dm = intelligence.decisionMetrics;
    if (dm.totalDecisions >= 5) {
      parts.push('\n📈 YOUR DECISION HISTORY (Self-Learning):');
      parts.push(`  Overall: ${dm.winRate.toFixed(1)}% WR | ${dm.profitFactor.toFixed(2)} PF (${dm.totalDecisions} decisions)`);
      if (dm.overrideSuccessRate > 0) {
        parts.push(`  Override success: ${dm.overrideSuccessRate.toFixed(1)}% | Consensus follow: ${dm.consensusSuccessRate.toFixed(1)}%`);
        if (dm.overrideSuccessRate > dm.consensusSuccessRate + 5) {
          parts.push('  -> Your overrides outperform consensus. Trust your conviction on high-confidence setups.');
        } else if (dm.consensusSuccessRate > dm.overrideSuccessRate + 5) {
          parts.push('  -> Consensus outperforms overrides. Be cautious when deviating from Omega agreement.');
        }
      }
      if (dm.bestOverrideCategory) {
        parts.push(`  Best override type: ${dm.bestOverrideCategory}`);
      }
      if (dm.worstOverrideCategory) {
        parts.push(`  Worst override type: ${dm.worstOverrideCategory} — avoid overriding in this category`);
      }
    }

    const tp1 = intelligence.tp1Learning;
    if (tp1.totalTP1Events >= 3) {
      parts.push('\n🎯 TP1 HIT LEARNING (Close vs Hold):');
      parts.push(`  Close at TP1: ${tp1.closeEarlyWinRate.toFixed(0)}% WR, avg $${tp1.avgPnlCloseEarly.toFixed(2)}`);
      parts.push(`  Hold to TP2: ${tp1.holdToTP2WinRate.toFixed(0)}% WR, avg $${tp1.avgPnlHoldToTP2.toFixed(2)}`);
      if (tp1.recommendation) {
        parts.push(`  -> ${tp1.recommendation}`);
      }
    }

    if (intelligence.validatedInsights.length > 0) {
      parts.push('\n🔬 VALIDATED INSIGHTS (High-Confidence Learnings):');
      intelligence.validatedInsights.slice(0, 3).forEach(insight => {
        parts.push(`  [${insight.confidence.toFixed(0)}%] ${insight.title}: ${insight.description}`);
        if (insight.winRate > 0 && insight.sampleSize >= 5) {
          parts.push(`    Evidence: ${insight.winRate.toFixed(1)}% WR over ${insight.sampleSize} trades`);
        }
      });
    }

    return parts.join('\n');
  }

  /**
   * Log Alpha's override decision to database for learning
   */
  private async logOverride(
    userId: string,
    decisionId: string,
    override: AlphaOverride,
    votes: OmegaCouncilVotes,
    marketContext: MarketContext,
    goalSessionId?: string
  ): Promise<void> {
    try {
      await supabase.from('alpha_authority_overrides').insert({
        user_id: userId,
        goal_session_id: goalSessionId,
        decision_id: decisionId,
        override_type: override.override_type,
        original_recommendation: override.original_recommendation,
        alpha_override_decision: override.alpha_decision,
        statistical_justification: {
          reasoning: override.statistical_justification,
          expected_edge: override.expected_edge
        },
        expected_edge: override.expected_edge,
        confidence_level: 0, // Will be updated when decision result is known
        omega_votes: votes,
        market_context: marketContext,
        actual_outcome: 'pending'
      });

      console.log('[Alpha Coordinator] 📊 Logged override decision for learning');
    } catch (error) {
      console.error('[Alpha Coordinator] Failed to log override:', error);
    }
  }
}

export const alphaCoordinator = new AlphaCoordinatorBrain();
