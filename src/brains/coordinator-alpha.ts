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
 */

import { openAIClient } from '../services/openai-client';
import type { OmegaVote } from './omega/trend';
import type { Omega8Vote, Omega9ValidationResult } from '../types/omega';
import type { TraderScore } from '../services/ai-identity';
import { omega9Hallucination, type Omega9Input } from './omega9-hallucination-brain';

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
}

export interface AlphaDecision {
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reasoning: string;
  omega_summary: string;
  omega8_liquidity_bias?: string;
  omega8_direction_support?: string;
  omega9_validation?: Omega9ValidationResult;
}

class AlphaCoordinatorBrain {
  /**
   * Coordinate Omega votes and make final decision
   */
  async coordinate(
    votes: OmegaCouncilVotes,
    marketContext: MarketContext,
    traderScore: TraderScore
  ): Promise<AlphaDecision> {
    // Calculate vote weights
    const weights = this.calculateWeights(votes, marketContext, traderScore);

    // Build compressed context
    const context = this.buildCoordinationContext(votes, weights, marketContext, traderScore);

    const prompt = `You are Alpha, the coordinator. Analyze Omega votes and make final decision.

${context}

Decide: BUY, SELL, or NO_TRADE.
Calculate entry, SL (ATR*1.5), TP (ATR*2.5).

Return JSON only:
{
  "action": "BUY|SELL|NO_TRADE",
  "entry": price,
  "stopLoss": price,
  "takeProfit": price,
  "confidence": 0-100,
  "reasoning": "brief decision rationale"
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

      const content = response.choices[0]?.message?.content || '{}';
      let decision = this.parseDecision(content, marketContext.price, marketContext.atr);

      // Add omega summary
      decision.omega_summary = this.generateOmegaSummary(votes, weights);

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

        if (!validation.pass) {
          console.log('[Alpha Coordinator] ❌ Omega-9 BLOCKED trade:', validation.reasoning);
          return {
            action: 'NO_TRADE',
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
   * Calculate vote weights based on regime and personality
   */
  private calculateWeights(
    votes: OmegaCouncilVotes,
    marketContext: MarketContext,
    traderScore: TraderScore
  ): Record<string, number> {
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

    return weights;
  }

  /**
   * Build compressed coordination context
   */
  private buildCoordinationContext(
    votes: OmegaCouncilVotes,
    weights: Record<string, number>,
    marketContext: MarketContext,
    traderScore: TraderScore
  ): string {
    const parts: string[] = [];

    parts.push(`Market: ${marketContext.symbol} | ${marketContext.regime} | ${marketContext.volatility} vol`);
    parts.push(`Price: ${marketContext.price} | ATR: ${marketContext.atr}`);
    parts.push(`Trader: ${traderScore.confidence_level} (Score: ${traderScore.current_score}, Streak: ${traderScore.win_streak})`);
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
   * Parse Alpha decision
   */
  private parseDecision(response: string, currentPrice: number, atr: number): AlphaDecision {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      // Validate and sanitize
      let action = parsed.action || 'NO_TRADE';
      if (!['BUY', 'SELL', 'NO_TRADE'].includes(action)) {
        action = 'NO_TRADE';
      }

      return {
        action,
        entry: parsed.entry || currentPrice,
        stopLoss: parsed.stopLoss || (action === 'BUY' ? currentPrice - atr * 1.5 : currentPrice + atr * 1.5),
        takeProfit: parsed.takeProfit || (action === 'BUY' ? currentPrice + atr * 2.5 : currentPrice - atr * 2.5),
        confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
        reasoning: parsed.reasoning || 'No reasoning provided',
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
}

export const alphaCoordinator = new AlphaCoordinatorBrain();
