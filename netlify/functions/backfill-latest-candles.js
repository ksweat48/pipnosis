const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const DEFAULT_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];

const TIMEFRAMES = [
  { name: 'M1', minutes: 1 },
  { name: 'M5', minutes: 5 },
  { name: 'M15', minutes: 15 },
  { name: 'M30', minutes: 30 },
  { name: 'H1', minutes: 60 },
  { name: 'H4', minutes: 240 },
  { name: 'D1', minutes: 1440 },
  { name: 'W1', minutes: 10080 }
];

async function getAvailableSymbols(supabase) {
  try {
    const { data, error } = await supabase
      .from('symbol_availability')
      .select('symbol')
      .eq('available_for_historical', true)
      .order('symbol');

    if (error || !data || data.length === 0) {
      console.log('[Backfill] Using default symbols');
      return DEFAULT_SYMBOLS;
    }

    const symbols = data.map(row => row.symbol);
    console.log(`[Backfill] Found ${symbols.length} available symbols from database`);
    return symbols;
  } catch (error) {
    console.error('[Backfill] Error fetching symbols:', error.message);
    return DEFAULT_SYMBOLS;
  }
}

async function fetchCandlesFromMetaApi(symbol, timeframe, limit = 200) {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured');
  }

  const now = new Date();
  const minutesPerCandle = timeframe.minutes;
  const totalMinutes = limit * minutesPerCandle;

  const startTime = new Date(now.getTime() - (totalMinutes * 60 * 1000));

  const intervalMs = minutesPerCandle * 60 * 1000;
  const currentCandleStartMs = Math.floor(now.getTime() / intervalMs) * intervalMs;
  const lastCompletedCandleMs = currentCandleStartMs - intervalMs;
  const lastCompletedCandle = new Date(lastCompletedCandleMs);

  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe.name}/candles?startTime=${startTime.toISOString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'auth-token': token,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();

    if (response.status === 404 || errorText.includes('NotFoundError')) {
      const error = new Error(`Symbol ${symbol} not available for historical data`);
      error.code = 'SYMBOL_NOT_AVAILABLE';
      error.status = 404;
      throw error;
    }

    throw new Error(`MetaAPI error: ${response.status} - ${errorText}`);
  }

  const candles = await response.json();

  if (!Array.isArray(candles)) {
    throw new Error('Invalid candle data from MetaAPI');
  }

  const filteredCandles = candles.filter(candle => {
    const candleTime = new Date(candle.time);
    return candleTime <= lastCompletedCandle;
  });

  return filteredCandles.slice(-limit).map(candle => ({
    symbol,
    timeframe: timeframe.name,
    open_time: candle.time,
    close_time: new Date(new Date(candle.time).getTime() + timeframe.minutes * 60000).toISOString(),
    open: parseFloat(candle.open),
    high: parseFloat(candle.high),
    low: parseFloat(candle.low),
    close: parseFloat(candle.close),
    volume: parseFloat(candle.tickVolume || 0)
  }));
}

function validateCandleContinuity(candles, timeframe) {
  if (candles.length < 2) {
    return { valid: true, gaps: [], duplicates: [] };
  }

  const gaps = [];
  const duplicates = [];
  const intervalSeconds = timeframe.minutes * 60;
  const seenTimes = new Set();

  candles.sort((a, b) => new Date(a.open_time).getTime() - new Date(b.open_time).getTime());

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const openTime = new Date(candle.open_time).getTime() / 1000;
    const closeTime = new Date(candle.close_time).getTime() / 1000;

    if (seenTimes.has(openTime)) {
      duplicates.push({ time: candle.open_time, index: i });
    }
    seenTimes.add(openTime);

    if (Math.abs(closeTime - openTime - intervalSeconds) > 1) {
      console.warn(`[Validation] Candle ${i} has incorrect duration: ${closeTime - openTime}s vs expected ${intervalSeconds}s`);
    }

    if (i > 0) {
      const prevTime = new Date(candles[i - 1].open_time).getTime() / 1000;
      const timeDiff = openTime - prevTime;

      if (timeDiff > intervalSeconds * 1.5) {
        const expectedCandles = Math.floor(timeDiff / intervalSeconds);
        const missingCandles = expectedCandles - 1;

        if (missingCandles > 0) {
          gaps.push({
            startTime: candles[i - 1].open_time,
            endTime: candle.open_time,
            missingCandles
          });
        }
      }
    }
  }

  return {
    valid: gaps.length === 0 && duplicates.length === 0,
    gaps,
    duplicates
  };
}

