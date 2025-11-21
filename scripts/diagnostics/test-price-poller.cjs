#!/usr/bin/env node

require('dotenv').config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

async function testPricePoller() {
  console.log('\n🔍 Testing continuous-price-poller edge function...\n');

  const functionUrl = `${SUPABASE_URL}/functions/v1/continuous-price-poller?action=poll`;

  console.log(`Calling: ${functionUrl}`);
  console.log('');

  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    console.log('Response Status:', response.status);
    console.log('Response Data:', JSON.stringify(data, null, 2));

    if (data.success) {
      console.log('\n✅ Price polling function is working!');
      console.log(`   Updated ${data.successfulUpdates}/${data.totalPairs} pairs`);
      console.log(`   Duration: ${data.durationMs}ms`);
      console.log(`   Data Quality: ${data.dataQuality}`);
    } else {
      console.log('\n❌ Price polling function failed');
      console.log(`   Message: ${data.message}`);
      if (data.errors) {
        console.log('   Errors:');
        data.errors.forEach(err => console.log(`     - ${err}`));
      }
    }

  } catch (error) {
    console.error('\n❌ Failed to call edge function:');
    console.error(error.message);
    console.error('\nPossible issues:');
    console.error('  1. Edge function not deployed');
    console.error('  2. Network/firewall blocking request');
    console.error('  3. Supabase credentials incorrect');
  }

  console.log('\n');
}

testPricePoller();
