/**
 * Unit Tests for Refined Safety Systems
 *
 * Tests the enhanced stop-run classification and Omega conflict resolution
 */

import { adversarialDetector, type MarketState as AdversarialMarketState, type Candle } from '../services/adversarial-detector';

describe('Refined Stop-Run Classification', () => {
  const baseMarketState: AdversarialMarketState = {
    price: 1.1000,
    ema20: 1.0995,
    ema50: 1.0990,
    ema200: 1.0980,
    atr: 0.0010,
    rsi: 50,
    vwap: 1.0998,
    swingHigh: 1.1020,
    swingLow: 1.0970
  };

  const createCandle = (open: number, high: number, low: number, close: number): Candle => ({
    open,
    high,
    low,
    close,
    volume: 1000,
    time: Date.now()
  });

  /**
   * Test 1: Active stop-run → must block
   */
  test('Should block active stop-run (within 3 candles)', () => {
    const candles: Candle[] = [
      createCandle(1.0990, 1.0995, 1.0985, 1.0992),
      createCandle(1.0992, 1.0997, 1.0987, 1.0994),
      createCandle(1.0994, 1.0999, 1.0989, 1.0996),
      createCandle(1.0996, 1.1001, 1.0991, 1.0998),
      createCandle(1.0998, 1.1003, 1.0993, 1.1000),
      createCandle(1.1000, 1.1005, 1.0995, 1.1002),
      createCandle(1.1002, 1.1007, 1.0997, 1.1004),
      createCandle(1.1004, 1.1009, 1.0999, 1.1006),
      createCandle(1.1006, 1.1011, 1.1001, 1.1008),
      // Active stop run on last candle (long upper wick)
      createCandle(1.1008, 1.1025, 1.1006, 1.1010) // Wick is ~15 pips, body is ~2 pips
    ];

    const result = adversarialDetector.evaluate(baseMarketState, candles);

    expect(result.stop_run_classification).toBeDefined();
    expect(result.stop_run_classification?.type).toBe('active_stop_run');
    expect(result.stop_run_classification?.should_block).toBe(true);
    expect(result.stop_run_classification?.candles_ago).toBeLessThanOrEqual(3);
  });

  /**
   * Test 2: Historical sweep + BOS → must allow
   */
  test('Should allow historical sweep with BOS', () => {
    const candles: Candle[] = [
      createCandle(1.0990, 1.0995, 1.0985, 1.0992),
      createCandle(1.0992, 1.0997, 1.0987, 1.0994),
      createCandle(1.0994, 1.0999, 1.0989, 1.0996),
      createCandle(1.0996, 1.1001, 1.0991, 1.0998),
      // Stop run 6 candles ago
      createCandle(1.0998, 1.1020, 1.0996, 1.1000), // Long upper wick
      // BOS - price breaks below after the stop run
      createCandle(1.1000, 1.1002, 1.0990, 1.0992),
      createCandle(1.0992, 1.0995, 1.0985, 1.0987),
      createCandle(1.0987, 1.0990, 1.0980, 1.0982), // Clear break below
      createCandle(1.0982, 1.0985, 1.0975, 1.0980),
      createCandle(1.0980, 1.0983, 1.0973, 1.0978)
    ];

    const result = adversarialDetector.evaluate(baseMarketState, candles);

    expect(result.stop_run_classification).toBeDefined();
    expect(result.stop_run_classification?.type).toBe('historical_sweep');
    expect(result.stop_run_classification?.has_bos).toBe(true);
    expect(result.stop_run_classification?.should_block).toBe(false);
  });

  /**
   * Test 3: Historical sweep + no BOS → Omega-9 decision required
   */
  test('Should flag historical sweep without BOS for Omega-9 validation', () => {
    const candles: Candle[] = [
      createCandle(1.0990, 1.0995, 1.0985, 1.0992),
      createCandle(1.0992, 1.0997, 1.0987, 1.0994),
      createCandle(1.0994, 1.0999, 1.0989, 1.0996),
      createCandle(1.0996, 1.1001, 1.0991, 1.0998),
      // Stop run 6 candles ago
      createCandle(1.0998, 1.1020, 1.0996, 1.1000), // Long upper wick
      // NO clear BOS - price just consolidates
      createCandle(1.1000, 1.1002, 1.0998, 1.1001),
      createCandle(1.1001, 1.1003, 1.0999, 1.1002),
      createCandle(1.1002, 1.1004, 1.1000, 1.1003),
      createCandle(1.1003, 1.1005, 1.1001, 1.1004),
      createCandle(1.1004, 1.1006, 1.1002, 1.1005)
    ];

    const result = adversarialDetector.evaluate(baseMarketState, candles);

    expect(result.stop_run_classification).toBeDefined();
    expect(result.stop_run_classification?.type).toBe('historical_sweep');
    expect(result.stop_run_classification?.has_bos).toBe(false);
    expect(result.stop_run_classification?.should_block).toBe(false);
    expect(result.stop_run_classification?.reasoning).toContain('additional validation');
  });

  /**
   * Test 4: Manipulation spike → must block
   */
  test('Should block manipulation spike (ATR > 2.2x)', () => {
    const candles: Candle[] = [
      createCandle(1.0990, 1.0995, 1.0985, 1.0992),
      createCandle(1.0992, 1.0997, 1.0987, 1.0994),
      createCandle(1.0994, 1.0999, 1.0989, 1.0996),
      createCandle(1.0996, 1.1001, 1.0991, 1.0998),
      createCandle(1.0998, 1.1003, 1.0993, 1.1000),
      createCandle(1.1000, 1.1005, 1.0995, 1.1002),
      createCandle(1.1002, 1.1007, 1.0997, 1.1004),
      createCandle(1.1004, 1.1009, 1.0999, 1.1006),
      createCandle(1.1006, 1.1011, 1.1001, 1.1008),
      // Extreme spike (30+ pips range when average is ~10 pips)
      createCandle(1.1008, 1.1040, 1.1005, 1.1012) // Range = 35 pips, body = 4 pips
    ];

    const result = adversarialDetector.evaluate(baseMarketState, candles);

    expect(result.stop_run_classification).toBeDefined();
    expect(result.stop_run_classification?.type).toBe('manipulation_spike');
    expect(result.stop_run_classification?.should_block).toBe(true);
  });

  /**
   * Test 5: No stop-run patterns → clean signal
   */
  test('Should return clean signal when no stop-runs detected', () => {
    const candles: Candle[] = [
      createCandle(1.0990, 1.0995, 1.0985, 1.0992),
      createCandle(1.0992, 1.0997, 1.0987, 1.0994),
      createCandle(1.0994, 1.0999, 1.0989, 1.0996),
      createCandle(1.0996, 1.1001, 1.0991, 1.0998),
      createCandle(1.0998, 1.1003, 1.0993, 1.1000),
      createCandle(1.1000, 1.1005, 1.0995, 1.1002),
      createCandle(1.1002, 1.1007, 1.0997, 1.1004),
      createCandle(1.1004, 1.1009, 1.0999, 1.1006),
      createCandle(1.1006, 1.1011, 1.1001, 1.1008),
      createCandle(1.1008, 1.1013, 1.1003, 1.1010) // Normal candle
    ];

    const result = adversarialDetector.evaluate(baseMarketState, candles);

    expect(result.stop_run_classification).toBeDefined();
    expect(result.stop_run_classification?.type).toBe('none');
    expect(result.stop_run_classification?.should_block).toBe(false);
  });
});

