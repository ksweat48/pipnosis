/**
 * LLM Snapshot Builder
 *
 * Converts market data, indicators, and trigger events into compact JSON
 * formatted for LLM consumption in the event-based trading system
 */

import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { TriggerEvent } from './trigger-detection-rules';
import { validateSLTPDistances, calculatePipDistance } from '../utils/currencyHelpers';
import { computeOmegaSensors, formatSensorsForLogging, type OmegaSensors } from './omega-sensors';

export interface LLMSnapshot {
  pipnosisIdentity: string;
  trigger: {
    type: string;
    confidence: number;
    context: string;
  };
  market: {
    symbol: string;
    timeframe: string;
    timestamp: string;
    currentPrice: number;
  };
  recentCandles: {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  indicators: {
    vwap: number;
    priceVsVWAP: string;
    ema20: number;
    ema50: number;
    priceVsEMA20: string;
    atr: number;
    atrPercent: number;
    volumeBaseline: number;
    volumeRatio: number;
  };
  priceAction: {
    trend: string;
    volatility: string;
    momentum: number;
    recentHigh: number;
    recentLow: number;
    pricePosition: string;
  };
  supportResistance?: {
    nearestSupport?: number;
    nearestResistance?: number;
    distanceToSupport?: number;
    distanceToResistance?: number;
  };
  portfolio: {
    openPositions: number;
    positions: {
      symbol: string;
      direction: string;
      entryPrice: number;
      currentPnL: number;
      holdingMinutes: number;
    }[];
    totalExposure: number;
  };
  rules: {
    maxHoldMinutes: number;
    maxTradePercent: number;
    mustCloseBeforeEOD: boolean;
    noOvernightHolds: boolean;
  };
  durationContext?: {
    expectedDurationHours: number;
    allowedDurationHours: number;
    bestCaseHours: number;
    worstCaseHours: number;
    volatilityDurationProfile: {
      min: number;
      preferred: number;
      max: number;
    };
    sessionMultiplier: number;
    warnings: string[];
    recommendation: string;
  };
}

export interface LLMTradeDecision {
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence: number;
  reasoning: string;
  maxHoldMinutes?: number;
  riskRewardRatio?: number;
}

class LLMSnapshotBuilder {
  /**
   * Build complete snapshot for LLM evaluation
   */
  buildSnapshot(
    trigger: TriggerEvent,
    candles: any[],
    indicators: {
      vwap: number;
      ema20: number;
      ema50: number;
      atr: number;
      volumeBaseline: number;
    },
    priceAction: {
      trend: 'bullish' | 'bearish' | 'sideways';
      volatility: 'low' | 'medium' | 'high';
      momentum: number;
    },
    openPositions: any[] = []
  ): LLMSnapshot {
    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;

    const recentCandles = this.formatRecentCandles(candles.slice(-10));
    const indicatorsSummary = this.formatIndicators(indicators, currentPrice, currentCandle.volume);
    const priceActionSummary = this.formatPriceAction(priceAction, candles);
    const supportResistance = this.calculateSupportResistance(candles, currentPrice);
    const portfolioSummary = this.formatPortfolio(openPositions, currentPrice);

    return {
      pipnosisIdentity: this.getPipnosisIdentity(),
      trigger: {
        type: trigger.type,
        confidence: trigger.confidence,
        context: trigger.context
      },
      market: {
        symbol: trigger.symbol,
        timeframe: trigger.timeframe,
        timestamp: trigger.timestamp.toISOString(),
        currentPrice
      },
      recentCandles,
      indicators: indicatorsSummary,
      priceAction: priceActionSummary,
      supportResistance,
      portfolio: portfolioSummary,
      rules: {
        maxHoldMinutes: PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES,
        maxTradePercent: PIPNOSIS_CORE_RULES.MAX_SINGLE_TRADE_PROFIT_PERCENT,
        mustCloseBeforeEOD: PIPNOSIS_CORE_RULES.ENFORCE_END_OF_DAY_CLOSURE,
        noOvernightHolds: !PIPNOSIS_CORE_RULES.ALLOW_OVERNIGHT_HOLDS
      }
    };
  }

