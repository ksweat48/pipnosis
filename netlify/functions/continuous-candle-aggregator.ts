import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import { fetchKrakenOHLC } from './_shared/kraken-client';

const supabase = getSupabaseAdmin();

const FOREX_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'NAS100', 'SPX500'];
const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'];
const ACTIVE_SYMBOLS = [...FOREX_SYMBOLS, ...CRYPTO_SYMBOLS];

function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_SYMBOLS.includes(symbol.toUpperCase());
}

// CRITICAL: Process M1, M5, M15 every run to ensure continuous data (runs every 5 min)
// These are the most commonly used timeframes and must always have fresh data
const FAST_TIMEFRAMES = ['M1', 'M5', 'M15']; // Process every run (5 min) - CRITICAL FOR PERSISTENCE
const MEDIUM_TIMEFRAMES = ['M30', 'H1']; // Process every 3rd run (15 min)
const SLOW_TIMEFRAMES = ['H4', 'D1']; // Process every 12th run (60 min)
const ALL_TIMEFRAMES = [...FAST_TIMEFRAMES, ...MEDIUM_TIMEFRAMES, ...SLOW_TIMEFRAMES];

// SAFETY: Maximum candles to create per timeframe per run (prevents runaway processing)
// Set to 720 to allow filling up to a 12-hour gap on restart (720 M1 candles max)
const MAX_CANDLES_PER_TIMEFRAME = 720;

// WICK RECONSTRUCTION: DISABLED to preserve actual price data integrity
// CRITICAL: We never artificially extend wicks beyond actual market prices
const ENABLE_WICK_RECONSTRUCTION = false;

const TIMEFRAME_MINUTES: Record<string, number> = {
  'M1': 1,
  'M5': 5,
  'M15': 15,
  'M30': 30,
  'H1': 60,
  'H4': 240,
  'D1': 1440
};

// CASCADING QUALITY HIERARCHY: Each timeframe aggregates from its optimal lower timeframe
// This ensures M5's high quality flows through the entire hierarchy
const AGGREGATION_HIERARCHY: Record<string, string> = {
  'M15': 'M5',  // 3 M5 candles
  'M30': 'M5',  // 6 M5 candles
  'H1': 'M5',   // 12 M5 candles
  'H4': 'H1',   // 4 H1 candles
  'D1': 'H4'    // 6 H4 candles (24 hours / 4 hours)
};

// QUALITY THRESHOLDS: Minimum percentage of lower timeframe candles required
const QUALITY_THRESHOLDS: Record<string, number> = {
  'M15': 0.66,  // Need 2+ of 3 M5 candles (66%)
  'M30': 0.50,  // Need 3+ of 6 M5 candles (50%)
  'H1': 0.50,   // Need 6+ of 12 M5 candles (50%)
  'H4': 0.50,   // Need 2+ of 4 H1 candles (50%)
  'D1': 0.50    // Need 3+ of 6 H4 candles (50%)
};

interface RealtimePrice {
  symbol: string;
  bid: number;
  ask: number;
  broker_time: string;
  created_at: string;
}

interface CandleData {
  symbol: string;
  timeframe: string;
  open_time: Date;
  close_time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function roundTimeToCandle(time: Date, minutes: number): Date {
  const ms = time.getTime();
  const roundedMs = Math.floor(ms / (minutes * 60 * 1000)) * (minutes * 60 * 1000);
  return new Date(roundedMs);
}

/**
 * Determine which timeframes to process based on current minute
 * This prevents timeout by processing heavy timeframes less frequently
 */
function getTimeframesToProcess(): string[] {
  const now = new Date();
  const minuteOfHour = now.getMinutes();

  // ALWAYS process fast timeframes (M1, M5, M15)
  let timeframes = [...FAST_TIMEFRAMES];

  // Every 15 minutes (0, 15, 30, 45), also process medium timeframes
  if (minuteOfHour % 15 === 0) {
    timeframes.push(...MEDIUM_TIMEFRAMES);
  }

  // Every hour (0 minutes), also process slow timeframes
  if (minuteOfHour === 0) {
    timeframes.push(...SLOW_TIMEFRAMES);
  }

  console.log(`[CandleAggregator] Processing timeframes: ${timeframes.join(', ')}`);
  return timeframes;
}

/**
 * Check if a specific date/time is during open market hours
 * Uses EST/EDT timezone (New York) to properly handle daylight saving time
 * Forex: Market closes Friday 5:00 PM EST and opens Sunday 5:00 PM EST
 * Crypto: Market is open 24/7/365
 */
function isMarketOpenAtTime(date: Date, symbol?: string): boolean {
  if (symbol && isCryptoSymbol(symbol)) {
    return true;
  }

  const estTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const fridayCloseTime = 17 * 60;
  const sundayOpenTime = 17 * 60;

  if (dayOfWeek === 6) {
    return false;
  }

  if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) {
    return false;
  }

  if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
    return false;
  }

  return true;
}

