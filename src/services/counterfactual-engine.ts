/**
 * Counterfactual Engine
 *
 * Runs "what if" simulations for every closed trade to discover optimal parameters.
 * This is zero-cost intelligence - pure algorithmic replay of candle history.
 *
 * For each closed trade, simulates 12 alternate timelines:
 * - 4 SL variants (0.7x, 0.85x, 1.15x, 1.30x)
 * - 3 TP variants (0.7x, 1.2x, 1.5x)
 * - 4 Risk variants (1%, 2%, 3%, 5%)
 * - 1 Early exit test (20% pullback from peak)
 *
 * Output: Training dataset for future Omega intelligence
 */

import { supabase } from '../lib/supabase';
import { CandleData } from './candle-data-service';

interface TradeData {
  id: string;
  user_id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  take_profit: number;
  position_size: number;
  profit_loss: number;
  entry_time: Date | string;
  exit_time: Date | string;
  timeframe?: string;
}

interface CounterfactualResult {
  variant_type: 'sl_variant' | 'tp_variant' | 'risk_variant' | 'early_exit' | 'hold_longer';
  variant_setting: number;
  variant_description: string;
  counterfactual_pnl: number;
  would_hit_tp: boolean;
  would_hit_sl: boolean;
  would_reverse_later: boolean;
  time_to_resolution_minutes: number;
  candles_held: number;
  market_regime?: string;
  volatility_regime?: string;
}

interface SimulationResult {
  outcome: 'tp_hit' | 'sl_hit' | 'held' | 'reversed';
  exit_price: number;
  pnl: number;
  candles_to_resolution: number;
  time_to_resolution_minutes: number;
  peak_price?: number;
  max_favorable_excursion?: number;
}

class CounterfactualEngine {
  private readonly MAX_HOLD_MINUTES = 360;
  private readonly EARLY_EXIT_PULLBACK_PCT = 0.20;

  /**
   * Main entry point - run all counterfactual simulations for a closed trade
   */
  async runCounterfactuals(
    trade: TradeData,
    candleHistory: CandleData[],
    options: { generateInsights?: boolean } = {}
  ): Promise<void> {
    try {
      console.log(`[Counterfactual] 🧠 Replaying trade ${trade.id} in 12 alternate timelines...`);

      if (!candleHistory || candleHistory.length < 10) {
        console.warn(`[Counterfactual] Insufficient candle history (${candleHistory?.length || 0} candles), skipping`);
        return;
      }

      const results: CounterfactualResult[] = [];

      const entryTime = new Date(trade.entry_time).getTime();
      const exitTime = new Date(trade.exit_time).getTime();
      const candlesInTrade = candleHistory.filter(c => c.time * 1000 >= entryTime && c.time * 1000 <= exitTime);

      if (candlesInTrade.length === 0) {
        console.warn(`[Counterfactual] No candles found between entry and exit, skipping`);
        return;
      }

      const marketRegime = this.detectMarketRegime(candleHistory);
      const volatilityRegime = this.detectVolatilityRegime(candleHistory);

      results.push(...this.simulateStopLossVariants(trade, candlesInTrade, marketRegime, volatilityRegime));
      results.push(...this.simulateTakeProfitVariants(trade, candlesInTrade, marketRegime, volatilityRegime));
      results.push(...this.simulateRiskVariants(trade, candlesInTrade, marketRegime, volatilityRegime));
      results.push(...this.simulateEarlyExit(trade, candlesInTrade, marketRegime, volatilityRegime));

      await this.saveCounterfactuals(trade, results);

      const bestAlternate = results.reduce((best, current) =>
        current.counterfactual_pnl > best.counterfactual_pnl ? current : best
      );

      console.log(
        `[Counterfactual] ✅ Best alternate: ${bestAlternate.variant_description} ` +
        `would yield $${bestAlternate.counterfactual_pnl.toFixed(2)} vs actual $${trade.profit_loss.toFixed(2)} ` +
        `(${bestAlternate.counterfactual_pnl > trade.profit_loss ? '+' : ''}${(bestAlternate.counterfactual_pnl - trade.profit_loss).toFixed(2)})`
      );

      if (options.generateInsights) {
        setTimeout(async () => {
          try {
            const { counterfactualInsightGenerator } = await import('./counterfactual-insight-generator');
            await counterfactualInsightGenerator.generateInsights(
              trade.id,
              trade.user_id,
              trade.symbol,
              trade.profit_loss
            );
          } catch (error) {
            console.error('[Counterfactual] Error generating insights:', error);
          }
        }, 2000);
      }
    } catch (error) {
      console.error('[Counterfactual] Error running counterfactuals:', error);
    }
  }

