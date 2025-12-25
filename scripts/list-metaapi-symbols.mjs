#!/usr/bin/env node

/**
 * List Available MetaAPI Symbols
 * Shows what symbols are available in your MetaAPI account
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '../.env') });

const metaApiToken = process.env.METAAPI_TOKEN;
const metaApiAccountId = process.env.METAAPI_ACCOUNT_ID;
const metaApiRegion = process.env.METAAPI_REGION || 'new-york';

if (!metaApiToken || !metaApiAccountId) {
  console.error('❌ Missing MetaAPI credentials');
  process.exit(1);
}

async function listSymbols() {
  try {
    const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${metaApiAccountId}/symbols`;

    console.log('Fetching available symbols from MetaAPI...');
    console.log('');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': metaApiToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      console.error(text);
      process.exit(1);
    }

    const data = await response.json();

    // Handle different response formats
    const symbols = Array.isArray(data) ? data : (data.symbols || []);

    console.log(`✅ Found ${symbols.length} available symbols`);
    console.log('');

    // If symbols are strings
    const symbolStrings = symbols.map(s => typeof s === 'string' ? s : (s.symbol || s.name || String(s)));

    // Filter for symbols we're interested in
    const cryptoSymbols = symbolStrings.filter(s =>
      s.includes('BTC') ||
      s.includes('ETH') ||
      s.includes('SOL') ||
      s.includes('BNB')
    );

    const indexSymbols = symbolStrings.filter(s =>
      s.includes('NAS') ||
      s.includes('SPX') ||
      s.includes('US100') ||
      s.includes('US500') ||
      s.includes('US30')
    );

    console.log('🪙 Crypto-related Symbols:');
    if (cryptoSymbols.length > 0) {
      cryptoSymbols.forEach(s => console.log(`  - ${s}`));
    } else {
      console.log('  - None found');
    }
    console.log('');

    console.log('📈 Index Symbols:');
    if (indexSymbols.length > 0) {
      indexSymbols.forEach(s => console.log(`  - ${s}`));
    } else {
      console.log('  - None found');
    }
    console.log('');

    // Show all symbols (first 100)
    console.log('📋 All Available Symbols:');
    symbolStrings.slice(0, 100).forEach(s => console.log(`  - ${s}`));
    if (symbolStrings.length > 100) {
      console.log(`  ... and ${symbolStrings.length - 100} more`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listSymbols();
