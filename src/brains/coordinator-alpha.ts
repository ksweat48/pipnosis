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
 * 4. Omega-9 Hallucination = ONLY safety module allowed to block
 *    - Validates execution parameters
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
import type { OmegaVote } from './omega/trend';
import type { Omega8Vote, Omega9ValidationResult } from '../types/omega';
import type { TraderScore } from '../services/ai-identity';
import { omega9Hallucination, type Omega9Input } from './omega9-hallucination-brain';
import { omega10Scheduler } from '../services/omega10-scheduler';
import { llmTokenTracker } from '../services/llm-token-tracker';
import { globalIntelligenceProvider } from '../services/global-intelligence-provider';
import { professionalRiskManager } from '../services/professional-risk-manager';
import { alphaIntelligenceAggregator, type AlphaIntelligenceSnapshot } from '../services/alpha-intelligence-aggregator';
import { supabase } from '../lib/supabase';
import type { AdversarialSignal } from '../services/adversarial-detector';
import type { RegimeSnapshot } from '../services/regime-oracle';
import { rrSuccessTracker } from '../services/rr-success-tracker';

export interface OmegaCouncilVotes {
  trend: OmegaVote | null;
  scalper: OmegaVote | null;
  swing: OmegaVote | null;
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
  atr: number;
  atr20?: number;      // Short-term ATR for volatility regime detection
  atr100?: number;     // Long-term ATR for volatility regime detection
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
  takeProfit: number;
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
  goal_context?: GoalContext;
  override?: AlphaOverride;
  intelligence_snapshot?: Partial<AlphaIntelligenceSnapshot>;
  adversarial_advisory?: AdversarialSignal;
  regime_advisory?: RegimeSnapshot;
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
    if (votes.swing) confidences.push(votes.swing.confidence);
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
    // If we don't have ATR20/ATR100, return stable
    if (!marketContext.atr20 || !marketContext.atr100) {
      return {
        regime: 'stable',
        ratio: 1.0,
        recommendation: 'Use standard R:R (2.0-2.5:1)'
      };
    }

    const ratio = marketContext.atr20 / marketContext.atr100;

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
    // Load full intelligence snapshot for comprehensive decision-making
    let intelligenceSnapshot: AlphaIntelligenceSnapshot | null = null;
    if (userId) {
      try {
        intelligenceSnapshot = await alphaIntelligenceAggregator.getFullIntelligenceSnapshot(userId, marketContext.symbol);
        console.log('[Alpha Coordinator] 🧠 Loaded full intelligence snapshot');
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to load intelligence snapshot:', error);
      }
    }
    // Calculate vote weights (with Omega-10 overrides if available)
    const weights = await this.calculateWeights(votes, marketContext, traderScore, userId);

    // Calculate weighted consensus score
    const consensus = this.calculateWeightedConsensus(votes, weights);
    console.log(`[Alpha Coordinator] 📊 Weighted Consensus: ${consensus.direction} ${consensus.score.toFixed(1)}% (${consensus.agreementCount}/${consensus.totalVotes} Omegas)`);

    // Fetch platform-wide intelligence for this symbol
    const platformIntelligence = await this.fetchPlatformIntelligence(marketContext.symbol);

