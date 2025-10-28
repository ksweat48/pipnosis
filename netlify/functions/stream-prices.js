/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
const { createLogger } = require('./function-logger.js');
const { createRestClient } = require('./metaapi-rest-client.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Content-Type': 'text/event-stream',
  'X-Accel-Buffering': 'no'
};

async function updateConnectionHealth(supabase, status, errorMessage = null) {
  try {
    const { error } = await supabase
      .from('connection_health_status')
      .insert({
        endpoint: 'stream-prices',
        status: status,
        error_message: errorMessage,
        region: process.env.METAAPI_REGION || 'london',
        account_id: process.env.METAAPI_ACCOUNT_ID || ''
      });

    if (error) {
      console.error('[stream-prices] Failed to update connection health:', error);
    }
  } catch (err) {
    console.error('[stream-prices] Error updating connection health:', err);
  }
}

async function storePriceInSupabase(supabase, symbol, bid, ask, brokerTime, source = 'metaapi-rest-polling') {
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

async function fetchPricesViaREST(restClient, accountId, symbols) {
  const prices = {};

  for (const symbol of symbols) {
    try {
      const priceData = await restClient.getSymbolPrice(accountId, symbol);

      if (priceData && priceData.bid && priceData.ask) {
        prices[symbol] = {
          symbol,
          bid: priceData.bid,
          ask: priceData.ask,
          mid: (priceData.bid + priceData.ask) / 2,
          spread: priceData.ask - priceData.bid,
          time: priceData.time || new Date().toISOString(),
          source: 'metaapi-rest-polling',
          timestamp: new Date().toISOString()
        };
      }
    } catch (err) {
      console.error(`[stream-prices] Failed to fetch ${symbol}:`, err.message);
    }
  }

  return prices;
}

exports.handler = async (event) => {
  const logger = createLogger('stream-prices');

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
  const token = process.env.METAAPI_ADMIN_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'london';

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Supabase not configured' })
    };
  }

  if (!token || !accountId) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'MetaAPI credentials not configured' })
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const urlObj = new URL(event.rawUrl);
  const symbols = (urlObj.searchParams.get('symbols') || 'EURUSD').split(',').map(s => s.trim().toUpperCase());

  logger.info('Starting price stream via REST polling', { symbols });

  const encoder = new TextEncoder();
  let messageCount = 0;
  const startTime = Date.now();

  return {
    statusCode: 200,
    headers: CORS,
    body: new ReadableStream({
      async start(controller) {
        let pollingInterval = null;
        let heartbeatInterval = null;
        let cleanupInterval = null;
        let restClient = null;
        let isActive = true;

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'starting',
            symbols,
            method: 'rest-polling',
            timestamp: new Date().toISOString()
          })}\n\n`));

          await updateConnectionHealth(supabase, 'connecting');

          restClient = createRestClient(token, { region, timeout: 5000 });

          const testPrice = await restClient.getSymbolPrice(accountId, symbols[0]);

          if (!testPrice || !testPrice.bid) {
            throw new Error('Failed to fetch initial price');
          }

          logger.success('REST connection established');

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'connected',
            symbols,
            method: 'rest-polling',
            timestamp: new Date().toISOString()
          })}\n\n`));

          await updateConnectionHealth(supabase, 'connected');

          pollingInterval = setInterval(async () => {
            if (!isActive) return;

            try {
              const prices = await fetchPricesViaREST(restClient, accountId, symbols);

              for (const [symbol, priceData] of Object.entries(prices)) {
                messageCount++;

                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'price',
                  ...priceData
                })}\n\n`));

                await storePriceInSupabase(
                  supabase,
                  priceData.symbol,
                  priceData.bid,
                  priceData.ask,
                  priceData.time,
                  'metaapi-rest-polling'
                );
              }
            } catch (err) {
              logger.error('Polling error', { error: err.message });
            }
          }, 1000);

          heartbeatInterval = setInterval(() => {
            if (!isActive) return;

            const runtime = Math.floor((Date.now() - startTime) / 1000);
            const heartbeat = {
              type: 'heartbeat',
              timestamp: new Date().toISOString(),
              runtime,
              messageCount,
              method: 'rest-polling'
            };

            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(heartbeat)}\n\n`));
            } catch (err) {
              logger.error('Heartbeat error', { error: err.message });
            }
          }, 10000);

          cleanupInterval = setInterval(async () => {
            if (!isActive) return;

            try {
              const cutoffTime = new Date(Date.now() - 300000).toISOString();
              await supabase
                .from('realtime_prices')
                .delete()
                .lt('created_at', cutoffTime);
            } catch (err) {
              logger.error('Cleanup error', { error: err.message });
            }
          }, 300000);

          await new Promise((resolve) => {
            setTimeout(() => {
              isActive = false;
              resolve();
            }, 540000);
          });

        } catch (err) {
          logger.error('Stream error', { error: err.message });
          await updateConnectionHealth(supabase, 'error', err.message);

          const errorDetails = {
            type: 'error',
            error: err.message,
            method: 'rest-polling',
            timestamp: new Date().toISOString()
          };

          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorDetails)}\n\n`));
          } catch (enqueueErr) {
            logger.error('Failed to enqueue error', { error: enqueueErr.message });
          }
        } finally {
          isActive = false;

          if (pollingInterval) clearInterval(pollingInterval);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          if (cleanupInterval) clearInterval(cleanupInterval);

          logger.info('Stream ended', { messageCount, runtime: Math.floor((Date.now() - startTime) / 1000) });

          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'closed',
              messageCount,
              timestamp: new Date().toISOString()
            })}\n\n`));
          } catch (enqueueErr) {
            logger.error('Failed to enqueue close message', { error: enqueueErr.message });
          }

          controller.close();
        }
      }
    })
  };
};
