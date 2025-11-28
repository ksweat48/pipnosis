/**
 * Force Fresh Data Collection Script
 *
 * This script triggers fresh data collection after the nuclear database reset.
 * It ensures clean data is collected for each symbol independently.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const SYMBOLS = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

async function verifyDatabaseIsEmpty() {
  console.log('🔍 Verifying database is empty...\n');

  const { count: candleCount } = await supabase
    .from('forex_candles')
    .select('*', { count: 'exact', head: true });

  const { count: priceCount } = await supabase
    .from('realtime_prices')
    .select('*', { count: 'exact', head: true });

  console.log(`Candles in database: ${candleCount || 0}`);
  console.log(`Prices in database: ${priceCount || 0}\n`);

  if ((candleCount || 0) > 0 || (priceCount || 0) > 0) {
    console.warn('⚠️  Warning: Database is not empty. Consider running the reset migration first.');
  } else {
    console.log('✅ Database is empty and ready for fresh data\n');
  }
}

async function triggerCandleFetch(symbol, timeframe) {
  console.log(`📊 Fetching fresh data for ${symbol} ${timeframe}...`);

  try {
    // Call the Netlify function to fetch candles
    const response = await fetch(`${supabaseUrl.replace('https://', 'https://app-')}/.netlify/functions/refresh-candles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol,
        timeframe,
        limit: 200 // Fetch 200 candles for initial load
      })
    });

    if (!response.ok) {
      console.error(`  ❌ Failed to fetch ${symbol} ${timeframe}: HTTP ${response.status}`);
      return false;
    }

    const data = await response.json();
    console.log(`  ✅ Fetched ${data.candlesInserted || 0} candles for ${symbol} ${timeframe}`);
    return true;
  } catch (error) {
    console.error(`  ❌ Error fetching ${symbol} ${timeframe}:`, error.message);
    return false;
  }
}

async function validateDataQuality() {
  console.log('\n🔍 Validating data quality...\n');

  for (const symbol of SYMBOLS) {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('timeframe, count')
      .eq('symbol', symbol);

    if (error) {
      console.error(`❌ Error checking ${symbol}:`, error);
      continue;
    }

    console.log(`${symbol}:`);
    for (const timeframe of TIMEFRAMES) {
      const count = data?.find(d => d.timeframe === timeframe)?.count || 0;
      console.log(`  ${timeframe}: ${count} candles`);
    }
    console.log('');
  }
}

async function checkForCrossContamination() {
  console.log('🔍 Checking for cross-symbol contamination...\n');

  const { data: rejections } = await supabase
    .from('price_validation_rejections')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!rejections || rejections.length === 0) {
    console.log('✅ No validation rejections found - data is clean!\n');
    return;
  }

  console.log(`⚠️  Found ${rejections.length} validation rejections:\n`);

  const bySymbol = rejections.reduce((acc, r) => {
    acc[r.symbol] = (acc[r.symbol] || 0) + 1;
    return acc;
  }, {});

  for (const [symbol, count] of Object.entries(bySymbol)) {
    console.log(`  ${symbol}: ${count} rejections`);
  }

  const crossContamination = rejections.filter(r => r.suspected_symbol);
  if (crossContamination.length > 0) {
    console.log(`\n🚨 CROSS-CONTAMINATION DETECTED:`);
    crossContamination.forEach(r => {
      console.log(`  ${r.symbol} received ${r.suspected_symbol} price: ${r.price}`);
    });
  }

  console.log('');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🚀 FORCE FRESH DATA COLLECTION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Verify database is empty
  await verifyDatabaseIsEmpty();

  // Step 2: Trigger fresh data collection for each symbol
  console.log('📥 Starting fresh data collection...\n');

  let successCount = 0;
  let failCount = 0;

  for (const symbol of SYMBOLS) {
    console.log(`\n${symbol}:`);
    for (const timeframe of TIMEFRAMES) {
      const success = await triggerCandleFetch(symbol, timeframe);
      if (success) {
        successCount++;
        // Wait 1 second between requests to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        failCount++;
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Results: ${successCount} successful, ${failCount} failed`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 3: Validate data quality
  await validateDataQuality();

  // Step 4: Check for cross-contamination
  await checkForCrossContamination();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ✅ FRESH DATA COLLECTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
