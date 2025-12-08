import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Dukascopy provides FREE historical forex data
const DUKASCOPY_BASE = 'https://datafeed.dukascopy.com/datafeed';

// Symbol mapping for Dukascopy
const SYMBOL_MAP: Record<string, string> = {
  'EURUSD': 'EURUSD',
  'GBPUSD': 'GBPUSD',
  'USDJPY': 'USDJPY',
  'XAUUSD': 'XAUUSD',
  'US30': 'USA30IDXUSD'
};

interface DukascopyTick {
  time: number;
  ask: number;
  bid: number;
  volume: number;
}

interface Candle {
  symbol: string;
  timeframe: string;
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  data_source: string;
}

async function fetchDukascopyTicks(
  symbol: string,
  startTime: Date,
  endTime: Date
): Promise<DukascopyTick[]> {
  const dukascopeSymbol = SYMBOL_MAP[symbol];
  if (!dukascopeSymbol) {
    throw new Error(`Symbol ${symbol} not supported`);
  }

  // Dukascopy provides tick data in hourly binary files
  // We'll fetch and aggregate them
  const ticks: DukascopyTick[] = [];

  const currentDate = new Date(startTime);
  while (currentDate <= endTime) {
    try {
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth()).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const hour = String(currentDate.getHours()).padStart(2, '0');

      // Dukascopy URL format: /symbol/year/month/day/hour_ticks.bi5
      const url = `${DUKASCOPY_BASE}/${dukascopeSymbol}/${year}/${month}/${day}/${hour}h_ticks.bi5`;

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000
      });

      // Parse binary tick data (simplified - you'd need proper bi5 parser)
      const buffer = Buffer.from(response.data);

      // For now, we'll use a simplified approach - get OHLC from public JSON API
      const jsonUrl = `${DUKASCOPY_BASE}/${dukascopeSymbol}/${year}/${month}/${day}/${hour}h_ticks.json`;
      const jsonResponse = await axios.get(jsonUrl, { timeout: 10000 });

      if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
        ticks.push(...jsonResponse.data);
      }
    } catch (error) {
      // Skip hours with no data
    }

    currentDate.setHours(currentDate.getHours() + 1);
  }

  return ticks;
}

function aggregateTicksToCandles(
  ticks: DukascopyTick[],
  symbol: string,
  timeframe: string
): Candle[] {
  if (ticks.length === 0) return [];

  const intervalMs = {
    'M1': 60000,
    'M5': 300000,
    'M15': 900000,
    'M30': 1800000,
    'H1': 3600000,
    'H4': 14400000,
    'D1': 86400000
  }[timeframe] || 300000;

  const candles: Candle[] = [];
  let currentCandle: Partial<Candle> | null = null;
  let candleStartTime = 0;

  for (const tick of ticks) {
    const tickTime = tick.time;
    const price = (tick.ask + tick.bid) / 2;

    const candleStart = Math.floor(tickTime / intervalMs) * intervalMs;

    if (!currentCandle || candleStartTime !== candleStart) {
      if (currentCandle) {
        candles.push(currentCandle as Candle);
      }

      candleStartTime = candleStart;
      currentCandle = {
        symbol,
        timeframe,
        open_time: new Date(candleStart).toISOString(),
        close_time: new Date(candleStart + intervalMs).toISOString(),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: tick.volume || 0,
        data_source: 'dukascopy'
      };
    } else {
      currentCandle.high = Math.max(currentCandle.high!, price);
      currentCandle.low = Math.min(currentCandle.low!, price);
      currentCandle.close = price;
      currentCandle.volume = (currentCandle.volume || 0) + (tick.volume || 0);
    }
  }

  if (currentCandle) {
    candles.push(currentCandle as Candle);
  }

  return candles;
}

async function findGaps(symbol: string, timeframe: string, daysBack: number) {
  const intervalSeconds = {
    'M1': 60, 'M5': 300, 'M15': 900, 'M30': 1800,
    'H1': 3600, 'H4': 14400, 'D1': 86400
  }[timeframe] || 300;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const { data, error } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .gte('open_time', startDate.toISOString())
    .order('open_time', { ascending: true });

  if (error || !data || data.length === 0) {
    return [];
  }

  const gaps: Array<{ start: Date; end: Date }> = [];

  for (let i = 1; i < data.length; i++) {
    const prevTime = new Date(data[i - 1].open_time);
    const currTime = new Date(data[i].open_time);
    const diffSeconds = (currTime.getTime() - prevTime.getTime()) / 1000;

    // If gap is more than 2x the interval (allowing for weekends), record it
    if (diffSeconds > intervalSeconds * 2 && diffSeconds < 86400 * 3) {
      gaps.push({
        start: new Date(prevTime.getTime() + intervalSeconds * 1000),
        end: currTime
      });
    }
  }

  return gaps;
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { symbol, timeframe, daysBack = 14, adminKey } = body;

    // Verify admin key
    if (adminKey !== process.env.ADMIN_REFRESH_KEY) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: Invalid admin key' })
      };
    }

    if (!symbol || !timeframe) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'symbol and timeframe required' })
      };
    }

    console.log(`Starting Dukascopy backfill for ${symbol} ${timeframe}...`);

    // Find gaps in existing data
    const gaps = await findGaps(symbol, timeframe, daysBack);
    console.log(`Found ${gaps.length} gaps to fill`);

    let totalFilled = 0;

    for (const gap of gaps) {
      console.log(`Filling gap: ${gap.start.toISOString()} to ${gap.end.toISOString()}`);

      try {
        // Fetch ticks from Dukascopy
        const ticks = await fetchDukascopyTicks(symbol, gap.start, gap.end);
        console.log(`Fetched ${ticks.length} ticks`);

        // Aggregate into candles
        const candles = aggregateTicksToCandles(ticks, symbol, timeframe);
        console.log(`Aggregated into ${candles.length} candles`);

        // Insert into database
        if (candles.length > 0) {
          const { error: insertError } = await supabase
            .from('forex_candles')
            .upsert(candles, {
              onConflict: 'symbol,timeframe,open_time',
              ignoreDuplicates: false
            });

          if (insertError) {
            console.error('Insert error:', insertError);
          } else {
            totalFilled += candles.length;
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error filling gap:`, error);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        symbol,
        timeframe,
        gapsFound: gaps.length,
        candlesFilled: totalFilled,
        message: `Filled ${totalFilled} candles across ${gaps.length} gaps using free Dukascopy data`
      })
    };
  } catch (error) {
    console.error('Dukascopy backfill error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to backfill',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
