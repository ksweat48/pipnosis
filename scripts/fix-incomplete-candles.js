#!/usr/bin/env node

/**
 * Fix Incomplete Candles Script
 *
 * This script scans for incomplete candles (missing wicks, invalid OHLC)
 * and regenerates them from raw tick data using the aggregate-candles function.
 *
 * Usage:
 *   node scripts/fix-incomplete-candles.js [hoursBack]
 *
 * Examples:
 *   node scripts/fix-incomplete-candles.js      # Regenerate last 48 hours
 *   node scripts/fix-incomplete-candles.js 24   # Regenerate last 24 hours
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const FOREX_PAIRS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

async function findIncompleteCandles() {
  console.log('🔍 Scanning for incomplete candles...\n');

  const issues = {
    invalidWicks: [],
    missingData: [],
    invalidOHLC: []
  };

  let totalScanned = 0;

  for (const symbol of FOREX_PAIRS) {
    for (const timeframe of TIMEFRAMES) {
      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: false })
        .limit(500);

      if (error) {
        console.error(`Error fetching ${symbol} ${timeframe}:`, error.message);
        continue;
      }

      if (!candles || candles.length === 0) {
        continue;
      }

      totalScanned += candles.length;

      for (const candle of candles) {
        // Check for invalid wicks (high = low)
        if (candle.high === candle.low) {
          issues.invalidWicks.push({
            symbol,
            timeframe,
            open_time: candle.open_time,
            issue: 'No wick - high equals low',
            data: { open: candle.open, high: candle.high, low: candle.low, close: candle.close }
          });
        }

        // Check for missing OHLC data
        if (!candle.open || !candle.high || !candle.low || !candle.close) {
          issues.missingData.push({
            symbol,
            timeframe,
            open_time: candle.open_time,
            issue: 'Missing OHLC data',
            data: { open: candle.open, high: candle.high, low: candle.low, close: candle.close }
          });
        }

        // Check for invalid OHLC relationships
        if (candle.high < candle.low ||
            candle.open < candle.low || candle.open > candle.high ||
            candle.close < candle.low || candle.close > candle.high) {
          issues.invalidOHLC.push({
            symbol,
            timeframe,
            open_time: candle.open_time,
            issue: 'Invalid OHLC relationships',
            data: { open: candle.open, high: candle.high, low: candle.low, close: candle.close }
          });
        }
      }
    }
  }

  return { issues, totalScanned };
}

async function regenerateCandles(hoursBack = 48) {
  console.log(`\n🔧 Regenerating candles from the last ${hoursBack} hours of tick data...\n`);

  const lookbackTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  console.log(`Calling Supabase aggregate-candles function...`);
  console.log(`Processing from: ${lookbackTime.toISOString()}`);
  console.log(`Lookback: ${hoursBack * 60} minutes\n`);

  try {
    const aggregateUrl = `${SUPABASE_URL}/functions/v1/aggregate-candles?lookback=${hoursBack * 60}`;

    const response = await fetch(aggregateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    console.log('\n✅ Candle regeneration completed:');
    console.log(`  - Ticks processed: ${result.ticksProcessed || 0}`);
    console.log(`  - Candles created: ${result.candlesCreated || 0}`);
    console.log(`  - Symbols processed: ${result.symbolsProcessed || 0}`);
    console.log(`  - Duration: ${result.duration || 0}ms`);

    return result;
  } catch (error) {
    console.error('❌ Failed to regenerate candles:', error.message);
    throw error;
  }
}

async function main() {
  const hoursBack = parseInt(process.argv[2]) || 48;

  console.log('='.repeat(80));
  console.log('🔧 INCOMPLETE CANDLES FIX SCRIPT');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Scan for issues
  console.log('STEP 1: Scanning for incomplete candles\n');
  const { issues, totalScanned } = await findIncompleteCandles();

  const totalIssues = issues.invalidWicks.length + issues.missingData.length + issues.invalidOHLC.length;

  console.log('\n📊 SCAN RESULTS:');
  console.log(`  - Total candles scanned: ${totalScanned}`);
  console.log(`  - Invalid wicks (high=low): ${issues.invalidWicks.length}`);
  console.log(`  - Missing OHLC data: ${issues.missingData.length}`);
  console.log(`  - Invalid OHLC relationships: ${issues.invalidOHLC.length}`);
  console.log(`  - TOTAL ISSUES: ${totalIssues}`);

  if (totalIssues === 0) {
    console.log('\n✅ No incomplete candles found! Your database is clean.');
    console.log('='.repeat(80));
    return;
  }

  if (issues.invalidWicks.length > 0) {
    console.log('\n❌ Sample invalid wicks (first 5):');
    issues.invalidWicks.slice(0, 5).forEach(issue => {
      console.log(`  ${issue.symbol} ${issue.timeframe} at ${issue.open_time}`);
      console.log(`    O:${issue.data.open} H:${issue.data.high} L:${issue.data.low} C:${issue.data.close}`);
    });
  }

  // Step 2: Regenerate candles from tick data
  console.log('\n' + '='.repeat(80));
  console.log(`STEP 2: Regenerating candles from raw tick data (last ${hoursBack} hours)\n`);

  try {
    await regenerateCandles(hoursBack);
  } catch (error) {
    console.error('\n❌ Regeneration failed:', error.message);
    console.log('\n💡 Try running with a smaller time window:');
    console.log(`   node scripts/fix-incomplete-candles.js 24`);
    process.exit(1);
  }

  // Step 3: Re-scan to verify fixes
  console.log('\n' + '='.repeat(80));
  console.log('STEP 3: Verifying fixes\n');

  const { issues: issuesAfter, totalScanned: totalScannedAfter } = await findIncompleteCandles();
  const totalIssuesAfter = issuesAfter.invalidWicks.length + issuesAfter.missingData.length + issuesAfter.invalidOHLC.length;

  console.log('\n📊 POST-FIX SCAN RESULTS:');
  console.log(`  - Total candles scanned: ${totalScannedAfter}`);
  console.log(`  - Invalid wicks (high=low): ${issuesAfter.invalidWicks.length}`);
  console.log(`  - Missing OHLC data: ${issuesAfter.missingData.length}`);
  console.log(`  - Invalid OHLC relationships: ${issuesAfter.invalidOHLC.length}`);
  console.log(`  - TOTAL ISSUES: ${totalIssuesAfter}`);

  const fixed = totalIssues - totalIssuesAfter;

  if (fixed > 0) {
    console.log(`\n✅ FIXED: ${fixed} candles`);
  } else if (totalIssuesAfter > 0) {
    console.log(`\n⚠️ Still have ${totalIssuesAfter} issues remaining.`);
    console.log('💡 This may be because:');
    console.log('   - Issues are older than the regeneration window');
    console.log('   - No tick data available for those periods');
    console.log('   - Try running with a longer time window (e.g., 72 or 168 hours)');
  } else {
    console.log('\n✅ All candles are now complete!');
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Script completed successfully!');
  console.log('='.repeat(80));
}

main().catch(error => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});
