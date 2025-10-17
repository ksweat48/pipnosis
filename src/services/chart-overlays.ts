import { Time, LineData } from 'lightweight-charts';
import { marketHoursService } from './market-hours';
import { Candle } from '../lib/indicators';
import { calculateLinearRegression } from '../strategies/indicators/linearRegression';
import { calculateHalfTrend } from '../strategies/indicators/halfTrend';
import { convertToHeikinAshi } from '../strategies/indicators/heikinAshi';

export interface DaySeparator {
  startTime: number;
  endTime: number;
  dayOfWeek: number;
  isAlternate: boolean;
  color: string;
}

export interface MarketClosedOverlay {
  startTime: number;
  endTime: number;
  color: string;
}

export interface StrategyAnnotation {
  time: Time;
  price: number;
  type: 'entry' | 'stop_loss' | 'take_profit' | 'breakeven';
  direction: 'BUY' | 'SELL';
  label: string;
  color: string;
}

class ChartOverlayService {
  private readonly DAY_COLOR_LIGHT = 'rgba(30, 41, 59, 0.3)';
  private readonly DAY_COLOR_DARK = 'rgba(15, 23, 42, 0.3)';
  private readonly MARKET_CLOSED_COLOR = 'rgba(239, 68, 68, 0.2)';

  getDaySeparators(timestamps: Time[]): DaySeparator[] {
    if (timestamps.length === 0) {
      return [];
    }

    const separators: DaySeparator[] = [];
    const days = new Map<string, { start: number; end: number; dayOfWeek: number }>();

    timestamps.forEach(time => {
      const timestamp = typeof time === 'number' ? time * 1000 : new Date(time as string).getTime();
      const date = new Date(timestamp);
      const dayKey = this.getDayKey(date);
      const dayOfWeek = date.getDay();

      if (!days.has(dayKey)) {
        days.set(dayKey, {
          start: timestamp,
          end: timestamp,
          dayOfWeek
        });
      } else {
        const day = days.get(dayKey)!;
        day.end = Math.max(day.end, timestamp);
      }
    });

    const sortedDays = Array.from(days.entries())
      .sort((a, b) => a[1].start - b[1].start);

    sortedDays.forEach(([_, day], index) => {
      const isAlternate = index % 2 === 0;
      separators.push({
        startTime: Math.floor(day.start / 1000),
        endTime: Math.floor(day.end / 1000),
        dayOfWeek: day.dayOfWeek,
        isAlternate,
        color: isAlternate ? this.DAY_COLOR_LIGHT : this.DAY_COLOR_DARK
      });
    });

    return separators;
  }

  getMarketClosedOverlays(timestamps: Time[]): MarketClosedOverlay[] {
    if (timestamps.length === 0) {
      return [];
    }

    const overlays: MarketClosedOverlay[] = [];
    const closedDays = new Map<string, { start: number; end: number }>();

    timestamps.forEach(time => {
      const timestamp = typeof time === 'number' ? time * 1000 : new Date(time as string).getTime();
      const date = new Date(timestamp);

      if (!marketHoursService.isTradingDay(date)) {
        const dayKey = this.getDayKey(date);

        if (!closedDays.has(dayKey)) {
          closedDays.set(dayKey, {
            start: timestamp,
            end: timestamp
          });
        } else {
          const closedDay = closedDays.get(dayKey)!;
          closedDay.end = Math.max(closedDay.end, timestamp);
        }
      }
    });

    closedDays.forEach(closedDay => {
      overlays.push({
        startTime: Math.floor(closedDay.start / 1000),
        endTime: Math.floor(closedDay.end / 1000),
        color: this.MARKET_CLOSED_COLOR
      });
    });

    return overlays;
  }

  getNextMarketClosedOverlay(latestTimestamp: Time): MarketClosedOverlay | null {
    const timestamp = typeof latestTimestamp === 'number' ? latestTimestamp * 1000 : new Date(latestTimestamp as string).getTime();
    const fromDate = new Date(timestamp);
    const now = new Date();

    const currentClosePeriod = marketHoursService.getCurrentMarketClosePeriod(now);
    if (currentClosePeriod) {
      const overlayStartTime = Math.max(
        Math.floor(currentClosePeriod.start.getTime() / 1000),
        Math.floor(timestamp / 1000)
      );

      const overlayEndTime = Math.min(
        Math.floor(currentClosePeriod.end.getTime() / 1000),
        Math.floor(now.getTime() / 1000)
      );

      if (overlayStartTime < overlayEndTime) {
        return {
          startTime: overlayStartTime,
          endTime: overlayEndTime,
          color: this.MARKET_CLOSED_COLOR
        };
      }
    }

    return null;
  }

  private getDayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  getSignalLineData(candles: Candle[], period: number = 50): LineData<Time>[] {
    try {
      const regressionValues = calculateLinearRegression(candles, period);

      return regressionValues.map((val, index) => ({
        time: Math.floor(candles[period - 1 + index].time instanceof Date
          ? candles[period - 1 + index].time.getTime() / 1000
          : (candles[period - 1 + index].time as any)) as Time,
        value: val.value
      }));
    } catch (error) {
      console.error('Error calculating Signal Line:', error);
      return [];
    }
  }

  getHalfTrendData(candles: Candle[]): LineData<Time>[] {
    try {
      const halfTrendValues = calculateHalfTrend(candles);

      return halfTrendValues.map((val, index) => ({
        time: Math.floor(val.timestamp.getTime() / 1000) as Time,
        value: val.value
      }));
    } catch (error) {
      console.error('Error calculating HalfTrend:', error);
      return [];
    }
  }

  getHeikinAshiData(candles: Candle[]): Array<{
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
  }> {
    try {
      const haCandles = convertToHeikinAshi(candles);

      return haCandles.map(candle => ({
        time: Math.floor(candle.time.getTime() / 1000) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close
      }));
    } catch (error) {
      console.error('Error calculating Heikin Ashi:', error);
      return [];
    }
  }

  createStrategyAnnotations(
    signal: {
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      direction: 'BUY' | 'SELL';
      timestamp: Date;
    }
  ): StrategyAnnotation[] {
    const time = Math.floor(signal.timestamp.getTime() / 1000) as Time;
    const annotations: StrategyAnnotation[] = [];

    annotations.push({
      time,
      price: signal.entryPrice,
      type: 'entry',
      direction: signal.direction,
      label: `${signal.direction} @ ${signal.entryPrice.toFixed(5)}`,
      color: signal.direction === 'BUY' ? '#10b981' : '#ef4444'
    });

    annotations.push({
      time,
      price: signal.stopLoss,
      type: 'stop_loss',
      direction: signal.direction,
      label: `SL: ${signal.stopLoss.toFixed(5)}`,
      color: '#ef4444'
    });

    annotations.push({
      time,
      price: signal.takeProfit,
      type: 'take_profit',
      direction: signal.direction,
      label: `TP: ${signal.takeProfit.toFixed(5)}`,
      color: '#10b981'
    });

    const riskDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    const breakEvenPrice = signal.direction === 'BUY'
      ? signal.entryPrice + riskDistance
      : signal.entryPrice - riskDistance;

    annotations.push({
      time,
      price: breakEvenPrice,
      type: 'breakeven',
      direction: signal.direction,
      label: `BE: ${breakEvenPrice.toFixed(5)}`,
      color: '#f59e0b'
    });

    return annotations;
  }

}

export const chartOverlayService = new ChartOverlayService();
