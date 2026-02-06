/**
 * Mid-Trade Trigger Detector
 *
 * Detects meaningful events during active trades that warrant LLM re-evaluation
 * DOES NOT call LLM - only detects triggers
 * Uses local calculations and indicator analysis
 */

import type { SimulatedTrade } from '../types';
import { getCurrencyPipInfo, calculatePipDistance } from '../utils/currencyHelpers';

export interface TriggerDetectionResult {
  triggered: boolean;
  triggerType: string | null;
  triggerReason: string | null;
  confidence: number;
  shouldCallLLM: boolean;
  metadata: Record<string, any>;
}

export interface MarketConditions {
  currentPrice: number;
  ohlc: any[];
  indicators: {
    rsi?: number;
    atr?: number;
    vwap?: number;
    ema20?: number;
    ema50?: number;
    ema200?: number;
  };
  priceAction: {
    trend?: string;
    volatility?: string;
    momentum?: string;
  };
}


class MidTradeTriggerDetector {
  // Memory to track which triggers have fired for each trade
  private firedTriggers: Map<string, Set<string>> = new Map();

  // Track last periodic wellness check time per trade
  private lastPeriodicCheck: Map<string, number> = new Map();

  // Periodic check interval in milliseconds (15 minutes)
  private periodicCheckInterval = 15 * 60 * 1000;

  /**
   * Check if any trigger events have occurred for an active trade
   * Returns first trigger found, or null if none
   */
  checkForTriggers(
    trade: SimulatedTrade,
    marketConditions: MarketConditions
  ): TriggerDetectionResult {
    const tradeId = trade.id;
    const currentPrice = marketConditions.currentPrice;

    // Initialize trigger memory for this trade if not exists
    if (!this.firedTriggers.has(tradeId)) {
      this.firedTriggers.set(tradeId, new Set());
    }

    const firedSet = this.firedTriggers.get(tradeId)!;

    // Check triggers in priority order
    // 1. Drawdown triggers (highest priority)
    const drawdownTrigger = this.checkDrawdownTriggers(trade, currentPrice, firedSet);
    if (drawdownTrigger.triggered) return drawdownTrigger;

    // 2. Technical profit triggers
    const profitTrigger = this.checkProfitTriggers(trade, currentPrice, marketConditions, firedSet);
    if (profitTrigger.triggered) return profitTrigger;

    // 4. Market structure triggers
    const structureTrigger = this.checkMarketStructureTriggers(trade, marketConditions, firedSet);
    if (structureTrigger.triggered) return structureTrigger;

    // 5. Time-based triggers
    const timeTrigger = this.checkTimeBasedTriggers(trade, marketConditions, firedSet);
    if (timeTrigger.triggered) return timeTrigger;

    // No triggers
    return {
      triggered: false,
      triggerType: null,
      triggerReason: null,
      confidence: 0,
      shouldCallLLM: false,
      metadata: {}
    };
  }

