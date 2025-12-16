/**
 * Alpha Execution Planner
 * Creates strategic trading plans for goal achievement
 * Supports both single-trade (sequential) and multi-trade (simultaneous) modes
 */

import { supabase } from '../lib/supabase';
import { openaiProxyClient } from './openai-proxy-client';
import { logger, LogCategory } from '../lib/logger';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';

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

      // Build comprehensive market snapshot
      const marketSnapshot = await this.buildMarketSnapshot(context.watchlist);

      // Call GPT-4o-mini to create strategic plan
      const prompt = this.buildPlanningPrompt(context, marketSnapshot);

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
   * Build planning prompt for Alpha
   */
  private buildPlanningPrompt(
    context: PlanningContext,
    marketSnapshot: MarketSnapshot[]
  ): string {
    const riskPercentMap = {
      low: 2,
      medium: 3,
      high: 5
    };

    const maxRiskPercent = riskPercentMap[context.riskMode];
    const maxRiskDollars = context.currentBalance * (maxRiskPercent / 100);

    return `
Goal: Achieve $${context.goalAmount} profit
Account Balance: $${context.currentBalance}
Risk Mode: ${context.riskMode.toUpperCase()} (max ${maxRiskPercent}% risk per trade = $${maxRiskDollars.toFixed(2)})
Timeframe: ${context.timeframe}
Execution Mode: ${context.multiTradeEnabled ? 'Multi-Trade (simultaneous)' : 'Single-Trade (sequential)'}

Available Symbols: ${context.watchlist.join(', ')}

Current Market Conditions:
${JSON.stringify(marketSnapshot, null, 2)}

Create a strategic trading plan with:
1. Number of trades needed (be realistic - don't over-trade)
2. Expected profit per trade
3. Preferred symbols for each trade
4. Risk per trade (MUST NOT exceed $${maxRiskDollars.toFixed(2)})
5. Execution strategy (${context.multiTradeEnabled ? 'execute all trades simultaneously' : 'execute trades one at a time, sequentially'})
6. Strategic reasoning

IMPORTANT RULES:
- Each trade should target AT LEAST $${(context.goalAmount / 3).toFixed(2)} to minimize number of trades
- Risk per trade cannot exceed ${maxRiskPercent}% of balance
- Prefer fewer, higher-quality trades over many small trades
- In single-trade mode, sequence trades by best opportunity first
- In multi-trade mode, diversify across symbols to reduce correlation risk

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
      riskPerTrade: context.currentBalance * 0.03,
      totalRisk: context.currentBalance * 0.03 * numTrades,
      strategicNotes: 'Conservative fallback strategy'
    };
  }
}

export const alphaExecutionPlanner = new AlphaExecutionPlanner();
