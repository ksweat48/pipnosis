import { logger } from '../lib/logger';
import { Candle } from '../types';

interface CriticalLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;
  touches: number;
  lastTouch: number;
  reason: string;
}

interface PrioritizedLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;
  distance: number;
  urgency: number;
  reason: string;
  actionable: string;
}

export class CriticalLevelDetector {
  private readonly MIN_TOUCHES = 2;
  private readonly PRICE_TOLERANCE_PERCENT = 0.15;
  private readonly LOOKBACK_CANDLES = 50;

  detectCriticalLevels(
    candles: Candle[],
    currentPrice: number,
    direction: 'long' | 'short'
  ): CriticalLevel[] {
    if (!candles || candles.length < 20) {
      logger.warn('[CriticalLevelDetector] Insufficient candles for level detection', {
        candleCount: candles?.length || 0
      });
      return [];
    }

    const recentCandles = candles.slice(-this.LOOKBACK_CANDLES);
    const swingLevels = this.findSwingLevels(recentCandles);
    const clusters = this.clusterLevels(swingLevels, currentPrice);
    const criticalLevels = this.scoreLevels(clusters, currentPrice, direction);

    logger.info('[CriticalLevelDetector] Detected critical levels', {
      direction,
      currentPrice,
      totalLevels: criticalLevels.length,
      supportLevels: criticalLevels.filter(l => l.type === 'support').length,
      resistanceLevels: criticalLevels.filter(l => l.type === 'resistance').length
    });

    return criticalLevels;
  }

  prioritizeLevel(
    levels: CriticalLevel[],
    currentPrice: number,
    direction: 'long' | 'short',
    stopLoss: number,
    takeProfit: number
  ): PrioritizedLevel | null {
    if (levels.length === 0) return null;

    const relevantLevels = direction === 'long'
      ? levels.filter(l => l.price > currentPrice && l.type === 'resistance')
      : levels.filter(l => l.price < currentPrice && l.type === 'support');

    if (relevantLevels.length === 0) return null;

    const scoredLevels = relevantLevels.map(level => {
      const distance = Math.abs(level.price - currentPrice);
      const distancePips = distance * 10000;
      const distancePercent = (distance / currentPrice) * 100;

      const tpDistance = Math.abs(takeProfit - currentPrice);
      const levelBeforeTP = direction === 'long'
        ? level.price < takeProfit
        : level.price > takeProfit;

      const proximityScore = distancePips < 10 ? 100 :
                           distancePips < 20 ? 80 :
                           distancePips < 30 ? 60 : 40;

      const strengthScore = level.strength * 100;
      const touchScore = Math.min(level.touches * 20, 100);
      const urgencyBonus = levelBeforeTP ? 50 : 0;

      const urgency = (proximityScore + strengthScore + touchScore + urgencyBonus) / 3.5;

      const actionable = this.generateActionableAdvice(
        level,
        currentPrice,
        direction,
        distancePips,
        levelBeforeTP
      );

      return {
        price: level.price,
        type: level.type,
        strength: level.strength,
        distance: distancePips,
        urgency: Math.min(urgency, 100),
        reason: level.reason,
        actionable
      };
    });

    scoredLevels.sort((a, b) => b.urgency - a.urgency);

    const topLevel = scoredLevels[0];

    logger.info('[CriticalLevelDetector] Prioritized most critical level', {
      direction,
      level: topLevel.price,
      type: topLevel.type,
      distance: `${topLevel.distance.toFixed(1)} pips`,
      urgency: topLevel.urgency.toFixed(1),
      actionable: topLevel.actionable
    });

    return topLevel;
  }

  private findSwingLevels(candles: Candle[]): Array<{ price: number; timestamp: number; type: 'high' | 'low' }> {
    const swings: Array<{ price: number; timestamp: number; type: 'high' | 'low' }> = [];

    for (let i = 2; i < candles.length - 2; i++) {
      const candle = candles[i];
      const leftCandles = [candles[i - 2], candles[i - 1]];
      const rightCandles = [candles[i + 1], candles[i + 2]];

      const isSwingHigh = leftCandles.every(c => c.high < candle.high) &&
                          rightCandles.every(c => c.high < candle.high);

      const isSwingLow = leftCandles.every(c => c.low > candle.low) &&
                         rightCandles.every(c => c.low > candle.low);

      if (isSwingHigh) {
        swings.push({
          price: candle.high,
          timestamp: candle.timestamp,
          type: 'high'
        });
      }

      if (isSwingLow) {
        swings.push({
          price: candle.low,
          timestamp: candle.timestamp,
          type: 'low'
        });
      }
    }

    return swings;
  }