  /**
   * Check drawdown triggers - highest priority
   */
  private checkDrawdownTriggers(
    trade: SimulatedTrade,
    currentPrice: number,
    firedSet: Set<string>
  ): TriggerDetectionResult {
    const isLong = trade.direction === 'buy';
    const priceDiff = isLong
      ? (currentPrice - trade.entryPrice)
      : (trade.entryPrice - currentPrice);

    const risk = Math.abs(trade.entryPrice - trade.stopLoss);
    const riskRatio = priceDiff / risk;

    // SSOT: Use centralized pip calculation for metadata
    const pipInfoDD = getCurrencyPipInfo(trade.symbol);
    const pipDistanceDD = calculatePipDistance(trade.symbol, trade.entryPrice, currentPrice);
    const dollarPerPipDD = pipInfoDD.dollarPerPipPerLot * trade.positionSize;
    const currentPnLDD = (priceDiff >= 0 ? pipDistanceDD : -pipDistanceDD) * dollarPerPipDD;

    // Near stop loss (within 15% of SL distance)
    const distanceToSL = Math.abs(currentPrice - trade.stopLoss);
    const slProximity = distanceToSL / risk;

    if (slProximity < 0.15 && !firedSet.has('near_sl')) {
      firedSet.add('near_sl');
      return {
        triggered: true,
        triggerType: 'near_sl',
        triggerReason: `Price within 15% of stop loss (${(slProximity * 100).toFixed(1)}% away)`,
        confidence: 95,
        shouldCallLLM: true,
        metadata: {
          current_price: currentPrice,
          stop_loss: trade.stopLoss,
          distance_pips: calculatePipDistance(trade.symbol, currentPrice, trade.stopLoss).toFixed(1),
          proximity_percent: (slProximity * 100).toFixed(1)
        }
      };
    }

    // Drawdown -0.50R (50% of risk)
    if (riskRatio <= -0.50 && !firedSet.has('drawdown_0.50R')) {
      firedSet.add('drawdown_0.50R');
      return {
        triggered: true,
        triggerType: 'drawdown_0.50R',
        triggerReason: `Drawdown reached -0.50R (${(riskRatio * 100).toFixed(0)}% of risk)`,
        confidence: 90,
        shouldCallLLM: true,
        metadata: {
          risk_ratio: riskRatio.toFixed(2),
          current_pnl: currentPnLDD.toFixed(2)
        }
      };
    }

    // Drawdown -0.30R (30% of risk)
    if (riskRatio <= -0.30 && !firedSet.has('drawdown_0.30R')) {
      firedSet.add('drawdown_0.30R');
      return {
        triggered: true,
        triggerType: 'drawdown_0.30R',
        triggerReason: `Drawdown reached -0.30R (${(riskRatio * 100).toFixed(0)}% of risk)`,
        confidence: 85,
        shouldCallLLM: true,
        metadata: {
          risk_ratio: riskRatio.toFixed(2),
          current_pnl: currentPnLDD.toFixed(2)
        }
      };
    }

    return { triggered: false, triggerType: null, triggerReason: null, confidence: 0, shouldCallLLM: false, metadata: {} };
  }

  /**
   * Check profit triggers
   */
  private checkProfitTriggers(
    trade: SimulatedTrade,
    currentPrice: number,
    marketConditions: MarketConditions,
    firedSet: Set<string>
  ): TriggerDetectionResult {
    const isLong = trade.direction === 'buy';
    const priceDiff = isLong
      ? (currentPrice - trade.entryPrice)
      : (trade.entryPrice - currentPrice);

    const risk = Math.abs(trade.entryPrice - trade.stopLoss);
    const riskRatio = priceDiff / risk;

    // SSOT: Use centralized pip calculation for profit metadata
    const pipInfoProfit = getCurrencyPipInfo(trade.symbol);
    const pipDistanceProfit = calculatePipDistance(trade.symbol, trade.entryPrice, currentPrice);
    const dollarPerPipProfit = pipInfoProfit.dollarPerPipPerLot * trade.positionSize;
    const currentPnLProfit = (priceDiff >= 0 ? pipDistanceProfit : -pipDistanceProfit) * dollarPerPipProfit;

    // Profit +1.5R (consider taking profit)
    if (riskRatio >= 1.5 && !firedSet.has('profit_1.5R')) {
      firedSet.add('profit_1.5R');
      return {
        triggered: true,
        triggerType: 'profit_1.5R',
        triggerReason: `Profit reached +1.5R (${(riskRatio * 100).toFixed(0)}% of risk) - consider taking profit`,
        confidence: 85,
        shouldCallLLM: true,
        metadata: {
          risk_ratio: riskRatio.toFixed(2),
          current_pnl: currentPnLProfit.toFixed(2)
        }
      };
    }

    // Momentum slowdown (RSI drop of 8+ points in 3 candles)
    if (marketConditions.ohlc.length >= 3) {
      const recentCandles = marketConditions.ohlc.slice(-3);
      // Calculate simple RSI approximation from price momentum
      const momentum = this.calculateMomentumChange(recentCandles);

      if (momentum < -8 && riskRatio > 0.5 && !firedSet.has('momentum_slowdown')) {
        firedSet.add('momentum_slowdown');
        return {
          triggered: true,
          triggerType: 'momentum_slowdown',
          triggerReason: `Momentum slowing while in profit (+${(riskRatio * 100).toFixed(0)}% R) - consider securing gains`,
          confidence: 75,
          shouldCallLLM: true,
          metadata: {
            momentum_change: momentum.toFixed(1),
            current_profit_ratio: riskRatio.toFixed(2)
          }
        };
      }
    }

    // Near key resistance/support - TP progress monitoring
    const distanceToTP = Math.abs(currentPrice - trade.takeProfit);
    const totalTPDistance = Math.abs(trade.takeProfit - trade.entryPrice);
    const tpProximity = distanceToTP / totalTPDistance;

    // Calculate TP progress (0% = at entry, 100% = at TP)
    const tpProgress = 1 - tpProximity;

    // 50% to TP - halfway check
    if (tpProgress >= 0.50 && tpProgress < 0.70 && !firedSet.has('tp_50_percent')) {
      firedSet.add('tp_50_percent');
      return {
        triggered: true,
        triggerType: 'tp_50_percent',
        triggerReason: `Trade 50% complete to take profit - Alpha evaluating momentum and potential to move SL to breakeven`,
        confidence: 75,
        shouldCallLLM: true,
        metadata: {
          current_price: currentPrice,
          take_profit: trade.takeProfit,
          tp_progress_percent: (tpProgress * 100).toFixed(1),
          distance_remaining_pips: calculatePipDistance(trade.symbol, currentPrice, trade.takeProfit).toFixed(1)
        }
      };
    }

    // 70% to TP - nearing target
    if (tpProgress >= 0.70 && tpProgress < 0.90 && !firedSet.has('tp_70_percent')) {
      firedSet.add('tp_70_percent');
      return {
        triggered: true,
        triggerType: 'tp_70_percent',
        triggerReason: `Trade 70% complete to take profit - Alpha checking for exhaustion signals or consolidation`,
        confidence: 80,
        shouldCallLLM: true,
        metadata: {
          current_price: currentPrice,
          take_profit: trade.takeProfit,
          tp_progress_percent: (tpProgress * 100).toFixed(1),
          distance_remaining_pips: calculatePipDistance(trade.symbol, currentPrice, trade.takeProfit).toFixed(1)
        }
      };
    }

    // 90% to TP - very close to target
    if (tpProximity < 0.10 && !firedSet.has('near_tp')) {
      firedSet.add('near_tp');
      return {
        triggered: true,
        triggerType: 'near_tp',
        triggerReason: `Price within 10% of take profit target - Alpha making final decision on letting it run vs closing early`,
        confidence: 85,
        shouldCallLLM: true,
        metadata: {
          current_price: currentPrice,
          take_profit: trade.takeProfit,
          distance_pips: calculatePipDistance(trade.symbol, currentPrice, trade.takeProfit).toFixed(1),
          proximity_percent: (tpProximity * 100).toFixed(1),
          tp_progress_percent: (tpProgress * 100).toFixed(1)
        }
      };
    }

    return { triggered: false, triggerType: null, triggerReason: null, confidence: 0, shouldCallLLM: false, metadata: {} };
  }

