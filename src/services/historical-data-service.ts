import { supabase } from '@/lib/supabase';
import { Timeframe } from '@/services/chart-preferences';
import { symbolValidator } from '@/services/symbol-validator';

interface HistoricalDataFetchOptions {
  symbols: string[];
  timeframes: Timeframe[];
  daysBack?: number;
  onProgress?: (progress: ProgressUpdate) => void;
}

interface ProgressUpdate {
  symbol: string;
  timeframe: Timeframe;
  status: 'pending' | 'fetching' | 'saving' | 'completed' | 'failed';
  candlesFetched?: number;
  candlesSaved?: number;
  error?: string;
}

interface BulkImportResult {
  totalSymbols: number;
  totalTimeframes: number;
  totalTasks: number;
  completed: number;
  failed: number;
  totalCandlesFetched: number;
  totalCandlesSaved: number;
  results: ProgressUpdate[];
  duration: number;
}

interface MetaApiCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
}

const TIMEFRAME_MINUTES_MAP: Record<Timeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
  W1: 10080,
};

function getTimeframeMinutes(timeframe: Timeframe): number {
  return TIMEFRAME_MINUTES_MAP[timeframe] || 15;
}

function getCurrentCandleStartTime(timeframe: Timeframe): Date {
  const now = new Date();
  const intervalMinutes = getTimeframeMinutes(timeframe);
  const intervalMs = intervalMinutes * 60 * 1000;

  const currentCandleStartMs = Math.floor(now.getTime() / intervalMs) * intervalMs;
  return new Date(currentCandleStartMs);
}

function getLastCompletedCandleTime(timeframe: Timeframe): Date {
  const now = new Date();
  const intervalMinutes = getTimeframeMinutes(timeframe);
  const intervalMs = intervalMinutes * 60 * 1000;

  const currentCandleStartMs = Math.floor(now.getTime() / intervalMs) * intervalMs;
  const lastCompletedCandleMs = currentCandleStartMs - intervalMs;

  return new Date(lastCompletedCandleMs);
}

async function fetchMetaApiCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number
): Promise<MetaApiCandle[]> {
  const netlifyUrl = `${window.location.origin}/.netlify/functions/forex-candles`;
  const url = `${netlifyUrl}?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`;

  console.log(`[HistoricalData] Fetching ${limit} ${timeframe} candles for ${symbol}`);
  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();

    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: errorText };
    }

    if (response.status === 404 || errorData.errorCode === 'SYMBOL_NOT_AVAILABLE') {
      const error: any = new Error(`Symbol ${symbol} not available for historical data`);
      error.code = 'SYMBOL_NOT_AVAILABLE';
      error.status = 404;
      throw error;
    }

    throw new Error(`Failed to fetch candles: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  if (!result.success || !result.data || !Array.isArray(result.data.candles)) {
    throw new Error('Invalid response from candles API');
  }

  return result.data.candles;
}

async function saveCandlesToDatabase(
  candles: MetaApiCandle[],
  symbol: string,
  timeframe: Timeframe
): Promise<{ saved: number; errors: number }> {
  if (candles.length === 0) {
    return { saved: 0, errors: 0 };
  }

  const lastCompletedTime = getLastCompletedCandleTime(timeframe);
  console.log(`[HistoricalData] Last completed candle time: ${lastCompletedTime.toISOString()}`);

  const filteredCandles = candles.filter(candle => {
    const candleTime = new Date(candle.time);
    return candleTime <= lastCompletedTime;
  });

  console.log(`[HistoricalData] Filtered ${candles.length} -> ${filteredCandles.length} candles (excluded incomplete candles)`);

  const forexCandles = filteredCandles.map((candle) => ({
    symbol,
    timeframe,
    open_time: candle.time,
    close_time: new Date(
      new Date(candle.time).getTime() + getTimeframeMinutes(timeframe) * 60000
    ).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.tickVolume || 0,
  }));

  const { error: forexError, count: forexCount } = await supabase
    .from('forex_candles')
    .upsert(forexCandles, {
      onConflict: 'symbol,timeframe,open_time',
      ignoreDuplicates: false,
      count: 'exact',
    });

  if (forexError) {
    console.error('[HistoricalData] Error saving to forex_candles:', forexError);
    throw forexError;
  }

  const marketDataCandles = candles.map((candle) => ({
    symbol,
    timeframe,
    timestamp: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.tickVolume || 0,
  }));

  const { error: marketError } = await supabase
    .from('market_data')
    .upsert(marketDataCandles, {
      onConflict: 'symbol,timeframe,timestamp',
      ignoreDuplicates: false,
    });

  if (marketError) {
    console.warn('[HistoricalData] Error saving to market_data:', marketError);
  }

  return {
    saved: forexCount || candles.length,
    errors: 0,
  };
}

async function fetchAndSaveHistoricalData(
  symbol: string,
  timeframe: Timeframe,
  daysBack: number,
  onProgress?: (update: ProgressUpdate) => void
): Promise<ProgressUpdate> {
  const result: ProgressUpdate = {
    symbol,
    timeframe,
    status: 'pending',
    candlesFetched: 0,
    candlesSaved: 0,
  };

  try {
    const validation = await symbolValidator.validateSymbol(symbol);
    if (!validation.available) {
      result.status = 'failed';
      result.error = validation.reason || 'Symbol not available from broker';
      onProgress?.(result);
      return result;
    }

    onProgress?.({ ...result, status: 'fetching' });

    const minutesPerCandle = getTimeframeMinutes(timeframe);
    const candlesPerDay = Math.floor((24 * 60) / minutesPerCandle);
    const totalCandles = Math.min(candlesPerDay * daysBack, 10000);

    const currentCandleStart = getCurrentCandleStartTime(timeframe);
    const lastCompleted = getLastCompletedCandleTime(timeframe);

    console.log(`[HistoricalData] ${symbol} ${timeframe} - Current candle starts at: ${currentCandleStart.toISOString()}`);
    console.log(`[HistoricalData] ${symbol} ${timeframe} - Last completed candle: ${lastCompleted.toISOString()}`);

    const candles = await fetchMetaApiCandles(symbol, timeframe, totalCandles);
    result.candlesFetched = candles.length;

    onProgress?.({ ...result, status: 'saving', candlesFetched: candles.length });

    const saveResult = await saveCandlesToDatabase(candles, symbol, timeframe);
    result.candlesSaved = saveResult.saved;
    result.status = 'completed';

    if (candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      console.log(`[HistoricalData] ✓ ${symbol} ${timeframe} - Latest saved candle: ${new Date(lastCandle.time).toISOString()}`);
    }

    onProgress?.(result);
    return result;
  } catch (error: any) {
    result.status = 'failed';

    if (error.code === 'SYMBOL_NOT_AVAILABLE') {
      result.error = `Symbol not available for historical data from your broker`;
    } else {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[HistoricalData] ✗ Failed ${symbol} ${timeframe}:`, result.error);
    }

    onProgress?.(result);
    return result;
  }
}

