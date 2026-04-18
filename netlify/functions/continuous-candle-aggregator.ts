/**
 * CCIP-CANDLE-SSOT-RESTORE-20260413
 *
 * SOLE AUTHORITY: Netlify continuous-candle-aggregator
 *
 * Data sources (in priority order):
 *   1. PRIMARY  — realtime_prices table (broker tick data via hybrid-price-collector)
 *   2. FALLBACK — MetaAPI historical-market-data API (dead-man switch, gap > 10 min)
 *
 * Removed sources (do not restore):
 *   - Finnhub  — unreliable, returned wrong/identical data for all pairs
 *   - Kraken   — crypto-only, redundant now that MetaAPI covers BTCUSD/ETHUSD
 *   - All other third-party APIs
 *
 * Governance rules:
 *   - This function is scheduled via netlify.toml every 2 minutes
 *   - The Supabase aggregate-candles edge function is TOMBSTONED (returns 410)
 *   - No other function may write to forex_candles as a primary aggregator
 *   - data_source must be 'netlify_aggregator' (tick-built) or 'metaapi_deadman' (gap-fill)
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const supabase = getSupabaseAdmin();

const FOREX_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'NAS100', 'SPX500'];
const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'];
const ACTIVE_SYMBOLS = [...FOREX_SYMBOLS, ...CRYPTO_SYMBOLS];

function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_SYMBOLS.includes(symbol.toUpperCase());
}

const FAST_TIMEFRAMES = ['M1', 'M5', 'M15'];
const MEDIUM_TIMEFRAMES = ['M30', 'H1'];
const SLOW_TIMEFRAMES = ['H4', 'D1'];
const ALL_TIMEFRAMES = [...FAST_TIMEFRAMES, ...MEDIUM_TIMEFRAMES, ...SLOW_TIMEFRAMES];

const MAX_CANDLES_PER_TIMEFRAME = 720;
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

const METAAPI_TIMEFRAME_MAP: Record<string, string> = {
  'M1': '1m',
  'M5': '5m',
  'M15': '15m',
  'M30': '30m',
  'H1': '1h',
  'H4': '4h',
  'D1': '1d',
};

const AGGREGATION_HIERARCHY: Record<string, string> = {
  'M5': 'M1',
  'M15': 'M5',
  'M30': 'M5',
  'H1': 'M5',
  'H4': 'H1',
  'D1': 'H4'
};

const QUALITY_THRESHOLDS: Record<string, number> = {
  'M5': 0.60,
  'M15': 0.66,
  'M30': 0.50,
  'H1': 0.50,
  'H4': 0.50,
  'D1': 0.50
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

function getTimeframesToProcess(): string[] {
  const now = new Date();
  const minuteOfHour = now.getMinutes();

  let timeframes = [...FAST_TIMEFRAMES];

  if (minuteOfHour % 15 === 0) {
    timeframes.push(...MEDIUM_TIMEFRAMES);
  }

  if (minuteOfHour === 0) {
    timeframes.push(...SLOW_TIMEFRAMES);
  }

  console.log(`[CandleAggregator] Processing timeframes: ${timeframes.join(', ')}`);
  return timeframes;
}

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

  if (dayOfWeek === 6) return false;
  if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) return false;
  if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) return false;

  return true;
}

function calculateCandleFromPrices(
  prices: RealtimePrice[],
  symbol: string,
  timeframe: string,
  candleStartTime: Date
): CandleData | null {
  if (prices.length < 2) {
    console.log(`[CandleAggregator] Skipping ${symbol} ${timeframe} — only ${prices.length} tick (need 2+)`);
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
    .gte('broker_time', cutoffTime.toISOString())
    .order('broker_time', { ascending: true });

  if (error) {
    console.error(`[CandleAggregator] Error fetching prices for ${symbol}:`, error.message);
    return [];
  }

  return data || [];
}

async function fetchLatestBrokerTime(symbol: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from('realtime_prices')
    .select('broker_time')
    .eq('symbol', symbol)
    .order('broker_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return new Date(data.broker_time);
}

async function getLastCandleTime(symbol: string, timeframe: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('open_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[CandleAggregator] Error fetching last candle for ${symbol} ${timeframe}:`, error.message);
    return null;
  }

  return data ? new Date(data.open_time) : null;
}

async function saveCandlesBatch(candles: CandleData[], dataSource: string = 'netlify_aggregator'): Promise<number> {
  if (candles.length === 0) return 0;

  const nonFlatCandles = candles.filter(c => !(c.open === c.high && c.high === c.low && c.low === c.close));
  if (nonFlatCandles.length !== candles.length) {
    console.log(`[CandleAggregator] Dropped ${candles.length - nonFlatCandles.length} flat candles before batch save`);
  }
  if (nonFlatCandles.length === 0) return 0;

  try {
    const candleRecords = nonFlatCandles.map(candle => ({
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
      data_source: dataSource,
      quality_score: candle.volume >= 3 ? 95 : 75
    }));

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

    return nonFlatCandles.length;
  } catch (error) {
    console.error(`[CandleAggregator] Unexpected batch save error:`, error);
    return 0;
  }
}

async function aggregateFromLowerTimeframe(
  symbol: string,
  targetTimeframe: string,
  sourceTimeframe: string,
  startTime: Date,
  endTime: Date
): Promise<CandleData | null> {
  try {
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

    if (!data || data.length === 0) return null;

    const validData = data.filter(c => !(c.open === c.high && c.high === c.low && c.low === c.close));
    if (validData.length === 0) {
      console.log(`[CandleAggregator] All ${sourceTimeframe} candles for ${symbol} ${targetTimeframe} are flat — skipping`);
      return null;
    }

    const targetMinutes = TIMEFRAME_MINUTES[targetTimeframe];
    const sourceMinutes = TIMEFRAME_MINUTES[sourceTimeframe];
    const expectedCandles = targetMinutes / sourceMinutes;
    const qualityThreshold = QUALITY_THRESHOLDS[targetTimeframe] || 0.5;
    const minimumCandles = Math.ceil(expectedCandles * qualityThreshold);

    if (validData.length < minimumCandles) {
      console.log(`[CandleAggregator] Insufficient ${sourceTimeframe} candles for ${symbol} ${targetTimeframe}: ${validData.length}/${expectedCandles} (need ${minimumCandles}+)`);
      return null;
    }

    const open = validData[0].open;
    const close = validData[validData.length - 1].close;
    const high = Math.max(...validData.map(c => c.high));
    const low = Math.min(...validData.map(c => c.low));
    const totalVolume = validData.reduce((sum, c) => sum + (c.volume || 0), 0);

    console.log(`[CandleAggregator]   Aggregated ${validData.length} ${sourceTimeframe} into ${targetTimeframe} for ${symbol}`);

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
    console.error(`[CandleAggregator] ${sourceTimeframe} to ${targetTimeframe} aggregation error:`, error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEAD-MAN SWITCH: MetaAPI gap-fill
// Authority: MetaAPI is the SOLE gap-fill source for ALL symbols (forex + crypto).
// Triggered when the last M1 candle is > 10 minutes old.
// Uses broker historical data — same source as the live tick feed.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchMetaApiCandles(
  symbol: string,
  timeframe: string,
  startTime: Date
): Promise<CandleData[]> {
  const metaapiToken = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'london';

  if (!metaapiToken || !accountId) {
    console.log(`[CandleAggregator] [MetaApiDeadMan] METAAPI_TOKEN or METAAPI_ACCOUNT_ID not configured`);
    return [];
  }

  const apiTimeframe = METAAPI_TIMEFRAME_MAP[timeframe];
  if (!apiTimeframe) {
    console.log(`[CandleAggregator] [MetaApiDeadMan] No MetaAPI timeframe mapping for ${timeframe}`);
    return [];
  }

  const url = `https://mt-market-data-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${apiTimeframe}/candles?startTime=${startTime.toISOString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': metaapiToken,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[CandleAggregator] [MetaApiDeadMan] MetaAPI error ${response.status} for ${symbol} ${timeframe}: ${text.slice(0, 200)}`);
      return [];
    }

    const raw = await response.json();
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const timeframeMinutes = TIMEFRAME_MINUTES[timeframe];
    const now = new Date();

    return raw
      .map((c: any) => {
        const openTime = new Date(c.time);
        const closeTime = new Date(openTime.getTime() + timeframeMinutes * 60 * 1000);
        return {
          symbol,
          timeframe,
          open_time: openTime,
          close_time: closeTime,
          open: parseFloat(String(c.open)),
          high: parseFloat(String(c.high)),
          low: parseFloat(String(c.low)),
          close: parseFloat(String(c.close)),
          volume: parseFloat(String(c.tickVolume || c.volume || 0)),
        } as CandleData;
      })
      .filter(c =>
        c.open > 0 &&
        c.high >= c.low &&
        c.high > 0 &&
        c.close_time <= now
      );
  } catch (err) {
    console.error(`[CandleAggregator] [MetaApiDeadMan] Fetch error for ${symbol} ${timeframe}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WICK CORRECTION: MetaAPI broker OHLC widens wicks on sparse-tick candles
// Triggered for completed M5 candles saved with fewer than MIN_TICKS_FOR_FULL_WICK
// ticks. Uses the ON CONFLICT GREATEST/LEAST upsert to only ever widen, never narrow.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_TICKS_FOR_FULL_WICK = 20;
const WICK_CORRECTION_LOOKBACK_MINUTES = 30;

async function correctSparseCandleWicks(symbol: string): Promise<number> {
  const metaapiToken = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  if (!metaapiToken || !accountId) return 0;

  const apiTimeframe = METAAPI_TIMEFRAME_MAP['M5'];
  if (!apiTimeframe) return 0;

  const lookbackTime = new Date(Date.now() - WICK_CORRECTION_LOOKBACK_MINUTES * 60 * 1000);

  const { data: sparseCandles, error } = await supabase
    .from('forex_candles')
    .select('open_time, open, high, low, close, tick_count')
    .eq('symbol', symbol)
    .eq('timeframe', 'M5')
    .gte('open_time', lookbackTime.toISOString())
    .lt('tick_count', MIN_TICKS_FOR_FULL_WICK)
    .order('open_time', { ascending: true });

  if (error || !sparseCandles || sparseCandles.length === 0) return 0;

  const oldestSparse = new Date(sparseCandles[0].open_time);
  const brokerCandles = await fetchMetaApiCandles(symbol, 'M5', oldestSparse);

  if (brokerCandles.length === 0) return 0;

  const brokerMap = new Map<number, CandleData>();
  for (const bc of brokerCandles) {
    brokerMap.set(new Date(bc.open_time).getTime(), bc);
  }

  const corrections: Array<{
    symbol: string;
    timeframe: string;
    open_time: string;
    close_time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    tick_count: number;
    data_source: string;
    quality_score: number;
  }> = [];

  for (const sparse of sparseCandles) {
    const sparseTime = new Date(sparse.open_time).getTime();
    const broker = brokerMap.get(sparseTime);
    if (!broker) continue;

    const correctedHigh = Math.max(Number(sparse.high), Number(broker.high));
    const correctedLow = Math.min(Number(sparse.low), Number(broker.low));

    if (correctedHigh === Number(sparse.high) && correctedLow === Number(sparse.low)) continue;

    const closeTime = new Date(sparseTime + 5 * 60 * 1000);
    corrections.push({
      symbol,
      timeframe: 'M5',
      open_time: new Date(sparse.open_time).toISOString(),
      close_time: closeTime.toISOString(),
      open: Number(sparse.open),
      high: correctedHigh,
      low: correctedLow,
      close: Number(sparse.close),
      volume: Number(broker.volume) || Number((sparse as any).tick_count) || 0,
      tick_count: MIN_TICKS_FOR_FULL_WICK,
      data_source: 'metaapi_wick_correction',
      quality_score: 95
    });
  }

  if (corrections.length === 0) return 0;

  const { error: upsertError } = await supabase
    .from('forex_candles')
    .upsert(corrections, { onConflict: 'symbol,timeframe,open_time', ignoreDuplicates: false });

  if (upsertError) {
    console.error(`[CandleAggregator] Wick correction upsert error for ${symbol}:`, upsertError.message);
    return 0;
  }

  console.log(`[CandleAggregator]   ${symbol}: Corrected wicks on ${corrections.length} sparse M5 candles via MetaAPI`);
  return corrections.length;
}

async function runMetaApiDeadManSwitch(
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

  console.log(`[CandleAggregator] [MetaApiDeadMan] ${symbol}: ${gapDesc} — triggering MetaAPI backfill`);

  const sinceDate = lastM1CandleTime
    ? new Date(lastM1CandleTime.getTime() - 60 * 1000)
    : new Date(now.getTime() - 6 * 60 * 60 * 1000);

  const timeframesToBackfill = gapMinutes >= 480
    ? [...FAST_TIMEFRAMES, ...MEDIUM_TIMEFRAMES]
    : FAST_TIMEFRAMES;

  let totalSaved = 0;

  for (const tf of timeframesToBackfill) {
    const candles = await fetchMetaApiCandles(symbol, tf, sinceDate);

    if (candles.length === 0) {
      console.log(`[CandleAggregator] [MetaApiDeadMan] No data returned for ${symbol} ${tf}`);
      continue;
    }

    const existingCheck = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', symbol)
      .eq('timeframe', tf)
      .gte('open_time', sinceDate.toISOString());

    const existingTimes = new Set(
      (existingCheck.data || []).map(r => new Date(r.open_time).getTime())
    );

    const newCandles = candles.filter(c => !existingTimes.has(c.open_time.getTime()));

    if (newCandles.length === 0) {
      console.log(`[CandleAggregator] [MetaApiDeadMan] All ${symbol} ${tf} candles already exist`);
      continue;
    }

    const saved = await saveCandlesBatch(newCandles, 'metaapi_deadman');
    totalSaved += saved;

    if (saved > 0) {
      console.log(`[CandleAggregator] [MetaApiDeadMan] Saved ${saved} ${symbol} ${tf} candles from MetaAPI`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  if (totalSaved > 0) {
    console.log(`[CandleAggregator] [MetaApiDeadMan] ${symbol}: Gap-fill complete — ${totalSaved} candles saved`);
  } else {
    console.log(`[CandleAggregator] [MetaApiDeadMan] ${symbol}: MetaAPI returned no new candles (gap: ${Math.round(gapMinutes)}min)`);
  }

  return totalSaved;
}

// ─────────────────────────────────────────────────────────────────────────────

async function aggregateCandlesForSymbol(
  symbol: string,
  timeframesToProcess: string[],
  maxDurationMs: number = 12000
): Promise<{ candlesCreated: number; timedOut: boolean }> {
  const symbolStartTime = Date.now();
  console.log(`[CandleAggregator]   Starting aggregation for ${symbol}...`);

  const MAX_REALTIME_RETENTION_MINUTES = 1380;
  const lastM1CandleTime = await getLastCandleTime(symbol, 'M1');
  const now = new Date();

  // BROKER CLOCK SKEW FIX: For forex pairs the broker sends broker_time at UTC+3 (EET).
  // open_time in forex_candles is stored using broker_time as the candle boundary, meaning
  // candle open_times are ~3 hours ahead of Date.now() (UTC). If we compute
  // gapMinutes = (Date.now() - lastM1CandleTime) the result is negative, making
  // lookbackMinutes negative, which sets the cutoffTime in the FUTURE and returns zero ticks.
  // Fix: probe the latest broker_time first to determine effectiveNow, then compute
  // gapMinutes against effectiveNow so both sides are in the same clock domain.
  const latestBrokerTime = isCryptoSymbol(symbol) ? null : await fetchLatestBrokerTime(symbol);
  const effectiveNowForLookback = (!isCryptoSymbol(symbol) && latestBrokerTime) ? latestBrokerTime : now;

  let lookbackMinutes: number;
  if (lastM1CandleTime) {
    const gapMinutes = Math.ceil((effectiveNowForLookback.getTime() - lastM1CandleTime.getTime()) / 60000);
    if (gapMinutes <= 0) {
      console.log(`[CandleAggregator]   ${symbol}: Last M1 open_time (${lastM1CandleTime.toISOString()}) is ahead of effectiveNow (${effectiveNowForLookback.toISOString()}) — using 10min lookback`);
      lookbackMinutes = 10;
    } else {
      lookbackMinutes = Math.min(gapMinutes + 2, MAX_REALTIME_RETENTION_MINUTES);
      console.log(`[CandleAggregator]   ${symbol}: Last M1 was ${gapMinutes}min ago (broker-clock-aligned) — using ${lookbackMinutes}min lookback`);
    }
  } else {
    lookbackMinutes = MAX_REALTIME_RETENTION_MINUTES;
    console.log(`[CandleAggregator]   ${symbol}: No prior M1 — using max ${lookbackMinutes}min lookback`);
  }

  const prices = await fetchRecentPrices(symbol, lookbackMinutes);

  if (prices.length === 0) {
    console.log(`[CandleAggregator]   ${symbol}: No tick data — triggering MetaAPI dead-man switch`);
    const saved = await runMetaApiDeadManSwitch(symbol, lastM1CandleTime);
    return { candlesCreated: saved, timedOut: false };
  }

  // Dead-man switch also fires when ticks exist but a gap is detected
  const deadManSaved = await runMetaApiDeadManSwitch(symbol, lastM1CandleTime);
  if (deadManSaved > 0) {
    console.log(`[CandleAggregator]   ${symbol}: Gap-fill saved ${deadManSaved} candles alongside tick aggregation`);
  }

  const firstPriceTime = new Date(prices[0].broker_time);
  const lastPriceTime = new Date(prices[prices.length - 1].broker_time);

  // Use latest broker_time as effectiveNow for candle boundary calculations.
  // This is consistent with how open_time is stored in forex_candles.
  const effectiveNow = isCryptoSymbol(symbol) ? now : lastPriceTime;
  const clockSkewMs = effectiveNow.getTime() - now.getTime();
  if (!isCryptoSymbol(symbol) && Math.abs(clockSkewMs) > 60000) {
    console.log(`[CandleAggregator]   ${symbol}: Broker clock skew ${Math.round(clockSkewMs / 60000)}min — using broker_time as effective now`);
  }

  console.log(`[CandleAggregator]   ${symbol}: ${prices.length} prices from ${firstPriceTime.toISOString()} to ${lastPriceTime.toISOString()}`);

  let candlesCreated = 0;
  const candlesToSave: CandleData[] = [];

  for (const timeframe of timeframesToProcess) {
    const elapsedMs = Date.now() - symbolStartTime;
    if (elapsedMs > maxDurationMs) {
      console.log(`[CandleAggregator] Approaching timeout (${elapsedMs}ms), stopping ${symbol} at ${timeframe}`);
      return { candlesCreated, timedOut: true };
    }

    const timeframeMinutes = TIMEFRAME_MINUTES[timeframe];
    const lookbackTime = new Date(effectiveNow.getTime() - lookbackMinutes * 60 * 1000);

    const { data: existingCandles } = await supabase
      .from('forex_candles')
      .select('open_time')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', lookbackTime.toISOString())
      .order('open_time', { ascending: true });

    const existingCandleTimes = new Set(
      (existingCandles || []).map(c => new Date(c.open_time).getTime())
    );

    const currentCandleStart = roundTimeToCandle(effectiveNow, timeframeMinutes);
    const previousCandleStart = new Date(currentCandleStart.getTime() - timeframeMinutes * 60 * 1000);

    const lastSavedInWindow = existingCandleTimes.size > 0
      ? new Date(Math.max(...Array.from(existingCandleTimes)))
      : null;

    const oldestTickCandleStart = roundTimeToCandle(firstPriceTime, timeframeMinutes);

    const startFrom = lastSavedInWindow
      ? new Date(lastSavedInWindow.getTime() + timeframeMinutes * 60 * 1000)
      : oldestTickCandleStart;
    const endAt = previousCandleStart;

    let currentCandleToCreate = startFrom;
    let candlesCreatedForTimeframe = 0;

    while (currentCandleToCreate <= endAt) {
      const loopElapsedMs = Date.now() - symbolStartTime;
      if (loopElapsedMs > maxDurationMs) {
        console.log(`[CandleAggregator]   Timeout in loop (${loopElapsedMs}ms), stopping ${symbol} ${timeframe}`);
        return { candlesCreated, timedOut: true };
      }

      if (candlesCreatedForTimeframe >= MAX_CANDLES_PER_TIMEFRAME) {
        console.log(`[CandleAggregator]   Max candles reached (${MAX_CANDLES_PER_TIMEFRAME}) for ${symbol} ${timeframe}`);
        break;
      }

      const candleEndTime = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
      const bufferMs = 30 * 1000;
      if (candleEndTime > new Date(effectiveNow.getTime() - bufferMs)) {
        break;
      }

      if (existingCandleTimes.has(currentCandleToCreate.getTime())) {
        currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
        continue;
      }

      let candle: CandleData | null = null;
      const sourceTimeframe = AGGREGATION_HIERARCHY[timeframe];

      if (sourceTimeframe) {
        candle = await aggregateFromLowerTimeframe(
          symbol,
          timeframe,
          sourceTimeframe,
          currentCandleToCreate,
          candleEndTime
        );
      } else {
        const candlePrices = prices.filter(p => {
          const priceTime = new Date(p.broker_time);
          return priceTime >= currentCandleToCreate && priceTime < candleEndTime;
        });

        if (candlePrices.length > 0) {
          candle = calculateCandleFromPrices(candlePrices, symbol, timeframe, currentCandleToCreate);
        }
      }

      if (candle) {
        candlesToSave.push(candle);
        candlesCreatedForTimeframe++;
      }

      currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
    }

    console.log(`[CandleAggregator]   ${symbol} ${timeframe}: ${candlesCreatedForTimeframe} candles queued`);
  }

  if (candlesToSave.length > 0) {
    console.log(`[CandleAggregator]   ${symbol}: Saving ${candlesToSave.length} candles...`);
    const saved = await saveCandlesBatch(candlesToSave, 'netlify_aggregator');
    candlesCreated = saved;
    console.log(`[CandleAggregator]   ${symbol}: Saved ${saved} candles`);

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
        return {
          symbol: sym,
          timeframe: tf,
          candle_time: latestOpenTime.toISOString(),
          event_time: new Date().toISOString()
        };
      });
      supabase.from('candle_cache_invalidation_events').insert(invalidationRows).then(({ error }) => {
        if (error) console.warn(`[CandleAggregator] Cache invalidation insert failed for ${symbol}:`, error.message);
      });
    }
  } else {
    console.log(`[CandleAggregator]   ${symbol}: No new candles to create`);
  }

  // Correct wicks on recently saved sparse-tick M5 candles using broker OHLC
  // CCIP-2026-04-15: Disabled for crypto symbols — Kraken is the authoritative price source
  // for BTCUSD/ETHUSD. MetaAPI does not serve reliable crypto OHLC from the same feed,
  // causing inflated highs (650-800+ USD above real price) that corrupt candle wicks.
  if (timeframesToProcess.includes('M5') && !isCryptoSymbol(symbol)) {
    try {
      await correctSparseCandleWicks(symbol);
    } catch (wickErr) {
      console.warn(`[CandleAggregator]   ${symbol}: Wick correction skipped:`, wickErr instanceof Error ? wickErr.message : wickErr);
    }
  }

  const symbolTotalDuration = Date.now() - symbolStartTime;
  console.log(`[CandleAggregator]   ${symbol} completed in ${symbolTotalDuration}ms`);

  return { candlesCreated, timedOut: false };
}

export const handler: Handler = async (_event, _context) => {
  console.log('[CandleAggregator] Starting — SSOT: Netlify only, MetaAPI dead-man switch');
  const startTime = Date.now();

  try {
    const now = new Date();
    const isForexMarketOpen = isMarketOpenAtTime(now);

    let symbolsToProcess = ACTIVE_SYMBOLS;
    if (!isForexMarketOpen) {
      symbolsToProcess = CRYPTO_SYMBOLS;
      console.log(`[CandleAggregator] Forex market closed — processing crypto only: ${symbolsToProcess.join(', ')}`);
    } else {
      console.log(`[CandleAggregator] Forex market open — processing all symbols`);
    }

    if (symbolsToProcess.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          candlesCreated: 0,
          symbolsProcessed: 0,
          message: 'No symbols to process — market closed',
          timestamp: new Date().toISOString()
        })
      };
    }

    const timeframesToProcess = getTimeframesToProcess();

    let totalCandlesCreated = 0;
    let symbolsProcessed = 0;
    let symbolsTimedOut = 0;
    const symbolResults: Record<string, { candles: number; timedOut: boolean; error?: string }> = {};

    for (const symbol of symbolsToProcess) {
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > 90000) {
        console.log(`[CandleAggregator] Approaching function timeout (${elapsedMs}ms), stopping before ${symbol}`);
        symbolResults[symbol] = { candles: 0, timedOut: false, error: 'Function timeout — not processed' };
        break;
      }

      try {
        const result = await aggregateCandlesForSymbol(symbol, timeframesToProcess);
        totalCandlesCreated += result.candlesCreated;
        symbolsProcessed++;

        if (result.timedOut) {
          symbolsTimedOut++;
          symbolResults[symbol] = { candles: result.candlesCreated, timedOut: true };
        } else {
          symbolResults[symbol] = { candles: result.candlesCreated, timedOut: false };
        }
      } catch (error) {
        console.error(`[CandleAggregator] Error processing ${symbol}:`, error);
        symbolResults[symbol] = {
          candles: 0,
          timedOut: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        symbolsProcessed++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[CandleAggregator] Done in ${duration}ms: ${totalCandlesCreated} candles, ${symbolsProcessed}/${symbolsToProcess.length} symbols`);

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
