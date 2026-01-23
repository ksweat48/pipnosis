import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { calculatePipDistance, getPipValue } from '@/utils/currencyHelpers';

interface EntryRecommendation {
  userId: string;
  tradeId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  alphaEntryPrice: number;
  optimalEntryPrice: number;
  pullbackZoneLow: number;
  pullbackZoneHigh: number;
  patternType: string;
  confidenceScore: number;
  reasoning: string;
}

class EntryPriceMonitorService {
  async generateEntryRecommendation(
    tradeId: string,
    userId: string
  ): Promise<void> {
    try {
      const { data: trade, error } = await supabase
        .from('goal_session_trades')
        .select('symbol, direction, entry_price, stop_loss, take_profit')
        .eq('id', tradeId)
        .single();

      if (error || !trade) {
        logger.error('[EntryPriceMonitor] Failed to fetch trade', { error, tradeId });
        return;
      }

      const recommendation = await this.calculateOptimalEntry(
        trade.symbol,
        trade.direction as 'buy' | 'sell',
        parseFloat(trade.entry_price),
        parseFloat(trade.stop_loss),
        parseFloat(trade.take_profit)
      );

      const { error: insertError } = await supabase
        .from('entry_price_recommendations')
        .insert({
          user_id: userId,
          trade_id: tradeId,
          symbol: recommendation.symbol,
          direction: recommendation.direction,
          alpha_entry_price: recommendation.alphaEntryPrice,
          optimal_entry_price: recommendation.optimalEntryPrice,
          pullback_zone_low: recommendation.pullbackZoneLow,
          pullback_zone_high: recommendation.pullbackZoneHigh,
          pattern_type: recommendation.patternType,
          confidence_score: recommendation.confidenceScore,
          reasoning: recommendation.reasoning,
        });

      if (insertError) {
        logger.error('[EntryPriceMonitor] Failed to insert recommendation', { insertError });
      } else {
        logger.info('[EntryPriceMonitor] Entry recommendation generated', {
          symbol: recommendation.symbol,
          optimalPrice: recommendation.optimalEntryPrice,
        });
      }
    } catch (error) {
      logger.error('[EntryPriceMonitor] Error generating recommendation', { error });
    }
  }

  private async calculateOptimalEntry(
    symbol: string,
    direction: 'buy' | 'sell',
    alphaEntry: number,
    stopLoss: number,
    takeProfit: number
  ): Promise<Omit<EntryRecommendation, 'userId' | 'tradeId'>> {
    const pipValue = getPipValue(symbol);
    const entryToSL = Math.abs(alphaEntry - stopLoss);
    const entryToTP = Math.abs(takeProfit - alphaEntry);

    const pullbackPercent = 0.382;
    let optimalEntry: number;
    let pullbackZoneLow: number;
    let pullbackZoneHigh: number;
    let patternType: string;
    let confidenceScore: number;
    let reasoning: string;

    if (direction === 'buy') {
      optimalEntry = alphaEntry - entryToSL * pullbackPercent;
      pullbackZoneLow = stopLoss + entryToSL * 0.2;
      pullbackZoneHigh = alphaEntry - entryToSL * 0.1;

      const riskReduction = ((alphaEntry - optimalEntry) / entryToSL) * 100;

      if (riskReduction > 30) {
        patternType = 'breakout_pullback';
        confidenceScore = 85;
        reasoning = `Alpha entered at ${alphaEntry.toFixed(pipValue)}. Price may pull back to ${optimalEntry.toFixed(
          pipValue
        )} (38.2% retracement) for better entry. This reduces risk by ${riskReduction.toFixed(
          1
        )}% while maintaining same profit target. Watch for price action between ${pullbackZoneLow.toFixed(
          pipValue
        )} and ${pullbackZoneHigh.toFixed(pipValue)}.`;
      } else if (riskReduction > 15) {
        patternType = 'retracement';
        confidenceScore = 70;
        reasoning = `Consider entry near ${optimalEntry.toFixed(
          pipValue
        )} if price retraces. This offers ${riskReduction.toFixed(
          1
        )}% better risk/reward than Alpha's entry at ${alphaEntry.toFixed(pipValue)}.`;
      } else {
        patternType = 'bounce';
        confidenceScore = 60;
        reasoning = `Alpha's entry at ${alphaEntry.toFixed(
          pipValue
        )} is strong. Minor pullback to ${optimalEntry.toFixed(
          pipValue
        )} possible but not essential. Consider entering on dips within pullback zone.`;
      }
    } else {
      optimalEntry = alphaEntry + entryToSL * pullbackPercent;
      pullbackZoneLow = alphaEntry + entryToSL * 0.1;
      pullbackZoneHigh = stopLoss - entryToSL * 0.2;

      const riskReduction = ((optimalEntry - alphaEntry) / entryToSL) * 100;

      if (riskReduction > 30) {
        patternType = 'breakout_pullback';
        confidenceScore = 85;
        reasoning = `Alpha entered short at ${alphaEntry.toFixed(
          pipValue
        )}. Price may pull back to ${optimalEntry.toFixed(
          pipValue
        )} (38.2% retracement) for better entry. This reduces risk by ${riskReduction.toFixed(
          1
        )}% while maintaining same profit target. Watch for price action between ${pullbackZoneLow.toFixed(
          pipValue
        )} and ${pullbackZoneHigh.toFixed(pipValue)}.`;
      } else if (riskReduction > 15) {
        patternType = 'retracement';
        confidenceScore = 70;
        reasoning = `Consider entry near ${optimalEntry.toFixed(
          pipValue
        )} if price retraces. This offers ${riskReduction.toFixed(
          1
        )}% better risk/reward than Alpha's entry at ${alphaEntry.toFixed(pipValue)}.`;
      } else {
        patternType = 'bounce';
        confidenceScore = 60;
        reasoning = `Alpha's entry at ${alphaEntry.toFixed(
          pipValue
        )} is strong. Minor pullback to ${optimalEntry.toFixed(
          pipValue
        )} possible but not essential. Consider entering on rallies within pullback zone.`;
      }
    }

    return {
      symbol,
      direction,
      alphaEntryPrice: alphaEntry,
      optimalEntryPrice: optimalEntry,
      pullbackZoneLow,
      pullbackZoneHigh,
      patternType,
      confidenceScore,
      reasoning,
    };
  }

  async getLatestRecommendation(userId: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('entry_price_recommendations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('[EntryPriceMonitor] Failed to fetch latest recommendation', { error });
        return null;
      }

      return data;
    } catch (error) {
      logger.error('[EntryPriceMonitor] Error fetching latest recommendation', { error });
      return null;
    }
  }
}

export const entryPriceMonitorService = new EntryPriceMonitorService();