  /**
   * Get Pipnosis identity and core rules for LLM
   */
  private getPipnosisIdentity(): string {
    return `You are Pipnosis, an elite SHORT-TERM INTRADAY AI trader. CRITICAL RULES: (1) Trades last minutes to hours ONLY, max ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS} hours. (2) NEVER hold overnight. (3) NEVER swing trade. (4) Only tight SL/TP. (5) Flow V2 detected this setup - evaluate if it's truly high-probability. (6) Return NO_TRADE if setup quality is questionable.`;
  }

  /**
   * Format recent candles for LLM
   */
  private formatRecentCandles(candles: any[]): LLMSnapshot['recentCandles'] {
    return candles.map(c => ({
      time: new Date(c.open_time).toISOString().substring(11, 16),
      open: parseFloat(c.open.toFixed(5)),
      high: parseFloat(c.high.toFixed(5)),
      low: parseFloat(c.low.toFixed(5)),
      close: parseFloat(c.close.toFixed(5)),
      volume: Math.round(c.volume)
    }));
  }

  /**
   * Format indicators with context
   */
  private formatIndicators(
    indicators: any,
    currentPrice: number,
    currentVolume: number
  ): LLMSnapshot['indicators'] {
    const vwapDistance = ((currentPrice - indicators.vwap) / indicators.vwap) * 100;
    const ema20Distance = ((currentPrice - indicators.ema20) / indicators.ema20) * 100;
    const atrPercent = (indicators.atr / currentPrice) * 100;
    const volumeRatio = currentVolume / indicators.volumeBaseline;

    return {
      vwap: parseFloat(indicators.vwap.toFixed(5)),
      priceVsVWAP: `${vwapDistance > 0 ? '+' : ''}${vwapDistance.toFixed(2)}%`,
      ema20: parseFloat(indicators.ema20.toFixed(5)),
      ema50: parseFloat(indicators.ema50.toFixed(5)),
      priceVsEMA20: `${ema20Distance > 0 ? '+' : ''}${ema20Distance.toFixed(2)}%`,
      atr: parseFloat(indicators.atr.toFixed(5)),
      atrPercent: parseFloat(atrPercent.toFixed(2)),
      volumeBaseline: Math.round(indicators.volumeBaseline),
      volumeRatio: parseFloat(volumeRatio.toFixed(2))
    };
  }

  /**
   * Format price action summary
   */
  private formatPriceAction(
    priceAction: any,
    candles: any[]
  ): LLMSnapshot['priceAction'] {
    const recentCandles = candles.slice(-20);
    const recentHigh = Math.max(...recentCandles.map(c => c.high));
    const recentLow = Math.min(...recentCandles.map(c => c.low));
    const currentPrice = candles[candles.length - 1].close;
    const range = recentHigh - recentLow;
    const position = range > 0 ? ((currentPrice - recentLow) / range) * 100 : 50;

    let positionDesc = 'middle of range';
    if (position > 70) positionDesc = 'near recent high';
    else if (position < 30) positionDesc = 'near recent low';

    return {
      trend: priceAction.trend,
      volatility: priceAction.volatility,
      momentum: parseFloat(priceAction.momentum.toFixed(1)),
      recentHigh: parseFloat(recentHigh.toFixed(5)),
      recentLow: parseFloat(recentLow.toFixed(5)),
      pricePosition: positionDesc
    };
  }

  /**
   * Calculate basic support and resistance levels
   */
  private calculateSupportResistance(
    candles: any[],
    currentPrice: number
  ): LLMSnapshot['supportResistance'] | undefined {
    if (candles.length < 50) return undefined;

    const recentCandles = candles.slice(-50);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);

    const resistanceLevels = highs
      .filter(h => h > currentPrice)
      .sort((a, b) => a - b);

    const supportLevels = lows
      .filter(l => l < currentPrice)
      .sort((a, b) => b - a);

