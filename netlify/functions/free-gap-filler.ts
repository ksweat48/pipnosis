import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Alpha Vantage provides FREE forex data (500 requests/day)
const ALPHA_VANTAGE_KEY = 'demo'; // Replace with your free key from alphavantage.co

interface Gap {
  start: Date;
  end: Date;
  missingCount: number;
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

async function findGaps(symbol: string, timeframe: string, daysBack: number): Promise<Gap[]> {
  const intervalMinutes = {
    'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
    'H1': 60, 'H4': 240, 'D1': 1440
  }[timeframe] || 5;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const { data, error } = await supabase
    .from('forex_candles')
    .select('open_time')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .gte('open_time', startDate.toISOString())
    .order('open_time', { ascending: true });

  if (error || !data || data.length < 2) {
    return [];
  }

  const gaps: Gap[] = [];

  for (let i = 1; i < data.length; i++) {
    const prevTime = new Date(data[i - 1].open_time);
    const currTime = new Date(data[i].open_time);
    const diffMinutes = (currTime.getTime() - prevTime.getTime()) / 60000;

    // Check if gap is significant (more than 2 intervals, less than 3 days)
    if (diffMinutes > intervalMinutes * 2 && diffMinutes < 4320) {
      // Skip weekend gaps (Friday 22:00 to Sunday 22:00 UTC)
      const prevDay = prevTime.getUTCDay();
      const prevHour = prevTime.getUTCHours();
      const isWeekendGap = (prevDay === 5 && prevHour >= 21) || prevDay === 6 || (prevDay === 0 && prevHour < 21);

      if (!isWeekendGap) {
        gaps.push({
          start: new Date(prevTime.getTime() + intervalMinutes * 60000),
          end: currTime,
          missingCount: Math.floor(diffMinutes / intervalMinutes) - 1
        });
      }
    }
  }

  return gaps;
}

async function interpolateGap(
  symbol: string,
  timeframe: string,
  gap: Gap
): Promise<Candle[]> {
  // Get candles before and after gap
  const { data: before } = await supabase
    .from('forex_candles')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .lt('open_time', gap.start.toISOString())
    .order('open_time', { ascending: false })
    .limit(1);

  const { data: after } = await supabase
    .from('forex_candles')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .gte('open_time', gap.end.toISOString())
    .order('open_time', { ascending: true })
    .limit(1);

  if (!before || !after || before.length === 0 || after.length === 0) {
    return [];
  }

  const beforeCandle = before[0];
  const afterCandle = after[0];

  // Simple linear interpolation for small gaps (< 10 candles)
  if (gap.missingCount <= 10) {
    const candles: Candle[] = [];
    const intervalMs = {
      'M1': 60000, 'M5': 300000, 'M15': 900000, 'M30': 1800000,
      'H1': 3600000, 'H4': 14400000, 'D1': 86400000
    }[timeframe] || 300000;

    const priceStep = (afterCandle.open - beforeCandle.close) / (gap.missingCount + 1);

    let currentTime = new Date(gap.start);
    let currentPrice = beforeCandle.close;

    for (let i = 0; i < gap.missingCount; i++) {
      currentPrice += priceStep;
      const open = currentPrice;
      const close = currentPrice + priceStep;
      const high = Math.max(open, close) * 1.0001; // Small wick
      const low = Math.min(open, close) * 0.9999;

      candles.push({
        symbol,
        timeframe,
        open_time: currentTime.toISOString(),
        close_time: new Date(currentTime.getTime() + intervalMs).toISOString(),
        open,
        high,
        low,
        close,
        volume: 0,
        data_source: 'interpolated'
      });

      currentTime = new Date(currentTime.getTime() + intervalMs);
    }

    return candles;
  }

  return [];
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
    const {
      symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'],
      timeframes = ['M5', 'H1'],
      daysBack = 14
    } = body;

    console.log(`Free Gap Filler: Processing ${symbols.length} symbols, ${timeframes.length} timeframes`);

    let totalGaps = 0;
    let totalFilled = 0;
    const results: any[] = [];

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        console.log(`\nChecking ${symbol} ${timeframe}...`);

        const gaps = await findGaps(symbol, timeframe, daysBack);
        totalGaps += gaps.length;

        console.log(`Found ${gaps.length} gaps`);

        for (const gap of gaps) {
          console.log(`Gap: ${gap.start.toISOString()} to ${gap.end.toISOString()} (${gap.missingCount} candles)`);

          try {
            const interpolatedCandles = await interpolateGap(symbol, timeframe, gap);

            if (interpolatedCandles.length > 0) {
              const { error: insertError } = await supabase
                .from('forex_candles')
                .upsert(interpolatedCandles, {
                  onConflict: 'symbol,timeframe,open_time',
                  ignoreDuplicates: true
                });

              if (!insertError) {
                totalFilled += interpolatedCandles.length;
                console.log(`✓ Filled ${interpolatedCandles.length} candles`);

                results.push({
                  symbol,
                  timeframe,
                  gap: `${gap.start.toISOString()} to ${gap.end.toISOString()}`,
                  filled: interpolatedCandles.length
                });
              } else {
                console.error(`✗ Insert error:`, insertError);
              }
            }
          } catch (error) {
            console.error(`Error filling gap:`, error);
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalGapsFound: totalGaps,
        totalCandlesFilled: totalFilled,
        results,
        message: totalFilled > 0
          ? `Successfully filled ${totalFilled} candles across ${totalGaps} gaps using interpolation`
          : `Found ${totalGaps} gaps but all were too large to interpolate safely`
      })
    };
  } catch (error) {
    console.error('Free gap filler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to fill gaps',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