async function saveCandlesToDatabase(supabase, candles) {
  if (candles.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const { error } = await supabase
    .from('forex_candles')
    .upsert(candles, {
      onConflict: 'symbol,timeframe,open_time',
      ignoreDuplicates: false
    });

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return { inserted: candles.length, updated: 0 };
}

async function backfillSymbolTimeframe(supabase, symbol, timeframe, stats) {
  const key = `${symbol}-${timeframe.name}`;

  try {
    console.log(`[Backfill] Fetching ${symbol} ${timeframe.name} (200 candles)...`);

    const candles = await fetchCandlesFromMetaApi(symbol, timeframe, 200);

    if (candles.length === 0) {
      console.warn(`[Backfill] No candles received for ${symbol} ${timeframe.name}`);
      stats.failed++;
      stats.failures.push({ symbol, timeframe: timeframe.name, reason: 'No candles returned' });
      return;
    }

    const validation = validateCandleContinuity(candles, timeframe);

    if (!validation.valid) {
      console.warn(`[Backfill] ${symbol} ${timeframe.name} has ${validation.gaps.length} gaps, ${validation.duplicates.length} duplicates`);
    }

    const result = await saveCandlesToDatabase(supabase, candles);

    stats.successful++;
    stats.totalCandles += candles.length;
    stats.details[key] = {
      symbol,
      timeframe: timeframe.name,
      candleCount: candles.length,
      timeRange: {
        start: candles[0]?.open_time,
        end: candles[candles.length - 1]?.open_time
      },
      gaps: validation.gaps.length,
      duplicates: validation.duplicates.length
    };

    console.log(`[Backfill] ✓ ${symbol} ${timeframe.name}: ${candles.length} candles saved`);

  } catch (error) {
    stats.failed++;

    if (error.code === 'SYMBOL_NOT_AVAILABLE') {
      console.log(`[Backfill] ⊗ ${symbol} ${timeframe.name}: Symbol not available`);
      stats.unavailableSymbols.add(symbol);
    } else {
      console.error(`[Backfill] ✗ ${symbol} ${timeframe.name}: ${error.message}`);
    }

    stats.failures.push({
      symbol,
      timeframe: timeframe.name,
      reason: error.message,
      code: error.code
    });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const params = new URLSearchParams(event.rawUrl ? event.rawUrl.split('?')[1] : '');
    const specificSymbol = params.get('symbol');
    const specificTimeframe = params.get('timeframe');
    const delayMs = parseInt(params.get('delay') || '1000', 10);

    console.log('[Backfill] Starting backfill operation...');
    console.log(`[Backfill] Delay between requests: ${delayMs}ms`);

    const allSymbols = await getAvailableSymbols(supabase);
    const symbolsToProcess = specificSymbol ? [specificSymbol] : allSymbols;
    const timeframesToProcess = specificTimeframe
      ? TIMEFRAMES.filter(tf => tf.name === specificTimeframe.toUpperCase())
      : TIMEFRAMES;

    if (timeframesToProcess.length === 0) {
      throw new Error(`Invalid timeframe: ${specificTimeframe}`);
    }

    const totalTasks = symbolsToProcess.length * timeframesToProcess.length;

    console.log(`[Backfill] Processing ${symbolsToProcess.length} symbols × ${timeframesToProcess.length} timeframes = ${totalTasks} tasks`);
    console.log(`[Backfill] Symbols: ${symbolsToProcess.join(', ')}`);
    console.log(`[Backfill] Timeframes: ${timeframesToProcess.map(tf => tf.name).join(', ')}`);

    const stats = {
      successful: 0,
      failed: 0,
      totalCandles: 0,
      details: {},
      failures: [],
      unavailableSymbols: new Set()
    };

    let taskCount = 0;

    for (const symbol of symbolsToProcess) {
      if (stats.unavailableSymbols.has(symbol)) {
        console.log(`[Backfill] Skipping ${symbol} - marked as unavailable`);
        stats.failed += timeframesToProcess.length;
        continue;
      }

      for (const timeframe of timeframesToProcess) {
        taskCount++;

        await backfillSymbolTimeframe(supabase, symbol, timeframe, stats);

        if (taskCount < totalTasks) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[Backfill] Complete in ${duration}s`);
    console.log(`[Backfill] Success: ${stats.successful}/${totalTasks}`);
    console.log(`[Backfill] Failed: ${stats.failed}/${totalTasks}`);
    console.log(`[Backfill] Total candles: ${stats.totalCandles}`);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        summary: {
          totalTasks,
          successful: stats.successful,
          failed: stats.failed,
          totalCandles: stats.totalCandles,
          durationSeconds: parseFloat(duration),
          unavailableSymbols: Array.from(stats.unavailableSymbols)
        },
        details: stats.details,
        failures: stats.failures
      })
    };

  } catch (error) {
    console.error('[Backfill] Fatal error:', error);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