    if (resistanceLevels.length === 0 && supportLevels.length === 0) {
      return undefined;
    }

    const nearestResistance = resistanceLevels[0];
    const nearestSupport = supportLevels[0];

    return {
      nearestSupport: nearestSupport ? parseFloat(nearestSupport.toFixed(5)) : undefined,
      nearestResistance: nearestResistance ? parseFloat(nearestResistance.toFixed(5)) : undefined,
      distanceToSupport: nearestSupport
        ? parseFloat((((currentPrice - nearestSupport) / currentPrice) * 100).toFixed(2))
        : undefined,
      distanceToResistance: nearestResistance
        ? parseFloat((((nearestResistance - currentPrice) / currentPrice) * 100).toFixed(2))
        : undefined
    };
  }

  /**
   * Format open positions portfolio
   */
  private formatPortfolio(openPositions: any[], currentPrice: number): LLMSnapshot['portfolio'] {
    const positions = openPositions.map(pos => {
      const pnl = pos.direction === 'buy'
        ? (currentPrice - pos.entryPrice) * pos.positionSize
        : (pos.entryPrice - currentPrice) * pos.positionSize;

      const holdingMinutes = Math.floor(
        (Date.now() - new Date(pos.entryTime).getTime()) / 60000
      );

      return {
        symbol: pos.symbol,
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        currentPnL: parseFloat(pnl.toFixed(2)),
        holdingMinutes
      };
    });

    const totalExposure = positions.reduce((sum, pos) => sum + Math.abs(pos.currentPnL), 0);

    return {
      openPositions: openPositions.length,
      positions,
      totalExposure: parseFloat(totalExposure.toFixed(2))
    };
  }

  /**
   * Format snapshot into LLM prompt
   */
  formatSnapshotAsPrompt(snapshot: LLMSnapshot): string {
    return `${snapshot.pipnosisIdentity}

**TRIGGER DETECTED:**
Type: ${snapshot.trigger.type}
Confidence: ${snapshot.trigger.confidence}%
Context: ${snapshot.trigger.context}

**MARKET STATE:**
Symbol: ${snapshot.market.symbol}
Timeframe: ${snapshot.market.timeframe}
Price: ${snapshot.market.currentPrice}
Time: ${snapshot.market.timestamp}

**INDICATORS:**
VWAP: ${snapshot.indicators.vwap} (Price is ${snapshot.indicators.priceVsVWAP})
EMA20: ${snapshot.indicators.ema20} (Price is ${snapshot.indicators.priceVsEMA20})
EMA50: ${snapshot.indicators.ema50}
ATR: ${snapshot.indicators.atr} (${snapshot.indicators.atrPercent}% of price)
Volume: ${snapshot.indicators.volumeRatio}x baseline

**PRICE ACTION:**
Trend: ${snapshot.priceAction.trend}
Volatility: ${snapshot.priceAction.volatility}
Momentum: ${snapshot.priceAction.momentum}
Position: ${snapshot.priceAction.pricePosition}
Recent Range: ${snapshot.priceAction.recentLow} - ${snapshot.priceAction.recentHigh}

${snapshot.supportResistance ? `**SUPPORT/RESISTANCE:**
Nearest Support: ${snapshot.supportResistance.nearestSupport || 'none'} (${snapshot.supportResistance.distanceToSupport || 0}% away)
Nearest Resistance: ${snapshot.supportResistance.nearestResistance || 'none'} (${snapshot.supportResistance.distanceToResistance || 0}% away)
` : ''}

**PORTFOLIO:**
Open Positions: ${snapshot.portfolio.openPositions}
${snapshot.portfolio.positions.length > 0 ? snapshot.portfolio.positions.map(p =>
  `- ${p.symbol} ${p.direction.toUpperCase()} @ ${p.entryPrice}, PnL: ${p.currentPnL}, held ${p.holdingMinutes}min`
).join('\n') : 'No open positions'}

**PIPNOSIS RULES (MANDATORY):**
- Max Hold: ${snapshot.rules.maxHoldMinutes} minutes (${snapshot.rules.maxHoldMinutes / 60} hours)
- Must close before end of day: ${snapshot.rules.mustCloseBeforeEOD}
- No overnight holds allowed: ${snapshot.rules.noOvernightHolds}
${snapshot.durationContext ? `
**DURATION CONTEXT (CRITICAL):**
- Expected fill time: ${snapshot.durationContext.expectedDurationHours.toFixed(1)}h (range: ${snapshot.durationContext.bestCaseHours.toFixed(1)}-${snapshot.durationContext.worstCaseHours.toFixed(1)}h)
- Allowed max duration: ${snapshot.durationContext.allowedDurationHours}h
- Session liquidity factor: ${snapshot.durationContext.sessionMultiplier.toFixed(2)}x
- Volatility-adjusted limits: ${snapshot.durationContext.volatilityDurationProfile.min}-${snapshot.durationContext.volatilityDurationProfile.max} hours
- Recommendation: ${snapshot.durationContext.recommendation}
${snapshot.durationContext.warnings.length > 0 ? `- Warnings:\n  ${snapshot.durationContext.warnings.map(w => `  • ${w}`).join('\n')}` : ''}
` : ''}

**YOUR TASK:**
Flow V2 detected this setup. Evaluate if it's truly high-probability for SHORT-TERM INTRADAY execution.
CRITICAL: Choose TP levels that can realistically fill within the allowed duration window.

Should you:
1. BUY (long position)
2. SELL (short position)
3. NO_TRADE (setup quality insufficient)

**RESPONSE FORMAT (JSON only):**
{
  "action": "BUY" | "SELL" | "NO_TRADE",
  "entry": <exact price or use current ${snapshot.market.currentPrice}>,
  "stopLoss": <price>,
  "takeProfit": <price>,
  "confidence": <0-100>,
  "reasoning": "<2-3 sentences explaining your decision>",
  "maxHoldMinutes": <minutes, max ${snapshot.rules.maxHoldMinutes}>
}`;
  }

