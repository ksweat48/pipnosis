#!/usr/bin/env node

/**
 * Manual trigger for candle aggregator to backfill missing candles
 *
 * This script manually calls the Netlify candle aggregator function
 * to immediately backfill all missing candles from the last 24 hours.
 */

const FUNCTION_URL = 'https://pipnosis.com/.netlify/functions/continuous-candle-aggregator';

async function triggerBackfill() {
  console.log('🚀 Triggering candle aggregator to backfill missing candles...');
  console.log(`📡 Calling: ${FUNCTION_URL}`);

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Backfill triggered successfully!');
      console.log('📊 Results:', JSON.stringify(data, null, 2));

      if (data.candlesCreated > 0) {
        console.log(`\n🎉 Created ${data.candlesCreated} candles across all symbols and timeframes!`);
      } else {
        console.log('\n⚠️  No new candles were created. This might mean:');
        console.log('   - All candles are already up to date');
        console.log('   - No price data available in the time range');
        console.log('   - The aggregator is still catching up');
      }
    } else {
      console.error('❌ Backfill failed:', response.status, response.statusText);
      console.error('Response:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ Error triggering backfill:', error.message);
  }
}

triggerBackfill();