/**
 * CRITICAL FIX: Wick reconstruction DISABLED to preserve price data integrity
 * We NEVER artificially extend wicks beyond actual market prices
 * Only reconstruct completely flat candles (which should be extremely rare)
 */
async function reconstructCandleWicks(candle: CandleData): Promise<CandleData> {
  // DISABLED: Return original candle to preserve actual price data
  if (!ENABLE_WICK_RECONSTRUCTION) {
    return candle;
  }

  // Even if enabled, only reconstruct completely flat candles
  const isCompletelyFlat = candle.high === candle.low &&
                           candle.open === candle.close &&
                           candle.high === candle.open;

  if (!isCompletelyFlat) {
    return candle; // Preserve actual price data
  }

  try {
    // Fetch recent candles for ATR calculation
    const { data: recentCandles } = await supabase
      .from('forex_candles')
      .select('open, high, low, close')
      .eq('symbol', candle.symbol)
      .eq('timeframe', candle.timeframe)
      .order('open_time', { ascending: false })
      .limit(14);

    if (!recentCandles || recentCandles.length < 5) {
      return candle; // Not enough data for reconstruction
    }

    // Calculate ATR (Average True Range)
    let totalTR = 0;
    let totalUpperWick = 0;
    let totalLowerWick = 0;
    let validCandles = 0;

    for (let i = 0; i < recentCandles.length - 1; i++) {
      const curr = recentCandles[i];
      const prev = recentCandles[i + 1];

      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      totalTR += tr;

      const bodySize = Math.abs(curr.close - curr.open);
      if (bodySize > 0) {
        const upperWick = curr.high - Math.max(curr.open, curr.close);
        const lowerWick = Math.min(curr.open, curr.close) - curr.low;
        totalUpperWick += upperWick / bodySize;
        totalLowerWick += lowerWick / bodySize;
        validCandles++;
      }
    }

    const atr = totalTR / (recentCandles.length - 1);
    const avgUpperWickPercent = validCandles > 0 ? totalUpperWick / validCandles : 0.3;
    const avgLowerWickPercent = validCandles > 0 ? totalLowerWick / validCandles : 0.3;

    // ONLY reconstruct completely flat candles with minimal extension
    // Use conservative ATR percentage to avoid artificial volatility
    const wickSize = atr * 0.3; // Reduced from 0.5
    const mid = candle.open;

    console.warn(
      `[CandleAggregator] ⚠️ Reconstructing FLAT candle ${candle.symbol} ${candle.timeframe} ` +
      `at ${candle.open_time.toISOString()} - Original: ${candle.high}/${candle.low}, ` +
      `New: ${(mid + wickSize / 2).toFixed(5)}/${(mid - wickSize / 2).toFixed(5)}`
    );

    return {
      ...candle,
      high: mid + wickSize / 2,
      low: mid - wickSize / 2
    };
  } catch (error) {
    // If reconstruction fails, return original candle
    return candle;
  }
}

function calculateCandleFromPrices(
  prices: RealtimePrice[],
  symbol: string,
  timeframe: string,
  candleStartTime: Date
): CandleData | null {
  if (prices.length === 0) return null;

  // CCIP GOVERNANCE (2026-03-10): Require at least 2 ticks to form a valid candle.
  // A single tick would produce a flat candle (open=high=low=close) with no price movement.
  if (prices.length < 2) {
    console.log(`[CandleAggregator] Skipping ${symbol} ${timeframe} candle — only ${prices.length} tick (need 2+)`);
    return null;
  }

  const timeframeMinutes = TIMEFRAME_MINUTES[timeframe];
  const candleEndTime = new Date(candleStartTime.getTime() + timeframeMinutes * 60 * 1000);

  const midPrices = prices.map(p => (p.bid + p.ask) / 2);

  return {
    symbol,
    timeframe,
    open_time: candleStartTime,
    close_time: candleEndTime,
    open: midPrices[0],
    high: Math.max(...midPrices),
    low: Math.min(...midPrices),
    close: midPrices[midPrices.length - 1],
    volume: prices.length
  };
}

async function fetchRecentPrices(symbol: string, lookbackMinutes: number): Promise<RealtimePrice[]> {
  const cutoffTime = new Date(Date.now() - lookbackMinutes * 60 * 1000);

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('symbol, bid, ask, broker_time, created_at')
    .eq('symbol', symbol)
    .gte('created_at', cutoffTime.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`[CandleAggregator] Error fetching prices for ${symbol}:`, error.message);
    return [];
  }

  return data || [];
}

async function getLastCandleTime(symbol: string, timeframe: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('data_source', 'netlify_aggregator')
    .order('open_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[CandleAggregator] Error fetching last candle for ${symbol} ${timeframe}:`, error.message);
    return null;
  }

  return data ? new Date(data.open_time) : null;
}

