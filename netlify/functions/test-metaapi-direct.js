/**
 * BARE-BONES METAAPI CONNECTION TEST
 *
 * This function bypasses ALL Pipnosis code and tests MetaAPI directly.
 * Process of elimination: If this works = Pipnosis code issue. If this fails = MetaAPI issue.
 */

const https = require('https');

exports.handler = async (event, context) => {
  console.log('[TEST] DIRECT METAAPI TEST - NO PIPNOSIS CODE');
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

  // Initialize variables outside try block for proper scoping
  let token = null;
  let tokenSource = 'not_checked';
  let requestBody = null;
  let accountId = null;
  let region = 'london';

  try {
    // Priority 1: Check for manual token from POST body
    tokenSource = 'unknown';

    if (event.httpMethod === 'POST' && event.body) {
      try {
        requestBody = JSON.parse(event.body);
        if (requestBody.token) {
          token = requestBody.token;
          tokenSource = 'manual_input';
          console.log('[KEY] Token source: Manual input from request body');
        }
      } catch (e) {
        console.log('[WARN] Failed to parse request body:', e.message);
      }
    }

    // Priority 2: Check for METAAPI_ADMIN_TOKEN (current standard)
    if (!token && process.env.METAAPI_ADMIN_TOKEN) {
      token = process.env.METAAPI_ADMIN_TOKEN;
      tokenSource = 'METAAPI_ADMIN_TOKEN';
      console.log('[KEY] Token source: METAAPI_ADMIN_TOKEN environment variable');
    }

    // Priority 3: Check for METAAPI_TOKEN (legacy fallback)
    if (!token && process.env.METAAPI_TOKEN) {
      token = process.env.METAAPI_TOKEN;
      tokenSource = 'METAAPI_TOKEN';
      console.log('[KEY] Token source: METAAPI_TOKEN environment variable (legacy)');
    }

    // Get account ID and region with proper fallback pattern
    // Priority: Manual input > Backend vars > Frontend vars (fallback)
    accountId = (requestBody && requestBody.accountId) ||
                process.env.METAAPI_ACCOUNT_ID ||
                process.env.VITE_METAAPI_ACCOUNT_ID;

    region = (requestBody && requestBody.region) ||
             process.env.METAAPI_REGION ||
             process.env.VITE_METAAPI_REGION ||
             'london';

    // Determine source for diagnostic reporting
    let accountIdSource = 'unknown';
    if (requestBody && requestBody.accountId) {
      accountIdSource = 'manual_input';
    } else if (process.env.METAAPI_ACCOUNT_ID) {
      accountIdSource = 'METAAPI_ACCOUNT_ID (backend)';
    } else if (process.env.VITE_METAAPI_ACCOUNT_ID) {
      accountIdSource = 'VITE_METAAPI_ACCOUNT_ID (fallback - not recommended for production)';
    }

    let regionSource = 'unknown';
    if (requestBody && requestBody.region) {
      regionSource = 'manual_input';
    } else if (process.env.METAAPI_REGION) {
      regionSource = 'METAAPI_REGION (backend)';
    } else if (process.env.VITE_METAAPI_REGION) {
      regionSource = 'VITE_METAAPI_REGION (fallback)';
    } else {
      regionSource = 'default (london)';
    }

    console.log('[INFO] Environment Check:');
    console.log(`  Token Source: ${tokenSource}`);
    console.log(`  Token: ${token ? '[OK] Present (length: ' + token.length + ', preview: ' + token.substring(0, 4) + '...' + token.substring(token.length - 4) + ')' : '[X] Missing'}`);
    console.log(`  Account ID: ${accountId || '[X] Missing'}`);
    console.log(`  Account ID Source: ${accountIdSource}`);
    console.log(`  Region: ${region}`);
    console.log(`  Region Source: ${regionSource}`);
    console.log('');

    if (!token) {
      console.log('[FAIL] Token Check Failed');
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
          result: '[FAIL] RED LIGHT - Token missing',
          tokenSources: {
            manual_input: 'Not provided',
            METAAPI_ADMIN_TOKEN: process.env.METAAPI_ADMIN_TOKEN ? 'Present' : 'Missing',
            METAAPI_TOKEN: process.env.METAAPI_TOKEN ? 'Present' : 'Missing'
          },
          recommendation: 'Add METAAPI_ADMIN_TOKEN to Netlify environment variables'
        })
      };
    }

    if (!accountId) {
      console.log('[FAIL] Account ID Check Failed');
      console.log('  Checked sources:');
      console.log('    1. POST request body (manual input)');
      console.log('    2. METAAPI_ACCOUNT_ID (backend variable)');
      console.log('    3. VITE_METAAPI_ACCOUNT_ID (frontend variable - fallback)');
      console.log('  All sources returned: NOT FOUND');

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          test: 'DIRECT_METAAPI_CONNECTION',
          error: 'Account ID not found in any environment variable',
          result: '[FAIL] RED LIGHT - Account ID missing',
          accountIdSources: {
            manual_input: 'Not provided',
            METAAPI_ACCOUNT_ID: process.env.METAAPI_ACCOUNT_ID ? 'Present' : 'Missing',
            VITE_METAAPI_ACCOUNT_ID: process.env.VITE_METAAPI_ACCOUNT_ID ? 'Present' : 'Missing'
          },
          recommendation: 'Add METAAPI_ACCOUNT_ID to Netlify environment variables (not just VITE_METAAPI_ACCOUNT_ID)',
          explanation: 'VITE_ prefixed variables are only available during build time. Netlify functions need non-prefixed variables at runtime.'
        })
      };
    }

    // Test 1: Get Account Info
    console.log('[TEST] TEST 1: Get Account Info');
    console.log(`URL: https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}`);

    const accountInfo = await makeRequest(
      `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}`,
      token
    );

    console.log('[OK] TEST 1 PASSED - Account found!');
    console.log('Account Info:', JSON.stringify(accountInfo, null, 2));

    // Test 2: Get Account Symbols
    console.log('');
    console.log('[TEST] TEST 2: Get Symbols');

    const symbols = await makeRequest(
      `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols`,
      token
    );

    console.log('[OK] TEST 2 PASSED - Symbols retrieved!');
    console.log(`Found ${symbols.length} symbols`);

    // Test 3: Get Current Price for EURUSD
    console.log('');
    console.log('[TEST] TEST 3: Get EURUSD Price');

    const price = await makeRequest(
      `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/EURUSD/current-price`,
      token
    );

    console.log('[OK] TEST 3 PASSED - Price retrieved!');
    console.log('EURUSD Price:', JSON.stringify(price, null, 2));

    console.log('');
    console.log('='.repeat(80));
    console.log('[SUCCESS] GREEN LIGHT - ALL TESTS PASSED!');
    console.log('='.repeat(80));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        test: 'DIRECT_METAAPI_CONNECTION',
        result: '[SUCCESS] GREEN LIGHT - MetaAPI is working!',
        details: {
          accountInfo: accountInfo,
          symbolCount: symbols.length,
          currentPrice: price,
          region: region,
          accountId: accountId,
          tokenSource: tokenSource,
          tokenLength: token.length
        },
        configuration: {
          accountIdSource: accountIdSource,
          regionSource: regionSource,
          usingFallback: accountIdSource.includes('fallback') || regionSource.includes('fallback'),
          recommendation: accountIdSource.includes('fallback') ?
            'Add METAAPI_ACCOUNT_ID and METAAPI_REGION to Netlify environment variables for production reliability' :
            'Configuration looks good'
        }
      })
    };

  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('[FAIL] RED LIGHT - TEST FAILED!');
    console.error('='.repeat(80));
    console.error('Error:', error.message || String(error));
    console.error('Error Stack:', error.stack);

    if (error.statusCode) {
      console.error('Status Code:', error.statusCode);
    }
    if (error.response) {
      console.error('Response:', error.response);
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        test: 'DIRECT_METAAPI_CONNECTION',
        result: '[FAIL] RED LIGHT - MetaAPI connection failed!',
        error: {
          message: error.message || String(error),
          stack: error.stack,
          statusCode: error.statusCode || null,
          response: error.response || null,
          type: error.constructor.name
        },
        diagnostics: {
          tokenSource: tokenSource || 'not_initialized',
          tokenPresent: !!token,
          tokenLength: token ? token.length : 0,
          region: region || 'not_set',
          accountId: accountId || 'not_set',
          environmentVariables: {
            METAAPI_ADMIN_TOKEN: !!process.env.METAAPI_ADMIN_TOKEN,
            METAAPI_TOKEN: !!process.env.METAAPI_TOKEN,
            METAAPI_ACCOUNT_ID: !!process.env.METAAPI_ACCOUNT_ID,
            METAAPI_REGION: !!process.env.METAAPI_REGION,
            VITE_METAAPI_ACCOUNT_ID: !!process.env.VITE_METAAPI_ACCOUNT_ID,
            VITE_METAAPI_REGION: !!process.env.VITE_METAAPI_REGION
          }
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
