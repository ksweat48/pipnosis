/**
 * Test Script for AI Market Analysis Engine
 * Run with: npx ts-node scripts/test-ai-analysis.ts
 */

import { analyzeMarket } from '../src/lib/aiMarketEngine';
import { Candle } from '../src/lib/indicators';

function generateTestCandles(count: number = 100): Candle[] {
  const candles: Candle[] = [];
  const basePrice = 1.1000;
  const baseVolume = 100000;
  const startTime = new Date('2025-01-01T00:00:00Z');

  for (let i = 0; i < count; i++) {
    const time = new Date(startTime.getTime() + i * 5 * 60 * 1000);

    const trend = Math.sin(i / 10) * 0.005;
    const noise = (Math.random() - 0.5) * 0.0005;
    const price = basePrice + trend + noise;

    const open = price + (Math.random() - 0.5) * 0.0002;
    const close = price + (Math.random() - 0.5) * 0.0002;
    const high = Math.max(open, close) + Math.random() * 0.0003;
    const low = Math.min(open, close) - Math.random() * 0.0003;
    const volume = baseVolume * (0.8 + Math.random() * 0.4);

    candles.push({
      time: time.toISOString(),
      open,
      high,
      low,
      close,
      volume
    });
  }

  return candles;
}

function generateBullishEngulfingPattern(): Candle[] {
  const candles = generateTestCandles(60);

  const bearishCandle: Candle = {
    time: new Date('2025-01-01T05:00:00Z').toISOString(),
    open: 1.1050,
    high: 1.1052,
    low: 1.1030,
    close: 1.1032,
    volume: 150000
  };

  const bullishEngulfing: Candle = {
    time: new Date('2025-01-01T05:05:00Z').toISOString(),
    open: 1.1028,
    high: 1.1065,
    low: 1.1025,
    close: 1.1060,
    volume: 200000
  };

  candles.push(bearishCandle, bullishEngulfing);

  return candles;
}

async function runTests() {
  console.log('🧪 Testing AI Market Analysis Engine\n');
  console.log('=' .repeat(60));

  console.log('\n📊 Test 1: Basic Analysis with Random Data');
  console.log('-'.repeat(60));
  try {
    const testCandles = generateTestCandles(100);
    const analysis = await analyzeMarket(testCandles);

    console.log('✅ Analysis completed successfully');
    console.log(`   RSI: ${analysis.rsi.value.toFixed(2)} (${analysis.rsi.status})`);
    console.log(`   VWAP: ${analysis.vwap.value.toFixed(5)} (${analysis.vwap.position})`);
    console.log(`   Volume: ${analysis.volume.status} (${analysis.volume.delta})`);
    console.log(`   ATR: ${analysis.atr.value.toFixed(5)} (${analysis.atr.status})`);
    console.log(`   Candle Pattern: ${analysis.candleSignal.type} (${analysis.candleSignal.strength || 'N/A'})`);
    console.log(`   Structure: ${analysis.structure.type} (Recent: ${analysis.structure.recent})`);
    console.log(`   Sentiment: ${analysis.sentiment.status} (${analysis.sentiment.confidence}%)`);
    console.log(`   Trade Signal: ${analysis.tradeSignal.status}`);
    if (analysis.tradeSignal.direction) {
      console.log(`   Direction: ${analysis.tradeSignal.direction} (${analysis.tradeSignal.confidence}%)`);
      console.log(`   Reason: ${analysis.tradeSignal.reason}`);
    }
  } catch (err) {
    console.error('❌ Test 1 failed:', err instanceof Error ? err.message : err);
  }

  console.log('\n📊 Test 2: Bullish Engulfing Pattern Detection');
  console.log('-'.repeat(60));
  try {
    const bullishCandles = generateBullishEngulfingPattern();
    const analysis = await analyzeMarket(bullishCandles);

    console.log('✅ Analysis completed successfully');
    console.log(`   Candle Pattern: ${analysis.candleSignal.type}`);
    console.log(`   Pattern Strength: ${analysis.candleSignal.strength}`);
    console.log(`   Sentiment: ${analysis.sentiment.status} (${analysis.sentiment.confidence}%)`);
    console.log(`   Trade Signal: ${analysis.tradeSignal.status}`);

    if (analysis.candleSignal.type.includes('Engulfing')) {
      console.log('✅ Bullish Engulfing pattern detected correctly');
    } else {
      console.log('⚠️  Expected Bullish Engulfing, got:', analysis.candleSignal.type);
    }
  } catch (err) {
    console.error('❌ Test 2 failed:', err instanceof Error ? err.message : err);
  }

  console.log('\n📊 Test 3: Insufficient Data Handling');
  console.log('-'.repeat(60));
  try {
    const fewCandles = generateTestCandles(15);
    await analyzeMarket(fewCandles);
    console.log('❌ Should have thrown error for insufficient data');
  } catch (err) {
    console.log('✅ Correctly rejected insufficient data');
    console.log(`   Error: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\n📊 Test 4: Oversold RSI Scenario');
  console.log('-'.repeat(60));
  try {
    const candles = generateTestCandles(60);

    for (let i = candles.length - 20; i < candles.length; i++) {
      candles[i].close = candles[i].open - Math.random() * 0.001;
      candles[i].low = candles[i].close - Math.random() * 0.0005;
    }

    const analysis = await analyzeMarket(candles);

    console.log('✅ Analysis completed successfully');
    console.log(`   RSI: ${analysis.rsi.value.toFixed(2)} (${analysis.rsi.status})`);

    if (analysis.rsi.value < 40) {
      console.log('✅ RSI correctly calculated for downtrend');
    }
  } catch (err) {
    console.error('❌ Test 4 failed:', err instanceof Error ? err.message : err);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 Testing complete!\n');
}

runTests().catch(console.error);