    // Get professional risk assessment (advisory only - Alpha has final authority)
    let riskAssessment = null;
    let riskContext = '';
    if (userId && goalContext) {
      try {
        const preliminaryAssessment = await professionalRiskManager.evaluateTrade({
          userId,
          symbol: marketContext.symbol,
          direction: consensus.direction === 'BUY' ? 'long' : 'short',
          currentBalance: goalContext.currentBalance,
          baseRiskPercent: 0.01,
          currentATR: marketContext.atr,
          goalSessionId: undefined
        });
        riskAssessment = preliminaryAssessment;

        // Build risk context string
        riskContext = `\n📊 PROFESSIONAL RISK ASSESSMENT (Advisory):\n`;
        riskContext += `Risk Score: ${preliminaryAssessment.riskScore.toFixed(0)}/100 | Confidence: ${preliminaryAssessment.confidenceScore.toFixed(0)}/100\n`;
        riskContext += `Recommended Lot Size: ${preliminaryAssessment.recommendedLotSize.toFixed(2)} lots\n`;
        riskContext += `Adjusted Risk: ${(preliminaryAssessment.adjustedRiskPercent * 100).toFixed(2)}%\n`;

        if (preliminaryAssessment.criticalWarnings.length > 0) {
          riskContext += `⚠️ WARNINGS:\n`;
          preliminaryAssessment.criticalWarnings.slice(0, 3).forEach(w => {
            riskContext += `  - ${w}\n`;
          });
        }

        riskContext += `Reasoning: ${preliminaryAssessment.overallReasoning}\n`;
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to get risk assessment:', error);
      }
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

    // Fetch historical R:R performance data for learning
    let rrPerformanceContext = '';
    if (userId) {
      try {
        const performanceSummary = await rrSuccessTracker.getRecentPerformanceSummary(userId, marketContext.symbol);
        if (performanceSummary && performanceSummary.length > 100) {
          rrPerformanceContext = `\n${performanceSummary}\n`;
        }
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to fetch R:R performance:', error);
      }
    }

    // Calculate enhanced intelligence signals
    const confidenceSpread = this.calculateConfidenceSpread(votes);
    const volatilityRegime = this.detectVolatilityRegime(marketContext);
    const stopQuality = this.calculateStopQualityScore(votes.omega8, null); // omega9 validation happens later

    // Build goal context (if trading with a goal)
    let goalContextText = '';
    if (goalContext && goalContext.hasGoal) {
      const riskPercent = goalContext.riskPercent || 5; // Use actual risk from user settings
      const maxRisk = goalContext.currentBalance * (riskPercent / 100);
      const dollarPerPipPerLot = marketContext.symbol.includes('JPY') ? 10 : marketContext.symbol.includes('XAU') ? 100 : 10;

      const exampleSL15 = maxRisk / (15 * dollarPerPipPerLot);
      const exampleSL30 = maxRisk / (30 * dollarPerPipPerLot);
      const exampleSL50 = maxRisk / (50 * dollarPerPipPerLot);

      const recentATR = marketContext.atr || 60;
      const avgCandleRange = recentATR * 0.7;

      goalContextText = `\n🎯 GOAL TRADING MODE:\nBalance: $${goalContext.currentBalance.toFixed(2)} | Target: +$${goalContext.targetGoal.toFixed(2)}\nProgress: $${goalContext.currentProgress.toFixed(2)} | Remaining: $${goalContext.remainingGoal.toFixed(2)}\n\n📊 POSITION SIZING EDUCATION:\nYou have ${riskPercent}% risk = $${maxRisk.toFixed(2)} available per trade\nPosition sizing formula: Lot Size = Risk Amount / (SL Pips × $${dollarPerPipPerLot}/pip per lot)\n\nEXAMPLES FOR ${marketContext.symbol}:\n- 15-pip SL: ${exampleSL15.toFixed(2)} lots available (tight, scalp-style)\n- 30-pip SL: ${exampleSL30.toFixed(2)} lots available (standard swing)\n- 50-pip SL: ${exampleSL50.toFixed(2)} lots available (wider breathing room)\n\nKEY INSIGHT: Wider SLs don't hurt you - they give trades breathing room while position size automatically adjusts to maintain proper risk. Don't fear wider stops!\n\n📈 MARKET REALITY CHECK:\nCurrent ATR: ${recentATR.toFixed(0)} pips | Recent Avg Range: ${avgCandleRange.toFixed(0)} pips/candle\nMinimum viable SL: ${(recentATR * 0.4).toFixed(0)} pips (avoid noise)\nRealistic TP ranges: ${(recentATR * 0.5).toFixed(0)}-${(recentATR * 1.5).toFixed(0)} pips achievable today\n\n⚠️ COMMON MISTAKES TO AVOID:\n- 2-3 pip SLs get stopped by market noise (100% failure rate)\n- 100+ pip TPs rarely fill unless major catalyst present\n- Lottery tickets (10:1+ R:R) almost never work\n\n✅ PROFESSIONAL APPROACH FOR $${goalContext.remainingGoal.toFixed(0)} GOAL:\nOption A: 1 trade with ${(goalContext.remainingGoal / (30 * dollarPerPipPerLot)).toFixed(2)} lots, 30-pip SL, 60-pip TP (2:1 R:R)\nOption B: 2 trades with ${(goalContext.remainingGoal / 2 / (20 * dollarPerPipPerLot)).toFixed(2)} lots each, 20-pip SL, 40-pip TP\nOption C: Multiple quality setups if market not offering full goal in one trade\n\nREMEMBER: Markets move in realistic increments. Take achievable profits through quality execution, not lottery tickets.\n`;
    }

    // Build intelligence context
    let intelligenceContext = this.buildIntelligenceContext(intelligenceSnapshot);

    const prompt = `You are Alpha, the final decision maker. You have COMPLETE AUTHORITY to accept or override ANY recommendation.

${context}

WEIGHTED CONSENSUS: ${consensus.direction} ${consensus.score.toFixed(1)}% (${consensus.agreementCount}/${consensus.totalVotes} agree)${conflictContext}${advisoryContext}${riskContext}${rrPerformanceContext}${intelligenceContext}${goalContextText}

🎯 ELITE ALPHA INTELLIGENCE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Omega Council Agreement:
  Confidence Spread: ${confidenceSpread.stdDev.toFixed(1)}% (Avg: ${confidenceSpread.avgConfidence.toFixed(0)}%)
  ${confidenceSpread.isHighAgreement ? '✅ HIGH CONSENSUS - can use wider R:R (2.5-3.5:1)' : '⚠️ HIGH DISAGREEMENT - tighten R:R to 1.5-2.0:1'}

📈 Volatility Regime:
  Status: ${volatilityRegime.regime.toUpperCase()} ${volatilityRegime.ratio !== 1.0 ? `(ATR ratio: ${volatilityRegime.ratio.toFixed(2)})` : ''}
  Recommendation: ${volatilityRegime.recommendation}

🛡️ Stop Quality Assessment:
  Score: ${stopQuality.score}/100
  ${stopQuality.recommendation}
${goalContext?.riskMode ? `
💰 Risk Allocation (${goalContext.riskMode.toUpperCase()} Mode):
  Risk per trade: ${goalContext.riskPercent}% = $${(goalContext.currentBalance * (goalContext.riskPercent || 5) / 100).toFixed(2)}
  ${goalContext.riskMode === 'low' ? 'Conservative mode - favor 1.5:1-2.0:1 R:R for consistency' :
    goalContext.riskMode === 'high' ? 'Aggressive mode - 2.5:1-4.0:1 R:R acceptable with high confidence' :
    'Balanced mode - 2.0:1-3.0:1 R:R optimal'}
` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR FULL AUTHORITY:
- Override Adversarial blocks when statistical edge is strong (manipulation resolved, BOS confirmed)
- Override Regime avoid_trading when symbol-specific conditions justify it
- Override Risk Omega if setup quality justifies it
- Override consensus if you see better opportunity
- Make contrarian calls based on platform intelligence
- Request mental timeout if confidence borderline (45-55%)

ADVISORY SIGNALS (NOT BLOCKERS):
${adversarialSignal ? `- Adversarial: ${adversarialSignal.recommended_action} (${adversarialSignal.level} level, score: ${adversarialSignal.suspicion_score})` : '- Adversarial: No concerns'}
${regimeSnapshot ? `- Regime: Risk factor ${(regimeSnapshot.risk_reduction_factor * 100).toFixed(0)}% ${regimeSnapshot.avoid_trading ? '(AVOID recommended but you can override)' : ''}` : '- Regime: Normal'}

Your job: Synthesize ALL intelligence and make the BEST decision. You can override any safety recommendation if statistically justified.

Decide: BUY, SELL, or NO_TRADE.
Calculate entry, SL (dynamic ATR buffer), TP (dynamic R:R based on context).

🛡️ GRADUATED SAFETY ZONES (Enforced by Omega-9):
- GREEN ZONE (R:R >= 1.5:1, TP >= 5 ATR): Full authority, optimal conditions
- YELLOW ZONE (R:R 1.0-1.5:1, TP 3-5 ATR): Suboptimal, proceed with caution
- ORANGE ZONE (R:R 0.5-1.0:1, TP 2-3 ATR): Risky, requires override reasoning
- RED ZONE (R:R < 0.5:1, TP < 2 ATR): HARD BLOCK - Cannot override even for goals

${goalContext && goalContext.hasGoal ? `\n🎯 GOAL-AWARE TRADING MODE:
- Goal: $${goalContext.targetGoal.toFixed(0)} (${goalContext.goalPercentage.toFixed(3)}% of balance)
- Progress: $${goalContext.currentProgress.toFixed(0)} (${(goalContext.currentProgress / goalContext.targetGoal * 100).toFixed(1)}% complete)
- Remaining: $${goalContext.remainingGoal.toFixed(0)}
- Est. pips needed: ~${goalContext.pipsNeededEstimate.toFixed(0)} pips

GOAL-AWARE DIRECTIVE:
- For small goals (< 0.1% of balance): You may use tighter TP (1.5R-2.0R) for faster fills
- CRITICAL: Even for small goals, MAINTAIN MINIMUM 1.0:1 R:R to stay in YELLOW ZONE
- Never go below 0.5:1 R:R - this triggers RED ZONE hard block
- Balance speed vs safety: Quick fills are good, but survival is mandatory` : ''}

CRITICAL POSITIONING RULES:
- BUY trades: stopLoss MUST be BELOW entry, takeProfit MUST be ABOVE entry
- SELL trades: stopLoss MUST be ABOVE entry, takeProfit MUST be BELOW entry
- Example BUY: entry=1.2000, stopLoss=1.1950 (below), takeProfit=1.2100 (above)
- Example SELL: entry=1.2000, stopLoss=1.2050 (above), takeProfit=1.1900 (below)
- Minimum R:R: 1.0:1 (YELLOW ZONE), aim for 1.5:1+ (GREEN ZONE)
- VERIFY your prices match the trade direction before returning

If you override any safety recommendation, include your statistical justification in reasoning.

Return JSON only:
{
  "action": "BUY|SELL|NO_TRADE",
  "entry": price,
  "stopLoss": price,
  "takeProfit": price,
  "confidence": 0-100,
  "reasoning": "brief decision rationale - state if you overrode any recommendations and why",
  "override": {
    "type": "adversarial_block|regime_avoid|risk_limit|none",
    "justification": "statistical reasoning if override occurred"
  }
}`;

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
          max_tokens: 150,
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
        contextType: 'fusion',
        userId: userId,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      let decision = this.parseDecision(content, marketContext.price, marketContext.atr);

      // Add decision field for compatibility
      decision.decision = decision.action;
      decision.symbol = marketContext.symbol;
      decision.timestamp = new Date();

      // Add omega summary and votes for transparency
      decision.omega_summary = this.generateOmegaSummary(votes, weights);
      decision.omega_votes = votes;

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
        const rawDecision = JSON.parse(parsed.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
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

      // Check Omega-10 recommendations
      if (userId) {
        const omega10Analysis = await omega10Scheduler.getLatestAnalysis(userId);
        if (omega10Analysis && omega10Analysis.riskHorizon.level === 'high') {
          console.log('[Alpha Coordinator] ⚠️ Omega-10 risk horizon: HIGH - reducing confidence');
          decision.confidence = Math.max(0, decision.confidence - 20);
          decision.omega10_applied = true;
          decision.reasoning += ' [Omega-10: High risk horizon detected]';
        }
      }

      // Add Omega-8 insights
      if (votes.omega8) {
        decision.omega8_liquidity_bias = votes.omega8.liquidity_bias;
        decision.omega8_direction_support = votes.omega8.direction_support;

        // Reduce position size if stop-run risk detected
        if (votes.omega8.liquidity_bias === 'stoprun_risk') {
          decision.confidence = Math.max(0, decision.confidence - 15);
          console.log('[Alpha Coordinator] ⚠️ Omega-8 flags stop-run risk - reducing confidence');
        }
      }

      // Omega-9 validation (final safety check)
      if (decision.action !== 'NO_TRADE') {
        console.log('[Alpha Coordinator] 🛡️ Running Omega-9 validation...');

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
            minRR: 1.5,
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
          console.log('[Alpha Coordinator] 🚨 RED ZONE HARD BLOCK - Trade cannot proceed');
          console.log('[Alpha Coordinator] ❌ Omega-9 HARD BLOCKED:', validation.reasoning);
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: marketContext.price,
            stopLoss: marketContext.price,
            takeProfit: marketContext.price,
            confidence: 0,
            reasoning: `🚨 RED ZONE HARD BLOCK: ${validation.reasoning}. This trade violates mathematical survival limits.`,
            omega_summary: decision.omega_summary,
            omega8_liquidity_bias: decision.omega8_liquidity_bias,
            omega8_direction_support: decision.omega8_direction_support,
            omega9_validation: validation
          };
        }

        // Check for other validation failures
        if (!validation.pass) {
          console.log('[Alpha Coordinator] ❌ Omega-9 BLOCKED trade:', validation.reasoning);
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: marketContext.price,
            stopLoss: marketContext.price,
            takeProfit: marketContext.price,
            confidence: 0,
            reasoning: `Omega-9 block: ${validation.reasoning}`,
            omega_summary: decision.omega_summary,
            omega8_liquidity_bias: decision.omega8_liquidity_bias,
            omega8_direction_support: decision.omega8_direction_support,
            omega9_validation: validation
          };
        }

