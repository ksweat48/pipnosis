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
import { MarketDataService } from './market-data-service';
import { getCurrencyPipInfo, calculateDollarPerPip } from '../utils/currencyHelpers';
import { riskToleranceEnforcer } from './risk-tolerance-enforcer';

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
          // ✅ PHASE 2: Use MarketDataService as SSOT
          const marketDataService = MarketDataService.getInstance();
          const candles = await marketDataService.getCandles(symbol, '15m', 50);

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
   * Estimate market profit potential based on technical indicators
   * SSOT: This is the authoritative calculation for market capability
   */
  private async estimateMarketPotential(
    symbol: string,
    direction: 'buy' | 'sell',
    entryPrice: number,
    atr?: number
  ): Promise<{
    predictedProfitMin: number;
    predictedProfitMax: number;
    confidence: number;
    reasoning: string;
  }> {
    try {
      // ✅ SSOT FIX: Get ATR from market data if not provided (with graceful fallback)
      let currentATR = atr;
      if (!currentATR) {
        try {
          const { data: atrData, error: atrError } = await supabase
            .from('market_atr_values')
            .select('atr_value')
            .eq('symbol', symbol)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (atrError) {
            // Table might not exist or RLS blocking - gracefully degrade
            console.warn(`[Alpha Execution Planner] Could not fetch ATR from market_atr_values (${atrError.code}): ${atrError.message}`);
            console.warn('[Alpha Execution Planner] Falling back to percentage-based estimation');
          } else {
            currentATR = atrData?.atr_value || null;
          }
        } catch (atrFetchError) {
          // Network error or other exception - gracefully degrade
          console.warn('[Alpha Execution Planner] Exception fetching ATR, using fallback:', atrFetchError);
        }
      }

      // Fallback: Use percentage-based estimation if no ATR
      if (!currentATR) {
        const conservativeMove = entryPrice * 0.003; // 0.3% move
        const optimisticMove = entryPrice * 0.008; // 0.8% move

        // Estimate profit based on typical position size
        const typicalPositionSize = 0.1; // 0.1 lots
        const pipInfo = getCurrencyPipInfo(symbol);
        const dollarPerPip = calculateDollarPerPip(symbol, typicalPositionSize);

        const minPips = conservativeMove / pipInfo.pipValue;
        const maxPips = optimisticMove / pipInfo.pipValue;

        const predictedProfitMin = Math.round(minPips * dollarPerPip * 100) / 100;
        const predictedProfitMax = Math.round(maxPips * dollarPerPip * 100) / 100;

        return {
          predictedProfitMin,
          predictedProfitMax,
          confidence: 60,
          reasoning: `Market potential estimated without ATR data. Conservative $${predictedProfitMin} to optimistic $${predictedProfitMax} based on typical ${symbol} volatility patterns.`
        };
      }

      // Calculate profit potential based on ATR
      // Conservative: 1.5x ATR move, Optimistic: 3.0x ATR move
      const conservativeMove = currentATR * 1.5;
      const optimisticMove = currentATR * 3.0;

      // CCIP FIX: Use risk-based position sizing instead of hardcoded 0.1 lots
      // This ensures market assessment respects user's risk tolerance
      // OLD BUG: hardcoded 0.1 lot made market estimates too conservative
      // Assume typical SL distance of 10 pips for estimation purposes
      const estimatedSLDistance = 10;
      const positionSizingResult = riskToleranceEnforcer.calculatePositionSizeFromRiskTolerance(
        symbol,
        {
          riskPercentage: 2.0, // Default conservative for estimation
          riskMode: 'medium',
          accountBalance: 1000, // Use standard account for market assessment
        },
        estimatedSLDistance,
        currentATR
      );

      const typicalPositionSize = positionSizingResult.positionSizeLots;
      const pipInfo = getCurrencyPipInfo(symbol);
      const dollarPerPip = calculateDollarPerPip(symbol, typicalPositionSize);

      const minPips = conservativeMove / pipInfo.pipValue;
      const maxPips = optimisticMove / pipInfo.pipValue;

      const predictedProfitMin = Math.round(minPips * dollarPerPip * 100) / 100;
      const predictedProfitMax = Math.round(maxPips * dollarPerPip * 100) / 100;

      return {
        predictedProfitMin,
        predictedProfitMax,
        confidence: 75,
        reasoning: `Market potential based on ATR analysis. ${symbol} with ATR=${currentATR.toFixed(5)} suggests conservative $${predictedProfitMin} (1.5x ATR) to optimistic $${predictedProfitMax} (3.0x ATR) profit range.`
      };
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Market Potential Estimator] Error:', error);

      // Emergency fallback
      return {
        predictedProfitMin: 50,
        predictedProfitMax: 120,
        confidence: 50,
        reasoning: 'Fallback estimation due to technical error. Conservative $50 to optimistic $120 range.'
      };
    }
  }

  /**
   * Calculate dual take profit targets for a goal
   * TP1: Conservative "safe zone" target with higher probability
   * TP2: Realistic market target that Alpha believes market will give
   *
   * ✅ SSOT COMPLIANCE: Uses Alpha's market assessment as authoritative source
   * ✅ GOVERNANCE: Market assessment overrides user goal if goal exceeds market potential
   */
  async calculateDualTargets(
    userGoal: number,
    currentBalance: number,
    riskMode: 'low' | 'medium' | 'high',
    options?: {
      marketAssessment?: {
        predictedProfitMin: number;
        predictedProfitMax: number;
        confidence: number;
        reasoning: string;
      };
      symbol?: string;
      direction?: 'buy' | 'sell';
      entryPrice?: number;
      atr?: number;
    }
  ): Promise<{
    tp1: number;
    tp2: number;
    reasoning: string;
    marketAssessment?: {
      predictedProfitMin: number;
      predictedProfitMax: number;
      confidence: number;
      reasoning: string;
    };
    adjustedGoal?: number;
    goalAdjusted: boolean;
  }> {
    try {
      let tp1: number;
      let tp2: number;
      let reasoning: string;
      let adjustedGoal: number | undefined;
      let goalAdjusted = false;
      let marketAssessment = options?.marketAssessment;

      // ✅ AUTO-GENERATE MARKET ASSESSMENT if not provided
      // This enables market-aligned TPs without requiring upstream changes
      if (!marketAssessment && options?.symbol && options?.direction && options?.entryPrice) {
        logger.info(
          LogCategory.AI_TRADING,
          `[Alpha TP Calculator] No market assessment provided, auto-generating for ${options.symbol}`
        );

        marketAssessment = await this.estimateMarketPotential(
          options.symbol,
          options.direction,
          options.entryPrice,
          options.atr
        );
      }

      // ✅ SSOT: If Alpha provided or generated market assessment, use it as truth
      if (marketAssessment) {
        // TP2 = Alpha's maximum predicted profit (what market will realistically give)
        tp2 = Math.round(marketAssessment.predictedProfitMax * 100) / 100;

        // TP1 = Conservative portion of market potential (65-70% of TP2)
        // This represents high-probability zone within market's capability
        tp1 = Math.round(marketAssessment.predictedProfitMax * 0.65 * 100) / 100;

        // Ensure TP1 doesn't fall below minimum prediction
        tp1 = Math.max(tp1, marketAssessment.predictedProfitMin);

        // Check if user goal exceeds market capability
        if (userGoal > marketAssessment.predictedProfitMax) {
          adjustedGoal = marketAssessment.predictedProfitMax;
          goalAdjusted = true;
          reasoning = `Market Assessment: Alpha predicts market can give $${marketAssessment.predictedProfitMin}-$${marketAssessment.predictedProfitMax}. Your goal ($${userGoal}) exceeds market capability, adjusted to $${adjustedGoal}. ${marketAssessment.reasoning}. TP1 ($${tp1}) = conservative 65% zone. TP2 ($${tp2}) = market maximum.`;
        } else {
          reasoning = `Market Assessment: Alpha predicts market can give $${marketAssessment.predictedProfitMin}-$${marketAssessment.predictedProfitMax}. ${marketAssessment.reasoning}. TP1 ($${tp1}) = conservative entry at 65% of market potential. TP2 ($${tp2}) = market maximum within capability.`;
        }

        logger.info(
          LogCategory.AI_TRADING,
          `[Alpha TP Calculator - Market Aligned] Market Range: $${marketAssessment.predictedProfitMin}-$${marketAssessment.predictedProfitMax} | User Goal: $${userGoal}${goalAdjusted ? ` → Adjusted: $${adjustedGoal}` : ''} | TP1: $${tp1} | TP2: $${tp2}`
        );
      } else {
        // FALLBACK: No market assessment provided - use legacy goal-based calculation
        // This should rarely happen after market assessment integration
        logger.warn(
          LogCategory.AI_TRADING,
          `[Alpha TP Calculator] No market assessment provided, using legacy goal-based calculation`
        );

        const classification = goalIntelligenceClassifier.classify({
          goalAmount: userGoal,
          accountBalance: currentBalance,
          timeframe: '1 day'
        });

        let tp1Percentage: number;
        let tp2Percentage: number;

        switch (classification.mode) {
          case 'precision':
            tp1Percentage = 0.55;
            tp2Percentage = 0.85;
            break;
          case 'execution':
            tp1Percentage = 0.50;
            tp2Percentage = 0.75;
            break;
          case 'campaign':
            tp1Percentage = 0.45;
            tp2Percentage = 0.65;
            break;
          case 'growth':
            tp1Percentage = 0.40;
            tp2Percentage = 0.55;
            break;
          default:
            tp1Percentage = 0.50;
            tp2Percentage = 0.75;
        }

        tp1 = Math.round(userGoal * tp1Percentage * 100) / 100;
        tp2 = Math.round(userGoal * tp2Percentage * 100) / 100;

        reasoning = `⚠️ Legacy calculation (no market assessment): Based on ${classification.mode} mode. TP1 ($${tp1}) = ${(tp1Percentage * 100).toFixed(0)}% conservative. TP2 ($${tp2}) = ${(tp2Percentage * 100).toFixed(0)}% goal-based estimate.`;
      }

      return {
        tp1,
        tp2,
        reasoning,
        marketAssessment,
        adjustedGoal,
        goalAdjusted
      };
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[Alpha TP Calculator] Error calculating targets:', error);

      // Emergency fallback
      const tp1 = Math.round(userGoal * 0.50 * 100) / 100;
      const tp2 = Math.round(userGoal * 0.75 * 100) / 100;

      return {
        tp1,
        tp2,
        reasoning: '⚠️ Fallback calculation due to error: TP1 at 50%, TP2 at 75% of user goal',
        goalAdjusted: false
      };
    }
  }
}

export const alphaExecutionPlanner = new AlphaExecutionPlanner();
