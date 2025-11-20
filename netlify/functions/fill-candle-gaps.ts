import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const metaApiToken = process.env.METAAPI_TOKEN!;
const metaApiAccountId = process.env.METAAPI_ACCOUNT_ID!;
const metaApiRegion = process.env.METAAPI_REGION || 'new-york';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ACTIVE_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY'];
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

interface GapFillResult {
  symbol: string;
  timeframe: string;
  gaps_filled: number;
  candles_created: number;
}

interface Gap {
  symbol: string;
  timeframe: string;
  expectedTime: Date;
  missingCandles: number;
}

async function detectGaps(lookbackHours: number): Promise<Gap[]> {
  const gaps: Gap[] = [];
  const cutoffTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  for (const symbol of ACTIVE_SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      try {
        const { data, error } = await supabase
          .from('forex_candles')
          .select('open_time')
          .eq('symbol', symbol)
          .eq('timeframe', timeframe.name)
          .gte('open_time', cutoffTime.toISOString())
          .order('open_time', { ascending: true });

        if (error || !data || data.length < 2) continue;

        const intervalMs = timeframe.minutes * 60 * 1000;

        for (let i = 1; i < data.length; i++) {
          const prevTime = new Date(data[i - 1].open_time).getTime();
          const currTime = new Date(data[i].open_time).getTime();
          const timeDiff = currTime - prevTime;

          if (timeDiff > intervalMs * 1.5) {
            const missingCandles = Math.floor(timeDiff / intervalMs) - 1;
            if (missingCandles > 0) {
              gaps.push({
                symbol,
                timeframe: timeframe.name,
                expectedTime: new Date(prevTime + intervalMs),
                missingCandles
              });
            }
          }
        }
      } catch (err) {
        console.error(`[GapDetection] Error checking ${symbol} ${timeframe.name}:`, err);
      }
    }
  }

  return gaps;
}

async function fetchMissingCandlesFromMetaApi(
  symbol: string,
  timeframe: string,
  startTime: Date,
  count: number
): Promise<any[]> {
  try {
    const tf = TIMEFRAMES.find(t => t.name === timeframe);
    if (!tf) return [];

    const endTime = new Date(startTime.getTime() + count * tf.minutes * 60 * 1000);

    const url = `https://mt-client-api-v1.${metaApiRegion}.agiliumtrade.ai/users/current/accounts/${metaApiAccountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': metaApiToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[MetaAPI] Error fetching ${symbol} ${timeframe}: ${response.status}`);
      return [];
    }

    const candles = await response.json();

    if (!Array.isArray(candles)) return [];

    return candles.map(candle => ({
      symbol,
      timeframe,
      open_time: candle.time,
      close_time: new Date(new Date(candle.time).getTime() + tf.minutes * 60000).toISOString(),
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.tickVolume || 0)
    }));
  } catch (error) {
    console.error(`[MetaAPI] Error fetching candles:`, error);
    return [];
  }
}

async function fillGapsWithMetaApi(gaps: Gap[]): Promise<number> {
  let totalFilled = 0;

  for (const gap of gaps) {
    try {
      const candles = await fetchMissingCandlesFromMetaApi(
        gap.symbol,
        gap.timeframe,
        gap.expectedTime,
        gap.missingCandles
      );

      if (candles.length > 0) {
        const { error } = await supabase
          .from('forex_candles')
          .upsert(candles, {
            onConflict: 'symbol,timeframe,open_time',
            ignoreDuplicates: false
          });

        if (!error) {
          totalFilled += candles.length;
          console.log(`[GapFill] Filled ${candles.length} candles for ${gap.symbol} ${gap.timeframe}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`[GapFill] Error filling gap for ${gap.symbol} ${gap.timeframe}:`, error);
    }
  }

  return totalFilled;
}

export const handler: Handler = async (event, context) => {
  console.log('[FillCandleGaps] Starting automatic gap detection and filling...');
  const startTime = Date.now();

  try {
    const lookbackHours = 24;

    console.log('[FillCandleGaps] Step 1: Detecting gaps in last 24 hours...');
    const gaps = await detectGaps(lookbackHours);
    console.log(`[FillCandleGaps] Found ${gaps.length} gaps to fill`);

    let metaApiFilled = 0;
    if (gaps.length > 0) {
      console.log('[FillCandleGaps] Step 2: Filling gaps with MetaAPI...');
      metaApiFilled = await fillGapsWithMetaApi(gaps.slice(0, 20));
    }

    console.log('[FillCandleGaps] Step 3: Running database gap fill function...');
    const { data, error } = await supabase.rpc('auto_fill_all_gaps', {
      p_lookback_hours: lookbackHours
    });

    let databaseResults: GapFillResult[] = [];
    if (!error && data) {
      databaseResults = data as GapFillResult[];
    }

    const totalGaps = databaseResults.reduce((sum, r) => sum + r.gaps_filled, 0);
    const totalCandles = databaseResults.reduce((sum, r) => sum + r.candles_created, 0);

    const duration = Date.now() - startTime;
    console.log(`[FillCandleGaps] ✅ Completed in ${duration}ms`);
    console.log(`[FillCandleGaps] MetaAPI: ${metaApiFilled} candles filled`);
    console.log(`[FillCandleGaps] Database: ${totalGaps} gaps filled, ${totalCandles} candles created`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        gapsDetected: gaps.length,
        metaApiFilled,
        databaseGapsFilled: totalGaps,
        databaseCandlesCreated: totalCandles,
        details: databaseResults,
        lookbackHours,
        durationMs: duration,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('[FillCandleGaps] Unexpected error:', error);
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