  private clusterLevels(
    swings: Array<{ price: number; timestamp: number; type: 'high' | 'low' }>,
    currentPrice: number
  ): CriticalLevel[] {
    if (swings.length === 0) return [];

    const tolerance = currentPrice * (this.PRICE_TOLERANCE_PERCENT / 100);
    const clusters: CriticalLevel[] = [];

    for (const swing of swings) {
      let foundCluster = false;

      for (const cluster of clusters) {
        if (Math.abs(cluster.price - swing.price) <= tolerance) {
          cluster.touches++;
          cluster.lastTouch = Math.max(cluster.lastTouch, swing.timestamp);

          const avgPrice = (cluster.price * (cluster.touches - 1) + swing.price) / cluster.touches;
          cluster.price = avgPrice;

          foundCluster = true;
          break;
        }
      }

      if (!foundCluster) {
        clusters.push({
          price: swing.price,
          type: swing.type === 'high' ? 'resistance' : 'support',
          strength: 0,
          touches: 1,
          lastTouch: swing.timestamp,
          reason: swing.type === 'high' ? 'Swing high rejection zone' : 'Swing low support zone'
        });
      }
    }

    return clusters.filter(c => c.touches >= this.MIN_TOUCHES);
  }

  private scoreLevels(
    clusters: CriticalLevel[],
    currentPrice: number,
    direction: 'long' | 'short'
  ): CriticalLevel[] {
    const now = Date.now();

    return clusters.map(level => {
      const baseStrength = Math.min(level.touches / 5, 1);

      const recencyHours = (now - level.lastTouch) / (1000 * 60 * 60);
      const recencyBonus = recencyHours < 24 ? 0.3 :
                          recencyHours < 72 ? 0.2 :
                          recencyHours < 168 ? 0.1 : 0;

      const distance = Math.abs(level.price - currentPrice);
      const distancePercent = (distance / currentPrice) * 100;
      const proximityBonus = distancePercent < 0.5 ? 0.3 :
                            distancePercent < 1.0 ? 0.2 :
                            distancePercent < 1.5 ? 0.1 : 0;

      const relevanceBonus =
        (direction === 'long' && level.type === 'resistance' && level.price > currentPrice) ||
        (direction === 'short' && level.type === 'support' && level.price < currentPrice)
          ? 0.2 : 0;

      level.strength = Math.min(baseStrength + recencyBonus + proximityBonus + relevanceBonus, 1);

      return level;
    }).filter(l => l.strength > 0.4);
  }

  private generateActionableAdvice(
    level: CriticalLevel,
    currentPrice: number,
    direction: 'long' | 'short',
    distancePips: number,
    beforeTP: boolean
  ): string {
    const levelType = level.type === 'resistance' ? 'resistance' : 'support';
    const action = direction === 'long' ? 'exit' : 'exit';

    if (distancePips < 10) {
      return `CRITICAL: ${levelType} at ${level.price.toFixed(5)} only ${distancePips.toFixed(1)} pips away. Consider ${action} immediately.`;
    } else if (distancePips < 20) {
      return `WARNING: Strong ${levelType} at ${level.price.toFixed(5)} approaching (${distancePips.toFixed(1)} pips). Monitor closely for rejection signs.`;
    } else if (beforeTP) {
      return `HEADS UP: ${levelType} at ${level.price.toFixed(5)} stands between you and TP (${distancePips.toFixed(1)} pips away). May block further progress.`;
    } else {
      return `INFO: ${levelType} at ${level.price.toFixed(5)} detected ${distancePips.toFixed(1)} pips away. Keep on radar.`;
    }
  }

  calculateEarlyExitLevels(
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    direction: 'long' | 'short',
    criticalLevel?: PrioritizedLevel
  ): { earlyExit: number; safetyMargin: number; reason: string } | null {
    if (!criticalLevel) return null;

    const fullDistance = Math.abs(takeProfit - entryPrice);
    const currentDistance = Math.abs(criticalLevel.price - entryPrice);
    const progressPercent = (currentDistance / fullDistance) * 100;

    if (progressPercent < 30) {
      return null;
    }

    const safetyMarginPips = direction === 'long' ? 5 : -5;
    const safetyMarginPrice = safetyMarginPips / 10000;

    const earlyExit = direction === 'long'
      ? criticalLevel.price - safetyMarginPrice
      : criticalLevel.price + safetyMarginPrice;

    const reason = `${criticalLevel.type} at ${criticalLevel.price.toFixed(5)} blocks ${progressPercent.toFixed(0)}% of move. Exit ${Math.abs(safetyMarginPips)} pips before.`;

    return {
      earlyExit,
      safetyMargin: Math.abs(safetyMarginPips),
      reason
    };
  }
}

export const criticalLevelDetector = new CriticalLevelDetector();
