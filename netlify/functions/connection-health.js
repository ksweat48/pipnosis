/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function httpRes(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return httpRes(200, { ok: true });
  }

  if (event.httpMethod !== 'GET') {
    return httpRes(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return httpRes(500, { error: 'Supabase not configured' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: healthData, error: healthError } = await supabase
      .from('metaapi_connection_health')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (healthError) {
      console.error('[connection-health] Failed to fetch health data:', healthError);
      return httpRes(500, {
        error: 'Failed to fetch connection health',
        details: healthError.message
      });
    }

    const { data: recentPrices, error: pricesError } = await supabase
      .from('realtime_prices')
      .select('symbol, created_at, source')
      .order('created_at', { ascending: false })
      .limit(10);

    if (pricesError) {
      console.error('[connection-health] Failed to fetch recent prices:', pricesError);
    }

    const now = new Date();
    const isHealthy = healthData &&
      healthData.connection_status === 'connected' &&
      healthData.last_message_at &&
      (now - new Date(healthData.last_message_at)) < 60000;

    const priceStats = recentPrices ? {
      count: recentPrices.length,
      latestTimestamp: recentPrices[0]?.created_at || null,
      sources: [...new Set(recentPrices.map(p => p.source))],
      symbols: [...new Set(recentPrices.map(p => p.symbol))]
    } : null;

    return httpRes(200, {
      ok: true,
      health: healthData || {
        connection_status: 'unknown',
        last_message_at: null,
        reconnect_count: 0,
        error_message: 'No health data available'
      },
      isHealthy,
      recentPrices: priceStats,
      timestamp: now.toISOString()
    });

  } catch (err) {
    console.error('[connection-health] Error:', err);
    return httpRes(500, {
      error: err.message || 'Internal error',
      details: {
        name: err.name,
        message: err.message
      }
    });
  }
};
