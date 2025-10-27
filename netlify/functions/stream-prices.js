/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Content-Type': 'text/event-stream',
  'X-Accel-Buffering': 'no'
};

let metaApiInstance = null;
let activeConnection = null;
let connectionPromise = null;
let lastPriceUpdate = {};
let isConnecting = false;

function resolveMetaApiCtor() {
  try {
    const m = require('metaapi.cloud-sdk');
    return m.default || m.MetaApi || m;
  } catch (e) {
    throw new Error('MetaApi SDK not installed: ' + e.message);
  }
}

async function updateConnectionHealth(supabase, status, errorMessage = null) {
  try {
    const { error } = await supabase.rpc('update_connection_health', {
      p_status: status,
      p_last_message_at: new Date().toISOString(),
      p_error_message: errorMessage,
      p_region: process.env.METAAPI_REGION || 'london',
      p_account_id: process.env.METAAPI_ACCOUNT_ID || ''
    });

    if (error) {
      console.error('[stream-prices] Failed to update connection health:', error);
    }
  } catch (err) {
    console.error('[stream-prices] Error updating connection health:', err);
  }
}

async function storePriceInSupabase(supabase, symbol, bid, ask, brokerTime, source = 'metaapi-ws') {
  try {
    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    const { error } = await supabase.from('realtime_prices').insert({
      symbol,
      bid,
      ask,
      mid,
      spread,
      broker_time: brokerTime,
      source
    });

    if (error) {
      console.error('[stream-prices] Failed to store price:', error);
    }
  } catch (err) {
    console.error('[stream-prices] Error storing price:', err);
  }
}

async function getOrCreateConnection() {
  if (activeConnection && activeConnection.healthMonitor?.healthStatus?.isHealthy) {
    console.log('[stream-prices] Reusing existing healthy connection');
    return activeConnection;
  }

  if (connectionPromise) {
    console.log('[stream-prices] Waiting for existing connection attempt');
    return await connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      isConnecting = true;
      const token = process.env.METAAPI_ADMIN_TOKEN;
      const accountId = process.env.METAAPI_ACCOUNT_ID;
      const region = process.env.METAAPI_REGION || 'london';

      if (!token || !accountId) {
        throw new Error('MetaAPI credentials not configured');
      }

      console.log('[stream-prices] Creating new MetaAPI connection...');
      console.log('[stream-prices] Region:', region);
      console.log('[stream-prices] Account:', accountId.substring(0, 8) + '...');

      const MetaApi = resolveMetaApiCtor();

      if (!metaApiInstance) {
        metaApiInstance = new MetaApi(token, {
          application: 'pipnosis-ai-trading',
          domain: 'agiliumtrade.ai',
          region: region,
          requestTimeout: 60000,
          retryOpts: {
            retries: 5,
            minDelayInSeconds: 1,
            maxDelayInSeconds: 30
          }
        });
      }

      const account = await metaApiInstance.metatraderAccountApi.getAccount(accountId);
      console.log('[stream-prices] Account state:', account.state);
      console.log('[stream-prices] Connection status:', account.connectionStatus);

      if (account.state !== 'DEPLOYED') {
        throw new Error(`Account not deployed. Current state: ${account.state}`);
      }

      const connection = account.getRPCConnection();
      console.log('[stream-prices] Connecting to terminal...');
      await connection.connect();

      console.log('[stream-prices] Waiting for synchronization...');
      await connection.waitSynchronized();

      console.log('[stream-prices] Connection established and synchronized');
      activeConnection = connection;
      isConnecting = false;
      connectionPromise = null;

      return connection;
    } catch (err) {
      console.error('[stream-prices] Connection failed:', err.message);
      isConnecting = false;
      connectionPromise = null;
      activeConnection = null;
      throw err;
    }
  })();

  return await connectionPromise;
}

