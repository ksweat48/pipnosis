import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { criticalLevelDetector } from './critical-level-detector';
import type { Candle } from '../types';
import type { PrioritizedLevel } from './critical-level-detector';

export interface TradeLevelResult {
  criticalLevels: any[];
  watchedLevel: any | null;
  earlyExitLevel: number | null;
}

class TradeLevelIntegration {
  async detectAndStoreLevels(
    tradeId: string,
    symbol: string,
    direction: 'long' | 'short',
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    candles: Candle[]
  ): Promise<TradeLevelResult> {
    try {
      const criticalLevels = criticalLevelDetector.detectCriticalLevels(
        candles,
        entryPrice,
        direction
      );

      if (criticalLevels.length === 0) {
        logger.info('[Trade Level Integration] No critical levels detected', {
          tradeId,
          symbol,
          direction
        });

        return {
          criticalLevels: [],
          watchedLevel: null,
          earlyExitLevel: null
        };
      }

      const watchedLevel = criticalLevelDetector.prioritizeLevel(
        criticalLevels,
        entryPrice,
        direction,
        stopLoss,
        takeProfit,
        symbol
      );

      let earlyExitLevel: number | null = null;

      if (watchedLevel) {
        const earlyExitCalc = criticalLevelDetector.calculateEarlyExitLevels(
          entryPrice,
          stopLoss,
          takeProfit,
          direction,
          watchedLevel
        );

        if (earlyExitCalc) {
          earlyExitLevel = earlyExitCalc.earlyExit;
        }
      }

      const levelsForDb = criticalLevels.map(level => ({
        price: level.price,
        type: level.type,
        strength: level.strength,
        touches: level.touches,
        lastTouch: level.lastTouch,
        reason: level.reason
      }));

      const watchedLevelForDb = watchedLevel ? {
        price: watchedLevel.price,
        type: watchedLevel.type,
        strength: watchedLevel.strength,
        distance: watchedLevel.distance,
        urgency: watchedLevel.urgency,
        reason: watchedLevel.reason,
        actionable: watchedLevel.actionable
      } : null;

      await supabase
        .from('goal_session_trades')
        .update({
          critical_levels: levelsForDb,
          watched_level: watchedLevelForDb,
          early_exit_level: earlyExitLevel
        })
        .eq('id', tradeId);

      logger.info('[Trade Level Integration] Stored critical levels for trade', {
        tradeId,
        symbol,
        totalLevels: criticalLevels.length,
        hasWatchedLevel: !!watchedLevel,
        watchedLevelPrice: watchedLevel?.price,
        watchedLevelUrgency: watchedLevel?.urgency,
        earlyExitLevel
      });

      return {
        criticalLevels: levelsForDb,
        watchedLevel: watchedLevelForDb,
        earlyExitLevel
      };

    } catch (error) {
      logger.error('[Trade Level Integration] Error detecting/storing levels', {
        tradeId,
        symbol,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        criticalLevels: [],
        watchedLevel: null,
        earlyExitLevel: null
      };
    }
  }

  async fetchLevelsForTrade(tradeId: string): Promise<{
    criticalLevels: any[];
    watchedLevel: any | null;
    earlyExitLevel: number | null;
  }> {
    try {
      const { data: trade, error } = await supabase
        .from('goal_session_trades')
        .select('critical_levels, watched_level, early_exit_level')
        .eq('id', tradeId)
        .single();

      if (error || !trade) {
        logger.error('[Trade Level Integration] Error fetching levels', {
          tradeId,
          error: error?.message
        });

        return {
          criticalLevels: [],
          watchedLevel: null,
          earlyExitLevel: null
        };
      }

      return {
        criticalLevels: trade.critical_levels || [],
        watchedLevel: trade.watched_level || null,
        earlyExitLevel: trade.early_exit_level || null
      };
    } catch (error) {
      logger.error('[Trade Level Integration] Error fetching levels', {
        tradeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        criticalLevels: [],
        watchedLevel: null,
        earlyExitLevel: null
      };
    }
  }

  parseCriticalLevelsFromDb(levelsJson: any): PrioritizedLevel | null {
    if (!levelsJson || typeof levelsJson !== 'object') return null;

    try {
      return {
        price: levelsJson.price,
        type: levelsJson.type,
        strength: levelsJson.strength,
        distance: levelsJson.distance,
        urgency: levelsJson.urgency,
        reason: levelsJson.reason,
        actionable: levelsJson.actionable
      };
    } catch (error) {
      logger.error('[Trade Level Integration] Error parsing critical levels', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return null;
    }
  }
}

export const tradeLevelIntegration = new TradeLevelIntegration();