async function saveCandleToDatabase(candle: CandleData): Promise<boolean> {
  try {
    // Apply wick reconstruction if needed
    const reconstructedCandle = await reconstructCandleWicks(candle);
    const qualityScore = candle.volume >= 3 ? 95 : 75; // Lower score for reconstructed candles

    const { error } = await supabase
      .from('forex_candles')
      .upsert({
        symbol: reconstructedCandle.symbol,
        timeframe: reconstructedCandle.timeframe,
        open_time: reconstructedCandle.open_time.toISOString(),
        close_time: reconstructedCandle.close_time.toISOString(),
        open: reconstructedCandle.open,
        high: reconstructedCandle.high,
        low: reconstructedCandle.low,
        close: reconstructedCandle.close,
        volume: reconstructedCandle.volume,
        tick_count: reconstructedCandle.volume,
        data_source: 'netlify_aggregator',
        quality_score: qualityScore
      }, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`[CandleAggregator] Database error for ${candle.symbol} ${candle.timeframe}:`, error.message);
      return false;
    }

    if (reconstructedCandle.high !== candle.high || reconstructedCandle.low !== candle.low) {
      console.log(`[CandleAggregator] 🔧 Reconstructed wicks for ${candle.symbol} ${candle.timeframe} (${candle.volume} ticks)`);
    }

    return true;
  } catch (error) {
    console.error(`[CandleAggregator] Unexpected error saving candle:`, error);
    return false;
  }
}

/**
 * OPTIMIZATION: Batch save multiple candles in a single DB transaction
 * BREAKTHROUGH: Now includes wick reconstruction for better quality
 */
async function saveCandlesBatch(candles: CandleData[]): Promise<number> {
  if (candles.length === 0) return 0;

  // CCIP GOVERNANCE (2026-03-10): Drop flat candles before any DB write.
  // A flat candle (open=high=low=close) from a single tick or stale price must never
  // overwrite a good candle that already exists in the database.
  const nonFlatCandles = candles.filter(c => !(c.open === c.high && c.high === c.low && c.low === c.close));
  if (nonFlatCandles.length !== candles.length) {
    console.log(`[CandleAggregator] Dropped ${candles.length - nonFlatCandles.length} flat candles before batch save`);
  }
  if (nonFlatCandles.length === 0) return 0;

  try {
    // Apply wick reconstruction to all candles
    const reconstructedCandles = await Promise.all(
      nonFlatCandles.map(candle => reconstructCandleWicks(candle))
    );

    let reconstructedCount = 0;
    const candleRecords = reconstructedCandles.map((candle, index) => {
      const original = nonFlatCandles[index];
      const wasReconstructed = candle.high !== original.high || candle.low !== original.low;
      if (wasReconstructed) reconstructedCount++;

      const qualityScore = candle.volume >= 3 ? 95 : 75;

      return {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        open_time: candle.open_time.toISOString(),
        close_time: candle.close_time.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        tick_count: candle.volume,
        data_source: 'netlify_aggregator',
        quality_score: qualityScore
      };
    });

    const { error } = await supabase
      .from('forex_candles')
      .upsert(candleRecords, {
        onConflict: 'symbol,timeframe,open_time',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`[CandleAggregator] Batch save error:`, error.message);
      return 0;
    }

    if (reconstructedCount > 0) {
      console.log(`[CandleAggregator] Reconstructed wicks for ${reconstructedCount}/${nonFlatCandles.length} candles`);
    }

    return nonFlatCandles.length;
  } catch (error) {
    console.error(`[CandleAggregator] Unexpected batch save error:`, error);
    return 0;
  }
}

// SQL-BASED AGGREGATION: More reliable than in-memory processing
async function aggregateCandleSQL(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date
): Promise<CandleData | null> {
  try {
    // Use SQL to calculate OHLC directly from realtime_prices
    const { data, error } = await supabase.rpc('aggregate_candle_from_prices', {
      p_symbol: symbol,
      p_start_time: startTime.toISOString(),
      p_end_time: endTime.toISOString()
    });

    if (error) {
      // If RPC function doesn't exist, return null (will fall back to in-memory)
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        console.log(`[CandleAggregator] SQL function not found, using fallback`);
        return null;
      }
      console.error(`[CandleAggregator] SQL aggregation error: ${error.message}`);
      return null;
    }

    if (!data || data.length === 0 || !data[0].price_count || data[0].price_count === 0) {
      return null;
    }

    const row = data[0];
    return {
      symbol,
      timeframe,
      open_time: startTime,
      close_time: endTime,
      open: row.first_price,
      high: row.high_price,
      low: row.low_price,
      close: row.last_price,
      volume: row.price_count
    };
  } catch (error) {
    // CRITICAL: Network errors (TypeError: fetch failed) should not crash the function
    // Fall back to in-memory aggregation silently
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('fetch failed') || errorMsg.includes('TypeError')) {
      console.log(`[CandleAggregator] SQL RPC connection issue, using fallback method`);
    } else {
      console.error(`[CandleAggregator] SQL aggregation error: ${errorMsg}`);
    }
    return null;
  }
}