        // Log safety zone status
        if (validation.safety_zone) {
          const zoneEmoji = validation.safety_zone === 'GREEN' ? '✅' : validation.safety_zone === 'YELLOW' ? '⚡' : validation.safety_zone === 'ORANGE' ? '⚠️' : '🚨';
          console.log(`[Alpha Coordinator] ${zoneEmoji} Safety Zone: ${validation.safety_zone} | Safety Score: ${validation.safety_evaluation?.safety_score || 0}/100`);

          if (validation.safety_zone === 'ORANGE') {
            console.log('[Alpha Coordinator] ⚠️ ORANGE ZONE: Trade allowed but requires Alpha override reasoning');
          } else if (validation.safety_zone === 'YELLOW') {
            console.log('[Alpha Coordinator] ⚡ YELLOW ZONE: Suboptimal conditions detected, proceeding with caution');
          }
        }

        // Apply Omega-9 corrections if provided
        if (validation.corrections.sl !== null) {
          console.log(`[Alpha Coordinator] 🔧 Omega-9 corrected SL: ${decision.stopLoss} → ${validation.corrections.sl}`);
          decision.stopLoss = validation.corrections.sl;
        }
        if (validation.corrections.tp !== null) {
          console.log(`[Alpha Coordinator] 🔧 Omega-9 corrected TP: ${decision.takeProfit} → ${validation.corrections.tp}`);
          decision.takeProfit = validation.corrections.tp;
        }