export async function bulkImportHistoricalData(
  options: HistoricalDataFetchOptions
): Promise<BulkImportResult> {
  const startTime = Date.now();
  const { symbols, timeframes, daysBack = 7, onProgress } = options;

  const result: BulkImportResult = {
    totalSymbols: symbols.length,
    totalTimeframes: timeframes.length,
    totalTasks: symbols.length * timeframes.length,
    completed: 0,
    failed: 0,
    totalCandlesFetched: 0,
    totalCandlesSaved: 0,
    results: [],
    duration: 0,
  };

  console.log(
    `[HistoricalData] Starting bulk import: ${result.totalTasks} tasks (${symbols.length} symbols × ${timeframes.length} timeframes)`
  );

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const taskResult = await fetchAndSaveHistoricalData(
        symbol,
        timeframe,
        daysBack,
        onProgress
      );

      result.results.push(taskResult);

      if (taskResult.status === 'completed') {
        result.completed++;
        result.totalCandlesFetched += taskResult.candlesFetched || 0;
        result.totalCandlesSaved += taskResult.candlesSaved || 0;
      } else if (taskResult.status === 'failed') {
        result.failed++;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  result.duration = Date.now() - startTime;

  console.log(
    `[HistoricalData] Bulk import completed in ${(result.duration / 1000).toFixed(1)}s: ${result.completed} succeeded, ${result.failed} failed`
  );

  return result;
}

export async function checkDataCompleteness(
  symbol: string,
  timeframe: Timeframe
): Promise<{
  hasData: boolean;
  oldestCandle: string | null;
  newestCandle: string | null;
  totalCandles: number;
}> {
  const { data, error } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('open_time', { ascending: true });

  if (error || !data || data.length === 0) {
    return {
      hasData: false,
      oldestCandle: null,
      newestCandle: null,
      totalCandles: 0,
    };
  }

  return {
    hasData: true,
    oldestCandle: data[0].open_time,
    newestCandle: data[data.length - 1].open_time,
    totalCandles: data.length,
  };
}

export async function getMarketOpenTime(): Promise<Date> {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = estTime.getDay();

  let marketOpenDate = new Date(estTime);

  if (dayOfWeek === 0) {
    marketOpenDate.setHours(17, 0, 0, 0);
  } else {
    const daysUntilSunday = 7 - dayOfWeek;
    marketOpenDate.setDate(marketOpenDate.getDate() + daysUntilSunday);
    marketOpenDate.setHours(17, 0, 0, 0);
  }

  return marketOpenDate;
}

export const historicalDataService = {
  bulkImportHistoricalData,
  checkDataCompleteness,
  getMarketOpenTime,
  fetchAndSaveHistoricalData,
};
