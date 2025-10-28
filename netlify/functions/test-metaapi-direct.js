/**
 * BARE-BONES METAAPI CONNECTION TEST
 *
 * This function bypasses ALL Pipnosis code and tests MetaAPI directly.
 * Process of elimination: If this works = Pipnosis code issue. If this fails = MetaAPI issue.
 */

const https = require('https');

exports.handler = async (event, context) => {
  console.log('🧪 DIRECT METAAPI TEST - NO PIPNOSIS CODE');
  console.log('='.repeat(80));

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Priority 1: Check for manual token from POST body
    let token = null;
    let tokenSource = 'unknown';
    let requestBody = null;

    if (event.httpMethod === 'POST' && event.body) {
      try {
        requestBody = JSON.parse(event.body);
        if (requestBody.token) {
          token = requestBody.token;
          tokenSource = 'manual_input';
          console.log('🔑 Token source: Manual input from request body');
        }
      } catch (e) {
        console.log('⚠️ Failed to parse request body:', e.message);
      }
    }

    // Priority 2: Check for METAAPI_ADMIN_TOKEN (current standard)
    if (!token && process.env.METAAPI_ADMIN_TOKEN) {
      token = process.env.METAAPI_ADMIN_TOKEN;
      tokenSource = 'METAAPI_ADMIN_TOKEN';
      console.log('🔑 Token source: METAAPI_ADMIN_TOKEN environment variable');
    }

    // Priority 3: Check for METAAPI_TOKEN (legacy fallback)
    if (!token && process.env.METAAPI_TOKEN) {
      token = process.env.METAAPI_TOKEN;
      tokenSource = 'METAAPI_TOKEN';
      console.log('🔑 Token source: METAAPI_TOKEN environment variable (legacy)');
    }

    // Get account ID and region
    const accountId = (requestBody && requestBody.accountId) || process.env.VITE_METAAPI_ACCOUNT_ID;
    const region = (requestBody && requestBody.region) || process.env.VITE_METAAPI_REGION || 'london';

    console.log('📋 Environment Check:');
    console.log(`  Token Source: ${tokenSource}`);
    console.log(`  Token: ${token ? '✓ Present (length: ' + token.length + ', preview: ' + token.substring(0, 4) + '...' + token.substring(token.length - 4) + ')' : '✗ Missing'}`);
    console.log(`  Account ID: ${accountId || '✗ Missing'}`);
    console.log(`  Region: ${region}`);
    console.log('');

    if (!token) {
      console.log('❌ Token Check Failed');
      console.log('  Checked sources:');
      console.log('    1. POST request body (manual input)');
      console.log('    2. METAAPI_ADMIN_TOKEN environment variable');
      console.log('    3. METAAPI_TOKEN environment variable');
      console.log('  All sources returned: NOT FOUND');

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          test: 'DIRECT_METAAPI_CONNECTION',
          error: 'No MetaAPI token found in any source (manual input, METAAPI_ADMIN_TOKEN, or METAAPI_TOKEN)',
          result: '🔴 RED LIGHT - Token missing',
          tokenSources: {
            manual_input: 'Not provided',
            METAAPI_ADMIN_TOKEN: process.env.METAAPI_ADMIN_TOKEN ? 'Present' : 'Missing',
            METAAPI_TOKEN: process.env.METAAPI_TOKEN ? 'Present' : 'Missing'
          }
        })
      };
    }

    if (!accountId) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          test: 'DIRECT_METAAPI_CONNECTION',
          error: 'VITE_METAAPI_ACCOUNT_ID not found in environment variables',
          result: '🔴 RED LIGHT - Account ID missing'
        })
      };
    }

    // Test 1: Get Account Info
    console.log('🧪 TEST 1: Get Account Info');
    console.log(`URL: https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}`);

    const accountInfo = await makeRequest(
      `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}`,
      token
    );

    console.log('✅ TEST 1 PASSED - Account found!');
    console.log('Account Info:', JSON.stringify(accountInfo, null, 2));

    // Test 2: Get Account Symbols
    console.log('');
    console.log('🧪 TEST 2: Get Symbols');

    const symbols = await makeRequest(
      `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols`,
      token
    );

    console.log('✅ TEST 2 PASSED - Symbols retrieved!');
    console.log(`Found ${symbols.length} symbols`);

    // Test 3: Get Current Price for EURUSD
    console.log('');
    console.log('🧪 TEST 3: Get EURUSD Price');

    const price = await makeRequest(
      `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/EURUSD/current-price`,
      token
    );

    console.log('✅ TEST 3 PASSED - Price retrieved!');
    console.log('EURUSD Price:', JSON.stringify(price, null, 2));

    console.log('');
    console.log('='.repeat(80));
    console.log('🟢 GREEN LIGHT - ALL TESTS PASSED!');
    console.log('='.repeat(80));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        test: 'DIRECT_METAAPI_CONNECTION',
        result: '🟢 GREEN LIGHT - MetaAPI is working!',
        details: {
          accountInfo: accountInfo,
          symbolCount: symbols.length,
          currentPrice: price,
          region: region,
          accountId: accountId,
          tokenSource: tokenSource,
          tokenLength: token.length
        }
      })
    };

  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('🔴 RED LIGHT - TEST FAILED!');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    console.error('Status Code:', error.statusCode);
    console.error('Response:', error.response);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        test: 'DIRECT_METAAPI_CONNECTION',
        result: '🔴 RED LIGHT - MetaAPI connection failed!',
        error: {
          message: error.message,
          statusCode: error.statusCode,
          response: error.response
        },
        diagnostics: {
          tokenSource: tokenSource,
          tokenLength: token ? token.length : 0,
          region: region,
          accountId: accountId
        }
      })
    };
  }
};

// Simple HTTPS request helper
function makeRequest(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          const error = new Error(`HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          try {
            error.response = JSON.parse(data);
          } catch (e) {
            error.response = data;
          }
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}
