/**
 * Mid-Trade Monitor Service
 *
 * SSOT for mid-trade guidance data and recommendations
 * Aggregates data from multiple sources:
 * - Active trades from goal_session_trades
 * - Real-time prices from realtime_prices
 * - AI evaluations from goal_ai_conversations
 * - Trigger detection from mid-trade-trigger-detector
 *
 * GOVERNANCE: Read-only service - does NOT execute trades
 * Trade closures MUST go through trade-closure-coordinator
 */

import { supabase } from '@/lib/supabase';
import { calculatePnL } from '@/types/position';
import type { GoalSessionTrade } from '@/types/position';

export interface MidTradeGuidance {
  tradeId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  currentPnL: number;
  timeInTrade: number; // minutes

  // Risk metrics
  distanceToSL: number; // pips
  distanceToTP: number; // pips
  drawdownPercent: number; // 0-100
  urgencyScore: number; // 0-100 (higher = more urgent)

  // Primary guidance
  primaryAction: 'hold' | 'trail_sl' | 'warning' | 'tp1_timing' | 'risk_alert';
  primaryMessage: string;
  actionColor: 'emerald' | 'amber' | 'red' | 'blue' | 'orange';

  // AI evaluation (if available)
  aiRecommendation?: string;
  aiConfidence?: number;
  aiTimestamp?: string;

  // Price freshness (SSOT compliance)
  priceAgeSeconds?: number;
  isPriceFresh?: boolean;
  stalePriceWarning?: string;

  // Session context
  goalSessionId: string;
  goalProgress?: number;
  goalTarget?: number;
}

export interface MidTradeMonitorStats {
  totalOpenTrades: number;
  tradesByUrgency: {
    critical: number; // Near SL
    high: number; // Drawdown or warning
    medium: number; // Routine updates
    low: number; // Holding well
  };
  totalUnrealizedPnL: number;
}

class MidTradeMonitorService {
  private lastRequestTime = 0;
  private requestInProgress = false;
  private lastSuccessfulUserId: string | null = null;