        // Apply confidence adjustment
        decision.confidence = Math.max(0, Math.min(100, decision.confidence + validation.confidence_adjustment));

        console.log('[Alpha Coordinator] ✅ Omega-9 validation passed');
      }

      console.log('[Alpha Coordinator] Decision:', decision.action);
      console.log('[Alpha Coordinator] Confidence:', decision.confidence);
      console.log('[Alpha Coordinator] Reasoning:', decision.reasoning);
      console.log('[Alpha Coordinator] Omega Summary:', decision.omega_summary);

      return decision;
    } catch (error) {
      console.error('[Alpha Coordinator] Error:', error);
      return {
        action: 'NO_TRADE',
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
    direction: 'BUY' | 'SELL' | 'NO_TRADE' | 'MIXED';
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
      { name: 'trend', vote: votes.trend, weight: weights.trend },
      { name: 'scalper', vote: votes.scalper, weight: weights.scalper },
      { name: 'swing', vote: votes.swing, weight: weights.swing },
      { name: 'reversal', vote: votes.reversal, weight: weights.reversal },
      { name: 'volatility', vote: votes.volatility, weight: weights.volatility },
      { name: 'risk', vote: votes.risk, weight: weights.risk * 0.5 }, // Reduce Risk weight to advisory level
      { name: 'omega8', vote: votes.omega8, weight: weights.omega8 }
    ];

    for (const entry of voteEntries) {
      if (!entry.vote) continue;

      totalVotes++;
      const weightedConfidence = entry.weight * entry.vote.confidence;
      totalWeight += entry.weight;

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

    // Strong agreement = 4+ Omegas agree AND weighted score > 65%
    const strongAgreement = agreementCount >= 4 && score >= 65;

    return {
      direction,
      score,
      agreementCount,
      totalVotes,
      strongAgreement
    };
  }

  /**
   * Calculate vote weights based on regime and personality
   * Includes Omega-10 meta-reasoning overrides
   */
  private async calculateWeights(
    votes: OmegaCouncilVotes,
    marketContext: MarketContext,
    traderScore: TraderScore,
    userId?: string
  ): Promise<Record<string, number>> {
    const weights: Record<string, number> = {
      trend: 1.0,
      scalper: 1.0,
      swing: 1.0,
      reversal: 1.0,
      volatility: 1.0,
      risk: 1.0,
      omega8: 1.0
    };

    // Adjust by market regime
    if (marketContext.regime === 'bull' || marketContext.regime === 'bear') {
      weights.trend = 1.5;      // Trending - boost trend specialist
      weights.swing = 1.3;      // Structure matters in trends
      weights.scalper = 0.8;    // Reduce scalping in strong trends
    } else if (marketContext.regime === 'side') {
      weights.scalper = 1.5;    // Ranging - boost scalper
      weights.reversal = 1.3;   // Reversals common in ranges
      weights.trend = 0.8;      // Reduce trend following
    }

    // Adjust by volatility
    if (marketContext.volatility === 'high') {
      weights.volatility = 1.5; // Boost volatility specialist
      weights.risk = 1.4;       // Risk is critical in volatility
      weights.scalper = 0.7;    // Scalping risky in high vol
    } else if (marketContext.volatility === 'low') {
      weights.scalper = 1.3;    // Scalping good in low vol
      weights.volatility = 0.9;
    }

    // Adjust by trader personality
    if (traderScore.confidence_level === 'aggressive') {
      weights.scalper = weights.scalper * 1.2;
      weights.reversal = weights.reversal * 1.1;
      weights.risk = weights.risk * 0.9;
    } else if (traderScore.confidence_level === 'cautious') {
      weights.risk = weights.risk * 1.5;     // Risk is VERY important
      weights.swing = weights.swing * 1.2;   // Structure confirmation
      weights.scalper = weights.scalper * 0.8;
    }

    // Losing streak - weight risk heavily
    if (traderScore.win_streak < 0) {
      weights.risk = weights.risk * 1.5;
    }

    // High score - trust trend more
    if (traderScore.current_score >= 85) {
      weights.trend = weights.trend * 1.2;
    }

    // Risk specialist ALWAYS important
    weights.risk = Math.max(weights.risk, 1.2);

    // Omega-8 OrderFlow adjustments
    if (votes.omega8 && votes.omega8.confidence >= 70) {
      weights.omega8 = 1.5;  // High confidence orderflow analysis
    }
    if (marketContext.regime === 'side') {
      weights.omega8 = weights.omega8 * 1.2;  // Boost in ranging markets (stop-run risk higher)
    }
    if (marketContext.volatility === 'high') {
      weights.omega8 = weights.omega8 * 1.15;  // Boost in high volatility (liquidity matters more)
    }
    if (traderScore.confidence_level === 'cautious') {
      weights.omega8 = weights.omega8 * 1.1;  // Cautious traders value liquidity analysis
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
    parts.push(`Price: ${marketContext.price} | ATR: ${marketContext.atr}`);
    parts.push(`Trader: ${traderScore.confidence_level} (Score: ${traderScore.current_score}, Streak: ${traderScore.win_streak})`);

    if (platformIntelligence) {
      parts.push('');
      parts.push(platformIntelligence);
    }

    parts.push('');
    parts.push('Omega Votes (weighted):');

    const voteEntries = [
      { name: 'Trend', vote: votes.trend, weight: weights.trend },
      { name: 'Scalper', vote: votes.scalper, weight: weights.scalper },
      { name: 'Swing', vote: votes.swing, weight: weights.swing },
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
   * Parse Alpha decision with validation and automatic correction
   */
  private parseDecision(response: string, currentPrice: number, atr: number): AlphaDecision {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      // Validate and sanitize action
      let action = parsed.action || 'NO_TRADE';
      if (!['BUY', 'SELL', 'NO_TRADE'].includes(action)) {
        action = 'NO_TRADE';
      }

      // If NO_TRADE, return simple response
      if (action === 'NO_TRADE') {
        return {
          action,
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
          reasoning: parsed.reasoning || 'No reasoning provided',
          omega_summary: ''
        };
      }

      // Get LLM values or use defaults
      let entry = parsed.entry || currentPrice;
      let stopLoss = parsed.stopLoss;
      let takeProfit = parsed.takeProfit;
      let correctionsMade = false;

      // Validate SL/TP positioning
      const isBuy = action === 'BUY';

      // Check if stopLoss is valid
      const slValid = stopLoss && (
        (isBuy && stopLoss < entry) ||
        (!isBuy && stopLoss > entry)
      );

      // Check if takeProfit is valid
      const tpValid = takeProfit && (
        (isBuy && takeProfit > entry) ||
        (!isBuy && takeProfit < entry)
      );

      // Check for zero distance
      const slZeroDistance = stopLoss && Math.abs(entry - stopLoss) < 0.00001;
      const tpZeroDistance = takeProfit && Math.abs(entry - takeProfit) < 0.00001;

      // Auto-correct invalid values
      if (!slValid || slZeroDistance) {
        const oldSL = stopLoss;
        stopLoss = isBuy ? entry - atr * 1.5 : entry + atr * 1.5;
        console.log(`[Alpha Coordinator] 🔧 Corrected invalid SL: ${oldSL} → ${stopLoss} (${action})`);
        correctionsMade = true;
      }

      if (!tpValid || tpZeroDistance) {
        const oldTP = takeProfit;
        takeProfit = isBuy ? entry + atr * 2.5 : entry - atr * 2.5;
        console.log(`[Alpha Coordinator] 🔧 Corrected invalid TP: ${oldTP} → ${takeProfit} (${action})`);
        correctionsMade = true;
      }

      // Validate R:R ratio
      const slDistance = Math.abs(entry - stopLoss);
      const tpDistance = Math.abs(takeProfit - entry);
      const rr = slDistance > 0 ? tpDistance / slDistance : 0;

      if (rr < 1.5) {
        // Adjust TP to achieve minimum 1.5:1 R:R
        takeProfit = isBuy ? entry + slDistance * 1.5 : entry - slDistance * 1.5;
        console.log(`[Alpha Coordinator] 🔧 Adjusted TP for R:R 1.5:1 → ${takeProfit}`);
        correctionsMade = true;
      }

      return {
        action,
        entry,
        stopLoss,
        takeProfit,
        confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
        reasoning: parsed.reasoning || 'No reasoning provided' + (correctionsMade ? ' [Auto-corrected SL/TP]' : ''),
        omega_summary: ''
      };
    } catch (error) {
      console.error('[Alpha Coordinator] Parse error:', error);
      return {
        action: 'NO_TRADE',
        entry: currentPrice,
        stopLoss: currentPrice,
        takeProfit: currentPrice,
        confidence: 0,
        reasoning: 'Parse failed',
        omega_summary: ''
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
   */
  private buildIntelligenceContext(intelligence?: AlphaIntelligenceSnapshot | null): string {
    if (!intelligence) {
      return '';
    }

    const parts: string[] = ['\n🧠 ALPHA INTELLIGENCE (Platform Learning):'];

    // Platform patterns
    if (intelligence.platformPatterns.topPerformingPatterns.length > 0) {
      const top = intelligence.platformPatterns.topPerformingPatterns[0];
      parts.push(`  Top Pattern: ${top.patternId} (WR: ${top.winRate.toFixed(1)}%, R: ${top.avgRMultiple.toFixed(2)}, n=${top.sampleSize})`);
    }

    // Override history
    if (intelligence.overrideHistory.totalOverrides > 0) {
      parts.push(`  Override History: ${intelligence.overrideHistory.totalOverrides} total, ${intelligence.overrideHistory.successRate.toFixed(1)}% success rate`);
    }

    // Confidence calibration
    const calibrationKeys = Object.keys(intelligence.calibrationData);
    if (calibrationKeys.length > 0) {
      parts.push(`  Confidence Calibration: ${calibrationKeys.length} buckets tracked`);
    }

    // Reasoning patterns
    if (intelligence.reasoningPatterns.length > 0) {
      const topPattern = intelligence.reasoningPatterns[0];
      parts.push(`  Top Reasoning: ${topPattern.description.substring(0, 50)}... (${topPattern.effectiveness.toFixed(1)}% effective)`);
    }

    // Meta insights
    if (intelligence.metaInsights.length > 0) {
      const topInsight = intelligence.metaInsights[0];
      parts.push(`  Key Insight: ${topInsight.description.substring(0, 60)}...`);
    }

    // Execution quality
    if (intelligence.executionQuality.avgSlippage > 0) {
      parts.push(`  Execution: ${intelligence.executionQuality.avgSlippage.toFixed(2)} pips avg slippage`);
      if (intelligence.executionQuality.slHuntingSuspected) {
        parts.push(`    ⚠️ SL hunting suspected in recent executions`);
      }
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
