#!/usr/bin/env node

/**
 * Historical Candle Gap Backfill Script
 *
 * This script scans the forex_candles table for gaps in the time sequence
 * and fills them with flat candles using the last known price.
 *
 * Usage:
 *   node scripts/backfill-candle-gaps.js [lookback_hours]
 *
 * Example:
 *   node scripts/backfill-candle-gaps.js 168  # Backfill last 7 days
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   VITE_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const DEFAULT_LOOKBACK_HOURS = 72; // 3 days default

async function backfillCandleGaps(lookbackHours = DEFAULT_LOOKBACK_HOURS) {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       HISTORICAL CANDLE GAP BACKFILL SCRIPT             ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📊 Scanning for gaps in the last ${lookbackHours} hours...`);
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log('');

  try {
    // Call the database function to fill all gaps
    console.log('🔍 Calling auto_fill_all_gaps database function...');

    const { data, error } = await supabase.rpc('auto_fill_all_gaps', {
      p_lookback_hours: lookbackHours
    });

    if (error) {
      console.error('❌ Error calling gap fill function:', error);
      process.exit(1);
    }

    console.log('');
    console.log('✅ Gap filling completed!');
    console.log('');

    if (!data || data.length === 0) {
      console.log('✨ No gaps found! Your candle data is complete.');
      console.log('');
      return;
    }

    // Calculate totals
    const totalGaps = data.reduce((sum, r) => sum + r.gaps_filled, 0);
    const totalCandles = data.reduce((sum, r) => sum + r.candles_created, 0);

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    BACKFILL SUMMARY                       ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📊 Total Gaps Filled:     ${totalGaps}`);
    console.log(`🕯️  Total Candles Created: ${totalCandles}`);
    console.log('');

    // Group by symbol for detailed report
    const bySymbol = {};
    data.forEach(row => {
      if (!bySymbol[row.symbol]) {
        bySymbol[row.symbol] = {
          gaps: 0,
          candles: 0,
          timeframes: []
        };
      }
      bySymbol[row.symbol].gaps += row.gaps_filled;
      bySymbol[row.symbol].candles += row.candles_created;
      bySymbol[row.symbol].timeframes.push({
        tf: row.timeframe,
        gaps: row.gaps_filled,
        candles: row.candles_created
      });
    });

    console.log('📈 Detailed Breakdown by Symbol:');
    console.log('');

    Object.entries(bySymbol).forEach(([symbol, info]) => {
      console.log(`  ${symbol}:`);
      console.log(`    Total: ${info.gaps} gaps, ${info.candles} candles`);
      info.timeframes.forEach(tf => {
        if (tf.gaps > 0) {
          console.log(`      ${tf.tf.toUpperCase()}: ${tf.gaps} gaps → ${tf.candles} candles`);
        }
      });
      console.log('');
    });

    // Query gap fill log for more details
    const { data: logData, error: logError } = await supabase
      .from('candle_gap_fill_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!logError && logData && logData.length > 0) {
      console.log('📝 Recent Gap Fill Operations (last 20):');
      console.log('');

      logData.forEach(log => {
        const gapDuration = new Date(log.gap_end_time) - new Date(log.gap_start_time);
        const durationMinutes = Math.round(gapDuration / 60000);
        console.log(`  • ${log.symbol} ${log.timeframe.toUpperCase()}`);
        console.log(`    Gap: ${new Date(log.gap_start_time).toLocaleString()} → ${new Date(log.gap_end_time).toLocaleString()}`);
        console.log(`    Duration: ${durationMinutes} minutes | Filled: ${log.candles_filled} candles`);
        console.log(`    Price: ${log.fill_price} | Method: ${log.fill_method}`);
        console.log('');
      });
    }

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    COMPLETION STATUS                      ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('✅ All gaps have been filled with flat candles');
    console.log('📊 Your chart data is now continuous and complete');
    console.log('🎯 Charts will display smooth candle sequences without gaps');
    console.log('');
    console.log(`⏰ Completed at: ${new Date().toLocaleString()}`);
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Unexpected error during gap backfill:');
    console.error(error);
    console.error('');
    process.exit(1);
  }
}

// Get lookback hours from command line argument
const lookbackHours = process.argv[2] ? parseInt(process.argv[2], 10) : DEFAULT_LOOKBACK_HOURS;

if (isNaN(lookbackHours) || lookbackHours <= 0) {
  console.error('❌ Invalid lookback hours. Must be a positive number.');
  console.error('   Usage: node scripts/backfill-candle-gaps.js [lookback_hours]');
  process.exit(1);
}

// Run the backfill
backfillCandleGaps(lookbackHours).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
