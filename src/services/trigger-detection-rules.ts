/**
 * Trigger Detection Rules for Event-Based LLM Trading
 *
 * This module defines all setup trigger patterns that open the "LLM gate"
 * Triggers are detected locally without any LLM calls to minimize costs
 * Only when a high-probability setup is detected does the system call the LLM
 */

export interface TriggerEvent {
  type: TriggerType;
  symbol: string;
  timeframe: string;
  timestamp: Date;
  price: number;
  confidence: number;
  metadata: TriggerMetadata;
  priority: number;
  context: string;
}

export type TriggerType =
  | 'vwap_touch'
  | 'vwap_bounce'
  | 'vwap_deviation'
  | 'ema_cross'
  | 'ema_momentum'
  | 'ema_pullback'
  | 'atr_expansion'
  | 'volume_spike'
  | 'candle_pattern'
  | 'confluence_event'
  | 'multi_timeframe_alignment';

export interface TriggerMetadata {
  vwap?: {
    distance: number;
    crossDirection?: 'above' | 'below';
    deviation: number;
  };
  ema?: {
    ema20: number;
    ema50: number;
    crossType?: 'golden' | 'death';
    slope20: number;
    priceToEma20Distance: number;
  };
  atr?: {
    current: number;
    average: number;
    expansionPercent: number;
  };
  volume?: {
    current: number;
    baseline: number;
    spikeRatio: number;
  };
  candle?: {
    pattern: string;
    strength: number;
  };
  confluence?: {
    triggers: TriggerType[];
    alignmentScore: number;
  };
  multiTimeframe?: {
    h1Trend: 'bullish' | 'bearish' | 'sideways';
    m15Trend: 'bullish' | 'bearish' | 'sideways';
    alignment: boolean;
  };
}

export interface MarketSnapshot {
  symbol: string;
  timestamp: Date;
  ohlc: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  indicators: {
    vwap: number;
    ema20: number;
    ema50: number;
    atr: number;
    volumeBaseline: number;
  };
  priceAction: {
    trend: 'bullish' | 'bearish' | 'sideways';
    volatility: 'low' | 'medium' | 'high';
    momentum: number;
  };
  support?: number;
  resistance?: number;
}

class TriggerDetectionRules {
  private readonly VWAP_TOUCH_THRESHOLD = 0.0015;
  private readonly VWAP_DEVIATION_THRESHOLD = 0.003;
  private readonly EMA_CROSS_MIN_SEPARATION = 0.0005;
  private readonly ATR_EXPANSION_THRESHOLD = 1.3;
  private readonly VOLUME_SPIKE_THRESHOLD = 1.3;
  private readonly EMA_SLOPE_THRESHOLD = 0.0002;

