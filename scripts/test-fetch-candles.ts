/**
 * Test script for fetching historical candles
 * 
 * Usage:
 *   tsx scripts/test-fetch-candles.ts <SYMBOL> <TIMEFRAME> <DAYS_BACK>
 * 
 * Examples:
 *   tsx scripts/test-fetch-candles.ts EURUSD 5m 90
 *   tsx scripts/test-fetch-candles.ts GBPUSD 15m 30
 *   tsx scripts/test-fetch-candles.ts XAUUSD 1h 60
 */

import { fetchHistoricalCandles, getHistoricalCandleStats, type FetchProgress } from '../src/services/fetchHistoricalCandles';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function formatProgress(progress: FetchProgress): string {
  const bar = '='.repeat(Math.floor(progress.percentComplete / 2));
  const spaces = ' '.repeat(50 - bar.length);
  
  return '[' + bar + spaces + '] ' + progress.percentComplete + '% - ' + progress.message;
}

function printProgress(progress: FetchProgress): void {
  const statusColor = {
    fetching: colors.blue,
    saving: colors.yellow,
    completed: colors.green,
    error: colors.red
  }[progress.status];

  process.stdout.write('\r' + colors.bright + statusColor + formatProgress(progress) + colors.reset);
  
  if (progress.status === 'completed' || progress.status === 'error') {
    console.log(); // New line after completion
  }
}

async function main() {
  console.log(colors.bright + colors.cyan + 'Historical Candles Fetch Test Script' + colors.reset + '\n');

  // Parse command-line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error(colors.red + 'Error: Missing required arguments' + colors.reset + '\n');
    console.log('Usage: tsx scripts/test-fetch-candles.ts <SYMBOL> <TIMEFRAME> [DAYS_BACK]\n');
    console.log('Examples:');
    console.log('  tsx scripts/test-fetch-candles.ts EURUSD 5m 90');
    console.log('  tsx scripts/test-fetch-candles.ts GBPUSD 15m 30');
    console.log('  tsx scripts/test-fetch-candles.ts XAUUSD 1h 60\n');
    console.log('Supported timeframes: 5m, 15m, 1h');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const timeframe = args[1] as '5m' | '15m' | '1h';
  const daysBack = args[2] ? parseInt(args[2]) : 90;

  // Validate timeframe
  if (!['5m', '15m', '1h'].includes(timeframe)) {
    console.error(colors.red + 'Error: Invalid timeframe "' + timeframe + '"' + colors.reset);
    console.error('Supported timeframes: 5m, 15m, 1h\n');
    process.exit(1);
  }

  // Validate daysBack
  if (isNaN(daysBack) || daysBack < 1 || daysBack > 365) {
    console.error(colors.red + 'Error: Invalid daysBack. Must be between 1 and 365.' + colors.reset + '\n');
    process.exit(1);
  }

  console.log(colors.bright + 'Configuration:' + colors.reset);
  console.log('  Symbol:      ' + colors.green + symbol + colors.reset);
  console.log('  Timeframe:   ' + colors.green + timeframe + colors.reset);
  console.log('  Days Back:   ' + colors.green + daysBack + colors.reset + '\n');

  // Check for existing data
  console.log(colors.yellow + 'Checking for existing data...' + colors.reset);
  const existingStats = await getHistoricalCandleStats(symbol, timeframe);
  
  if (existingStats && existingStats.totalCandles > 0) {
    console.log(colors.cyan + 'Found existing data:' + colors.reset);
    console.log('  Total Candles: ' + existingStats.totalCandles);
    console.log('  Date Range:    ' + existingStats.oldestCandle?.toISOString() + ' to ' + existingStats.newestCandle?.toISOString());
    console.log('  Coverage:      ' + existingStats.dateRangeDays.toFixed(1) + ' days\n');
  } else {
    console.log(colors.yellow + 'No existing data found. Will fetch fresh data.' + colors.reset + '\n');
  }

  // Start the fetch operation
  console.log(colors.bright + colors.green + 'Starting fetch operation...' + colors.reset + '\n');
  
  const startTime = Date.now();
  
  try {
    const result = await fetchHistoricalCandles({
      symbol,
      timeframe,
      daysBack,
      overwrite: false,
      onProgress: printProgress
    });

    const durationSeconds = (Date.now() - startTime) / 1000;

    console.log('\n' + colors.bright + colors.cyan + 'Fetch Results' + colors.reset + '\n');

    if (result.success) {
      console.log(colors.green + 'Status:          SUCCESS' + colors.reset);
      console.log('  Candles Fetched: ' + result.candlesFetched);
      console.log('  Candles Saved:   ' + result.candlesSaved);
      console.log('  Date Range:      ' + result.dateRangeStart.toISOString() + ' to ' + result.dateRangeEnd.toISOString());
      console.log('  Duration:        ' + durationSeconds.toFixed(2) + 's');
      
      if (result.error) {
        console.log('  ' + colors.yellow + 'Note: ' + result.error + colors.reset);
      }
    } else {
      console.log(colors.red + 'Status:          FAILED' + colors.reset);
      console.log('  Error:           ' + result.error);
      console.log('  Candles Fetched: ' + result.candlesFetched);
      console.log('  Candles Saved:   ' + result.candlesSaved);
      console.log('  Duration:        ' + durationSeconds.toFixed(2) + 's');
    }

    // Show updated stats
    console.log('\n' + colors.bright + 'Fetching updated statistics...' + colors.reset);
    const updatedStats = await getHistoricalCandleStats(symbol, timeframe);
    
    if (updatedStats) {
      console.log(colors.cyan + 'Current database stats:' + colors.reset);
      console.log('  Total Candles: ' + updatedStats.totalCandles);
      console.log('  Oldest Candle: ' + updatedStats.oldestCandle?.toISOString());
      console.log('  Newest Candle: ' + updatedStats.newestCandle?.toISOString());
      console.log('  Coverage:      ' + updatedStats.dateRangeDays.toFixed(1) + ' days');
    }

    console.log('\n' + colors.bright + colors.green + 'Test completed successfully!' + colors.reset + '\n');
    process.exit(0);

  } catch (error) {
    const durationSeconds = (Date.now() - startTime) / 1000;
    
    console.log('\n' + colors.bright + colors.red + 'Test failed!' + colors.reset + '\n');
    console.error('Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
    console.error('Duration: ' + durationSeconds.toFixed(2) + 's\n');
    
    if (error instanceof Error && error.stack) {
      console.error(colors.yellow + 'Stack trace:' + colors.reset);
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error(colors.red + 'Unhandled error:' + colors.reset, error);
  process.exit(1);
});