  /**
   * Check market structure triggers
   */
  private checkMarketStructureTriggers(
    trade: SimulatedTrade,
    marketConditions: MarketConditions,
    firedSet: Set<string>
  ): TriggerDetectionResult {
    const isLong = trade.direction === 'buy';
    const currentPrice = marketConditions.currentPrice;

    // Trend flip detection
    if (marketConditions.priceAction.trend) {
      const expectedTrend = isLong ? 'bullish' : 'bearish';
      const actualTrend = marketConditions.priceAction.trend;

      if (actualTrend !== expectedTrend && actualTrend !== 'neutral' && !firedSet.has('trend_flip')) {
        firedSet.add('trend_flip');
        return {
          triggered: true,
          triggerType: 'trend_flip',
          triggerReason: `Trend changed from ${expectedTrend} to ${actualTrend} - position may be in danger`,
          confidence: 90,
          shouldCallLLM: true,
          metadata: {
            expected_trend: expectedTrend,
            actual_trend: actualTrend,
            trade_direction: trade.direction
          }
        };
      }
    }

    // VWAP crossover (price crosses against position)
    if (marketConditions.indicators.vwap) {
      const vwap = marketConditions.indicators.vwap;
      const crossedVWAP = isLong ? (currentPrice < vwap) : (currentPrice > vwap);

      if (crossedVWAP && !firedSet.has('vwap_crossover')) {
        firedSet.add('vwap_crossover');
        return {
          triggered: true,
          triggerType: 'vwap_crossover',
          triggerReason: `Price crossed below VWAP (unfavorable for ${trade.direction.toUpperCase()} position)`,
          confidence: 85,
          shouldCallLLM: true,
          metadata: {
            current_price: currentPrice,
            vwap: vwap,
            trade_direction: trade.direction
          }
        };
      }
    }

    // Volatility spike
    if (marketConditions.ohlc.length >= 10) {
      const volatilityIncrease = this.checkVolatilitySpike(marketConditions.ohlc);

      if (volatilityIncrease > 30 && !firedSet.has('volatility_spike')) {
        firedSet.add('volatility_spike');
        return {
          triggered: true,
          triggerType: 'volatility_spike',
          triggerReason: `Volatility increased ${volatilityIncrease.toFixed(0)}% in last 10 candles - risk increased`,
          confidence: 80,
          shouldCallLLM: true,
          metadata: {
            volatility_increase_percent: volatilityIncrease.toFixed(1)
          }
        };
      }
    }

    return { triggered: false, triggerType: null, triggerReason: null, confidence: 0, shouldCallLLM: false, metadata: {} };
  }