  /**
   * Simulate 4 stop loss variants
   */
  private simulateStopLossVariants(
    trade: TradeData,
    candles: CandleData[],
    marketRegime: string,
    volatilityRegime: string
  ): CounterfactualResult[] {
    const multipliers = [0.7, 0.85, 1.15, 1.30];
    const results: CounterfactualResult[] = [];

    for (const multiplier of multipliers) {
      const newSL = this.calculateNewStopLoss(trade, multiplier);
      const simulation = this.replayTrade(trade, candles, newSL, trade.take_profit);

      const direction = multiplier < 1 ? 'tighter' : 'wider';
      const pctChange = Math.abs((1 - multiplier) * 100).toFixed(0);

      results.push({
        variant_type: 'sl_variant',
        variant_setting: multiplier,
        variant_description: `SL ${direction} by ${pctChange}% (${multiplier}x)`,
        counterfactual_pnl: simulation.pnl,
        would_hit_tp: simulation.outcome === 'tp_hit',
        would_hit_sl: simulation.outcome === 'sl_hit',
        would_reverse_later: simulation.outcome === 'reversed',
        time_to_resolution_minutes: simulation.time_to_resolution_minutes,
        candles_held: simulation.candles_to_resolution,
        market_regime: marketRegime,
        volatility_regime: volatilityRegime
      });
    }

    return results;
  }

  /**
   * Simulate 3 take profit variants
   */
  private simulateTakeProfitVariants(
    trade: TradeData,
    candles: CandleData[],
    marketRegime: string,
    volatilityRegime: string
  ): CounterfactualResult[] {
    const multipliers = [0.7, 1.2, 1.5];
    const results: CounterfactualResult[] = [];

    for (const multiplier of multipliers) {
      const newTP = this.calculateNewTakeProfit(trade, multiplier);
      const simulation = this.replayTrade(trade, candles, trade.stop_loss, newTP);

      const direction = multiplier < 1 ? 'earlier' : 'extended';
      const pctChange = Math.abs((multiplier - 1) * 100).toFixed(0);

      results.push({
        variant_type: 'tp_variant',
        variant_setting: multiplier,
        variant_description: `TP ${direction} by ${pctChange}% (${multiplier}x)`,
        counterfactual_pnl: simulation.pnl,
        would_hit_tp: simulation.outcome === 'tp_hit',
        would_hit_sl: simulation.outcome === 'sl_hit',
        would_reverse_later: simulation.outcome === 'reversed',
        time_to_resolution_minutes: simulation.time_to_resolution_minutes,
        candles_held: simulation.candles_to_resolution,
        market_regime: marketRegime,
        volatility_regime: volatilityRegime
      });
    }

    return results;
  }

  /**
   * Simulate 4 risk sizing variants
   */
  private simulateRiskVariants(
    trade: TradeData,
    candles: CandleData[],
    marketRegime: string,
    volatilityRegime: string
  ): CounterfactualResult[] {
    const riskPercentages = [1, 2, 3, 5];
    const results: CounterfactualResult[] = [];

    const actualRiskPct = this.estimateRiskPercentage(trade);
    const simulation = this.replayTrade(trade, candles, trade.stop_loss, trade.take_profit);

    for (const riskPct of riskPercentages) {
      const multiplier = riskPct / actualRiskPct;
      const adjustedPnL = trade.profit_loss * multiplier;

      results.push({
        variant_type: 'risk_variant',
        variant_setting: riskPct,
        variant_description: `Risk ${riskPct}% (${multiplier.toFixed(2)}x position size)`,
        counterfactual_pnl: adjustedPnL,
        would_hit_tp: simulation.outcome === 'tp_hit',
        would_hit_sl: simulation.outcome === 'sl_hit',
        would_reverse_later: false,
        time_to_resolution_minutes: simulation.time_to_resolution_minutes,
        candles_held: simulation.candles_to_resolution,
        market_regime: marketRegime,
        volatility_regime: volatilityRegime
      });
    }

    return results;
  }

