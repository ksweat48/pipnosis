/**
 * Alpha Execution Planner
 * Creates strategic trading plans for goal achievement
 * Supports both single-trade (sequential) and multi-trade (simultaneous) modes
 * Integrates Goal Intelligence Layer for mode-specific execution psychology
 */

import { supabase } from '../lib/supabase';
import { openaiProxyClient } from './openai-proxy-client';
import { logger, LogCategory } from '../lib/logger';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';
import { goalIntelligenceClassifier, GoalClassification } from './goal-intelligence-classifier';

export interface TradePlan {
  totalTradesNeeded: number;
  trades: Array<{
    sequenceNumber: number;
    estimatedProfit: number;
    symbol: string;
    timeframe: string;
    confidence: number;
    reasoning: string;
  }>;
  executionMode: 'sequential' | 'simultaneous';
  riskPerTrade: number;
  totalRisk: number;
  strategicNotes: string;
}

export interface PlanningContext {
  goalAmount: number;
  currentBalance: number;
  riskMode: 'low' | 'medium' | 'high';
  timeframe: string;
  watchlist: string[];
  multiTradeEnabled: boolean;
  goalClassification?: GoalClassification;
}

interface MarketSnapshot {
  symbol: string;
  available: boolean;
  price?: number;
  trend?: 'bullish' | 'bearish' | 'sideways';
  volatility?: 'high' | 'medium' | 'low';
  candlesAvailable?: number;
}