  /**
   * Check time-based triggers
   */
  private checkTimeBasedTriggers(
    trade: SimulatedTrade,
    marketConditions: MarketConditions,
    firedSet: Set<string>
  ): TriggerDetectionResult {
    const now = Date.now();
    const timeInTrade = now - trade.entryTime.getTime();
    const minutesInTrade = timeInTrade / 60000;

    // Expected duration exceeded (2x expected)
    // Estimate expected duration: 60-90 minutes for typical intraday trade
    const expectedDuration = 75; // minutes

    if (minutesInTrade > expectedDuration * 2 && !firedSet.has('time_exceeded_2x')) {
      firedSet.add('time_exceeded_2x');
      return {
        triggered: true,
        triggerType: 'time_exceeded_2x',
        triggerReason: `Trade duration (${minutesInTrade.toFixed(0)}m) exceeded 2x expected (${expectedDuration}m) - re-evaluate`,
        confidence: 70,
        shouldCallLLM: true,
        metadata: {
          minutes_in_trade: minutesInTrade.toFixed(0),
          expected_duration: expectedDuration
        }
      };
    }

    // Trade stalling (15+ candles with minimal price movement)
    if (marketConditions.ohlc.length >= 15) {
      const priceRange = this.calculatePriceRange(marketConditions.ohlc.slice(-15));
      const risk = Math.abs(trade.entryPrice - trade.stopLoss);

      // If price range in last 15 candles < 20% of risk, it's stalling
      if (priceRange < risk * 0.20 && minutesInTrade > 15 && !firedSet.has('trade_stalling')) {
        firedSet.add('trade_stalling');
        return {
          triggered: true,
          triggerType: 'trade_stalling',
          triggerReason: `Trade stalling for 15+ candles with minimal movement - consider exit`,
          confidence: 65,
          shouldCallLLM: true,
          metadata: {
            price_range_pips: calculatePipDistance(trade.symbol, highSinceEntry, lowSinceEntry).toFixed(1),
            minutes_in_trade: minutesInTrade.toFixed(0)
          }
        };
      }
    }

    return { triggered: false, triggerType: null, triggerReason: null, confidence: 0, shouldCallLLM: false, metadata: {} };
  }

  /**
   * Check if periodic wellness check should fire (every 15 minutes)
   * This is a "general check-in" to provide continuous confidence
   */
  checkPeriodicWellness(
    trade: SimulatedTrade,
    marketConditions: MarketConditions
  ): TriggerDetectionResult {
    const tradeId = trade.id;
    const now = Date.now();
    const lastCheck = this.lastPeriodicCheck.get(tradeId) || 0;
    const timeSinceLastCheck = now - lastCheck;

    // Check if 15 minutes have passed since last periodic check
    if (timeSinceLastCheck < this.periodicCheckInterval) {
      return {
        triggered: false,
        triggerType: null,
        triggerReason: null,
        confidence: 0,
        shouldCallLLM: false,
        metadata: {
          time_until_next_check: Math.ceil((this.periodicCheckInterval - timeSinceLastCheck) / 60000)
        }
      };
    }

    // Time for periodic wellness check
    this.lastPeriodicCheck.set(tradeId, now);

    const isLong = trade.direction === 'buy';
    const priceDiff = isLong
      ? (marketConditions.currentPrice - trade.entryPrice)
      : (trade.entryPrice - marketConditions.currentPrice);
    const risk = Math.abs(trade.entryPrice - trade.stopLoss);
    const riskRatio = priceDiff / risk;
    const minutesInTrade = (now - trade.entryTime.getTime()) / 60000;

    // SSOT: Calculate dollar P&L using centralized pip values
    const pipInfoWellness = getCurrencyPipInfo(trade.symbol);
    const pipDiffWellness = calculatePipDistance(trade.symbol, trade.entryPrice, marketConditions.currentPrice);
    const dollarPerPipWellness = pipInfoWellness.dollarPerPipPerLot * trade.positionSize;
    const dollarPnL = (priceDiff >= 0 ? pipDiffWellness : -pipDiffWellness) * dollarPerPipWellness;

    // Create user-friendly message
    const timeDescription = this.formatTradeTime(minutesInTrade);
    const profitDescription = this.describeProfitStatus(dollarPnL, riskRatio);

    return {
      triggered: true,
      triggerType: 'periodic_wellness',
      triggerReason: `Routine check-in: Trade has been running for ${timeDescription}. ${profitDescription}`,
      confidence: 100, // Always execute periodic checks
      shouldCallLLM: true,
      metadata: {
        minutes_in_trade: minutesInTrade.toFixed(0),
        current_risk_ratio: riskRatio.toFixed(2),
        dollar_pnl: dollarPnL.toFixed(2),
        check_type: 'periodic_wellness',
        last_check_minutes_ago: (timeSinceLastCheck / 60000).toFixed(1),
        user_friendly: true
      }
    };
  }

