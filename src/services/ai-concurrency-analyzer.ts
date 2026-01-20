/**
 * AI Concurrency Analyzer
 *
 * Analyzes goals and determines optimal concurrent trade limit (1, 2, or 3).
 * Decision is FINAL - no user override allowed.
 *
 * Logic:
 * - 1 trade max: Goal achievable in 1-2 trades
 * - 2 trades max: Goal needs 3-5 trades in 1 day
 * - 3 trades max: Goal needs 6+ trades over multiple days
 */

import { openAIProxyClient } from './openai-proxy-client';
import { logger } from '../lib/logger';

export interface ConcurrencyAnalysis {
  maxConcurrentTrades: 1 | 2 | 3;
  reasoning: string;
  estimatedTradesNeeded: number;
  estimatedDaysNeeded: number;
  riskLevel: 'conservative' | 'balanced' | 'aggressive';
}

export interface GoalInput {
  goalAmount: number;
  accountBalance: number;
  timeframe: string; // "1 day", "3 days", "1 week", etc.
  timeframeHours: number;
}

export class AIConcurrencyAnalyzer {
  /**
   * Analyzes a goal and determines optimal concurrent trade limit
   */
  async analyzeGoal(input: GoalInput): Promise<ConcurrencyAnalysis> {
    try {
      const { goalAmount, accountBalance, timeframe, timeframeHours } = input;

      // Calculate key metrics
      const goalPercentage = (goalAmount / accountBalance) * 100;
      const avgTradeRisk = 2; // Assume 2% risk per trade
      const avgWinRate = 0.65; // Assume 65% win rate (conservative)
      const avgRR = 2; // Assume 1:2 risk:reward

      // Calculate trades needed with probability
      const expectedTradesForGoal = this.estimateTradesNeeded(
        goalAmount,
        accountBalance,
        avgTradeRisk,
        avgWinRate,
        avgRR
      );

      // Call LLM for reasoning
      const prompt = this.buildConcurrencyPrompt(input, expectedTradesForGoal);

      const response = await openAIProxyClient.chat({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert trading risk manager. Analyze goals and determine optimal concurrent trade limits.

Rules:
- 1 concurrent trade: Goal achievable in 1-2 trades (low complexity)
- 2 concurrent trades: Goal needs 3-5 trades in 1 day (moderate complexity)
- 3 concurrent trades: Goal needs 6+ trades over multiple days (high complexity)

Response format (JSON):
{
  "maxConcurrentTrades": 1 | 2 | 3,
  "reasoning": "Clear 2-3 sentence explanation",
  "riskLevel": "conservative" | "balanced" | "aggressive"
}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3, // Low temperature for consistency
        max_tokens: 300
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from LLM');
      }

      // Parse JSON response
      const analysis = JSON.parse(content);

      // Validate response
      if (![1, 2, 3].includes(analysis.maxConcurrentTrades)) {
        throw new Error('Invalid maxConcurrentTrades value');
      }

      logger.info('AI Concurrency Analysis Complete', {
        goalAmount,
        accountBalance,
        timeframe,
        decision: analysis.maxConcurrentTrades,
        estimatedTrades: expectedTradesForGoal
      });

      return {
        maxConcurrentTrades: analysis.maxConcurrentTrades,
        reasoning: analysis.reasoning,
        estimatedTradesNeeded: expectedTradesForGoal,
        estimatedDaysNeeded: Math.ceil(expectedTradesForGoal / 3), // ~3 trades per day max
        riskLevel: analysis.riskLevel
      };

    } catch (error) {
      logger.error('AI Concurrency Analysis Failed', { error });

      // Fallback: Conservative default
      const fallbackTrades = Math.ceil((input.goalAmount / input.accountBalance) * 50);
      const fallbackConcurrency = fallbackTrades <= 2 ? 1 : fallbackTrades <= 5 ? 2 : 3;

      return {
        maxConcurrentTrades: fallbackConcurrency as 1 | 2 | 3,
        reasoning: 'Fallback analysis: Conservative estimate based on goal size.',
        estimatedTradesNeeded: fallbackTrades,
        estimatedDaysNeeded: Math.ceil(fallbackTrades / 3),
        riskLevel: 'conservative'
      };
    }
  }

  /**
   * Builds the LLM prompt for concurrency analysis
   */
  private buildConcurrencyPrompt(input: GoalInput, estimatedTrades: number): string {
    const { goalAmount, accountBalance, timeframe, timeframeHours } = input;
    const goalPercent = ((goalAmount / accountBalance) * 100).toFixed(1);

    return `Analyze this trading goal:

Goal: $${goalAmount} profit (${goalPercent}% of balance)
Account Balance: $${accountBalance}
Timeframe: ${timeframe} (${timeframeHours} hours)
Estimated Trades Needed: ${estimatedTrades}

Determine optimal concurrent trade limit (1, 2, or 3) and explain why.

Consider:
- Trade complexity: Can this be done in 1-2 big wins, or needs many small wins?
- Time pressure: Does ${timeframe} allow sequential trading, or need parallelization?
- Risk management: Is spreading risk across multiple positions safer here?
- Opportunity cost: Will limiting concurrency miss good setups?

Respond with JSON only.`;
  }

  /**
   * Estimates trades needed using Kelly Criterion logic
   */
  private estimateTradesNeeded(
    goalAmount: number,
    balance: number,
    riskPercent: number,
    winRate: number,
    rr: number
  ): number {
    // PHASE 2: This is estimation-only logic, not actual risk calculation
    // Actual risk management happens through ProfessionalRiskManager.evaluateTrade()
    const riskPerTrade = balance * (riskPercent / 100);
    const avgWinAmount = riskPerTrade * rr; // Win = risk * RR
    const avgLossAmount = riskPerTrade; // Loss = risk amount
    const expectedValue = (winRate * avgWinAmount) - ((1 - winRate) * avgLossAmount);

    if (expectedValue <= 0) {
      return 999; // Impossible goal with negative EV
    }

    // How many trades to reach goal with this EV?
    const tradesNeeded = Math.ceil(goalAmount / expectedValue);

    // Add buffer for variance
    return Math.ceil(tradesNeeded * 1.3);
  }
}

export const aiConcurrencyAnalyzer = new AIConcurrencyAnalyzer();