  /**
   * Get all mid-trade guidance for user's active trades
   * Sorted by urgency (most urgent first)
   *
   * CCIP COMPLIANCE:
   * - Throttling is transparent (logged)
   * - First request bypasses throttling (ensures initial discovery)
   * - Prevents concurrent requests (re-entrancy protection)
   */
  async getMidTradeGuidance(userId: string): Promise<{
    guidance: MidTradeGuidance[];
    stats: MidTradeMonitorStats;
  }> {
    const emptyResponse = {
      guidance: [],
      stats: {
        totalOpenTrades: 0,
        tradesByUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
        totalUnrealizedPnL: 0
      }
    };

    // Prevent concurrent requests to same user (re-entrancy protection)
    if (this.requestInProgress) {
      console.debug('[MidTradeMonitor] Request already in progress, returning cached state');
      return emptyResponse;
    }

    // Throttle requests: max once per 500ms, UNLESS first request for this user
    const now = Date.now();
    const isFirstRequest = this.lastSuccessfulUserId !== userId;
    const timeSinceLastRequest = now - this.lastRequestTime;
    const isThrottled = timeSinceLastRequest < 500;

    if (isThrottled && !isFirstRequest) {
      console.debug(`[MidTradeMonitor] Throttled (${timeSinceLastRequest}ms since last request, min 500ms required)`);
      return emptyResponse;
    }

    this.lastRequestTime = now;
    this.requestInProgress = true;

    try {
      // Fetch all open trades
      const { data: trades, error: tradesError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (tradesError) throw tradesError;
      if (!trades || trades.length === 0) {
        return {
          guidance: [],
          stats: {
            totalOpenTrades: 0,
            tradesByUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
            totalUnrealizedPnL: 0
          }
        };
      }

      // Fetch current prices for all symbols
      const symbols = Array.from(new Set(trades.map(t => t.symbol)));
      const { data: prices, error: pricesError } = await supabase
        .from('realtime_prices')
        .select('symbol, bid, ask, created_at')
        .in('symbol', symbols)
        .order('created_at', { ascending: false });

      if (pricesError) {
        console.error('[MidTradeMonitor] Error fetching prices:', pricesError);
      }

      // Build price map (most recent price per symbol)
      const priceMap = new Map<string, { bid: number; ask: number; age: number; ageSeconds: number }>();
      if (prices) {
        for (const price of prices) {
          if (!priceMap.has(price.symbol)) {
            const ageMs = Date.now() - new Date(price.created_at).getTime();
            const ageSeconds = Math.floor(ageMs / 1000);
            const ageMinutes = ageSeconds / 60;
            priceMap.set(price.symbol, {
              bid: parseFloat(price.bid),
              ask: parseFloat(price.ask),
              age: ageMinutes,
              ageSeconds
            });
          }
        }
      }

      // Fetch price freshness status from SSOT table
      const { data: stalenessData } = await supabase
        .from('polling_price_staleness')
        .select('symbol, staleness_minutes, is_critical')
        .in('symbol', symbols);

      const stalenessMap = new Map<string, { staleness_minutes: number; is_critical: boolean }>();
      if (stalenessData) {
        stalenessData.forEach(item => {
          stalenessMap.set(item.symbol, {
            staleness_minutes: item.staleness_minutes,
            is_critical: item.is_critical
          });
        });
      }

      // Fetch recent AI evaluations (last 24 hours)
      const { data: aiEvaluations } = await supabase
        .from('goal_ai_conversations')
        .select('trade_id, content, metadata, created_at')
        .eq('user_id', userId)
        .in('conversation_type', ['mid_trade_alert', 'periodic_wellness', 'trade_milestone'])
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });

      // Build AI evaluation map (most recent per trade)
      const aiMap = new Map<string, { content: string; confidence: number; timestamp: string }>();
      if (aiEvaluations) {
        for (const evaluation of aiEvaluations) {
          if (!aiMap.has(evaluation.trade_id)) {
            aiMap.set(evaluation.trade_id, {
              content: evaluation.content,
              confidence: evaluation.metadata?.confidence || 75,
              timestamp: evaluation.created_at
            });
          }
        }
      }

      // Build guidance for each trade
      const guidanceList: MidTradeGuidance[] = [];
      let totalPnL = 0;

      for (const trade of trades) {
        const priceData = priceMap.get(trade.symbol);

        // Use current_price from trade if realtime unavailable (fallback)
        const currentPrice = priceData
          ? (trade.direction === 'buy' ? priceData.bid : priceData.ask)
          : (trade.current_price || trade.entry_price);

        // Calculate P&L
        const lotSize = trade.lot_size || trade.position_size;
        const pnl = calculatePnL(
          trade.direction,
          trade.entry_price,
          currentPrice,
          lotSize,
          trade.symbol
        );

        totalPnL += pnl;

        // Calculate risk metrics
        const risk = Math.abs(trade.entry_price - trade.stop_loss);
        const isLong = trade.direction === 'buy';
        const priceDiff = isLong
          ? (currentPrice - trade.entry_price)
          : (trade.entry_price - currentPrice);
        const riskRatio = priceDiff / risk;

        const distanceToSL = Math.abs(currentPrice - trade.stop_loss);
        const slProximity = distanceToSL / risk; // 0 = at SL, 1 = at entry
        const drawdownPercent = Math.max(0, (-riskRatio) * 100);

        const distanceToTP = Math.abs(currentPrice - trade.take_profit);

        // Calculate time in trade
        const timeInTrade = trade.opened_at
          ? (Date.now() - new Date(trade.opened_at).getTime()) / 1000 / 60
          : 0;

        // Generate guidance
        const guidance = this.generateGuidance(
          trade,
          currentPrice,
          pnl,
          slProximity,
          riskRatio,
          drawdownPercent,
          timeInTrade,
          aiMap.get(trade.id)
        );

        // Check price freshness for this symbol
        const staleness = stalenessMap.get(trade.symbol);
        const priceAgeSeconds = priceData?.ageSeconds || 0;
        const isFresh = !staleness?.is_critical && priceAgeSeconds < 300; // Fresh if < 5 min and not critical
        let stalePriceWarning: string | undefined;

        if (staleness?.is_critical) {
          stalePriceWarning = `WARNING: Price data is ${Math.round(staleness.staleness_minutes)} minutes stale - guidance may be inaccurate`;
        } else if (priceAgeSeconds > 120) {
          stalePriceWarning = `CAUTION: Price data is ${Math.round(priceAgeSeconds / 60)} minutes old`;
        }

        guidanceList.push({
          tradeId: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          entryPrice: trade.entry_price,
          currentPrice,
          stopLoss: trade.stop_loss,
          takeProfit: trade.take_profit,
          takeProfit1: trade.take_profit_1,
          takeProfit2: trade.take_profit_2,
          currentPnL: pnl,
          timeInTrade,
          distanceToSL: distanceToSL / 0.0001, // Convert to pips
          distanceToTP: distanceToTP / 0.0001,
          drawdownPercent,
          urgencyScore: guidance.urgencyScore,
          primaryAction: guidance.action,
          primaryMessage: guidance.message,
          actionColor: guidance.color,
          aiRecommendation: aiMap.get(trade.id)?.content,
          aiConfidence: aiMap.get(trade.id)?.confidence,
          aiTimestamp: aiMap.get(trade.id)?.timestamp,
          priceAgeSeconds,
          isPriceFresh: isFresh,
          stalePriceWarning,
          goalSessionId: trade.goal_session_id
        });
      }

      // Sort by urgency (highest first)
      guidanceList.sort((a, b) => b.urgencyScore - a.urgencyScore);

      // Calculate stats
      const stats: MidTradeMonitorStats = {
        totalOpenTrades: guidanceList.length,
        tradesByUrgency: {
          critical: guidanceList.filter(g => g.urgencyScore >= 80).length,
          high: guidanceList.filter(g => g.urgencyScore >= 60 && g.urgencyScore < 80).length,
          medium: guidanceList.filter(g => g.urgencyScore >= 40 && g.urgencyScore < 60).length,
          low: guidanceList.filter(g => g.urgencyScore < 40).length
        },
        totalUnrealizedPnL: totalPnL
      };

      // Track successful request for this user (enables first-request throttling bypass)
      this.lastSuccessfulUserId = userId;

      return { guidance: guidanceList, stats };
    } catch (error) {
      // Ignore AbortError - these happen when requests are cancelled (component unmount, session close, etc.)
      const isAbortError = error instanceof Error && (
        error.name === 'AbortError' ||
        error.message?.includes('signal is aborted') ||
        error.message?.includes('AbortError')
      );

      if (isAbortError) {
        // Silently return empty guidance - request was aborted
        return {
          guidance: [],
          stats: {
            totalOpenTrades: 0,
            tradesByUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
            totalUnrealizedPnL: 0
          }
        };
      }

      // Only log non-abort errors
      console.error('[MidTradeMonitor] Error getting guidance:', error);
      return {
        guidance: [],
        stats: {
          totalOpenTrades: 0,
          tradesByUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
          totalUnrealizedPnL: 0
        }
      };
    } finally {
      this.requestInProgress = false;
    }
  }

  /**
   * Generate guidance based on trade state
   * GOVERNANCE: This is advisory only - does NOT execute trades
   */
  private generateGuidance(
    trade: GoalSessionTrade,
    currentPrice: number,
    pnl: number,
    slProximity: number,
    riskRatio: number,
    drawdownPercent: number,
    timeInTrade: number,
    aiEval?: { content: string; confidence: number; timestamp: string }
  ): {
    action: 'hold' | 'trail_sl' | 'warning' | 'tp1_timing' | 'risk_alert';
    message: string;
    color: 'emerald' | 'amber' | 'red' | 'blue' | 'orange';
    urgencyScore: number;
  } {
    // PRIORITY 1: Critical risk (near stop loss)
    if (slProximity < 0.15) {
      return {
        action: 'risk_alert',
        message: `CRITICAL: Price very close to stop loss (${(slProximity * 100).toFixed(1)}% away). Position may close soon.`,
        color: 'red',
        urgencyScore: 95
      };
    }

    // PRIORITY 2: Severe drawdown
    if (drawdownPercent >= 70) {
      return {
        action: 'warning',
        message: `Severe drawdown at ${drawdownPercent.toFixed(0)}% of risk. Price approaching stop loss territory.`,
        color: 'red',
        urgencyScore: 90
      };
    }

    // PRIORITY 3: Significant drawdown
    if (drawdownPercent >= 50) {
      return {
        action: 'warning',
        message: `Moderate drawdown at ${drawdownPercent.toFixed(0)}% of risk. Monitoring closely for reversal or stop hit.`,
        color: 'amber',
        urgencyScore: 75
      };
    }

    // PRIORITY 4: Trail stop loss opportunity (profitable trade)
    if (riskRatio >= 1.5) {
      const profit = riskRatio.toFixed(1);
      return {
        action: 'trail_sl',
        message: `Strong profit at +${profit}R. Consider trailing stop loss to lock in gains.`,
        color: 'emerald',
        urgencyScore: 65
      };
    }

    // PRIORITY 5: TP1 timing (near first target)
    if (trade.take_profit_1 && !trade.tp1_hit_at) {
      const distanceToTP1 = Math.abs(currentPrice - trade.take_profit_1);
      const totalTP1Distance = Math.abs(trade.take_profit_1 - trade.entry_price);
      const tp1Progress = 1 - (distanceToTP1 / totalTP1Distance);

      if (tp1Progress >= 0.80) {
        return {
          action: 'tp1_timing',
          message: `Near TP1 target (${(tp1Progress * 100).toFixed(0)}% complete). Monitoring momentum for optimal exit.`,
          color: 'blue',
          urgencyScore: 55
        };
      }
    }

    // PRIORITY 6: Moderate progress (normal trading)
    if (riskRatio >= 0.5) {
      return {
        action: 'hold',
        message: `Trade progressing well at +${riskRatio.toFixed(1)}R. Continue holding as direction remains valid.`,
        color: 'emerald',
        urgencyScore: 30
      };
    }

    // PRIORITY 7: Minor drawdown (acceptable)
    if (drawdownPercent >= 20 && drawdownPercent < 50) {
      return {
        action: 'hold',
        message: `Minor drawdown at ${drawdownPercent.toFixed(0)}% of risk. Normal market fluctuation, within acceptable range.`,
        color: 'amber',
        urgencyScore: 45
      };
    }

    // PRIORITY 8: Early stage or breakeven
    if (Math.abs(riskRatio) < 0.2) {
      const timeDesc = timeInTrade < 15 ? 'Early stage' : 'Ranging near entry';
      return {
        action: 'hold',
        message: `${timeDesc}. Price near breakeven. Monitoring for directional confirmation.`,
        color: 'blue',
        urgencyScore: 25
      };
    }

    // DEFAULT: Normal holding
    return {
      action: 'hold',
      message: `Trade active for ${this.formatTime(timeInTrade)}. Direction valid, continue monitoring.`,
      color: 'blue',
      urgencyScore: 20
    };
  }

  /**
   * Format time in human-readable way
   */
  private formatTime(minutes: number): string {
    if (minutes < 1) return '<1 min';
    if (minutes < 60) return `${Math.floor(minutes)} min`;

    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);

    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }
}

export const midTradeMonitorService = new MidTradeMonitorService();