  /**
   * Format trade time in user-friendly way
   */
  private formatTradeTime(minutes: number): string {
    if (minutes < 1) return 'less than a minute';
    if (minutes < 60) return `${Math.floor(minutes)} minute${Math.floor(minutes) !== 1 ? 's' : ''}`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.floor(minutes % 60);

    if (remainingMinutes === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    return `${hours}h ${remainingMinutes}m`;
  }

  /**
   * Describe profit/loss status in plain English
   */
  private describeProfitStatus(dollarPnL: number, riskRatio: number): string {
    const absAmount = Math.abs(dollarPnL);

    if (dollarPnL > 0) {
      return `Currently up $${absAmount.toFixed(2)}`;
    } else if (dollarPnL < 0) {
      return `Currently down $${absAmount.toFixed(2)}`;
    } else {
      return `Currently at break-even`;
    }
  }

  /**
   * Manually trigger evaluation (user requested)
   */
  manualTrigger(tradeId: string, question: string): TriggerDetectionResult {
    return {
      triggered: true,
      triggerType: 'manual_request',
      triggerReason: `User requested evaluation: "${question}"`,
      confidence: 100,
      shouldCallLLM: true,
      metadata: {
        user_question: question,
        trigger_source: 'user'
      }
    };
  }

  /**
   * Clear fired triggers for a trade (when trade closes or conditions reset)
   */
  clearTriggers(tradeId: string): void {
    this.firedTriggers.delete(tradeId);
    this.lastPeriodicCheck.delete(tradeId);
  }

  /**
   * Reset specific trigger type (when market conditions change significantly)
   */
  resetTrigger(tradeId: string, triggerType: string): void {
    const firedSet = this.firedTriggers.get(tradeId);
    if (firedSet) {
      firedSet.delete(triggerType);
    }
  }

  /**
   * Calculate momentum change from recent candles
   */
  private calculateMomentumChange(candles: any[]): number {
    if (candles.length < 2) return 0;

    const first = candles[0];
    const last = candles[candles.length - 1];

    // Simple momentum: (last close - first close) / first close * 100
    const momentum = ((last.close - first.close) / first.close) * 100;
    return momentum;
  }

  /**
   * Check for volatility spike
   */
  private checkVolatilitySpike(candles: any[]): number {
    if (candles.length < 10) return 0;

    const recent10 = candles.slice(-10);
    const previous10 = candles.slice(-20, -10);

    if (previous10.length < 10) return 0;

    // Calculate average range for each period
    const recentAvgRange = recent10.reduce((sum, c) => sum + (c.high - c.low), 0) / 10;
    const previousAvgRange = previous10.reduce((sum, c) => sum + (c.high - c.low), 0) / 10;

    if (previousAvgRange === 0) return 0;

    // Calculate percent increase
    const increasePercent = ((recentAvgRange - previousAvgRange) / previousAvgRange) * 100;
    return increasePercent;
  }

  /**
   * Calculate price range over candles
   */
  private calculatePriceRange(candles: any[]): number {
    if (candles.length === 0) return 0;

    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));

    return high - low;
  }
}

export const midTradeTriggerDetector = new MidTradeTriggerDetector();
