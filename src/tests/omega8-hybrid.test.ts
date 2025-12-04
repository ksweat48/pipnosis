/**
 * Tests for Omega-8 Hybrid OrderFlow Brain
 *
 * Validates:
 * - Deterministic pattern detection accuracy
 * - Scoring logic consistency
 * - LLM triggering conditions
 * - Final bias combination logic
 * - ATR-relative tolerance across instruments
 */

import { Omega8HybridBrain, type Omega8MarketSnapshot, type Omega8Candle } from '../brains/omega8-hybrid-orderflow';

describe('Omega-8 Hybrid Brain', () => {
  let brain: Omega8HybridBrain;

  beforeEach(() => {
    brain = new Omega8HybridBrain();
  });

  describe('Pattern Detection', () => {
    test('detects equal highs with ATR-relative tolerance', () => {
      const candles: Omega8Candle[] = [
        { time: 1000, open: 100, high: 105, low: 99, close: 104, volume: 1000 },
        { time: 2000, open: 104, high: 105.05, low: 103, close: 104.5, volume: 1200 },
        { time: 3000, open: 104.5, high: 104.9, low: 104, close: 104.2, volume: 1100 }
      ];

      const snapshot: Omega8MarketSnapshot = {
        symbol: 'EURUSD',
        timeframe: 'M15',
        price: 104,
        atr: 0.5,
        candles,
        trendBias: 'up',
        support: [103, 102],
        resistance: [106, 107]
      };

      const patterns = (brain as any).detectPatterns(snapshot);

      expect(patterns.equalHighs).toBeGreaterThan(0);
    });

    test('detects liquidity sweeps with rejection wicks', () => {
      const candles: Omega8Candle[] = [
        { time: 1000, open: 100, high: 102, low: 99, close: 100.5, volume: 1000 },
        { time: 2000, open: 100.5, high: 103, low: 100, close: 100.2, volume: 1500 },
        { time: 3000, open: 100.2, high: 101, low: 99.5, close: 100, volume: 1200 }
      ];

      const snapshot: Omega8MarketSnapshot = {
        symbol: 'XAUUSD',
        timeframe: 'M5',
        price: 100,
        atr: 2.0,
        candles,
        trendBias: 'up',
        support: [],
        resistance: []
      };

      const patterns = (brain as any).detectPatterns(snapshot);

      expect(patterns.sweptHighs + patterns.sweptLows).toBeGreaterThan(0);
    });

    test('detects Fair Value Gaps (FVG)', () => {
      const candles: Omega8Candle[] = [
        { time: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
        { time: 2000, open: 100.5, high: 105, low: 100, close: 104, volume: 2000 },
        { time: 3000, open: 104, high: 106, low: 103, close: 105, volume: 1500 }
      ];

      const snapshot: Omega8MarketSnapshot = {
        symbol: 'GBPUSD',
        timeframe: 'M15',
        price: 105,
        atr: 1.0,
        candles,
        trendBias: 'up',
        support: [],
        resistance: []
      };

      const patterns = (brain as any).detectPatterns(snapshot);

      expect(patterns.fvgBullish).toBeGreaterThan(0);
    });

    test('detects directional volume spikes', () => {
      const candles: Omega8Candle[] = [
        { time: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
        { time: 2000, open: 100.5, high: 101, low: 100, close: 100.7, volume: 1100 },
        { time: 3000, open: 100.7, high: 102, low: 100.5, close: 101.8, volume: 2500 }
      ];

      const snapshot: Omega8MarketSnapshot = {
        symbol: 'EURUSD',
        timeframe: 'M5',
        price: 101.8,
        atr: 0.5,
        candles,
        trendBias: 'up',
        support: [],
        resistance: []
      };

      const patterns = (brain as any).detectPatterns(snapshot);

      expect(patterns.volSpikeBullish || patterns.volSpikeBearish).toBe(true);
    });
  });

  describe('Deterministic Scoring', () => {
    test('assigns strong buy bias for bullish sweep in uptrend', () => {
      const patterns = {
        equalHighs: 0,
        equalLows: 2,
        sweptHighs: 0,
        sweptLows: 2,
        fvgBullish: 1,
        fvgBearish: 0,
        volSpikeBullish: true,
        volSpikeBearish: false,
        absorptionBullish: false,
        absorptionBearish: false,
        accumulationZone: false,
        distributionZone: false,
        confluenceScore: 3
      };

      const decision = (brain as any).scoreOmega8(patterns, 'up', 1.0);

      expect(decision.baseBias).toBe('buy');
      expect(decision.confidence).toBeGreaterThanOrEqual(60);
    });

    test('assigns neutral bias for conflicting signals', () => {
      const patterns = {
        equalHighs: 1,
        equalLows: 1,
        sweptHighs: 1,
        sweptLows: 1,
        fvgBullish: 0,
        fvgBearish: 0,
        volSpikeBullish: false,
        volSpikeBearish: false,
        absorptionBullish: false,
        absorptionBearish: false,
        accumulationZone: false,
        distributionZone: false,
        confluenceScore: 0
      };

      const decision = (brain as any).scoreOmega8(patterns, 'sideways', 1.0);

      expect(decision.baseBias).toBe('neutral');
      expect(decision.confidence).toBeLessThan(60);
    });

    test('confluence bonus amplifies strong signals', () => {
      const patternsWithConfluence = {
        equalHighs: 0,
        equalLows: 1,
        sweptHighs: 0,
        sweptLows: 1,
        fvgBullish: 1,
        fvgBearish: 0,
        volSpikeBullish: true,
        volSpikeBearish: false,
        absorptionBullish: false,
        absorptionBearish: false,
        accumulationZone: false,
        distributionZone: false,
        confluenceScore: 3
      };

      const patternsWithoutConfluence = { ...patternsWithConfluence, confluenceScore: 0 };

      const decisionWith = (brain as any).scoreOmega8(patternsWithConfluence, 'up', 1.0);
      const decisionWithout = (brain as any).scoreOmega8(patternsWithoutConfluence, 'up', 1.0);

      expect(decisionWith.confidence).toBeGreaterThan(decisionWithout.confidence);
    });
  });

  describe('LLM Triggering Logic', () => {
    test('skips LLM when confidence is very high (>= 75)', () => {
      const deterministic = {
        baseBias: 'buy' as const,
        confidence: 85,
        scoreDetails: [],
        rawScore: 50
      };

      const patterns = {
        equalHighs: 0,
        equalLows: 0,
        sweptHighs: 0,
        sweptLows: 0,
        fvgBullish: 0,
        fvgBearish: 0,
        volSpikeBullish: false,
        volSpikeBearish: false,
        absorptionBullish: false,
        absorptionBearish: false,
        accumulationZone: false,
        distributionZone: false,
        confluenceScore: 0
      };

      const shouldUse = (brain as any).shouldUseLLM(deterministic, patterns);

      expect(shouldUse).toBe(false);
    });

    test('skips LLM when confidence is very low (<= 25)', () => {
      const deterministic = {
        baseBias: 'neutral' as const,
        confidence: 20,
        scoreDetails: [],
        rawScore: 5
      };

      const patterns = {
        equalHighs: 0,
        equalLows: 0,
        sweptHighs: 0,
        sweptLows: 0,
        fvgBullish: 0,
        fvgBearish: 0,
        volSpikeBullish: false,
        volSpikeBearish: false,
        absorptionBullish: false,
        absorptionBearish: false,
        accumulationZone: false,
        distributionZone: false,
        confluenceScore: 0
      };

      const shouldUse = (brain as any).shouldUseLLM(deterministic, patterns);

      expect(shouldUse).toBe(false);
    });

    test('uses LLM when confidence is in ambiguous range (35-65)', () => {
      const deterministic = {
        baseBias: 'buy' as const,
        confidence: 50,
        scoreDetails: [],
        rawScore: 15
      };

      const patterns = {
        equalHighs: 0,
        equalLows: 0,
        sweptHighs: 0,
        sweptLows: 0,
        fvgBullish: 0,
        fvgBearish: 0,
        volSpikeBullish: false,
        volSpikeBearish: false,
        absorptionBullish: false,
        absorptionBearish: false,
        accumulationZone: false,
        distributionZone: false,
        confluenceScore: 0
      };

      const shouldUse = (brain as any).shouldUseLLM(deterministic, patterns);

      expect(shouldUse).toBe(true);
    });

    test('uses LLM when patterns are conflicting', () => {
      const deterministic = {
        baseBias: 'neutral' as const,
        confidence: 70,
        scoreDetails: [],
        rawScore: 10
      };

      const patterns = {
        equalHighs: 1,
        equalLows: 1,
        sweptHighs: 1,
        sweptLows: 1,
        fvgBullish: 0,
        fvgBearish: 0,
        volSpikeBullish: false,
        volSpikeBearish: false,
        absorptionBullish: false,
        absorptionBearish: false,
        accumulationZone: false,
        distributionZone: false,
        confluenceScore: 0
      };

      const shouldUse = (brain as any).shouldUseLLM(deterministic, patterns);

      expect(shouldUse).toBe(true);
    });
  });

  describe('Bias Combination Logic', () => {
    test('uses deterministic bias when both agree', () => {
      const combined = (brain as any).combineBiases('buy', 'buy', 60, 65);

      expect(combined).toBe('buy');
    });

    test('uses higher confidence bias when they disagree', () => {
      const combined = (brain as any).combineBiases('buy', 'sell', 70, 50);

      expect(combined).toBe('buy');
    });

    test('returns neutral when average confidence is low', () => {
      const combined = (brain as any).combineBiases('buy', 'sell', 45, 40);

      expect(combined).toBe('neutral');
    });
  });

  describe('ATR-Relative Tolerance', () => {
    test('works for forex pairs (small ATR)', () => {
      const candles: Omega8Candle[] = [
        { time: 1000, open: 1.1000, high: 1.1005, low: 1.0995, close: 1.1002, volume: 1000 },
        { time: 2000, open: 1.1002, high: 1.1006, low: 1.0998, close: 1.1004, volume: 1100 }
      ];

      const snapshot: Omega8MarketSnapshot = {
        symbol: 'EURUSD',
        timeframe: 'M15',
        price: 1.1004,
        atr: 0.0005,
        candles,
        trendBias: 'up',
        support: [],
        resistance: []
      };

      const patterns = (brain as any).detectPatterns(snapshot);

      expect(patterns).toBeDefined();
    });

    test('works for gold (large ATR)', () => {
      const candles: Omega8Candle[] = [
        { time: 1000, open: 2000, high: 2015, low: 1995, close: 2010, volume: 5000 },
        { time: 2000, open: 2010, high: 2016, low: 2005, close: 2012, volume: 5500 }
      ];

      const snapshot: Omega8MarketSnapshot = {
        symbol: 'XAUUSD',
        timeframe: 'M15',
        price: 2012,
        atr: 10.0,
        candles,
        trendBias: 'up',
        support: [],
        resistance: []
      };

      const patterns = (brain as any).detectPatterns(snapshot);

      expect(patterns).toBeDefined();
    });
  });
});
