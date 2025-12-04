import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

async function validateCandleQuality() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        FINNHUB IMPORT DATA QUALITY VALIDATION                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();

  const issues = [];
  const summary = {
    totalCandles: 0,
    invalidCandles: 0,
    gapCount: 0,
    symbolStats: {}
  };

  for (const symbol of SYMBOLS) {
    summary.symbolStats[symbol] = {
      totalCandles: 0,
      timeframeStats: {}
    };

    for (const timeframe of TIMEFRAMES) {
      console.log(`\n🔍 Validating ${symbol} ${timeframe}...`);

      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('data_source', 'finnhub_import')
        .order('open_time', { ascending: true });

      if (error) {
        console.error(`   ❌ Database error: ${error.message}`);
        issues.push({ symbol, timeframe, issue: 'Database error', details: error.message });
        continue;
      }

      if (!candles || candles.length === 0) {
        console.log(`   ⚠️  No Finnhub data found`);
        issues.push({ symbol, timeframe, issue: 'No data', details: 'No Finnhub candles found' });
        continue;
      }

      summary.totalCandles += candles.length;
      summary.symbolStats[symbol].totalCandles += candles.length;
      summary.symbolStats[symbol].timeframeStats[timeframe] = candles.length;

      console.log(`   📊 Found ${candles.length} candles`);

      let invalidCount = 0;
      let gapCount = 0;

      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];

        if (candle.high < candle.low) {
          invalidCount++;
          summary.invalidCandles++;
          issues.push({
            symbol,
            timeframe,
            issue: 'Invalid OHLC',
            details: `High ${candle.high} < Low ${candle.low} at ${candle.open_time}`
          });
        }

        if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
          invalidCount++;
          summary.invalidCandles++;
          issues.push({
            symbol,
            timeframe,
            issue: 'Invalid price',
            details: `Zero or negative price at ${candle.open_time}`
          });
        }

        if (candle.open > candle.high || candle.close > candle.high) {
          invalidCount++;
          summary.invalidCandles++;
          issues.push({
            symbol,
            timeframe,
            issue: 'Price above high',
            details: `Open/Close above High at ${candle.open_time}`
          });
        }

        if (candle.open < candle.low || candle.close < candle.low) {
          invalidCount++;
          summary.invalidCandles++;
          issues.push({
            symbol,
            timeframe,
            issue: 'Price below low',
            details: `Open/Close below Low at ${candle.open_time}`
          });
        }

        if (i > 0) {
          const prevCandle = candles[i - 1];
          const prevTime = new Date(prevCandle.open_time).getTime();
          const currentTime = new Date(candle.open_time).getTime();

          const expectedInterval = getTimeframeInterval(timeframe);
          const actualInterval = (currentTime - prevTime) / 1000;

          if (actualInterval > expectedInterval * 1.5) {
            gapCount++;
            summary.gapCount++;
            const gapHours = (actualInterval / 3600).toFixed(2);
            issues.push({
              symbol,
              timeframe,
              issue: 'Time gap',
              details: `${gapHours}h gap between ${prevCandle.open_time} and ${candle.open_time}`
            });
          }
        }
      }

      if (invalidCount === 0 && gapCount === 0) {
        console.log(`   ✅ All candles valid, no gaps detected`);
      } else {
        if (invalidCount > 0) {
          console.log(`   ⚠️  ${invalidCount} invalid candles found`);
        }
        if (gapCount > 0) {
          console.log(`   ⚠️  ${gapCount} time gaps detected`);
        }
      }

      const oldestCandle = candles[0];
      const newestCandle = candles[candles.length - 1];
      const coverage = Math.ceil(
        (new Date(newestCandle.open_time) - new Date(oldestCandle.open_time)) / (1000 * 60 * 60 * 24)
      );

      console.log(`   📅 Coverage: ${coverage} days (${new Date(oldestCandle.open_time).toLocaleDateString()} to ${new Date(newestCandle.open_time).toLocaleDateString()})`);
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    VALIDATION SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`📊 Total Candles Imported: ${summary.totalCandles.toLocaleString()}`);
  console.log(`✅ Valid Candles: ${(summary.totalCandles - summary.invalidCandles).toLocaleString()}`);
  console.log(`❌ Invalid Candles: ${summary.invalidCandles}`);
  console.log(`⚠️  Time Gaps Detected: ${summary.gapCount}`);
  console.log();

  console.log('📊 Candles by Symbol:');
  for (const symbol of SYMBOLS) {
    const stats = summary.symbolStats[symbol];
    console.log(`\n   ${symbol}: ${stats.totalCandles.toLocaleString()} candles`);
    for (const timeframe of TIMEFRAMES) {
      const count = stats.timeframeStats[timeframe] || 0;
      if (count > 0) {
        console.log(`      ${timeframe}: ${count.toLocaleString()}`);
      }
    }
  }

  if (issues.length > 0) {
    console.log('\n⚠️  Issues Found:');
    console.log();

    const issueTypes = {};
    issues.forEach(issue => {
      const key = `${issue.symbol}-${issue.timeframe}-${issue.issue}`;
      if (!issueTypes[key]) {
        issueTypes[key] = { ...issue, count: 0 };
      }
      issueTypes[key].count++;
    });

    Object.values(issueTypes).forEach(issue => {
      console.log(`   ${issue.symbol} ${issue.timeframe}: ${issue.issue} (${issue.count}x)`);
      if (issue.count <= 3) {
        console.log(`      ${issue.details}`);
      }
    });

    console.log();
    console.log('⚠️  Consider re-importing affected symbol/timeframe combinations');
  } else {
    console.log('\n✅ All data passed validation checks!');
    console.log('🎉 Your historical data is ready for AI training');
  }

  console.log();
}

function getTimeframeInterval(timeframe) {
  const intervals = {
    'M1': 60,
    'M5': 300,
    'M15': 900,
    'M30': 1800,
    'H1': 3600,
    'H4': 14400,
    'D1': 86400
  };
  return intervals[timeframe] || 3600;
}

async function checkDataCoverage(daysBack = 30) {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                   DATA COVERAGE REPORT                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysBack);

  for (const symbol of SYMBOLS) {
    console.log(`\n${symbol}:`);

    for (const timeframe of TIMEFRAMES) {
      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('data_source', 'finnhub_import')
        .gte('open_time', targetDate.toISOString())
        .order('open_time', { ascending: true });

      if (error || !candles || candles.length === 0) {
        console.log(`   ${timeframe}: ❌ No data`);
        continue;
      }

      const expectedCandles = getExpectedCandleCount(timeframe, daysBack);
      const coverage = (candles.length / expectedCandles) * 100;
      const status = coverage > 90 ? '✅' : coverage > 75 ? '⚠️ ' : '❌';

      console.log(`   ${timeframe}: ${status} ${candles.length}/${expectedCandles} candles (${coverage.toFixed(1)}% coverage)`);
    }
  }

  console.log();
}

function getExpectedCandleCount(timeframe, days) {
  const intervals = {
    'M1': 60,
    'M5': 300,
    'M15': 900,
    'M30': 1800,
    'H1': 3600,
    'H4': 14400,
    'D1': 86400
  };

  const secondsInDay = 86400;
  const tradingHoursPerDay = 24;
  const interval = intervals[timeframe];

  return Math.floor((days * tradingHoursPerDay * 3600) / interval);
}

async function main() {
  await validateCandleQuality();
  await checkDataCoverage(30);
}

main().catch(error => {
  console.error('\n❌ Validation error:', error);
  process.exit(1);
});
