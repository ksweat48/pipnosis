import { CandleData, Timeframe } from './metaapi';
import { getCandleOpenTime } from './candle-utils';
import { marketHoursService } from './market-hours';

export interface GapInfo {
  start: Date;
  end: Date;
  isWeekend: boolean;
  isTradingDayGap: boolean;
  missingTradingDays: Date[];
}

export interface MergedCandleResult {
  candles: CandleData[];
  stats: {
    apiCandles: number;
    dbCandles: number;
    duplicatesRemoved: number;
    gapsFilled: number;
    totalCandles: number;
  };
}

export function mergeHistoricalAndLiveCandles(
  apiCandles: CandleData[],
  dbCandles: CandleData[],
  timeframe: Timeframe
): MergedCandleResult {
  const candleMap = new Map<number, CandleData>();
  let duplicatesRemoved = 0;
  let gapsFilled = 0;

  for (const candle of apiCandles) {
    const normalizedTime = getCandleOpenTime(candle.time, timeframe).getTime();
    candleMap.set(normalizedTime, {
      ...candle,
      time: new Date(normalizedTime)
    });
  }

  for (const candle of dbCandles) {
    const normalizedTime = getCandleOpenTime(candle.time, timeframe).getTime();

    if (candleMap.has(normalizedTime)) {
      duplicatesRemoved++;
      const existingCandle = candleMap.get(normalizedTime)!;

      if (candle.tickVolume && candle.tickVolume > (existingCandle.tickVolume || 0)) {
        candleMap.set(normalizedTime, {
          ...candle,
          time: new Date(normalizedTime)
        });
      }
    } else {
      gapsFilled++;
      candleMap.set(normalizedTime, {
        ...candle,
        time: new Date(normalizedTime)
      });
    }
  }

  const mergedCandles = Array.from(candleMap.entries())
    .sort(([timeA], [timeB]) => timeA - timeB)
    .map(([, candle]) => candle);

  return {
    candles: mergedCandles,
    stats: {
      apiCandles: apiCandles.length,
      dbCandles: dbCandles.length,
      duplicatesRemoved,
      gapsFilled,
      totalCandles: mergedCandles.length
    }
  };
}

export function detectGaps(
  candles: CandleData[],
  timeframe: Timeframe
): GapInfo[] {
  if (candles.length < 2) return [];

  const gaps: GapInfo[] = [];
  const timeframeMinutes = getTimeframeMinutes(timeframe);
  const expectedIntervalMs = timeframeMinutes * 60 * 1000;

  for (let i = 1; i < candles.length; i++) {
    const prevTime = candles[i - 1].time.getTime();
    const currTime = candles[i].time.getTime();
    const actualInterval = currTime - prevTime;

    if (actualInterval > expectedIntervalMs * 1.5) {
      const gapStart = new Date(prevTime + expectedIntervalMs);
      const gapEnd = new Date(currTime);

      const gapDurationHours = actualInterval / (60 * 60 * 1000);

      const isWeekendGap = isLikelyWeekendGap(new Date(prevTime), new Date(currTime));
      const missingTradingDays = isWeekendGap ? [] : marketHoursService.getTradingDaysBetween(gapStart, gapEnd);

      const isTradingDayGap = !isWeekendGap && missingTradingDays.length > 0;

      gaps.push({
        start: gapStart,
        end: gapEnd,
        isWeekend: isWeekendGap,
        isTradingDayGap,
        missingTradingDays
      });
    }
  }

  return gaps;
}

function isLikelyWeekendGap(prevTime: Date, currTime: Date): boolean {
  const prevDay = prevTime.getUTCDay();
  const currDay = currTime.getUTCDay();

  const gapDurationHours = (currTime.getTime() - prevTime.getTime()) / (60 * 60 * 1000);

  if (gapDurationHours >= 40 && gapDurationHours <= 72) {
    if ((prevDay === 5 || prevDay === 6) && (currDay === 0 || currDay === 1)) {
      return true;
    }

    if (prevDay === 5 && currDay === 0) {
      return true;
    }

    if (prevDay === 5 && currDay === 1 && gapDurationHours >= 48) {
      return true;
    }
  }

  return marketHoursService.isWeekend(prevTime) || marketHoursService.isWeekend(currTime);
}

function getTimeframeMinutes(timeframe: Timeframe): number {
  const map: Record<Timeframe, number> = {
    M1: 1,
    M5: 5,
    M15: 15,
    M30: 30,
    H1: 60,
    H4: 240,
    D1: 1440,
    W1: 10080,
    MN1: 43200
  };
  return map[timeframe] || 15;
}