  /**
   * Detect all active triggers from a market snapshot
   */
  detectTriggers(snapshot: MarketSnapshot): TriggerEvent[] {
    const triggers: TriggerEvent[] = [];
    const currentPrice = snapshot.ohlc[snapshot.ohlc.length - 1].close;

    const vwapTriggers = this.detectVWAPTriggers(snapshot, currentPrice);
    const emaTriggers = this.detectEMATriggers(snapshot, currentPrice);
    const atrTriggers = this.detectATRTriggers(snapshot);
    const volumeTriggers = this.detectVolumeTriggers(snapshot);
    const candleTriggers = this.detectCandlePatterns(snapshot);

    triggers.push(...vwapTriggers);
    triggers.push(...emaTriggers);
    triggers.push(...atrTriggers);
    triggers.push(...volumeTriggers);
    triggers.push(...candleTriggers);

    const confluenceTriggers = this.detectConfluence(triggers, snapshot);
    if (confluenceTriggers.length > 0) {
      triggers.push(...confluenceTriggers);
    }

    triggers.forEach(trigger => {
      trigger.priority = this.calculateTriggerPriority(trigger);
    });

    return triggers.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Detect VWAP-based triggers
   */
  private detectVWAPTriggers(snapshot: MarketSnapshot, currentPrice: number): TriggerEvent[] {
    const triggers: TriggerEvent[] = [];
    const { vwap } = snapshot.indicators;
    const distance = Math.abs(currentPrice - vwap);
    const distancePercent = distance / currentPrice;
    const deviation = (currentPrice - vwap) / vwap;

    if (distancePercent <= this.VWAP_TOUCH_THRESHOLD) {
      triggers.push({
        type: 'vwap_touch',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: currentPrice,
        confidence: 75,
        metadata: {
          vwap: {
            distance: distancePercent,
            crossDirection: currentPrice > vwap ? 'above' : 'below',
            deviation
          }
        },
        priority: 0,
        context: `Price touched VWAP at ${currentPrice.toFixed(5)}, distance: ${(distancePercent * 100).toFixed(3)}%`
      });
    }

    if (Math.abs(deviation) >= this.VWAP_DEVIATION_THRESHOLD) {
      const candles = snapshot.ohlc;
      const prevCandle = candles[candles.length - 2];
      const currentCandle = candles[candles.length - 1];

      const prevDeviation = (prevCandle.close - vwap) / vwap;
      const isReturningToVWAP = Math.abs(deviation) < Math.abs(prevDeviation);

      if (isReturningToVWAP) {
        triggers.push({
          type: 'vwap_bounce',
          symbol: snapshot.symbol,
          timeframe: 'M15',
          timestamp: snapshot.timestamp,
          price: currentPrice,
          confidence: 70,
          metadata: {
            vwap: {
              distance: distancePercent,
              deviation
            }
          },
          priority: 0,
          context: `Price bouncing back to VWAP from ${(Math.abs(deviation) * 100).toFixed(2)}% deviation`
        });
      }
    }

    return triggers;
  }

  /**
   * Detect EMA-based triggers
   */
  private detectEMATriggers(snapshot: MarketSnapshot, currentPrice: number): TriggerEvent[] {
    const triggers: TriggerEvent[] = [];
    const { ema20, ema50 } = snapshot.indicators;
    const candles = snapshot.ohlc;

    if (candles.length < 2) return triggers;

    const prevCandle = candles[candles.length - 2];
    const currentCandle = candles[candles.length - 1];

    const ema20Slope = (ema20 - prevCandle.close) / prevCandle.close;
    const priceToEma20Distance = Math.abs(currentPrice - ema20) / currentPrice;

    const prevEma20AboveEma50 = prevCandle.close > ema50;
    const currentEma20AboveEma50 = ema20 > ema50;
    const crossOccurred = prevEma20AboveEma50 !== currentEma20AboveEma50;
    const separation = Math.abs(ema20 - ema50) / ema50;

    if (crossOccurred && separation >= this.EMA_CROSS_MIN_SEPARATION) {
      triggers.push({
        type: 'ema_cross',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: currentPrice,
        confidence: 80,
        metadata: {
          ema: {
            ema20,
            ema50,
            crossType: currentEma20AboveEma50 ? 'golden' : 'death',
            slope20: ema20Slope,
            priceToEma20Distance
          }
        },
        priority: 0,
        context: `EMA ${currentEma20AboveEma50 ? 'Golden' : 'Death'} cross detected`
      });
    }

    if (Math.abs(ema20Slope) >= this.EMA_SLOPE_THRESHOLD && ema20 > ema50) {
      triggers.push({
        type: 'ema_momentum',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: currentPrice,
        confidence: 72,
        metadata: {
          ema: {
            ema20,
            ema50,
            slope20: ema20Slope,
            priceToEma20Distance
          }
        },
        priority: 0,
        context: `Strong EMA20 momentum, slope: ${(ema20Slope * 100).toFixed(3)}%`
      });
    }

    if (priceToEma20Distance <= 0.001 && snapshot.priceAction.trend !== 'sideways') {
      triggers.push({
        type: 'ema_pullback',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: currentPrice,
        confidence: 75,
        metadata: {
          ema: {
            ema20,
            ema50,
            slope20: ema20Slope,
            priceToEma20Distance
          }
        },
        priority: 0,
        context: `Price pulled back to EMA20 on ${snapshot.priceAction.trend} trend`
      });
    }

    return triggers;
  }

  /**
   * Detect ATR expansion triggers
   */
  private detectATRTriggers(snapshot: MarketSnapshot): TriggerEvent[] {
    const triggers: TriggerEvent[] = [];
    const candles = snapshot.ohlc;

    if (candles.length < 20) return triggers;

    const currentATR = snapshot.indicators.atr;
    const recentCandles = candles.slice(-14);
    const avgATR = recentCandles.reduce((sum, c) => {
      const tr = Math.max(c.high - c.low, Math.abs(c.high - c.close), Math.abs(c.low - c.close));
      return sum + tr;
    }, 0) / 14;

    const expansionRatio = currentATR / avgATR;

    if (expansionRatio >= this.ATR_EXPANSION_THRESHOLD) {
      const currentCandle = candles[candles.length - 1];
      const isBreakout = Math.abs(currentCandle.close - currentCandle.open) / currentCandle.open > 0.002;

      if (isBreakout) {
        triggers.push({
          type: 'atr_expansion',
          symbol: snapshot.symbol,
          timeframe: 'M15',
          timestamp: snapshot.timestamp,
          price: currentCandle.close,
          confidence: 78,
          metadata: {
            atr: {
              current: currentATR,
              average: avgATR,
              expansionPercent: (expansionRatio - 1) * 100
            }
          },
          priority: 0,
          context: `ATR expansion ${((expansionRatio - 1) * 100).toFixed(1)}% with breakout candle`
        });
      }
    }

    return triggers;
  }

  /**
   * Detect volume spike triggers
   */
  private detectVolumeTriggers(snapshot: MarketSnapshot): TriggerEvent[] {
    const triggers: TriggerEvent[] = [];
    const candles = snapshot.ohlc;

    if (candles.length < 20) return triggers;

    const currentVolume = candles[candles.length - 1].volume;
    const volumeBaseline = snapshot.indicators.volumeBaseline;
    const spikeRatio = currentVolume / volumeBaseline;

    if (spikeRatio >= this.VOLUME_SPIKE_THRESHOLD) {
      triggers.push({
        type: 'volume_spike',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: candles[candles.length - 1].close,
        confidence: 70,
        metadata: {
          volume: {
            current: currentVolume,
            baseline: volumeBaseline,
            spikeRatio
          }
        },
        priority: 0,
        context: `Volume spike ${((spikeRatio - 1) * 100).toFixed(1)}% above baseline`
      });
    }

    return triggers;
  }

  /**
   * Detect candle pattern triggers
   */
  private detectCandlePatterns(snapshot: MarketSnapshot): TriggerEvent[] {
    const triggers: TriggerEvent[] = [];
    const candles = snapshot.ohlc;

    if (candles.length < 3) return triggers;

    const currentCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const prevPrevCandle = candles[candles.length - 3];

    const body = Math.abs(currentCandle.close - currentCandle.open);
    const totalRange = currentCandle.high - currentCandle.low;
    const bodyRatio = body / totalRange;
    const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
    const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);

    if (bodyRatio < 0.3 && lowerWick > body * 2 && currentCandle.close > currentCandle.open) {
      triggers.push({
        type: 'candle_pattern',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: currentCandle.close,
        confidence: 73,
        metadata: {
          candle: {
            pattern: 'hammer',
            strength: lowerWick / body
          }
        },
        priority: 0,
        context: 'Bullish hammer pattern detected'
      });
    }

    const isBullishEngulfing =
      prevCandle.close < prevCandle.open &&
      currentCandle.close > currentCandle.open &&
      currentCandle.open < prevCandle.close &&
      currentCandle.close > prevCandle.open &&
      body > Math.abs(prevCandle.close - prevCandle.open);

    if (isBullishEngulfing) {
      triggers.push({
        type: 'candle_pattern',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: currentCandle.close,
        confidence: 78,
        metadata: {
          candle: {
            pattern: 'bullish_engulfing',
            strength: body / Math.abs(prevCandle.close - prevCandle.open)
          }
        },
        priority: 0,
        context: 'Bullish engulfing pattern detected'
      });
    }

    const isBearishEngulfing =
      prevCandle.close > prevCandle.open &&
      currentCandle.close < currentCandle.open &&
      currentCandle.open > prevCandle.close &&
      currentCandle.close < prevCandle.open &&
      body > Math.abs(prevCandle.close - prevCandle.open);

    if (isBearishEngulfing) {
      triggers.push({
        type: 'candle_pattern',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: currentCandle.close,
        confidence: 78,
        metadata: {
          candle: {
            pattern: 'bearish_engulfing',
            strength: body / Math.abs(prevCandle.close - prevCandle.open)
          }
        },
        priority: 0,
        context: 'Bearish engulfing pattern detected'
      });
    }

    return triggers;
  }

