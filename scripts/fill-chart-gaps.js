#!/usr/bin/env node
/**
 * FREE Gap Filler - Fills missing candles using interpolation
 *
 * Usage:
 *   node scripts/fill-chart-gaps.js
 *   node scripts/fill-chart-gaps.js EURUSD M5 7   # specific symbol, timeframe, days
 *
 * This script:
 * - Detects gaps in your candle data
 * - Fills small gaps (< 20 candles) using linear interpolation
 * - Skips weekend gaps automatically
 * - 100% FREE - no API keys needed!
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INTERVAL_MINUTES = {
  'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
  'H1': 60, 'H4': 240, 'D1': 1440
};

async function findAndFillGaps(symbol, timeframe, daysBack) {
  const intervalMinutes = INTERVAL_MINUTES[timeframe] || 5;
  const intervalMs = intervalMinutes * 60000;

  console.log(`\n📊 Checking ${symbol} ${timeframe}...`);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const { data, error } = await supabase
    .from('forex_candles')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .gte('open_time', startDate.toISOString())
    .order('open_time', { ascending: true });

  if (error) {
    console.error(`  ❌ Error fetching data:`, error.message);
    return { gaps: 0, filled: 0 };
  }

  if (!data || data.length < 2) {
    console.log(`  ℹ️  Not enough data to check for gaps`);
    return { gaps: 0, filled: 0 };
  }

  const gaps = [];
  const fillCandles = [];

  for (let i = 1; i < data.length; i++) {
    const prevTime = new Date(data[i - 1].open_time);
    const currTime = new Date(data[i].open_time);
    const diffMinutes = (currTime - prevTime) / 60000;

    // Check if there's a gap (more than 1.5x the interval)
    if (diffMinutes > intervalMinutes * 1.5 && diffMinutes < 1440) {
      // Skip weekend gaps (Fri 21:00 UTC to Sun 21:00 UTC)
      const prevDay = prevTime.getUTCDay();
      const prevHour = prevTime.getUTCHours();
      const isWeekend = (prevDay === 5 && prevHour >= 21) || prevDay === 6 || (prevDay === 0 && prevHour < 21);

      if (!isWeekend) {
        const missingCount = Math.floor(diffMinutes / intervalMinutes) - 1;

        // Only fill small gaps (< 20 candles) to avoid bad interpolation
        if (missingCount > 0 && missingCount <= 20) {
          gaps.push({
            start: prevTime,
            end: currTime,
            count: missingCount
          });

          // Linear interpolation between the two candles
          const priceStep = (data[i].open - data[i-1].close) / (missingCount + 1);
          let currentTime = new Date(prevTime.getTime() + intervalMs);
          let currentPrice = data[i-1].close;

          for (let j = 0; j < missingCount; j++) {
            currentPrice += priceStep;
            const open = currentPrice;
            const close = currentPrice + priceStep;
            const high = Math.max(open, close) * 1.0002; // Small wick
            const low = Math.min(open, close) * 0.9998;

            fillCandles.push({
              symbol,
              timeframe,
              open_time: currentTime.toISOString(),
              close_time: new Date(currentTime.getTime() + intervalMs).toISOString(),
              open,
              high,
              low,
              close,
              volume: 0,
              data_source: 'interpolated'
            });

            currentTime = new Date(currentTime.getTime() + intervalMs);
          }
        }
      }
    }
  }

  if (fillCandles.length > 0) {
    console.log(`  🔧 Filling ${fillCandles.length} candles across ${gaps.length} gaps...`);

    const { error: insertError } = await supabase
      .from('forex_candles')
      .upsert(fillCandles, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: true
      });

    if (insertError) {
      console.error(`  ❌ Error inserting:`, insertError.message);
      return { gaps: gaps.length, filled: 0 };
    }

    console.log(`  ✅ Successfully filled ${fillCandles.length} candles`);
  } else if (gaps.length > 0) {
    console.log(`  ℹ️  Found ${gaps.length} gaps but they're too large to interpolate safely`);
  } else {
    console.log(`  ✅ No gaps found - data looks clean!`);
  }

  return { gaps: gaps.length, filled: fillCandles.length };
}

async function main() {
  console.log('🚀 FREE Gap Filler - Filling missing candles\n');

  const args = process.argv.slice(2);

  let symbols, timeframes, daysBack;

  if (args.length >= 3) {
    // Specific symbol/timeframe/days
    symbols = [args[0]];
    timeframes = [args[1]];
    daysBack = parseInt(args[2]) || 14;
  } else {
    // All symbols and timeframes
    symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];
    timeframes = ['M5', 'M15', 'M30', 'H1'];
    daysBack = 14;
  }

  console.log(`📅 Looking back ${daysBack} days\n`);

  let totalGaps = 0;
  let totalFilled = 0;

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const result = await findAndFillGaps(symbol, timeframe, daysBack);
      totalGaps += result.gaps;
      totalFilled += result.filled;

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\n✅ Gap filling complete!`);
  console.log(`   Total gaps found: ${totalGaps}`);
  console.log(`   Total candles filled: ${totalFilled}`);
  console.log(`\n💡 Tip: Run this script anytime you notice gaps in your charts\n`);
}

main().catch(console.error);
