import { supabase } from '../lib/supabase';
import { calculateHalfTrend, calculateStochRSI, calculateLinearRegression, convertToHeikinAshi } from './indicators';

export interface FlowV2Signal {
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  setupType: string;
  reasoning: string;
  h1Bias: 'bullish' | 'bearish';
  m5FilterPassed: boolean;
  m1ExecutionReady: boolean;
  riskReward: number;
  phase: 'h1_bias' | 'm5_filter' | 'm1_execution' | 'complete';
}

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

class FlowTraderV2Strategy {
  async analyzeSetup(symbol: string, sessionId: string, atTime?: Date): Promise<FlowV2Signal | null> {
    try {
      if (atTime) {
        console.log(`[Flow V2] 🕐 Analyzing ${symbol} at historical time: ${atTime.toISOString()}`);
      }

      const h1Candles = await this.getCandles(symbol, 'H1', 50, atTime);
      const m5Candles = await this.getCandles(symbol, 'M5', 100, atTime);
      const m1Candles = await this.getCandles(symbol, 'M1', 100, atTime);

      if (atTime && h1Candles && h1Candles.length > 0) {
        const dataRange = `${h1Candles[0].timestamp} to ${h1Candles[h1Candles.length - 1].timestamp}`;
        console.log(`[Flow V2] 📊 Data range for backtest: ${dataRange}`);
      }

      if (!h1Candles || h1Candles.length < 2) {
        console.log(`[Flow V2] ❌ PHASE 1 FAILED: Insufficient H1 data for ${symbol} (got ${h1Candles?.length || 0}, need 2+)`);
        return null;
      }

      if (!m5Candles || m5Candles.length < 50) {
        console.log(`[Flow V2] ❌ PHASE 2 FAILED: Insufficient M5 data for ${symbol} (got ${m5Candles?.length || 0}, need 50+)`);
        return null;
      }

      if (!m1Candles || m1Candles.length < 50) {
        console.log(`[Flow V2] ❌ PHASE 3 FAILED: Insufficient M1 data for ${symbol} (got ${m1Candles?.length || 0}, need 50+)`);
        return null;
      }

      console.log(`[Flow V2] Data loaded: H1=${h1Candles.length}, M5=${m5Candles.length}, M1=${m1Candles.length}`);

      const phase1 = await this.phase1MacroIntel(h1Candles, symbol);
      if (!phase1.biasValid) {
        console.log(`[Flow V2] ❌ PHASE 1: H1 bias not clear for ${symbol} - ${phase1.reasoning}`);
        return null;
      }
      console.log(`[Flow V2] ✓ PHASE 1 PASSED: ${phase1.reasoning}`);

      const phase2 = await this.phase2TacticalAlignment(m5Candles, phase1.bias, symbol);
      if (!phase2.filterPassed) {
        console.log(`[Flow V2] ❌ PHASE 2: M5 filter not passed - ${phase2.reasoning}`);
        return null;
      }
      console.log(`[Flow V2] ✓ PHASE 2 PASSED: ${phase2.reasoning}`);

      const phase3 = await this.phase3PrecisionEntry(m1Candles, phase1.bias, symbol);
      if (!phase3.executionReady) {
        console.log(`[Flow V2] ❌ PHASE 3: M1 execution not ready - ${phase3.reasoning}`);
        return null;
      }
      console.log(`[Flow V2] ✓ PHASE 3 PASSED: ${phase3.reasoning}`);

      const currentPrice = m1Candles[m1Candles.length - 1].close;
      const signal = this.buildSignal(
        symbol,
        phase1,
        phase2,
        phase3,
        currentPrice
      );

      console.log(`[Flow V2] ✅ SIGNAL GENERATED: ${signal.direction.toUpperCase()} ${symbol} @ ${signal.entryPrice.toFixed(5)} (Confidence: ${signal.confidence}%, RR: 1:${signal.riskReward.toFixed(2)})`);

      await this.saveFlowV2Signal(sessionId, signal, phase1, phase2, phase3);

      return signal;
    } catch (error) {
      console.error(`[Flow V2] ❌ ERROR analyzing ${symbol}:`, error);
      return null;
    }
  }