class AlphaExecutionPlanner {
  /**
   * Create a strategic plan to achieve the goal
   */
  async createPlan(
    context: PlanningContext,
    userId: string
  ): Promise<TradePlan> {
    try {
      logger.info(LogCategory.AI_TRADING, `[Alpha Planner] Creating strategic plan for $${context.goalAmount} goal`);

      // Classify goal if not already provided
      const goalClassification = context.goalClassification || goalIntelligenceClassifier.classify({
        goalAmount: context.goalAmount,
        accountBalance: context.currentBalance,
        timeframe: context.timeframe
      });

      // Block execution if goal is in Growth Mode
      if (goalClassification.shouldBlockExecution) {
        logger.warn(LogCategory.AI_TRADING, `[Alpha Planner] Goal blocked: ${goalClassification.reasoning}`);
        throw new Error(
          `Goal exceeds safe execution limits (${goalClassification.goalRatioPercent.toFixed(1)}% of balance). ` +
          `${goalClassification.alternativeApproach ? goalClassification.alternativeApproach.reasoning : 'Please reduce goal amount.'}`
        );
      }

      logger.info(
        LogCategory.AI_TRADING,
        `[Alpha Planner] Goal classified as ${goalClassification.mode.toUpperCase()} mode (${goalClassification.goalRatioPercent.toFixed(1)}%)`
      );

      // Build comprehensive market snapshot
      const marketSnapshot = await this.buildMarketSnapshot(context.watchlist);

      // Call GPT-4o-mini to create strategic plan with goal intelligence
      const prompt = this.buildPlanningPrompt(context, marketSnapshot, goalClassification);

      const response = await openaiProxyClient.chat({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are Pipnosis Alpha, an expert trading strategist. Create a detailed plan to achieve the user's goal based on current market conditions. Return ONLY valid JSON, no markdown or explanations.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        requestType: 'alpha-planning'
      });

      const plan = JSON.parse(response.choices[0].message.content) as TradePlan;

      logger.info(LogCategory.AI_TRADING, `[Alpha Planner] Plan created: ${plan.totalTradesNeeded} trades in ${plan.executionMode} mode`);

      return plan;
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Alpha Planner] Error creating plan:', error);

      // Return fallback plan
      return this.createFallbackPlan(context);
    }
  }

  /**
   * Re-assess plan after a trade completes (for single-trade mode)
   */
  async reassessPlan(
    goalSessionId: string,
    completedTrade: any,
    userId: string
  ): Promise<TradePlan> {
    try {
      logger.info(LogCategory.AI_TRADING, `[Alpha Planner] Re-assessing plan after trade completion`);

      // Fetch current session state
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', goalSessionId)
        .single();

      if (!session) {
        throw new Error('Session not found');
      }

      const remainingAmount = session.target_value - session.current_progress;
      const tradesCompleted = session.trades_completed || 0;

      // Get fresh market data
      const marketSnapshot = await this.buildMarketSnapshot(session.watchlist);

      // Ask Alpha to adjust the plan
      const prompt = `
Previous plan execution update:
- Trade ${tradesCompleted} just completed
- P&L: $${completedTrade.profit_loss || 0}
- Goal: $${session.target_value}
- Achieved so far: $${session.current_progress}
- Remaining: $${remainingAmount.toFixed(2)}
- Risk Mode: ${session.risk_mode}

Current market conditions:
${JSON.stringify(marketSnapshot, null, 2)}

Create an adjusted strategic plan for the remaining $${remainingAmount.toFixed(2)}. Consider:
1. What just worked or didn't work
2. Current market conditions
3. Time remaining in session
4. Risk tolerance

Return JSON format:
{
  "totalTradesNeeded": number,
  "trades": [
    {
      "sequenceNumber": number,
      "estimatedProfit": number,
      "symbol": string,
      "timeframe": string,
      "confidence": number (0-1),
      "reasoning": string
    }
  ],
  "executionMode": "sequential",
  "riskPerTrade": number,
  "totalRisk": number,
  "strategicNotes": string
}
`;

      const response = await openaiProxyClient.chat({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are Pipnosis Alpha. Adjust the trading plan based on progress and current markets. Return ONLY valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        requestType: 'alpha-replan'
      });

      const adjustedPlan = JSON.parse(response.choices[0].message.content) as TradePlan;

      // Update plan in database
      await supabase
        .from('goal_sessions')
        .update({
          planned_strategy: adjustedPlan,
          trades_planned: adjustedPlan.totalTradesNeeded
        })
        .eq('id', goalSessionId);

      logger.info(LogCategory.AI_TRADING, `[Alpha Planner] Plan adjusted: ${adjustedPlan.totalTradesNeeded} trades remaining`);

      return adjustedPlan;
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Alpha Planner] Error reassessing plan:', error);
      throw error;
    }
  }

  /**
   * Build planning prompt for Alpha with Goal Intelligence
   */
  private buildPlanningPrompt(
    context: PlanningContext,
    marketSnapshot: MarketSnapshot[],
    goalClassification: GoalClassification
  ): string {
    // Use goal-mode specific max risk
    const maxRiskPercent = goalClassification.maxRiskPerTradePct;
    const maxRiskDollars = context.currentBalance * (maxRiskPercent / 100);

    // Mode-specific execution psychology
    const modeGuidance = this.getModeSpecificGuidance(goalClassification);

    return `
🎯 GOAL INTELLIGENCE CLASSIFICATION
Goal: $${context.goalAmount} (${goalClassification.goalRatioPercent.toFixed(1)}% of balance)
Mode: ${goalClassification.mode.toUpperCase()}
Psychology: ${goalClassification.executionPsychology}
Classification: ${goalClassification.reasoning}

Account Balance: $${context.currentBalance}
Execution Mode: ${context.multiTradeEnabled ? 'Multi-Trade (simultaneous)' : 'Single-Trade (sequential)'}

${modeGuidance}

📊 RISK PARAMETERS
Max Risk Per Trade: ${maxRiskPercent}% ($${maxRiskDollars.toFixed(2)})
Expected Trade Count: ${goalClassification.expectedTradeCount}
Target R:R Range: ${goalClassification.targetRiskRewardRange[0]}-${goalClassification.targetRiskRewardRange[1]}
Min Confidence: ${goalClassification.minConfidenceThreshold}%

Available Symbols: ${context.watchlist.join(', ')}

Current Market Conditions:
${JSON.stringify(marketSnapshot, null, 2)}

Create a strategic trading plan that RESPECTS the ${goalClassification.mode.toUpperCase()} MODE guidelines above:
1. Number of trades (target: ${goalClassification.expectedTradeCount})
2. Expected profit per trade
3. Preferred symbols for each trade
4. Risk per trade (MAX: ${maxRiskPercent}%)
5. R:R ratio per trade (target: ${goalClassification.targetRiskRewardRange[0]}-${goalClassification.targetRiskRewardRange[1]})
6. Strategic reasoning aligned with ${goalClassification.executionPsychology} psychology

CRITICAL: Follow ${goalClassification.mode.toUpperCase()} mode principles strictly

Return ONLY this JSON format (no markdown, no explanations):
{
  "totalTradesNeeded": number,
  "trades": [
    {
      "sequenceNumber": number,
      "estimatedProfit": number,
      "symbol": string,
      "timeframe": "15m",
      "confidence": number (0-1),
      "reasoning": string
    }
  ],
  "executionMode": "${context.multiTradeEnabled ? 'simultaneous' : 'sequential'}",
  "riskPerTrade": number,
  "totalRisk": number,
  "strategicNotes": string
}
`;
  }

  /**
   * Get mode-specific execution guidance
   */
  private getModeSpecificGuidance(classification: GoalClassification): string {
    switch (classification.mode) {
      case 'precision':
        return `
🎯 PRECISION MODE GUIDELINES
- This is a surgical job, not a power play
- Optimize for HIGH PROBABILITY, not max profit
- ONE clean trade is sufficient - no ego trading
- Risk should be goal-scaled, not balance-maxed
- Target R:R: ${classification.targetRiskRewardRange[0]}-${classification.targetRiskRewardRange[1]} (conservative)
- "If the goal is small, trade small. Precision beats power."`;

      case 'execution':
        return `
🎯 EXECUTION MODE GUIDELINES
- Professional execution through sequenced wins
- Expect ${classification.expectedTradeCount} disciplined trades
- Focus on quality setups, not speed
- Risk per trade stays controlled (${classification.maxRiskPerTradePct}%)
- Target R:R: ${classification.targetRiskRewardRange[0]}-${classification.targetRiskRewardRange[1]}
- Only A+ setups - no emotional compression
- "This is achievable, but only through discipline."`;

      case 'campaign':
        return `
🎯 CAMPAIGN MODE GUIDELINES
- Multi-session campaign - DO NOT rush
- Staged progress over time
- Reduce per-trade risk for longevity
- Expect ${classification.expectedTradeCount}+ trades across sessions
- Target R:R: ${classification.targetRiskRewardRange[0]}-${classification.targetRiskRewardRange[1]}
- Consistency over speed
- "Large goals require time, not aggression."`;

      case 'growth':
        return `
�� GROWTH MODE - EXECUTION BLOCKED
- This is a capital problem, not a trading problem
- Goal exceeds safe execution limits
- Alternative approach required
- See staged growth plan`;

      default:
        return '';
    }
  }

  /**
   * Build market snapshot for all symbols
   */
  private async buildMarketSnapshot(symbols: string[]): Promise<MarketSnapshot[]> {
    const snapshots = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const dbTimeframe = normalizeTimeframeToDb('15m');
          const { data: candles } = await supabase
            .from('forex_candles')
            .select('*')
            .eq('symbol', symbol)
            .eq('timeframe', dbTimeframe)
            .order('open_time', { ascending: false })
            .limit(50);

          if (!candles || candles.length === 0) {
            return { symbol, available: false };
          }

          const latest = candles[0];
          const trend = this.calculateTrend(candles);
          const volatility = this.calculateVolatility(candles);

          return {
            symbol,
            available: true,
            price: parseFloat(latest.close),
            trend,
            volatility,
            candlesAvailable: candles.length
          };
        } catch (error) {
          logger.warn(LogCategory.AI_TRADING, `[Alpha Planner] Error fetching ${symbol} data:`, error);
          return { symbol, available: false };
        }
      })
    );

    return snapshots;
  }

  /**
   * Calculate trend from candles
   */
  private calculateTrend(candles: any[]): 'bullish' | 'bearish' | 'sideways' {
    if (candles.length < 20) return 'sideways';

    const prices = candles.map(c => parseFloat(c.close)).reverse();
    const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentPrice = prices[prices.length - 1];

    if (currentPrice > sma20 * 1.002) return 'bullish';
    if (currentPrice < sma20 * 0.998) return 'bearish';
    return 'sideways';
  }

  /**
   * Calculate volatility from candles
   */
  private calculateVolatility(candles: any[]): 'high' | 'medium' | 'low' {
    if (candles.length < 14) return 'medium';

    const ranges = candles
      .slice(0, 14)
      .map(c => parseFloat(c.high) - parseFloat(c.low));

    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const latestPrice = parseFloat(candles[0].close);
    const volatilityPct = (avgRange / latestPrice) * 100;

    if (volatilityPct > 0.5) return 'high';
    if (volatilityPct < 0.2) return 'low';
    return 'medium';
  }

  /**
   * Create fallback plan if AI fails
   */
  private createFallbackPlan(context: PlanningContext): TradePlan {
    const numTrades = context.multiTradeEnabled ? 2 : 1;
    const profitPerTrade = context.goalAmount / numTrades;

    return {
      totalTradesNeeded: numTrades,
      trades: Array.from({ length: numTrades }, (_, i) => ({
        sequenceNumber: i + 1,
        estimatedProfit: profitPerTrade,
        symbol: context.watchlist[i % context.watchlist.length],
        timeframe: '15m',
        confidence: 0.7,
        reasoning: 'Fallback plan - AI planning unavailable'
      })),
      executionMode: context.multiTradeEnabled ? 'simultaneous' : 'sequential',
      // PHASE 2: Use SSOT constant for fallback risk (conservative 3% is above default but acceptable)
      riskPerTrade: context.currentBalance * 0.03, // TODO: Use TRADING_CONSTANTS or ProfessionalRiskManager
      totalRisk: context.currentBalance * 0.03 * numTrades,
      strategicNotes: 'Conservative fallback strategy'
    };
  }

  /**
   * Calculate dual take profit targets for a goal
   * TP1: Conservative "safe zone" target with higher probability
   * TP2: Realistic market target that Alpha believes market will give
   */
  async calculateDualTargets(
    userGoal: number,
    currentBalance: number,
    riskMode: 'low' | 'medium' | 'high'
  ): Promise<{ tp1: number; tp2: number; reasoning: string }> {
    try {
      // Classify the goal
      const classification = goalIntelligenceClassifier.classify({
        goalAmount: userGoal,
        accountBalance: currentBalance,
        timeframe: '1 day' // Default for calculation
      });

      // Base TP1 on conservative probability (45-60% of user's goal)
      // This is the "safe zone" where Alpha is confident user can reach
      let tp1Percentage: number;
      let tp2Percentage: number;

      switch (classification.mode) {
        case 'precision':
          // For precision mode, user's goal is already small and realistic
          tp1Percentage = 0.55; // 55% of goal is very achievable
          tp2Percentage = 0.85; // 85% of goal is what market will likely give
          break;

        case 'execution':
          // For execution mode, goals are moderate but achievable
          tp1Percentage = 0.50; // 50% is high probability
          tp2Percentage = 0.75; // 75% is realistic market target
          break;

        case 'campaign':
          // For campaign mode, goals are ambitious
          tp1Percentage = 0.45; // 45% is conservative
          tp2Percentage = 0.65; // 65% is realistic for this session
          break;

        case 'growth':
          // For growth mode (shouldn't execute, but calculate anyway)
          tp1Percentage = 0.40; // 40% would be impressive
          tp2Percentage = 0.55; // 55% would be exceptional
          break;

        default:
          tp1Percentage = 0.50;
          tp2Percentage = 0.75;
      }

      const tp1 = Math.round(userGoal * tp1Percentage * 100) / 100;
      const tp2 = Math.round(userGoal * tp2Percentage * 100) / 100;

      const reasoning = `Based on ${classification.mode} mode classification: TP1 ($${tp1}) represents a ${(tp1Percentage * 100).toFixed(0)}% conservative target with high probability. TP2 ($${tp2}) represents a ${(tp2Percentage * 100).toFixed(0)}% realistic target that market conditions suggest is achievable.`;

      logger.info(
        LogCategory.AI_TRADING,
        `[Alpha TP Calculator] User Goal: $${userGoal} → TP1: $${tp1} (${(tp1Percentage * 100).toFixed(0)}%) | TP2: $${tp2} (${(tp2Percentage * 100).toFixed(0)}%)`
      );

      return {
        tp1,
        tp2,
        reasoning
      };
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Alpha TP Calculator] Error calculating targets:', error);

      // Fallback to simple calculation
      const tp1 = Math.round(userGoal * 0.50 * 100) / 100;
      const tp2 = Math.round(userGoal * 0.75 * 100) / 100;

      return {
        tp1,
        tp2,
        reasoning: 'Fallback calculation: TP1 at 50%, TP2 at 75% of user goal'
      };
    }
  }
}

export const alphaExecutionPlanner = new AlphaExecutionPlanner();
