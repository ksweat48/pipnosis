import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

interface MetaApiPrice {
  bid: number;
  ask: number;
  time?: string;
}

async function getMetaApiPrice(symbol: string): Promise<{ bid: number; ask: number; timestamp: string; source: string }> {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured');
  }

  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/current-price`;

  console.log(`[get-live-price] Fetching ${symbol} from MetaAPI`);
  console.log(`[get-live-price] URL: ${url}`);
  console.log(`[get-live-price] Region: ${region}`);
  console.log(`[get-live-price] Account ID: ${accountId}`);
  console.log(`[get-live-price] Token present: ${token ? 'YES' : 'NO'}`);
  console.log(`[get-live-price] Token length: ${token ? token.length : 0}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`[get-live-price] Response status: ${response.status}`);
    console.log(`[get-live-price] Response ok: ${response.ok}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[get-live-price] MetaAPI error response body:`, errorText);

      let errorDetail = errorText;
      if (response.status === 401) {
        errorDetail = 'Invalid or expired MetaAPI token - Check token in Netlify env vars';
      } else if (response.status === 403) {
        errorDetail = 'Access forbidden - check account permissions';
      } else if (response.status === 404) {
        errorDetail = `Account ${accountId} NOT DEPLOYED or DELETED in region ${region}. Login to https://app.metaapi.cloud/ and deploy the account, or create a new account. See LIVE_FEED_FIX_GUIDE.md for instructions.`;
      } else if (response.status === 429) {
        errorDetail = 'Rate limit exceeded - too many requests';
      } else if (response.status >= 500) {
        errorDetail = 'MetaAPI server error - service may be down';
      }

      throw new Error(`MetaAPI HTTP ${response.status}: ${errorDetail}`);
    }

    const data: MetaApiPrice = await response.json();
    console.log(`[get-live-price] Price data received for ${symbol}:`, {
      bid: data.bid,
      ask: data.ask,
      hasTime: !!data.time
    });

    if (!data.bid || !data.ask) {
      console.error(`[get-live-price] Invalid price data:`, data);
      throw new Error(`Invalid price data from MetaAPI: bid=${data.bid}, ask=${data.ask}`);
    }

    if (isNaN(data.bid) || isNaN(data.ask)) {
      console.error(`[get-live-price] Price values are NaN:`, data);
      throw new Error(`Invalid numeric values: bid=${data.bid}, ask=${data.ask}`);
    }

    return {
      bid: parseFloat(String(data.bid)),
      ask: parseFloat(String(data.ask)),
      timestamp: data.time || new Date().toISOString(),
      source: 'metaapi-live'
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[get-live-price] Request timeout for ${symbol} after 8 seconds`);
      throw new Error(`MetaAPI request timeout after 8 seconds for ${symbol}`);
    }
    console.error(`[get-live-price] Fetch error for ${symbol}:`, error);
    throw error;
  }
}

async function getCachedPrice(symbol: string, maxAgeSeconds: number = 10): Promise<{ bid: number; ask: number; timestamp: string; source: string; ageSeconds: number; quality: number } | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const cutoffTime = new Date(Date.now() - (maxAgeSeconds * 1000)).toISOString();

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('bid, ask, broker_time, created_at')
    .eq('symbol', symbol.toUpperCase())
    .gte('created_at', cutoffTime)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const ageSeconds = Math.floor((Date.now() - new Date(data.created_at).getTime()) / 1000);

  if (ageSeconds > maxAgeSeconds) {
    console.warn(`[get-live-price] Cached price for ${symbol} is too old (${ageSeconds}s > ${maxAgeSeconds}s) - rejecting`);
    return null;
  }

  // Calculate quality score: 100 for fresh data, decreasing with age
  const quality = Math.max(0, Math.min(100, 100 - (ageSeconds / maxAgeSeconds) * 100));

  return {
    bid: parseFloat(data.bid),
    ask: parseFloat(data.ask),
    timestamp: data.broker_time,
    source: 'supabase-cache',
    ageSeconds,
    quality: Math.round(quality)
  };
}

async function getFallbackPrice(symbol: string): Promise<{ bid: number; ask: number; timestamp: string; source: string; ageSeconds: number; quality: number } | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Try to get last known price from fallback cache
  const { data: fallbackData, error: fallbackError } = await supabase
    .from('polling_fallback_cache')
    .select('*')
    .eq('symbol', symbol.toUpperCase())
    .gte('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!fallbackError && fallbackData) {
    const ageSeconds = Math.floor((Date.now() - new Date(fallbackData.cached_at).getTime()) / 1000);
    console.warn(`[get-live-price] Using emergency fallback for ${symbol} (${ageSeconds}s old)`);

    return {
      bid: parseFloat(fallbackData.bid),
      ask: parseFloat(fallbackData.ask),
      timestamp: fallbackData.broker_time,
      source: 'emergency-fallback',
      ageSeconds,
      quality: fallbackData.quality_score
    };
  }

  // Last resort: get ANY recent price (up to 5 minutes old)
  const { data: lastResortData, error: lastResortError } = await supabase
    .from('realtime_prices')
    .select('bid, ask, broker_time, created_at')
    .eq('symbol', symbol.toUpperCase())
    .gte('created_at', new Date(Date.now() - 300000).toISOString()) // 5 minutes
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastResortError && lastResortData) {
    const ageSeconds = Math.floor((Date.now() - new Date(lastResortData.created_at).getTime()) / 1000);
    console.warn(`[get-live-price] Using last resort price for ${symbol} (${ageSeconds}s old)`);

    return {
      bid: parseFloat(lastResortData.bid),
      ask: parseFloat(lastResortData.ask),
      timestamp: lastResortData.broker_time,
      source: 'last-resort',
      ageSeconds,
      quality: 10 // Very low quality
    };
  }

  return null;
}


async function savePriceToDatabase(symbol: string, bid: number, ask: number, source: string): Promise<void> {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('[get-live-price] Supabase credentials not configured, skipping database save');
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    // Save to realtime_prices
    const { error } = await supabase
      .from('realtime_prices')
      .insert({
        symbol: symbol.toUpperCase(),
        bid: bid.toString(),
        ask: ask.toString(),
        mid: mid.toString(),
        spread: spread.toString(),
        broker_time: new Date().toISOString(),
        source: source
      });

    if (error) {
      console.error('[get-live-price] Failed to save price to database:', error);
    } else {
      console.log(`[get-live-price] ✓ Saved ${symbol} to database: ${bid}/${ask} (${source})`);
    }

    // Also update fallback cache for live data
    if (source === 'metaapi-live') {
      await supabase
        .from('polling_fallback_cache')
        .upsert({
          symbol: symbol.toUpperCase(),
          bid: bid.toString(),
          ask: ask.toString(),
          mid: mid.toString(),
          spread: spread.toString(),
          source: source,
          quality_score: 100, // Perfect quality for live data
          broker_time: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString() // 1 hour expiry
        }, {
          onConflict: 'symbol'
        });
    }
  } catch (error) {
    console.error('[get-live-price] Exception saving to database:', error);
  }
}

export const handler: Handler = async (event) => {
  console.log('[get-live-price] Function invoked');
  console.log('[get-live-price] HTTP Method:', event.httpMethod);

  if (event.httpMethod === 'OPTIONS') {
    console.log('[get-live-price] Handling OPTIONS preflight request');
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const params = new URLSearchParams(event.rawUrl?.split('?')[1] || '');
    const symbol = params.get('symbol') || 'EURUSD';
    const requestId = Math.random().toString(36).substring(7);

    console.log(`[get-live-price][${requestId}] ========== NEW REQUEST ==========`);
    console.log(`[get-live-price][${requestId}] Symbol: ${symbol}`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_TOKEN: ${process.env.METAAPI_TOKEN ? 'SET' : 'MISSING'}`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_ACCOUNT_ID: ${process.env.METAAPI_ACCOUNT_ID || 'MISSING'}`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_REGION: ${process.env.METAAPI_REGION || 'MISSING'}`);

    let priceData;
    let fetchMethod = 'unknown';
    let fallbackLevel = 0;

    // Fallback chain:
    // 1. Live MetaAPI
    // 2. Recent cache (< 10 seconds)
    // 3. Stale cache (< 60 seconds)
    // 4. Emergency fallback cache
    // 5. Last resort (up to 5 minutes old)

    try {
      console.log(`[get-live-price][${requestId}] Level 1: Attempting live MetaAPI...`);
      priceData = await getMetaApiPrice(symbol);
      fetchMethod = 'metaapi-live';
      fallbackLevel = 1;
      console.log(`[get-live-price][${requestId}] ✓ Live price fetched: ${priceData.bid}/${priceData.ask}`);

      await savePriceToDatabase(symbol, priceData.bid, priceData.ask, priceData.source);
    } catch (metaError) {
      console.error(`[get-live-price][${requestId}] ❌ Level 1 failed:`, metaError instanceof Error ? metaError.message : String(metaError));

      // Level 2: Recent cache (< 10 seconds)
      console.log(`[get-live-price][${requestId}] Level 2: Trying recent cache (<10s)...`);
      const recentCache = await getCachedPrice(symbol, 10);
      if (recentCache) {
        priceData = recentCache;
        fetchMethod = 'recent-cache';
        fallbackLevel = 2;
        console.warn(`[get-live-price][${requestId}] ⚠️ Using recent cache (${recentCache.ageSeconds}s old, quality: ${recentCache.quality}%)`);
      } else {
        console.warn(`[get-live-price][${requestId}] ❌ Level 2 failed, no recent cache`);

        // Level 3: Stale cache (< 60 seconds)
        console.log(`[get-live-price][${requestId}] Level 3: Trying stale cache (<60s)...`);
        const staleCache = await getCachedPrice(symbol, 60);
        if (staleCache) {
          priceData = staleCache;
          fetchMethod = 'stale-cache';
          fallbackLevel = 3;
          console.warn(`[get-live-price][${requestId}] ⚠️ Using stale cache (${staleCache.ageSeconds}s old, quality: ${staleCache.quality}%)`);
        } else {
          console.warn(`[get-live-price][${requestId}] ❌ Level 3 failed, no stale cache`);

          // Level 4-5: Emergency fallback and last resort
          console.log(`[get-live-price][${requestId}] Level 4-5: Trying emergency fallback...`);
          const fallback = await getFallbackPrice(symbol);
          if (fallback) {
            priceData = fallback;
            fetchMethod = fallback.source;
            fallbackLevel = fallback.source === 'emergency-fallback' ? 4 : 5;
            console.warn(`[get-live-price][${requestId}] ⚠️ Using ${fallback.source} (${fallback.ageSeconds}s old, quality: ${fallback.quality}%)`);
          } else {
            console.error(`[get-live-price][${requestId}] ❌ CRITICAL: All fallback levels exhausted for ${symbol}`);
            throw new Error(`No price data available for ${symbol} at any fallback level. Original error: ${metaError instanceof Error ? metaError.message : String(metaError)}`);
          }
        }
      }
    }

    const isLive = fetchMethod === 'metaapi-live';
    const statusCode = isLive ? 200 : 206;

    // Determine data quality label
    let dataQualityLabel = 'LIVE';
    let warningMessage = undefined;

    switch (fallbackLevel) {
      case 1:
        dataQualityLabel = 'LIVE';
        break;
      case 2:
        dataQualityLabel = 'RECENT_CACHE';
        warningMessage = `Using recent cached data (${priceData.ageSeconds}s old, quality: ${priceData.quality}%)`;
        break;
      case 3:
        dataQualityLabel = 'STALE_CACHE';
        warningMessage = `Using stale cached data (${priceData.ageSeconds}s old, quality: ${priceData.quality}%) - Consider data unreliable`;
        break;
      case 4:
        dataQualityLabel = 'EMERGENCY_FALLBACK';
        warningMessage = `Using emergency fallback data (${priceData.ageSeconds}s old, quality: ${priceData.quality}%) - Data is old, use with caution`;
        break;
      case 5:
        dataQualityLabel = 'LAST_RESORT';
        warningMessage = `Using last resort data (${priceData.ageSeconds}s old, quality: ${priceData.quality}%) - Data is very old, highly unreliable`;
        break;
    }

    if (isLive) {
      console.log(`[get-live-price][${requestId}] ========== REQUEST SUCCESS (LIVE DATA) ==========`);
    } else {
      console.warn(`[get-live-price][${requestId}] ========== REQUEST PARTIAL (${dataQualityLabel}, Level ${fallbackLevel}) ==========`);
    }

    return {
      statusCode,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: true,
        symbol: symbol.toUpperCase(),
        ...priceData,
        dataQuality: dataQualityLabel,
        fallbackLevel,
        warning: warningMessage
      })
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('[get-live-price] ========== REQUEST FAILED ==========');
    console.error('[get-live-price] ERROR:', error);
    console.error('[get-live-price] Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[get-live-price] Error message:', errorMessage);
    if (errorStack) {
      console.error('[get-live-price] Error stack:', errorStack);
    }

    return {
      statusCode: 503,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: errorMessage,
        dataQuality: 'UNAVAILABLE',
        source: 'error',
        timestamp: new Date().toISOString(),
        message: 'Live price data unavailable - Cannot proceed with trading'
      })
    };
  }
};
