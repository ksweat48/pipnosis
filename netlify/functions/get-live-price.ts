import { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

// Track price history for staleness detection - keyed by "symbol:source"
const priceHistory: Map<string, Array<{ bid: number; ask: number; timestamp: number; source: string }>> = new Map();
const STALENESS_THRESHOLD_MS = 30000; // 30 seconds
const MAX_PRICE_HISTORY = 10;

// Hard maximum age for any fallback price served to the chart
// Prices older than this are rejected outright rather than served as "live"
const MAX_FALLBACK_AGE_SECONDS = 60;

interface PriceResult {
  bid: number;
  ask: number;
  timestamp: string;
  source: string;
  staleness?: number;
  priceVariance?: number;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache'
};

interface MetaApiPrice {
  bid: number;
  ask: number;
  time?: string;
  brokerTime?: string;
}

async function getMetaApiPrice(symbol: string): Promise<{ bid: number; ask: number; timestamp: string; brokerTime?: string; source: string }> {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'london';

  if (!token) {
    throw new Error('MetaAPI token not configured');
  }

  if (!accountId) {
    throw new Error('MetaAPI account ID not configured');
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

      const error = new Error(`MetaAPI HTTP ${response.status}: ${errorDetail}`);
      (error as any).response = { status: response.status };
      throw error;
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

    const brokerTime = data.time || new Date().toISOString();
    return {
      bid: parseFloat(String(data.bid)),
      ask: parseFloat(String(data.ask)),
      timestamp: brokerTime,
      brokerTime,
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

function isPriceStale(symbol: string, currentPrice: { bid: number; ask: number }): boolean {
  // NOTE: This function only detects staleness via in-memory price history.
  // On Netlify cold starts, history is empty and this returns false (price accepted).
  // Fallback stale-data protection is handled separately via MAX_FALLBACK_AGE_SECONDS on levels 2-5.
  const history = priceHistory.get(symbol) || [];

  if (history.length === 0) {
    console.log(`[get-live-price] No price history yet for ${symbol} (cold start or first call) - accepting price`);
    return false;
  }

  const now = Date.now();
  const recentPrices = history.filter(p => now - p.timestamp < STALENESS_THRESHOLD_MS);

  if (recentPrices.length === 0) {
    return false;
  }

  // Check if all recent prices are identical (price not moving = possible API returning cached data)
  const allSame = recentPrices.every(p =>
    p.bid === currentPrice.bid && p.ask === currentPrice.ask
  );

  if (allSame && recentPrices.length > 0) {
    const oldestRecentPrice = recentPrices[0];
    const staleDuration = now - oldestRecentPrice.timestamp;

    if (staleDuration > STALENESS_THRESHOLD_MS) {
      console.warn(`[get-live-price] ⚠️ STALE PRICE DETECTED for ${symbol}: unchanged for ${(staleDuration/1000).toFixed(1)}s (threshold: ${STALENESS_THRESHOLD_MS/1000}s)`);
      return true;
    }
  }

  return false;
}

function addPriceToHistory(symbol: string, bid: number, ask: number, source: string): void {
  const history = priceHistory.get(symbol) || [];

  history.push({
    bid,
    ask,
    timestamp: Date.now(),
    source
  });

  // Keep only last MAX_PRICE_HISTORY entries
  if (history.length > MAX_PRICE_HISTORY) {
    history.shift();
  }

  priceHistory.set(symbol, history);
}


async function getCachedPrice(symbol: string, maxAgeSeconds: number = 10): Promise<{ bid: number; ask: number; timestamp: string; source: string; ageSeconds: number; quality: number } | null> {
  const supabase = getSupabaseAdmin();

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
  const supabase = getSupabaseAdmin();

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


async function savePriceToDatabase(symbol: string, bid: number, ask: number, source: string, brokerTime?: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
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
        broker_time: brokerTime || new Date().toISOString(),
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
    const accountId = process.env.METAAPI_ACCOUNT_ID;

    console.log(`[get-live-price][${requestId}] ========== NEW REQUEST ==========`);
    console.log(`[get-live-price][${requestId}] Symbol: ${symbol}`);
    console.log(`[get-live-price][${requestId}] Using Account: ${accountId?.slice(0, 8)}...`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_TOKEN: ${process.env.METAAPI_TOKEN ? 'SET' : 'MISSING'}`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_ACCOUNT_ID: ${accountId ? 'SET' : 'MISSING'}`);
    console.log(`[get-live-price][${requestId}] Env check - METAAPI_REGION: ${process.env.METAAPI_REGION || 'london'}`);

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
      console.log(`[get-live-price][${requestId}] Level 1: Attempting live MetaAPI with account ${accountId?.slice(0, 8)}...`);
      priceData = await getMetaApiPrice(symbol);
      fetchMethod = 'metaapi-live';
      fallbackLevel = 1;
      console.log(`[get-live-price][${requestId}] ✓ Live MetaAPI price fetched: ${priceData.bid}/${priceData.ask}`);

      await savePriceToDatabase(symbol, priceData.bid, priceData.ask, priceData.source, (priceData as any).brokerTime);
    } catch (metaError) {
      console.error(`[get-live-price][${requestId}] ❌ Level 1 failed:`, metaError instanceof Error ? metaError.message : String(metaError));

      // Level 2: Recent cache (< 10 seconds)
      console.log(`[get-live-price][${requestId}] Level 2: Trying recent cache (<10s)...`);
      const recentCache = await getCachedPrice(symbol, 10);
      if (recentCache && recentCache.ageSeconds <= MAX_FALLBACK_AGE_SECONDS) {
        priceData = recentCache;
        fetchMethod = 'recent-cache';
        fallbackLevel = 2;
        console.warn(`[get-live-price][${requestId}] ⚠️ Using recent cache (${recentCache.ageSeconds}s old, quality: ${recentCache.quality}%)`);
      } else {
        if (recentCache) {
          console.warn(`[get-live-price][${requestId}] ❌ Level 2 rejected: cache is ${recentCache.ageSeconds}s old (max ${MAX_FALLBACK_AGE_SECONDS}s)`);
        } else {
          console.warn(`[get-live-price][${requestId}] ❌ Level 2 failed, no recent cache`);
        }

        // Level 3: Stale cache (< 60 seconds) - hard cap enforced by MAX_FALLBACK_AGE_SECONDS
        console.log(`[get-live-price][${requestId}] Level 3: Trying stale cache (<${MAX_FALLBACK_AGE_SECONDS}s)...`);
        const staleCache = await getCachedPrice(symbol, MAX_FALLBACK_AGE_SECONDS);
        if (staleCache && staleCache.ageSeconds <= MAX_FALLBACK_AGE_SECONDS) {
          priceData = staleCache;
          fetchMethod = 'stale-cache';
          fallbackLevel = 3;
          console.warn(`[get-live-price][${requestId}] ⚠️ Using stale cache (${staleCache.ageSeconds}s old, quality: ${staleCache.quality}%)`);
        } else {
          if (staleCache) {
            console.warn(`[get-live-price][${requestId}] ❌ Level 3 rejected: cache is ${staleCache.ageSeconds}s old (max ${MAX_FALLBACK_AGE_SECONDS}s) - refusing to serve stale data`);
          } else {
            console.warn(`[get-live-price][${requestId}] ❌ Level 3 failed, no stale cache within age limit`);
          }

          // Level 4-5: Emergency fallback and last resort - only accepted if within age limit
          console.log(`[get-live-price][${requestId}] Level 4-5: Trying emergency fallback (max age ${MAX_FALLBACK_AGE_SECONDS}s)...`);
          const fallback = await getFallbackPrice(symbol);
          if (fallback && fallback.ageSeconds <= MAX_FALLBACK_AGE_SECONDS) {
            priceData = fallback;
            fetchMethod = fallback.source;
            fallbackLevel = fallback.source === 'emergency-fallback' ? 4 : 5;
            console.warn(`[get-live-price][${requestId}] ⚠️ Using ${fallback.source} (${fallback.ageSeconds}s old, quality: ${fallback.quality}%)`);
          } else {
            if (fallback) {
              console.error(`[get-live-price][${requestId}] ❌ Level 4-5 rejected: fallback price is ${fallback.ageSeconds}s old (max ${MAX_FALLBACK_AGE_SECONDS}s) - this would display months-old price data`);
            } else {
              console.error(`[get-live-price][${requestId}] ❌ CRITICAL: All fallback levels exhausted for ${symbol}`);
            }
            throw new Error(`No fresh price data available for ${symbol}. All sources failed and cached data exceeded maximum age of ${MAX_FALLBACK_AGE_SECONDS}s. Original error: ${metaError instanceof Error ? metaError.message : String(metaError)}`);
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
        warning: warningMessage,
        activeSource: priceData.source
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
