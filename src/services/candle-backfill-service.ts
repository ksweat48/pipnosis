import { supabase } from '@/lib/supabase';
import { Timeframe } from '@/services/chart-preferences';
import { CandleData, getTimeframeMinutes, sanitizeCandleData } from '@/services/candle-data-service';

interface GapInfo {
  startTime: number;
  endTime: number;
  expectedCandles: number;
  missingCandles: number;
}

interface BackfillResult {
  success: boolean;
  gapsFilled: number;
  candlesCreated: number;
  errors: string[];
}

export async function detectCandleGaps(
  existingCandles: CandleData[],
  timeframe: Timeframe
): Promise<GapInfo[]> {
  if (existingCandles.length < 2) {
    return [];
  }

  const gaps: GapInfo[] = [];
  const intervalSeconds = getTimeframeMinutes(timeframe) * 60;

  for (let i = 1; i < existingCandles.length; i++) {
    const prevTime = existingCandles[i - 1].time;
    const currTime = existingCandles[i].time;
    const timeDiff = currTime - prevTime;

    if (timeDiff > intervalSeconds * 1.5) {
      const expectedCandles = Math.floor(timeDiff / intervalSeconds);
      const missingCandles = expectedCandles - 1;

      if (missingCandles > 0) {
        gaps.push({
          startTime: prevTime,
          endTime: currTime,
          expectedCandles,
          missingCandles
        });
      }
    }
  }

  return gaps;
}

