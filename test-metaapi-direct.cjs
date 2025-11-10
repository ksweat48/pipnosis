#!/usr/bin/env node
/**
 * Direct MetaAPI Connection Test
 * Tests if we can connect to MetaAPI with current credentials
 */

require('dotenv').config();

const token = process.env.METAAPI_TOKEN;
const accountId = process.env.METAAPI_ACCOUNT_ID;
const region = process.env.METAAPI_REGION || 'london';

console.log('\n========== MetaAPI Connection Test ==========');
console.log('Token present:', !!token);
console.log('Token length:', token ? token.length : 0);
console.log('Account ID:', accountId);
console.log('Region:', region);
console.log('===========================================\n');

async function testMetaAPI() {
  if (!token || !accountId) {
    console.error('❌ MetaAPI credentials not found in environment');
    process.exit(1);
  }

  const symbol = 'EURUSD';
  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/current-price`;

  console.log(`Testing URL: ${url}\n`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    const body = await response.text();
    console.log('\nResponse body:', body);

    if (response.ok) {
      const data = JSON.parse(body);
      console.log('\n✅ SUCCESS! MetaAPI is working');
      console.log(`Price: ${data.bid}/${data.ask}`);
      console.log(`Time: ${data.time || 'N/A'}`);
    } else {
      console.log('\n❌ FAILED! MetaAPI returned an error');
      if (response.status === 401) {
        console.log('   Reason: Invalid or expired token');
      } else if (response.status === 403) {
        console.log('   Reason: Access forbidden - check account permissions');
      } else if (response.status === 404) {
        console.log('   Reason: Symbol not found or account not connected');
      } else if (response.status === 429) {
        console.log('   Reason: Rate limit exceeded');
      } else if (response.status >= 500) {
        console.log('   Reason: MetaAPI server error');
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('\n❌ Request timed out after 10 seconds');
    } else {
      console.error('\n❌ Connection error:', error.message);
    }
  }
}

testMetaAPI().catch(console.error);