  /**
   * Detect confluence events (multiple triggers aligning)
   */
  private detectConfluence(triggers: TriggerEvent[], snapshot: MarketSnapshot): TriggerEvent[] {
    const confluenceTriggers: TriggerEvent[] = [];

    if (triggers.length < 2) return confluenceTriggers;

    const vwapTrigger = triggers.find(t => t.type.includes('vwap'));
    const volumeTrigger = triggers.find(t => t.type === 'volume_spike');

    if (vwapTrigger && volumeTrigger) {
      confluenceTriggers.push({
        type: 'confluence_event',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: vwapTrigger.price,
        confidence: 85,
        metadata: {
          confluence: {
            triggers: [vwapTrigger.type, volumeTrigger.type],
            alignmentScore: 90
          }
        },
        priority: 0,
        context: 'VWAP trigger with volume confirmation'
      });
    }

    const emaTrigger = triggers.find(t => t.type.includes('ema'));
    const atrTrigger = triggers.find(t => t.type === 'atr_expansion');

    if (emaTrigger && atrTrigger) {
      confluenceTriggers.push({
        type: 'confluence_event',
        symbol: snapshot.symbol,
        timeframe: 'M15',
        timestamp: snapshot.timestamp,
        price: emaTrigger.price,
        confidence: 83,
        metadata: {
          confluence: {
            triggers: [emaTrigger.type, atrTrigger.type],
            alignmentScore: 85
          }
        },
        priority: 0,
        context: 'EMA momentum with ATR expansion'
      });
    }

    return confluenceTriggers;
  }