  async phase1MacroIntel(h1Candles: Candle[], symbol: string): Promise<{
    biasValid: boolean;
    bias: 'bullish' | 'bearish';
    candle: Candle;
    reasoning: string;
  }> {
    const currentCandle = h1Candles[h1Candles.length - 1];
    const previousCandle = h1Candles[h1Candles.length - 2];

    const currentBullish = currentCandle.close > currentCandle.open;
    const previousBullish = previousCandle.close > previousCandle.open;

    let bias: 'bullish' | 'bearish' = currentBullish ? 'bullish' : 'bearish';
    let biasValid = false;
    let reasoning = '';

    if (currentBullish) {
      biasValid = true;
      reasoning = `H1 current candle is bullish. Only looking for BUY opportunities.`;
    } else if (previousBullish && !currentBullish) {
      biasValid = true;
      bias = 'bullish';
      reasoning = `H1 previous candle was bullish. Continue looking for BUY opportunities.`;
    } else if (!currentBullish) {
      biasValid = true;
      bias = 'bearish';
      reasoning = `H1 current candle is bearish. Only looking for SELL opportunities.`;
    } else if (!previousBullish && currentBullish) {
      biasValid = true;
      bias = 'bearish';
      reasoning = `H1 previous candle was bearish. Continue looking for SELL opportunities.`;
    }

    return {
      biasValid,
      bias,
      candle: currentCandle,
      reasoning
    };
  }

  async phase2TacticalAlignment(
    m5Candles: Candle[],
    h1Bias: 'bullish' | 'bearish',
    symbol: string
  ): Promise<{
    filterPassed: boolean;
    halfTrendColor: string;
    stochRSI: number;
    signalLine: number;
    currentPrice: number;
    reasoning: string;
  }> {
    const closePrices = m5Candles.map(c => c.close);
    const highPrices = m5Candles.map(c => c.high);
    const lowPrices = m5Candles.map(c => c.low);
    const currentPrice = closePrices[closePrices.length - 1];

    const halfTrend = calculateHalfTrend(highPrices, lowPrices, closePrices);
    const halfTrendColor = halfTrend.trend;
    const halfTrendValue = halfTrend.value;

    const stochRSI = calculateStochRSI(closePrices, 14, 14, 3, 3);
    const stochValue = stochRSI.k[stochRSI.k.length - 1];
    const prevStochValue = stochRSI.k[stochRSI.k.length - 2];

    const signalLine = calculateLinearRegression(closePrices, 20);

    let filterPassed = false;
    let reasoning = '';

    if (h1Bias === 'bullish') {
      const halfTrendGreen = halfTrendColor === 'green';
      const priceAboveHalfTrend = currentPrice > halfTrendValue;
      const stochOversold = stochValue < 30;
      const stochCrossingUp = stochValue > prevStochValue && stochValue < 30;
      const priceAboveSignalLine = currentPrice > signalLine;

      if (halfTrendGreen && priceAboveHalfTrend && (stochOversold || stochCrossingUp) && priceAboveSignalLine) {
        filterPassed = true;
        reasoning = `M5 BUY filter passed: HalfTrend GREEN (${halfTrendValue.toFixed(5)}), price above it, Stoch RSI ${stochOversold ? 'oversold' : 'crossing up'} (${stochValue.toFixed(2)}), price above signal line (${signalLine.toFixed(5)})`;
      } else {
        reasoning = `M5 BUY filter not met: HalfTrend ${halfTrendColor}, Stoch RSI ${stochValue.toFixed(2)}, needs < 30 and crossing up`;
      }
    } else {
      const halfTrendRed = halfTrendColor === 'red';
      const priceBelowHalfTrend = currentPrice < halfTrendValue;
      const stochOverbought = stochValue > 70;
      const stochCrossingDown = stochValue < prevStochValue && stochValue > 70;
      const priceBelowSignalLine = currentPrice < signalLine;

      if (halfTrendRed && priceBelowHalfTrend && (stochOverbought || stochCrossingDown) && priceBelowSignalLine) {
        filterPassed = true;
        reasoning = `M5 SELL filter passed: HalfTrend RED (${halfTrendValue.toFixed(5)}), price below it, Stoch RSI ${stochOverbought ? 'overbought' : 'crossing down'} (${stochValue.toFixed(2)}), price below signal line (${signalLine.toFixed(5)})`;
      } else {
        reasoning = `M5 SELL filter not met: HalfTrend ${halfTrendColor}, Stoch RSI ${stochValue.toFixed(2)}, needs > 70 and crossing down`;
      }
    }

    return {
      filterPassed,
      halfTrendColor,
      stochRSI: stochValue,
      signalLine,
      currentPrice,
      reasoning
    };
  }