async function subscribeToSymbol(connection, symbol) {
  try {
    console.log('[stream-prices] Subscribing to', symbol);
    await connection.subscribeToMarketData(symbol, [
      { type: 'quotes', intervalInMilliseconds: 0 }
    ]);
    console.log('[stream-prices] Successfully subscribed to', symbol);
  } catch (err) {
    console.error('[stream-prices] Failed to subscribe to', symbol, ':', err.message);
    throw err;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Supabase not configured' })
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const urlObj = new URL(event.rawUrl);
  const symbols = (urlObj.searchParams.get('symbols') || 'EURUSD').split(',').map(s => s.trim().toUpperCase());

  console.log('[stream-prices] Starting price stream for:', symbols.join(', '));

  let timeoutId;
  let heartbeatId;
  let cleanupId;
  let messageCount = 0;
  const startTime = Date.now();

  return {
    statusCode: 200,
    headers: CORS,
    body: (async function* () {
      try {
        yield `data: ${JSON.stringify({ type: 'connected', symbols, timestamp: new Date().toISOString() })}\n\n`;

        await updateConnectionHealth(supabase, 'connecting');
        const connection = await getOrCreateConnection();
        await updateConnectionHealth(supabase, 'connected');

        for (const symbol of symbols) {
          await subscribeToSymbol(connection, symbol);
        }

        const priceListener = (symbolPrice) => {
          const { symbol, bid, ask, time } = symbolPrice;

          if (symbols.includes(symbol.toUpperCase())) {
            const priceData = {
              symbol,
              bid,
              ask,
              mid: (bid + ask) / 2,
              spread: ask - bid,
              time,
              source: 'metaapi-ws',
              timestamp: new Date().toISOString()
            };

            lastPriceUpdate[symbol] = priceData;
            messageCount++;

            storePriceInSupabase(supabase, symbol, bid, ask, time, 'metaapi-ws').catch(err => {
              console.error('[stream-prices] Failed to store price:', err);
            });
          }
        };

        connection.addSynchronizationListener({
          onSymbolPriceUpdated: priceListener
        });

        console.log('[stream-prices] Streaming started, waiting for price updates...');

        heartbeatId = setInterval(() => {
          const runtime = Math.floor((Date.now() - startTime) / 1000);
          const heartbeat = {
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
            runtime,
            messageCount,
            isHealthy: connection?.healthMonitor?.healthStatus?.isHealthy || false
          };

          try {
            yield `data: ${JSON.stringify(heartbeat)}\n\n`;
          } catch (err) {
            console.error('[stream-prices] Heartbeat error:', err);
          }
        }, 10000);

        cleanupId = setInterval(async () => {
          try {
            await supabase.rpc('cleanup_old_realtime_prices');
          } catch (err) {
            console.error('[stream-prices] Cleanup error:', err);
          }
        }, 300000);

        const priceInterval = setInterval(() => {
          for (const symbol of symbols) {
            if (lastPriceUpdate[symbol]) {
              const age = Date.now() - new Date(lastPriceUpdate[symbol].timestamp).getTime();
              if (age < 5000) {
                try {
                  yield `data: ${JSON.stringify({ type: 'price', ...lastPriceUpdate[symbol] })}\n\n`;
                } catch (err) {
                  console.error('[stream-prices] Price broadcast error:', err);
                }
              }
            }
          }
        }, 500);

        timeoutId = setTimeout(() => {
          console.log('[stream-prices] Stream timeout after 9 minutes, closing...');
          clearInterval(priceInterval);
        }, 540000);

        await new Promise((resolve) => {
          setTimeout(resolve, 540000);
        });

      } catch (err) {
        console.error('[stream-prices] Stream error:', err.message);
        await updateConnectionHealth(supabase, 'error', err.message);

        yield `data: ${JSON.stringify({
          type: 'error',
          error: err.message,
          timestamp: new Date().toISOString()
        })}\n\n`;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (heartbeatId) clearInterval(heartbeatId);
        if (cleanupId) clearInterval(cleanupId);

        console.log('[stream-prices] Stream ended, sent', messageCount, 'price updates');
        yield `data: ${JSON.stringify({ type: 'closed', timestamp: new Date().toISOString() })}\n\n`;
      }
    })()
  };
};