  /**
   * Calculate trigger priority for sorting
   */
  private calculateTriggerPriority(trigger: TriggerEvent): number {
    let priority = trigger.confidence;

    if (trigger.type === 'confluence_event') {
      priority += 15;
    }

    if (trigger.type === 'ema_cross' || trigger.type === 'vwap_touch') {
      priority += 10;
    }

    if (trigger.type === 'volume_spike') {
      priority += 5;
    }

    return priority;
  }

  /**
   * Check multi-timeframe alignment
   */
  checkMultiTimeframeAlignment(
    m15Trend: 'bullish' | 'bearish' | 'sideways',
    h1Trend: 'bullish' | 'bearish' | 'sideways'
  ): boolean {
    if (m15Trend === 'sideways' || h1Trend === 'sideways') {
      return false;
    }
    return m15Trend === h1Trend;
  }

  /**
   * Validate trigger against Pipnosis rules
   * CCIP-2026-0410A: Confidence never gates trigger validity. Structural properties only.
   */
  validateTrigger(trigger: TriggerEvent): boolean {
    const prohibitedTimeframes = ['D1', 'W1', 'MN1'];
    if (prohibitedTimeframes.includes(trigger.timeframe)) {
      return false;
    }

    return true;
  }
}

export const triggerDetectionRules = new TriggerDetectionRules();