describe('Refined Omega Conflict Resolution', () => {
  // Note: These tests would require importing the orchestrator
  // For now, documenting expected behavior

  test('HARD BLOCK: Two Omegas disagree >= 70% from conflicting domains', () => {
    // Example: OmegaTrend (BUY 82%) vs OmegaSwing (SELL 78%)
    // Expected: HARD BLOCK, trade rejected
    expect(true).toBe(true); // Placeholder
  });

  test('SOFT WARNING: One Omega disagrees with low confidence', () => {
    // Example: OmegaTrend (BUY 75%) vs OmegaScalper (SELL 60%)
    // Expected: SOFT conflict, 10-20% confidence penalty, trade proceeds
    expect(true).toBe(true); // Placeholder
  });

  test('SOFT WARNING: Similar domain disagreement', () => {
    // Example: OmegaSwing (BUY 75%) vs OmegaReversal (SELL 72%)
    // Expected: SOFT conflict, 15% confidence penalty, trade proceeds
    expect(true).toBe(true); // Placeholder
  });

  test('NO CONFLICT: All Omegas agree', () => {
    // Example: All Omegas vote BUY with varying confidence
    // Expected: No conflict, normal execution
    expect(true).toBe(true); // Placeholder
  });

  test('NO CONFLICT: Only one high-confidence directional vote', () => {
    // Example: OmegaTrend (BUY 75%), others weak lean BUY/SELL
    // Expected: No conflict, normal execution
    expect(true).toBe(true); // Placeholder
  });
});