  /**
   * Parse LLM response into structured decision
   */
  parseLLMResponse(response: string): LLMTradeDecision {
    try {
      const cleanResponse = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleanResponse);

      const decision: LLMTradeDecision = {
        action: parsed.action || 'NO_TRADE',
        entry: parsed.entry,
        stopLoss: parsed.stopLoss,
        takeProfit: parsed.takeProfit,
        confidence: parsed.confidence || 0,
        reasoning: parsed.reasoning || 'No reasoning provided',
        maxHoldMinutes: parsed.maxHoldMinutes
      };

      if (decision.entry && decision.stopLoss && decision.takeProfit) {
        const risk = Math.abs(decision.entry - decision.stopLoss);
        const reward = Math.abs(decision.takeProfit - decision.entry);
        decision.riskRewardRatio = reward / risk;
      }

      return decision;
    } catch (error) {
      console.error('[LLM Snapshot] Failed to parse LLM response:', error);
      return {
        action: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Failed to parse LLM response'
      };
    }
  }

  /**
   * Validate LLM decision against Pipnosis rules
   */
  validateDecision(decision: LLMTradeDecision): { isValid: boolean; violations: string[] } {
    const violations: string[] = [];

    if (decision.action === 'NO_TRADE') {
      return { isValid: true, violations: [] };
    }

    if (!decision.entry || !decision.stopLoss || !decision.takeProfit) {
      violations.push('Missing required fields: entry, stopLoss, or takeProfit');
    }

    // Validate SL/TP direction relative to entry price
    if (decision.entry && decision.stopLoss && decision.takeProfit) {
      if (decision.direction === 'buy') {
        if (decision.stopLoss >= decision.entry) {
          violations.push(`BUY trade: Stop loss (${decision.stopLoss}) must be below entry (${decision.entry})`);
        }
        if (decision.takeProfit <= decision.entry) {
          violations.push(`BUY trade: Take profit (${decision.takeProfit}) must be above entry (${decision.entry})`);
        }
      } else if (decision.direction === 'sell') {
        if (decision.stopLoss <= decision.entry) {
          violations.push(`SELL trade: Stop loss (${decision.stopLoss}) must be above entry (${decision.entry})`);
        }
        if (decision.takeProfit >= decision.entry) {
          violations.push(`SELL trade: Take profit (${decision.takeProfit}) must be below entry (${decision.entry})`);
        }
      }
    }

    if (decision.maxHoldMinutes && decision.maxHoldMinutes > PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES) {
      violations.push(
        `maxHoldMinutes ${decision.maxHoldMinutes} exceeds maximum ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES}`
      );
    }

    if (decision.riskRewardRatio && decision.riskRewardRatio < 1.2) {
      violations.push(`Risk:Reward ratio ${decision.riskRewardRatio.toFixed(2)} is too low (minimum 1.2)`);
    }

    if (decision.confidence < 60) {
      violations.push(`Confidence ${decision.confidence}% is too low for execution`);
    }

    // Validate SL/TP distances are appropriate for currency type
    if (decision.entry && decision.stopLoss && decision.takeProfit && decision.symbol) {
      const distanceValidation = validateSLTPDistances(
        decision.symbol,
        decision.entry,
        decision.stopLoss,
        decision.takeProfit
      );

      if (!distanceValidation.isValid) {
        distanceValidation.warnings.forEach(warning => {
          violations.push(`Currency-specific validation: ${warning}`);
        });
      }

      // Log pip distances for transparency
      const slPips = calculatePipDistance(decision.symbol, decision.entry, decision.stopLoss);
      const tpPips = calculatePipDistance(decision.symbol, decision.entry, decision.takeProfit);
      console.log(`[SL/TP Validation] ${decision.symbol}: SL=${slPips.toFixed(1)} pips, TP=${tpPips.toFixed(1)} pips`);
    }

    return {
      isValid: violations.length === 0,
      violations
    };
  }

  /**
   * Calculate EMA200 for longer-term trend analysis
   */
  calculateEMA200(closes: number[]): number {
    if (closes.length < 200) {
      return closes[closes.length - 1];
    }
    return this.calculateEMA(closes, 200);
  }

  /**
   * Calculate EMA helper
   */
  private calculateEMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate RSI helper
   */
  private calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * Calculate Stochastic RSI
   */
  calculateStochRSI(closes: number[], period: number = 14): number {
    if (closes.length < period * 2) return 50;

    const rsiValues: number[] = [];
    for (let i = period; i < closes.length; i++) {
      const slice = closes.slice(i - period, i + 1);
      rsiValues.push(this.calculateRSI(slice, period));
    }

    const currentRSI = rsiValues[rsiValues.length - 1];
    const recentRSI = rsiValues.slice(-period);

    const minRSI = Math.min(...recentRSI);
    const maxRSI = Math.max(...recentRSI);

    if (maxRSI === minRSI) return 50;

    const stochRSI = ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100;
    return stochRSI;
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
    if (closes.length < 26) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    // Calculate 12-period EMA
    const ema12 = this.calculateEMA(closes, 12);

    // Calculate 26-period EMA
    const ema26 = this.calculateEMA(closes, 26);

    // MACD line = EMA12 - EMA26
    const macd = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    // For simplicity, we'll use a simple moving average here
    const signal = macd * 0.9; // Approximation

    // Histogram = MACD - Signal
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  /**
   * Detect swing high and low levels
   */
  detectSwingLevels(candles: any[], lookback: number = 20): { high: number; low: number } {
    const recentCandles = candles.slice(-lookback);

    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);

    return {
      high: Math.max(...highs),
      low: Math.min(...lows)
    };
  }

  /**
   * Detect support and resistance levels
   */
  detectSupportResistance(candles: any[], currentPrice: number): {
    support: number[];
    resistance: number[];
  } {
    const recentCandles = candles.slice(-50);
    const support: number[] = [];
    const resistance: number[] = [];

    // Find pivot points
    for (let i = 2; i < recentCandles.length - 2; i++) {
      const candle = recentCandles[i];
      const prevCandle = recentCandles[i - 1];
      const prevPrevCandle = recentCandles[i - 2];
      const nextCandle = recentCandles[i + 1];
      const nextNextCandle = recentCandles[i + 2];

      // Pivot high (resistance)
      if (
        candle.high > prevCandle.high &&
        candle.high > prevPrevCandle.high &&
        candle.high > nextCandle.high &&
        candle.high > nextNextCandle.high
      ) {
        if (candle.high > currentPrice) {
          resistance.push(candle.high);
        }
      }

      // Pivot low (support)
      if (
        candle.low < prevCandle.low &&
        candle.low < prevPrevCandle.low &&
        candle.low < nextCandle.low &&
        candle.low < nextNextCandle.low
      ) {
        if (candle.low < currentPrice) {
          support.push(candle.low);
        }
      }
    }

    // Sort and keep top 3 of each
    support.sort((a, b) => b - a);
    resistance.sort((a, b) => a - b);

    return {
      support: support.slice(0, 3),
      resistance: resistance.slice(0, 3)
    };
  }

  /**
   * Build compressed market state for condition monitoring
   */
  buildMarketState(candles: any[]): {
    price: number;
    ema20: number;
    ema50: number;
    ema200: number;
    rsi: number;
    stochRsi: number;
    atr: number;
    vwap: number;
    trend: string;
    momentum: number;
    volatility: string;
    swingHigh: number;
    swingLow: number;
    macd: number;
    macdSignal: number;
    omegaSensors: OmegaSensors;
  } {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const currentCandle = candles[candles.length - 1];

    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema200 = this.calculateEMA200(closes);
    const rsi = this.calculateRSI(closes, 14);
    const stochRsi = this.calculateStochRSI(closes, 14);

    // Calculate ATR
    const atrPeriod = 14;
    const trValues: number[] = [];
    for (let i = Math.max(1, candles.length - atrPeriod); i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trValues.push(tr);
    }
    const atr = trValues.reduce((sum, tr) => sum + tr, 0) / trValues.length;

    // Calculate VWAP
    const vwapCandles = candles.slice(-20);
    let sumPV = 0;
    let sumV = 0;
    for (const candle of vwapCandles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1000;
      sumPV += typical * volume;
      sumV += volume;
    }
    const vwap = sumPV / sumV;

    // Determine trend
    let trend = 'sideways';
    if (ema20 > ema50 && currentCandle.close > ema50) {
      trend = 'bullish';
    } else if (ema20 < ema50 && currentCandle.close < ema50) {
      trend = 'bearish';
    }

    // Calculate momentum
    const momentum = closes.length >= 10
      ? ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100
      : 0;

    // Determine volatility
    const atrPercent = (atr / currentCandle.close) * 100;
    let volatility = 'medium';
    if (atrPercent < 0.3) volatility = 'low';
    else if (atrPercent > 0.8) volatility = 'high';

    const swingLevels = this.detectSwingLevels(candles);

    // Calculate MACD
    const macdData = this.calculateMACD(closes);

    // Compute Omega Sensors (ZERO cost, pure math)
    const omegaSensors = computeOmegaSensors(
      candles,
      rsi,
      macdData.macd,
      macdData.signal,
      atr,
      vwap
    );

    // Dev logging for Omega Sensors
    if (import.meta.env.DEV_MODE === 'true') {
      console.debug(formatSensorsForLogging(omegaSensors, trend));
    }

    return {
      price: currentCandle.close,
      ema20,
      ema50,
      ema200,
      rsi,
      stochRsi,
      atr,
      vwap,
      trend,
      momentum,
      volatility,
      swingHigh: swingLevels.high,
      swingLow: swingLevels.low,
      macd: macdData.macd,
      macdSignal: macdData.signal,
      omegaSensors
    };
  }
}

export const llmSnapshotBuilder = new LLMSnapshotBuilder();