export async function backfillGapsFromTicks(
  symbol: string,
  timeframe: Timeframe,
  gaps: GapInfo[]
): Promise<{ result: BackfillResult; backfilledCandles: CandleData[] }> {
  const result: BackfillResult = {
    success: true,
    gapsFilled: 0,
    candlesCreated: 0,
    errors: []
  };

  const allBackfilledCandles: CandleData[] = [];

  if (gaps.length === 0) {
    return { result, backfilledCandles: allBackfilledCandles };
  }

  // Only log if there are significant gaps (more than 10 minutes)
  const significantGaps = gaps.filter(g => (g.endTime - g.startTime) > 600);
  if (significantGaps.length > 0) {
    console.log(`[Backfill] Found ${significantGaps.length} significant gaps for ${symbol} ${timeframe}`);
  }

  const intervalMinutes = getTimeframeMinutes(timeframe);
  const intervalMs = intervalMinutes * 60 * 1000;

  for (const gap of gaps) {
    try {
      const startTimeUtc = new Date(gap.startTime * 1000);
      const endTimeUtc = new Date(gap.endTime * 1000);

      // Skip small gaps (less than 10 minutes)
      if ((gap.endTime - gap.startTime) < 600) {
        continue;
      }

      const { data: ticks, error: tickError } = await supabase
        .from('realtime_prices')
        .select('bid, ask, created_at, broker_time')
        .eq('symbol', symbol)
        .gte('created_at', startTimeUtc.toISOString())
        .lte('created_at', endTimeUtc.toISOString())
        .order('created_at', { ascending: true });

      if (tickError) {
        result.errors.push(`Failed to fetch ticks for gap: ${tickError.message}`);
        result.success = false;
        continue;
      }

      if (!ticks || ticks.length === 0) {
        // Skip warning for empty tick data - common during market close
        continue;
      }

      // Reduced logging - only log for large datasets
      if (ticks.length > 100) {
        console.log(`[Backfill] Processing ${ticks.length} ticks`);
      }

      const candleMap = new Map<number, { midPrices: number[]; tickCount: number }>();

      for (const tick of ticks) {
        const tickTime = new Date(tick.broker_time || tick.created_at).getTime();
        const candleStartMs = Math.floor(tickTime / intervalMs) * intervalMs;
        const candleStartSeconds = Math.floor(candleStartMs / 1000);

        if (candleStartSeconds <= gap.startTime || candleStartSeconds >= gap.endTime) {
          continue;
        }

        if (!candleMap.has(candleStartSeconds)) {
          candleMap.set(candleStartSeconds, { midPrices: [], tickCount: 0 });
        }

        const data = candleMap.get(candleStartSeconds)!;
        const bid = parseFloat(tick.bid);
        const ask = parseFloat(tick.ask);
        const midPrice = (bid + ask) / 2;

        data.midPrices.push(midPrice);
        data.tickCount++;
      }

      if (candleMap.size > 0) {
        const backfilledCandles: CandleData[] = [];

        for (const [candleTime, data] of candleMap.entries()) {
          if (data.midPrices.length === 0) continue;

          const candle: CandleData = {
            time: candleTime,
            open: data.midPrices[0],
            high: Math.max(...data.midPrices),
            low: Math.min(...data.midPrices),
            close: data.midPrices[data.midPrices.length - 1],
            volume: data.tickCount
          };

          backfilledCandles.push(candle);
        }

        // Add to all backfilled candles
        allBackfilledCandles.push(...backfilledCandles);

        // Reduced logging
        result.candlesCreated += backfilledCandles.length;
        result.gapsFilled++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Gap backfill failed: ${errorMsg}`);
      result.success = false;
    }
  }

  // Only log summary if gaps were actually filled
  if (result.gapsFilled > 0) {
    console.log(`[Backfill] Complete: ${result.gapsFilled} gaps filled, ${result.candlesCreated} candles created`);
  }

  return { result, backfilledCandles: allBackfilledCandles };
}

export function generatePlaceholderCandles(
  gaps: GapInfo[],
  existingCandles: CandleData[],
  timeframe: Timeframe
): CandleData[] {
  const placeholders: CandleData[] = [];
  const intervalSeconds = getTimeframeMinutes(timeframe) * 60;

  for (const gap of gaps) {
    const prevCandleIndex = existingCandles.findIndex(c => c.time === gap.startTime);
    if (prevCandleIndex === -1) continue;

    const prevCandle = existingCandles[prevCandleIndex];
    const lastKnownPrice = prevCandle.close;

    let currentTime = gap.startTime + intervalSeconds;

    while (currentTime < gap.endTime) {
      placeholders.push({
        time: currentTime,
        open: lastKnownPrice,
        high: lastKnownPrice,
        low: lastKnownPrice,
        close: lastKnownPrice,
        volume: 0
      });

      currentTime += intervalSeconds;
    }
  }

  return placeholders;
}

export async function detectAndBackfillGaps(
  symbol: string,
  timeframe: Timeframe,
  existingCandles: CandleData[]
): Promise<{ candles: CandleData[]; backfillResult: BackfillResult }> {
  const gaps = await detectCandleGaps(existingCandles, timeframe);

  if (gaps.length === 0) {
    // Silence - no gaps is good
    return { candles: existingCandles, backfillResult: { success: true, gapsFilled: 0, candlesCreated: 0, errors: [] } };
  }

  // Only log significant gaps
  const significantGaps = gaps.filter(g => g.missingCandles > 10);
  if (significantGaps.length > 0) {
    console.log(`[Backfill] Detected ${significantGaps.length} significant gaps in ${symbol} ${timeframe} data`);
  }

  const { result: backfillResult, backfilledCandles } = await backfillGapsFromTicks(symbol, timeframe, gaps);

  // Merge backfilled candles with existing candles and deduplicate
  const allCandles = [...existingCandles, ...backfilledCandles];

  // Sort by time and deduplicate
  // CRITICAL: Sanitize all candles during merge to prevent Date objects
  const candleMap = new Map<number, CandleData>();
  allCandles.forEach(candle => {
    // Sanitize to ensure primitive numbers
    const sanitized = sanitizeCandleData(candle);

    // Keep existing candles over backfilled ones (they're more reliable)
    if (!candleMap.has(sanitized.time)) {
      candleMap.set(sanitized.time, sanitized);
    }
  });

  const mergedCandles = Array.from(candleMap.values())
    .sort((a, b) => a.time - b.time);

  console.log(`[Backfill] Merged ${existingCandles.length} existing + ${backfilledCandles.length} backfilled = ${mergedCandles.length} total candles`);

  return { candles: mergedCandles, backfillResult };
}