  async phase3PrecisionEntry(
    m1Candles: Candle[],
    h1Bias: 'bullish' | 'bearish',
    symbol: string
  ): Promise<{
    executionReady: boolean;
    haFlip: string;
    rsi: number;
    signalLine: number;
    currentPrice: number;
    chochDetected: boolean;
    reasoning: string;
  }> {
    const haCandles = convertToHeikinAshi(m1Candles);
    const closePrices = m1Candles.map(c => c.close);
    const currentPrice = closePrices[closePrices.length - 1];

    const lastHA = haCandles[haCandles.length - 1];
    const prevHA = haCandles[haCandles.length - 2];

    const currentHAColor = lastHA.close > lastHA.open ? 'green' : 'red';
    const previousHAColor = prevHA.close > prevHA.open ? 'green' : 'red';
    const haFlip = currentHAColor !== previousHAColor ? `${previousHAColor}-to-${currentHAColor}` : 'no-flip';

    const rsi = this.calculateRSI(closePrices, 14);
    const signalLine = calculateLinearRegression(closePrices, 20);

    const chochDetected = this.detectCHoCH(m1Candles, h1Bias);

    let executionReady = false;
    let reasoning = '';

    if (h1Bias === 'bullish') {
      const haFlippedGreen = haFlip === 'red-to-green';
      const rsiAbove50 = rsi > 50;
      const priceAboveSignalLine = currentPrice > signalLine;

      if (haFlippedGreen && (rsiAbove50 || this.isRSICrossingUp(closePrices)) && priceAboveSignalLine) {
        executionReady = true;
        reasoning = `M1 BUY execution ready: Heikin Ashi flipped ${haFlip}, RSI ${rsi.toFixed(2)} ${rsiAbove50 ? '> 50' : 'crossing up'}, price above signal line (${signalLine.toFixed(5)})${chochDetected ? ', CHoCH detected' : ''}`;
      } else {
        reasoning = `M1 BUY execution not ready: HA flip ${haFlip}, RSI ${rsi.toFixed(2)}, needs HA green flip + RSI > 50`;
      }
    } else {
      const haFlippedRed = haFlip === 'green-to-red';
      const rsiBelow50 = rsi < 50;
      const priceBelowSignalLine = currentPrice < signalLine;

      if (haFlippedRed && (rsiBelow50 || this.isRSICrossingDown(closePrices)) && priceBelowSignalLine) {
        executionReady = true;
        reasoning = `M1 SELL execution ready: Heikin Ashi flipped ${haFlip}, RSI ${rsi.toFixed(2)} ${rsiBelow50 ? '< 50' : 'crossing down'}, price below signal line (${signalLine.toFixed(5)})${chochDetected ? ', CHoCH detected' : ''}`;
      } else {
        reasoning = `M1 SELL execution not ready: HA flip ${haFlip}, RSI ${rsi.toFixed(2)}, needs HA red flip + RSI < 50`;
      }
    }

    return {
      executionReady,
      haFlip,
      rsi,
      signalLine,
      currentPrice,
      chochDetected,
      reasoning
    };
  }

  buildSignal(
    symbol: string,
    phase1: any,
    phase2: any,
    phase3: any,
    currentPrice: number
  ): FlowV2Signal {
    const direction: 'buy' | 'sell' = phase1.bias === 'bullish' ? 'buy' : 'sell';

    const atr = this.calculateATR([{ high: currentPrice * 1.001, low: currentPrice * 0.999, close: currentPrice }], 14);
    const atrBuffer = atr * 1.5;

    let stopLoss: number;
    let takeProfit: number;

    if (direction === 'buy') {
      stopLoss = currentPrice - atrBuffer;
      takeProfit = currentPrice + (atrBuffer * 2);
    } else {
      stopLoss = currentPrice + atrBuffer;
      takeProfit = currentPrice - (atrBuffer * 2);
    }

    const riskReward = Math.abs(takeProfit - currentPrice) / Math.abs(currentPrice - stopLoss);

    const confidence = this.calculateConfidence(phase1, phase2, phase3, riskReward);

    const reasoning = `Flow Trader V2 ${direction.toUpperCase()} setup on ${symbol}. ${phase1.reasoning}. ${phase2.reasoning}. ${phase3.reasoning}. Risk:Reward = 1:${riskReward.toFixed(2)}`;

    return {
      symbol,
      direction,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      confidence,
      setupType: 'Flow Trader V2',
      reasoning,
      h1Bias: phase1.bias,
      m5FilterPassed: phase2.filterPassed,
      m1ExecutionReady: phase3.executionReady,
      riskReward,
      phase: 'complete'
    };
  }