async function aggregateFromM1Candles(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date
): Promise<CandleData | null> {
  try {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('open, high, low, close, open_time')
      .eq('symbol', symbol)
      .eq('timeframe', 'M1')
      .gte('open_time', startTime.toISOString())
      .lt('open_time', endTime.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      console.error(`[CandleAggregator] Error fetching M1 candles for aggregation:`, error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const open = data[0].open;
    const close = data[data.length - 1].close;
    const high = Math.max(...data.map(c => c.high));
    const low = Math.min(...data.map(c => c.low));

    return {
      symbol,
      timeframe,
      open_time: startTime,
      close_time: endTime,
      open,
      high,
      low,
      close,
      volume: data.length
    };
  } catch (error) {
    console.error(`[CandleAggregator] M1 aggregation unexpected error:`, error);
    return null;
  }
}

/**
 * BREAKTHROUGH: Generic aggregation from any lower timeframe
 * This creates a cascading quality hierarchy: M5 → H1 → H4 → D1
 */
async function aggregateFromLowerTimeframe(
  symbol: string,
  targetTimeframe: string,
  sourceTimeframe: string,
  startTime: Date,
  endTime: Date
): Promise<CandleData | null> {
  try {
    // Fetch source candles that fall within this target timeframe period
    const { data, error } = await supabase
      .from('forex_candles')
      .select('open, high, low, close, volume, open_time')
      .eq('symbol', symbol)
      .eq('timeframe', sourceTimeframe)
      .gte('open_time', startTime.toISOString())
      .lt('open_time', endTime.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      console.error(`[CandleAggregator] Error fetching ${sourceTimeframe} candles for ${targetTimeframe} aggregation:`, error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    // CCIP GOVERNANCE (2026-03-10): Filter out flat ghost candles before aggregation.
    // Flat candles (open=high=low=close) are artifacts from stale-price gap-fillers and must
    // not propagate upward through the timeframe hierarchy. Only candles with real price movement
    // are used as aggregation inputs.
    const validData = data.filter(c => !(c.open === c.high && c.high === c.low && c.low === c.close));

    if (validData.length === 0) {
      console.log(`[CandleAggregator] All ${sourceTimeframe} candles for ${symbol} ${targetTimeframe} are flat — skipping aggregation`);
      return null;
    }

    // Calculate expected source candles for this target timeframe
    const targetMinutes = TIMEFRAME_MINUTES[targetTimeframe];
    const sourceMinutes = TIMEFRAME_MINUTES[sourceTimeframe];
    const expectedCandles = targetMinutes / sourceMinutes;

    // Get quality threshold for this timeframe
    const qualityThreshold = QUALITY_THRESHOLDS[targetTimeframe] || 0.5;
    const minimumCandles = Math.ceil(expectedCandles * qualityThreshold);

    // Only create target candle if we have enough valid (non-flat) source candles
    if (validData.length < minimumCandles) {
      console.log(`[CandleAggregator] Insufficient valid ${sourceTimeframe} candles for ${symbol} ${targetTimeframe}: ${validData.length}/${expectedCandles} (need ${minimumCandles}+, ${data.length - validData.length} flat filtered)`);
      return null;
    }

    // Aggregate valid source candles into target timeframe
    // Take first open, last close, highest high, lowest low
    const open = validData[0].open;
    const close = validData[validData.length - 1].close;
    const high = Math.max(...validData.map(c => c.high));
    const low = Math.min(...validData.map(c => c.low));
    const totalVolume = validData.reduce((sum, c) => sum + (c.volume || 0), 0);

    const filteredMsg = data.length !== validData.length ? ` (${data.length - validData.length} flat filtered)` : '';
    console.log(`[CandleAggregator]   Aggregated ${validData.length} ${sourceTimeframe} candles into ${targetTimeframe} for ${symbol}${filteredMsg}`);

    return {
      symbol,
      timeframe: targetTimeframe,
      open_time: startTime,
      close_time: endTime,
      open,
      high,
      low,
      close,
      volume: totalVolume
    };
  } catch (error) {
    console.error(`[CandleAggregator] ${sourceTimeframe} → ${targetTimeframe} aggregation error:`, error);
    return null;
  }
}

/**
 * LEGACY: Kept for backwards compatibility
 * Now calls the generic aggregateFromLowerTimeframe function
 */
async function aggregateFromM5Candles(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date
): Promise<CandleData | null> {
  return aggregateFromLowerTimeframe(symbol, timeframe, 'M5', startTime, endTime);
}

/**
 * DEAD-MAN SWITCH: Fetches Kraken OHLC candles and saves them directly to the DB.
 * Triggered when the tick feed has been silent (no ticks → no M1 candles for > 10 min).
 * Uses `data_source = 'kraken_backfill'` and `quality_score = 90`.
 * Only runs for crypto symbols (BTCUSD, ETHUSD).
 */
async function backfillFromKrakenOHLC(
  symbol: string,
  timeframe: string,
  sinceDate: Date
): Promise<number> {
  try {
    const sinceSec = Math.floor(sinceDate.getTime() / 1000);
    const candles = await fetchKrakenOHLC(symbol, timeframe, sinceSec);

    if (candles.length === 0) {
      console.log(`[CandleAggregator] [KrakenBackfill] No OHLC candles returned for ${symbol} ${timeframe}`);
      return 0;
    }

    const now = new Date();
    const intervalMs = TIMEFRAME_MINUTES[timeframe] * 60 * 1000;

    // Only save completed (closed) candles — exclude the currently forming one
    const completedCandles = candles.filter(c => c.closeTime <= now);

    if (completedCandles.length === 0) {
      console.log(`[CandleAggregator] [KrakenBackfill] All candles are still forming for ${symbol} ${timeframe}`);
      return 0;
    }

    // Check which timestamps already exist so we don't overwrite higher-quality data
    const existingCheck = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', sinceDate.toISOString());

    const existingTimes = new Set(
      (existingCheck.data || []).map(r => new Date(r.open_time).getTime())
    );

    const newCandles = completedCandles.filter(c => !existingTimes.has(c.openTime.getTime()));

    if (newCandles.length === 0) {
      console.log(`[CandleAggregator] [KrakenBackfill] All ${completedCandles.length} ${symbol} ${timeframe} candles already exist`);
      return 0;
    }

    const records = newCandles.map(c => ({
      symbol,
      timeframe,
      open_time: c.openTime.toISOString(),
      close_time: c.closeTime.toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      tick_count: c.volume,
      data_source: 'kraken_backfill',
      quality_score: 90,
    }));

    const { error } = await supabase
      .from('forex_candles')
      .upsert(records, { onConflict: 'symbol,timeframe,open_time', ignoreDuplicates: false });

    if (error) {
      console.error(`[CandleAggregator] [KrakenBackfill] DB error for ${symbol} ${timeframe}:`, error.message);
      return 0;
    }

    console.log(`[CandleAggregator] [KrakenBackfill] Saved ${newCandles.length} ${symbol} ${timeframe} candles from Kraken OHLC`);
    return newCandles.length;
  } catch (err) {
    console.error(`[CandleAggregator] [KrakenBackfill] Error for ${symbol} ${timeframe}:`, err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * DEAD-MAN SWITCH: Detect a gap in M1 crypto candles and trigger Kraken OHLC backfill.
 * If the last netlify_aggregator M1 candle is > 10 minutes old and the symbol is crypto,
 * we fetch OHLC from Kraken for all fast timeframes to fill the gap.
 * Returns total candles saved across all filled timeframes.
 */
async function runKrakenDeadManSwitch(
  symbol: string,
  lastM1CandleTime: Date | null
): Promise<number> {
  const now = new Date();
  const gapMinutes = lastM1CandleTime
    ? (now.getTime() - lastM1CandleTime.getTime()) / 60000
    : Infinity;

  if (gapMinutes < 10) return 0;

  const gapDesc = lastM1CandleTime
    ? `${Math.round(gapMinutes)}min gap since ${lastM1CandleTime.toISOString()}`
    : 'no M1 candles found';

  console.log(`[CandleAggregator] [DeadManSwitch] ${symbol}: ${gapDesc} — triggering Kraken OHLC backfill`);

  const sinceDate = lastM1CandleTime
    ? new Date(lastM1CandleTime.getTime() - 60 * 1000)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let totalSaved = 0;
  for (const tf of FAST_TIMEFRAMES) {
    const saved = await backfillFromKrakenOHLC(symbol, tf, sinceDate);
    totalSaved += saved;
  }

  if (totalSaved > 0) {
    console.log(`[CandleAggregator] [DeadManSwitch] ${symbol}: Filled ${totalSaved} candles from Kraken OHLC`);
  }

  return totalSaved;
}

async function aggregateCandlesForSymbol(
  symbol: string,
  timeframesToProcess: string[],
  startTime: number,
  maxDurationMs: number = 12000 // 12 seconds per symbol - INCREASED for reliable completion
): Promise<{ candlesCreated: number; timedOut: boolean }> {
  const symbolStartTime = Date.now();
  console.log(`[CandleAggregator]   📊 Starting aggregation for ${symbol}...`);

  // ADAPTIVE LOOKBACK: Check the actual last candle time from the DB (no time filter)
  // so that after a restart or long gap, we can compute the correct fetch window.
  // realtime_prices is retained for 24 hours, so cap at 23 hours (1380 minutes).
  const MAX_REALTIME_RETENTION_MINUTES = 1380;
  const lastM1CandleTime = await getLastCandleTime(symbol, 'M1');
  const now = new Date();

  let lookbackMinutes: number;
  if (lastM1CandleTime) {
    const gapMinutes = Math.ceil((now.getTime() - lastM1CandleTime.getTime()) / 60000);
    // Add 2 extra minutes buffer, cap at realtime_prices retention window
    lookbackMinutes = Math.min(gapMinutes + 2, MAX_REALTIME_RETENTION_MINUTES);
    console.log(`[CandleAggregator]   🕐 ${symbol}: Last M1 candle was ${gapMinutes}min ago — using ${lookbackMinutes}min lookback`);
  } else {
    lookbackMinutes = MAX_REALTIME_RETENTION_MINUTES;
    console.log(`[CandleAggregator]   🕐 ${symbol}: No prior M1 candle found — using max ${lookbackMinutes}min lookback`);
  }

  const prices = await fetchRecentPrices(symbol, lookbackMinutes);

  if (prices.length === 0) {
    console.log(`[CandleAggregator]   ⚠️ ${symbol}: No prices found in last ${lookbackMinutes} minutes`);

    // DEAD-MAN SWITCH: For crypto symbols, attempt Kraken OHLC backfill when tick feed is silent
    if (isCryptoSymbol(symbol)) {
      const krakenSaved = await runKrakenDeadManSwitch(symbol, lastM1CandleTime);
      if (krakenSaved > 0) {
        console.log(`[CandleAggregator]   [DeadManSwitch] ${symbol}: Kraken backfill saved ${krakenSaved} candles`);
        return { candlesCreated: krakenSaved, timedOut: false };
      }
    }

    return { candlesCreated: 0, timedOut: false };
  }

  // DEAD-MAN SWITCH: Even when ticks exist, check for a gap on crypto symbols
  // (covers partial feed restoration where old ticks exist but recent ones are missing)
  if (isCryptoSymbol(symbol)) {
    const krakenSaved = await runKrakenDeadManSwitch(symbol, lastM1CandleTime);
    if (krakenSaved > 0) {
      console.log(`[CandleAggregator]   [DeadManSwitch] ${symbol}: Gap-fill saved ${krakenSaved} candles alongside tick aggregation`);
    }
  }

  const firstPriceTime = new Date(prices[0].created_at);
  const lastPriceTime = new Date(prices[prices.length - 1].created_at);
  console.log(`[CandleAggregator]   📈 ${symbol}: Fetched ${prices.length} prices from ${firstPriceTime.toISOString()} to ${lastPriceTime.toISOString()}`);

  let candlesCreated = 0;
  const candlesToSave: CandleData[] = [];

  for (const timeframe of timeframesToProcess) {
    const timeframeStartTime = Date.now();

    // TIMEOUT PROTECTION: Check if we're approaching the per-symbol limit
    const elapsedMs = Date.now() - symbolStartTime; // FIXED: Use symbolStartTime instead of global startTime
    if (elapsedMs > maxDurationMs) {
      console.log(`[CandleAggregator] ⚠️ Approaching timeout (${elapsedMs}ms), stopping ${symbol} at ${timeframe}`);
      return { candlesCreated, timedOut: true };
    }

    console.log(`[CandleAggregator]     🔧 Processing ${symbol} ${timeframe}...`);
    const timeframeMinutes = TIMEFRAME_MINUTES[timeframe];

    // OPTIMIZATION: Fetch ALL existing candles for this time range in ONE query
    // Use the same adaptive lookback window so we catch all candles that may need updating
    const lookbackTime = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
    const { data: existingCandles } = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', lookbackTime.toISOString())
      .order('open_time', { ascending: true });

    // Create a Set of existing candle timestamps for O(1) lookup
    const existingCandleTimes = new Set(
      (existingCandles || []).map(c => new Date(c.open_time).getTime())
    );

    console.log(`[CandleAggregator]       📋 Found ${existingCandleTimes.size} existing ${timeframe} candles`);

    // INTELLIGENT LOOKBACK: Check last saved candle and fill from there
    const currentCandleStart = roundTimeToCandle(now, timeframeMinutes);
    const previousCandleStart = new Date(currentCandleStart.getTime() - timeframeMinutes * 60 * 1000);

    // Get the last saved candle — use DB result from Set (window-scoped), or fall back to
    // getLastCandleTime result (M1 already fetched above; for other TFs get from existingCandles).
    // If nothing exists in the lookback window, default to the start of available tick data.
    const lastSavedInWindow = existingCandleTimes.size > 0
      ? new Date(Math.max(...Array.from(existingCandleTimes)))
      : null;

    // The earliest candle we can possibly build is bounded by oldest available tick
    const oldestTickTime = firstPriceTime;
    const oldestTickCandleStart = roundTimeToCandle(oldestTickTime, timeframeMinutes);

    // Start from one period after last saved candle, or oldest available tick (whichever is later)
    const startFrom = lastSavedInWindow
      ? new Date(lastSavedInWindow.getTime() + timeframeMinutes * 60 * 1000)
      : oldestTickCandleStart;
    const endAt = previousCandleStart;

    // BACKFILL LOOP: Create all missing candles
    let currentCandleToCreate = startFrom;
    let candlesCreatedForTimeframe = 0;

    while (currentCandleToCreate <= endAt) {
      // TIMEOUT PROTECTION: Check inside the loop to prevent hanging
      const loopElapsedMs = Date.now() - symbolStartTime; // FIXED: Use symbolStartTime instead of global startTime
      if (loopElapsedMs > maxDurationMs) {
        console.log(`[CandleAggregator]       ⚠️ Timeout in while loop (${loopElapsedMs}ms), stopping ${symbol} ${timeframe}`);
        return { candlesCreated, timedOut: true };
      }

      // MAX CANDLES PROTECTION: Prevent creating too many candles per timeframe
      if (candlesCreatedForTimeframe >= MAX_CANDLES_PER_TIMEFRAME) {
        console.log(`[CandleAggregator]       ⚠️ Max candles reached (${MAX_CANDLES_PER_TIMEFRAME}) for ${symbol} ${timeframe}`);
        break;
      }

      const candleEndTime = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);

      // Skip if candle period is not complete yet (with 30 second safety buffer for faster completion)
      const bufferMs = 30 * 1000; // REDUCED from 60s to 30s for faster candle finalization
      if (candleEndTime > new Date(now.getTime() - bufferMs)) {
        break;
      }

      // OPTIMIZATION: Check if candle already exists (O(1) lookup in Set)
      if (existingCandleTimes.has(currentCandleToCreate.getTime())) {
        // Candle already exists, skip it
        currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
        continue;
      }

      let candle: CandleData | null = null;

      // CASCADING QUALITY HIERARCHY: Use optimal aggregation strategy based on timeframe
      // M1, M5: Build from tick data (foundation layer)
      // M15, M30, H1: Aggregate from M5 candles (inherits M5's quality)
      // H4: Aggregate from H1 candles (inherits M5's quality via H1)
      // D1: Aggregate from H4 candles (inherits M5's quality via H1 → H4)

      const sourceTimeframe = AGGREGATION_HIERARCHY[timeframe];

      if (sourceTimeframe) {
        // QUALITY PATH: Aggregate from lower timeframe for cascading quality
        candle = await aggregateFromLowerTimeframe(
          symbol,
          timeframe,
          sourceTimeframe,
          currentCandleToCreate,
          candleEndTime
        );

        // FALLBACK: If lower timeframe aggregation fails, try tick data
        if (!candle && (timeframe === 'M1' || timeframe === 'M5')) {
          const candlePrices = prices.filter(p => {
            const priceTime = new Date(p.created_at);
            return priceTime >= currentCandleToCreate && priceTime < candleEndTime;
          });

          if (candlePrices.length > 0) {
            candle = calculateCandleFromPrices(candlePrices, symbol, timeframe, currentCandleToCreate);
          }
        }
      } else {
        // FOUNDATION PATH: Build M1 and M5 from tick data
        const candlePrices = prices.filter(p => {
          const priceTime = new Date(p.created_at);
          return priceTime >= currentCandleToCreate && priceTime < candleEndTime;
        });

        if (candlePrices.length > 0) {
          candle = calculateCandleFromPrices(candlePrices, symbol, timeframe, currentCandleToCreate);
        }
      }

      if (candle) {
        // CRITICAL FIX: ALWAYS save candles to maintain historical continuity
        // The market hours filter was causing M1/M5 candles to disappear every weekend
        // We MUST save ALL candles (including weekend) to preserve chart history
        // Weekend candles can be filtered during DISPLAY if needed, but must exist in DB

        const wasMarketOpen = isMarketOpenAtTime(candle.open_time, symbol);
        if (!wasMarketOpen) {
          console.log(`[CandleAggregator]       💾 Including weekend/closed candle for ${symbol} ${timeframe} at ${candle.open_time.toISOString()} (preserves history)`);
        }

        // OPTIMIZATION: Collect candles for batch insert
        candlesToSave.push(candle);
        candlesCreatedForTimeframe++;
      }

      // Move to next candle period
      currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
    }

    // Performance logging for timeframe
    const timeframeDuration = Date.now() - timeframeStartTime;
    console.log(`[CandleAggregator]       ✅ ${symbol} ${timeframe}: ${candlesCreatedForTimeframe} candles queued (${timeframeDuration}ms)`);
  }

  // OPTIMIZATION: Batch save all candles at once (much faster than individual inserts)
  if (candlesToSave.length > 0) {
    const saveStartTime = Date.now();
    console.log(`[CandleAggregator]   💾 ${symbol}: Saving ${candlesToSave.length} candles to database...`);
    const saved = await saveCandlesBatch(candlesToSave);
    const saveDuration = Date.now() - saveStartTime;
    candlesCreated = saved;
    console.log(`[CandleAggregator]   ✅ ${symbol}: Created ${saved} candles across ${timeframesToProcess.length} timeframes (save: ${saveDuration}ms)`);

    if (saved > 0) {
      const seenPairs = new Map<string, Date>();
      for (const c of candlesToSave) {
        const key = `${c.symbol}:${c.timeframe}`;
        const existing = seenPairs.get(key);
        if (!existing || c.open_time > existing) {
          seenPairs.set(key, c.open_time);
        }
      }
      const invalidationRows = Array.from(seenPairs.entries()).map(([key, latestOpenTime]) => {
        const [sym, tf] = key.split(':');
        return { symbol: sym, timeframe: tf, candle_time: latestOpenTime.toISOString(), event_time: new Date().toISOString() };
      });
      supabase.from('candle_cache_invalidation_events').insert(invalidationRows).then(({ error }) => {
        if (error) console.warn(`[CandleAggregator] Cache invalidation insert failed for ${symbol}:`, error.message);
      });
    }
  } else {
    console.log(`[CandleAggregator]   ℹ️ ${symbol}: No new candles to create`);
  }

  const symbolTotalDuration = Date.now() - symbolStartTime;
  console.log(`[CandleAggregator]   ⏱️ ${symbol} completed in ${symbolTotalDuration}ms`);

  return { candlesCreated, timedOut: false };
}

export const handler: Handler = async (event, context) => {
  console.log('[CandleAggregator] Starting continuous candle aggregation...');
  const startTime = Date.now();

  try {
    // SMART SCHEDULING: Check market hours and filter symbols accordingly
    const now = new Date();
    const isForexMarketOpen = isMarketOpenAtTime(now);

    // Filter symbols based on market hours
    let symbolsToProcess = ACTIVE_SYMBOLS;
    if (!isForexMarketOpen) {
      // Forex market closed - only process crypto symbols
      symbolsToProcess = CRYPTO_SYMBOLS;
      console.log(`[CandleAggregator] 🌙 Forex market closed - processing only crypto: ${symbolsToProcess.join(', ')}`);
    } else {
      console.log(`[CandleAggregator] 🌅 Forex market open - processing all symbols`);
    }

    // Early exit if no symbols to process
    if (symbolsToProcess.length === 0) {
      console.log('[CandleAggregator] ℹ️ No symbols to process at this time');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          candlesCreated: 0,
          symbolsProcessed: 0,
          message: 'No symbols to process - market closed',
          timestamp: new Date().toISOString()
        })
      };
    }

    // OPTIMIZATION: Determine which timeframes to process this run
    const timeframesToProcess = getTimeframesToProcess();

    // OPTIMIZATION: Process symbols sequentially with timeout protection
    // This is more reliable than Promise.allSettled for timeout detection
    let totalCandlesCreated = 0;
    let symbolsProcessed = 0;
    let symbolsTimedOut = 0;
    const symbolResults: Record<string, { candles: number; timedOut: boolean; error?: string }> = {};

    console.log(`[CandleAggregator] Starting loop for ${symbolsToProcess.length} symbols: ${symbolsToProcess.join(', ')}`);

    for (const symbol of symbolsToProcess) {
      console.log(`[CandleAggregator] ▶️ Processing symbol ${symbolsProcessed + 1}/${symbolsToProcess.length}: ${symbol}`);

      // Check if we're approaching global function timeout (9 symbols * 12s = 108s max)
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > 90000) { // 90 seconds total (safety buffer under 120s Netlify timeout)
        console.log(`[CandleAggregator] ⚠️ Approaching function timeout (${elapsedMs}ms), stopping before ${symbol}`);
        symbolResults[symbol] = { candles: 0, timedOut: false, error: 'Function timeout - not processed' };
        break;
      }

      try {
        const result = await aggregateCandlesForSymbol(symbol, timeframesToProcess, startTime);
        totalCandlesCreated += result.candlesCreated;
        symbolsProcessed++;

        if (result.timedOut) {
          symbolsTimedOut++;
          symbolResults[symbol] = { candles: result.candlesCreated, timedOut: true };
          console.log(`[CandleAggregator]   ⏱️ ${symbol} timed out after creating ${result.candlesCreated} candles`);
        } else {
          symbolResults[symbol] = { candles: result.candlesCreated, timedOut: false };
          console.log(`[CandleAggregator]   ✅ ${symbol} completed: ${result.candlesCreated} candles created`);
        }
      } catch (error) {
        console.error(`[CandleAggregator] ❌ Error processing ${symbol}:`, error);
        symbolResults[symbol] = {
          candles: 0,
          timedOut: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        // Continue processing other symbols even if one fails
        symbolsProcessed++;
      }
    }

    console.log(`[CandleAggregator] Loop completed. Processed ${symbolsProcessed}/${symbolsToProcess.length} symbols`);

    const duration = Date.now() - startTime;
    console.log(`[CandleAggregator] ✅ Completed in ${duration}ms: ${totalCandlesCreated} candles created`);
    console.log(`[CandleAggregator] Symbols: ${symbolsProcessed}/${symbolsToProcess.length} processed, ${symbolsTimedOut} timed out`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        candlesCreated: totalCandlesCreated,
        symbolsProcessed,
        symbolsTimedOut,
        totalSymbols: symbolsToProcess.length,
        isForexMarketOpen,
        timeframesProcessed: timeframesToProcess,
        durationMs: duration,
        symbolResults,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('[CandleAggregator] Unexpected error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