  /**
   * Simulate early exit on 20% pullback from peak
   */
  private simulateEarlyExit(
    trade: TradeData,
    candles: CandleData[],
    marketRegime: string,
    volatilityRegime: string
  ): CounterfactualResult[] {
    const simulation = this.replayTradeWithEarlyExit(trade, candles);

    return [{
      variant_type: 'early_exit',
      variant_setting: this.EARLY_EXIT_PULLBACK_PCT,
      variant_description: `Exit on 20% pullback from peak`,
      counterfactual_pnl: simulation.pnl,
      would_hit_tp: simulation.outcome === 'tp_hit',
      would_hit_sl: simulation.outcome === 'sl_hit',
      would_reverse_later: simulation.outcome === 'reversed',
      time_to_resolution_minutes: simulation.time_to_resolution_minutes,
      candles_held: simulation.candles_to_resolution,
      market_regime: marketRegime,
      volatility_regime: volatilityRegime
    }];
  }

  /**
   * Core replay engine - simulate trade with different SL/TP
   */
  private replayTrade(
    trade: TradeData,
    candles: CandleData[],
    stopLoss: number,
    takeProfit: number
  ): SimulationResult {
    const direction = trade.direction;
    const entry = trade.entry_price;
    let candleCount = 0;
    let peakPrice = entry;

    for (const candle of candles) {
      candleCount++;

      if (direction === 'buy') {
        peakPrice = Math.max(peakPrice, candle.high);

        if (candle.low <= stopLoss) {
          return this.buildResult('sl_hit', stopLoss, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }
        if (candle.high >= takeProfit) {
          return this.buildResult('tp_hit', takeProfit, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }
      } else {
        peakPrice = Math.min(peakPrice, candle.low);

        if (candle.high >= stopLoss) {
          return this.buildResult('sl_hit', stopLoss, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }
        if (candle.low <= takeProfit) {
          return this.buildResult('tp_hit', takeProfit, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }
      }
    }

    const lastPrice = candles[candles.length - 1].close;
    return this.buildResult('held', lastPrice, entry, direction, trade.position_size, candleCount, trade.timeframe);
  }

  /**
   * Replay with early exit logic (20% pullback from peak)
   */
  private replayTradeWithEarlyExit(
    trade: TradeData,
    candles: CandleData[]
  ): SimulationResult {
    const direction = trade.direction;
    const entry = trade.entry_price;
    let peakPrice = entry;
    let candleCount = 0;

    for (const candle of candles) {
      candleCount++;

      if (direction === 'buy') {
        peakPrice = Math.max(peakPrice, candle.high);

        if (candle.low <= trade.stop_loss) {
          return this.buildResult('sl_hit', trade.stop_loss, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }
        if (candle.high >= trade.take_profit) {
          return this.buildResult('tp_hit', trade.take_profit, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }

        const pullbackThreshold = peakPrice - (peakPrice - entry) * this.EARLY_EXIT_PULLBACK_PCT;
        if (peakPrice > entry && candle.close <= pullbackThreshold) {
          return this.buildResult('reversed', candle.close, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }
      } else {
        peakPrice = Math.min(peakPrice, candle.low);

        if (candle.high >= trade.stop_loss) {
          return this.buildResult('sl_hit', trade.stop_loss, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }
        if (candle.low <= trade.take_profit) {
          return this.buildResult('tp_hit', trade.take_profit, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }

        const pullbackThreshold = peakPrice + (entry - peakPrice) * this.EARLY_EXIT_PULLBACK_PCT;
        if (peakPrice < entry && candle.close >= pullbackThreshold) {
          return this.buildResult('reversed', candle.close, entry, direction, trade.position_size, candleCount, trade.timeframe);
        }
      }
    }

    const lastPrice = candles[candles.length - 1].close;
    return this.buildResult('held', lastPrice, entry, direction, trade.position_size, candleCount, trade.timeframe);
  }

  /**
   * Build simulation result object
   */
  private buildResult(
    outcome: 'tp_hit' | 'sl_hit' | 'held' | 'reversed',
    exitPrice: number,
    entryPrice: number,
    direction: 'buy' | 'sell',
    positionSize: number,
    candleCount: number,
    timeframe?: string
  ): SimulationResult {
    const pnl = this.calculatePnL(direction, entryPrice, exitPrice, positionSize);
    const minutesPerCandle = this.getMinutesPerCandle(timeframe || '15m');

    return {
      outcome,
      exit_price: exitPrice,
      pnl,
      candles_to_resolution: candleCount,
      time_to_resolution_minutes: candleCount * minutesPerCandle
    };
  }

  /**
   * Calculate P&L for simulation
   */
  private calculatePnL(
    direction: 'buy' | 'sell',
    entryPrice: number,
    exitPrice: number,
    positionSize: number
  ): number {
    const priceDiff = direction === 'buy'
      ? exitPrice - entryPrice
      : entryPrice - exitPrice;

    return priceDiff * positionSize;
  }

  /**
   * Calculate new stop loss based on multiplier
   */
  private calculateNewStopLoss(trade: TradeData, multiplier: number): number {
    const distance = Math.abs(trade.entry_price - trade.stop_loss);
    const newDistance = distance * multiplier;

    return trade.direction === 'buy'
      ? trade.entry_price - newDistance
      : trade.entry_price + newDistance;
  }

  /**
   * Calculate new take profit based on multiplier
   */
  private calculateNewTakeProfit(trade: TradeData, multiplier: number): number {
    const distance = Math.abs(trade.take_profit - trade.entry_price);
    const newDistance = distance * multiplier;

    return trade.direction === 'buy'
      ? trade.entry_price + newDistance
      : trade.entry_price - newDistance;
  }

  /**
   * Estimate risk percentage from trade data
   */
  private estimateRiskPercentage(trade: TradeData): number {
    const slDistance = Math.abs(trade.entry_price - trade.stop_loss);
    const riskDollars = slDistance * trade.position_size;
    const accountSize = 10000;
    return (riskDollars / accountSize) * 100;
  }

  /**
   * Detect market regime from candle history
   */
  private detectMarketRegime(candles: CandleData[]): string {
    if (candles.length < 20) return 'sideways';

    const recent = candles.slice(-20);
    const first = recent[0].close;
    const last = recent[recent.length - 1].close;
    const change = ((last - first) / first) * 100;

    if (change > 0.5) return 'bull';
    if (change < -0.5) return 'bear';
    return 'sideways';
  }

  /**
   * Detect volatility regime from candle history
   */
  private detectVolatilityRegime(candles: CandleData[]): string {
    if (candles.length < 20) return 'medium';

    const recent = candles.slice(-20);
    const ranges = recent.map(c => ((c.high - c.low) / c.close) * 100);
    const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;

    if (avgRange > 0.3) return 'high';
    if (avgRange < 0.1) return 'low';
    return 'medium';
  }

  /**
   * Get minutes per candle for timeframe
   */
  private getMinutesPerCandle(timeframe: string): number {
    const map: Record<string, number> = {
      '1m': 1, '5m': 5, '15m': 15, '30m': 30,
      '1h': 60, '4h': 240, '1d': 1440
    };
    return map[timeframe] || 15;
  }

  /**
   * Save counterfactual results to database
   */
  private async saveCounterfactuals(trade: TradeData, results: CounterfactualResult[]): Promise<void> {
    const records = results.map(result => ({
      trade_id: trade.id,
      user_id: trade.user_id,
      symbol: trade.symbol,
      timeframe: trade.timeframe || '15m',
      variant_type: result.variant_type,
      variant_setting: result.variant_setting,
      variant_description: result.variant_description,
      counterfactual_pnl: result.counterfactual_pnl,
      actual_pnl: trade.profit_loss,
      would_hit_tp: result.would_hit_tp,
      would_hit_sl: result.would_hit_sl,
      would_reverse_later: result.would_reverse_later,
      time_to_resolution_minutes: result.time_to_resolution_minutes,
      candles_held: result.candles_held,
      market_regime: result.market_regime,
      volatility_regime: result.volatility_regime
    }));

    const { error } = await supabase
      .from('ai_counterfactuals')
      .insert(records);

    if (error) {
      console.error('[Counterfactual] Error saving counterfactuals:', error);
    } else {
      console.log(`[Counterfactual] ✅ Saved ${records.length} counterfactual simulations`);
    }
  }
}

export const counterfactualEngine = new CounterfactualEngine();