  calculateConfidence(phase1: any, phase2: any, phase3: any, riskReward: number): number {
    let confidence = 0;

    if (phase1.biasValid) confidence += 30;
    if (phase2.filterPassed) confidence += 30;
    if (phase3.executionReady) confidence += 25;
    if (phase3.chochDetected) confidence += 10;
    if (riskReward >= 2.0) confidence += 5;

    return Math.min(100, confidence);
  }

  calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  isRSICrossingUp(prices: number[]): boolean {
    if (prices.length < 16) return false;
    const currentRSI = this.calculateRSI(prices, 14);
    const previousRSI = this.calculateRSI(prices.slice(0, -1), 14);
    return currentRSI > previousRSI && currentRSI > 45 && currentRSI < 55;
  }

  isRSICrossingDown(prices: number[]): boolean {
    if (prices.length < 16) return false;
    const currentRSI = this.calculateRSI(prices, 14);
    const previousRSI = this.calculateRSI(prices.slice(0, -1), 14);
    return currentRSI < previousRSI && currentRSI < 55 && currentRSI > 45;
  }

  detectCHoCH(candles: Candle[], bias: 'bullish' | 'bearish'): boolean {
    if (candles.length < 10) return false;

    const recent = candles.slice(-10);
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);

    const previousHigh = Math.max(...highs.slice(0, -3));
    const previousLow = Math.min(...lows.slice(0, -3));

    const currentHigh = Math.max(...highs.slice(-3));
    const currentLow = Math.min(...lows.slice(-3));

    if (bias === 'bullish') {
      return currentLow > previousHigh;
    } else {
      return currentHigh < previousLow;
    }
  }

  calculateATR(candles: Candle[], period: number): number {
    if (candles.length < 2) return 0.001;

    const trs = [];
    for (let i = 1; i < Math.min(candles.length, period + 1); i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
  }

  async getCandles(symbol: string, timeframe: string, limit: number, beforeTime?: Date): Promise<Candle[] | null> {
    try {
      let query = supabase
        .from('forex_candles')
        .select('open_time, open, high, low, close, volume')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe);

      // For backtesting: only get candles up to and including the specified time
      if (beforeTime) {
        query = query.lte('open_time', beforeTime.toISOString());
      }

      const { data, error } = await query
        .order('open_time', { ascending: false })
        .limit(limit);

      if (error) {
        console.error(`[Flow V2] Error fetching ${timeframe} candles for ${symbol}:`, error);
        return null;
      }

      if (!data || data.length === 0) {
        console.log(`[Flow V2] No ${timeframe} candles found for ${symbol}`);
        return null;
      }

      // Map open_time to timestamp for compatibility
      const candles: Candle[] = data.reverse().map(d => ({
        timestamp: d.open_time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume
      }));

      return candles;
    } catch (error) {
      console.error(`[Flow V2] Error in getCandles for ${symbol} ${timeframe}:`, error);
      return null;
    }
  }

  async saveFlowV2Signal(sessionId: string, signal: FlowV2Signal, phase1: any, phase2: any, phase3: any): Promise<void> {
    try {
      await supabase.from('flow_v2_signals').insert({
        goal_session_id: sessionId,
        symbol: signal.symbol,
        h1_bias: phase1.bias,
        h1_candle_color: phase1.candle.close > phase1.candle.open ? 'green' : 'red',
        m5_halftrend_color: phase2.halfTrendColor,
        m5_stoch_rsi: phase2.stochRSI,
        m5_signal_line: phase2.signalLine,
        m5_price: phase2.currentPrice,
        m5_filter_passed: phase2.filterPassed,
        m1_ha_flip: phase3.haFlip,
        m1_rsi: phase3.rsi,
        m1_signal_line: phase3.signalLine,
        m1_price: phase3.currentPrice,
        m1_choch_detected: phase3.chochDetected,
        m1_execution_ready: phase3.executionReady,
        indicators: {
          entry: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          riskReward: signal.riskReward,
          confidence: signal.confidence
        },
        phase: signal.phase
      });
    } catch (error) {
      console.error('[Flow V2] Error saving signal:', error);
    }
  }
}

export const flowTraderV2 = new FlowTraderV2Strategy();
