import { Timeframe, CandleData } from './metaapi';
import { marketDataCache } from './market-data-cache';
import { metaApiService } from './metaapi';
import { marketHoursService } from './market-hours';

interface BackfillTask {
  symbol: string;
  timeframe: Timeframe;
  startDate: Date;
  endDate: Date;
  priority: number;
}

const ALL_TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

class TimeframeBackfillService {
  private backfillQueue: BackfillTask[] = [];
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private currentTimeframe: Timeframe | null = null;
  private activeSymbol: string | null = null;

  async checkAndBackfillAllTimeframes(symbol: string, priorityTimeframe?: Timeframe): Promise<void> {
    const now = new Date();
    const lookbackDays = 7;
    const startDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    this.activeSymbol = symbol;
    if (priorityTimeframe) {
      this.currentTimeframe = priorityTimeframe;
    }

    console.log(`🔍 Checking data completeness for ${symbol} across all timeframes ${priorityTimeframe ? `(priority: ${priorityTimeframe})` : ''}`);

    if (priorityTimeframe) {
      await this.checkTimeframeCompleteness(symbol, priorityTimeframe, startDate, now, true);
    }

    for (const timeframe of ALL_TIMEFRAMES) {
      if (timeframe !== priorityTimeframe) {
        await this.checkTimeframeCompleteness(symbol, timeframe, startDate, now, false);
      }
    }

    if (!this.isProcessing && this.backfillQueue.length > 0) {
      this.startProcessing();
    }
  }

  async checkAndBackfillTimeframe(symbol: string, timeframe: Timeframe): Promise<void> {
    const now = new Date();
    const lookbackDays = 7;
    const startDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    this.activeSymbol = symbol;
    this.currentTimeframe = timeframe;

    console.log(`🔍 Checking data completeness for ${symbol} ${timeframe} (immediate check)`);
    await this.checkTimeframeCompleteness(symbol, timeframe, startDate, now, true);

    if (!this.isProcessing && this.backfillQueue.length > 0) {
      this.startProcessing();
    }
  }

  private async checkTimeframeCompleteness(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date,
    isPriority: boolean = false
  ): Promise<void> {
    try {
      const existingCandles = await marketDataCache.getCachedCandles(
        symbol,
        timeframe,
        startDate,
        endDate
      );

      const expectedCandles = this.calculateExpectedCandleCount(timeframe, startDate, endDate);
      const actualCandles = existingCandles.length;
      const completeness = actualCandles / expectedCandles;

      const completenessThreshold = isPriority ? 0.98 : 0.95;
      console.log(`📊 ${symbol} ${timeframe}: ${actualCandles}/${expectedCandles} candles (${(completeness * 100).toFixed(1)}%) ${isPriority ? '[PRIORITY]' : ''}`);

      if (completeness < completenessThreshold) {
        const gaps = this.detectGaps(existingCandles, timeframe, startDate, endDate);

        if (gaps.length > 0) {
          console.log(`⚠️ Found ${gaps.length} gaps in ${symbol} ${timeframe}`);

          for (const gap of gaps) {
            this.addBackfillTask({
              symbol,
              timeframe,
              startDate: gap.start,
              endDate: gap.end,
              priority: this.calculatePriority(timeframe, gap.start)
            });
          }
        } else if (actualCandles === 0) {
          console.log(`📥 Scheduling full backfill for ${symbol} ${timeframe}`);
          this.addBackfillTask({
            symbol,
            timeframe,
            startDate,
            endDate,
            priority: this.calculatePriority(timeframe, startDate)
          });
        }
      } else {
        console.log(`✅ ${symbol} ${timeframe} data is complete`);
      }
    } catch (error) {
      console.error(`Error checking ${symbol} ${timeframe}:`, error);
    }
  }

  private detectGaps(
    candles: CandleData[],
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Array<{ start: Date; end: Date }> {
    if (candles.length === 0) {
      return [{ start: startDate, end: endDate }];
    }

    const gaps: Array<{ start: Date; end: Date }> = [];
    const sortedCandles = candles.sort((a, b) => a.time.getTime() - b.time.getTime());
    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    const expectedIntervalMs = timeframeMinutes * 60 * 1000;

    if (sortedCandles[0].time.getTime() - startDate.getTime() > expectedIntervalMs * 2) {
      gaps.push({
        start: startDate,
        end: new Date(sortedCandles[0].time.getTime() - expectedIntervalMs)
      });
    }

    for (let i = 1; i < sortedCandles.length; i++) {
      const prevTime = sortedCandles[i - 1].time.getTime();
      const currTime = sortedCandles[i].time.getTime();
      const actualInterval = currTime - prevTime;

      if (actualInterval > expectedIntervalMs * 2) {
        const gapStart = new Date(prevTime + expectedIntervalMs);
        const gapEnd = new Date(currTime - expectedIntervalMs);

        const tradingDays = marketHoursService.getTradingDaysBetween(gapStart, gapEnd);
        if (tradingDays.length > 0) {
          gaps.push({ start: gapStart, end: gapEnd });
        }
      }
    }

    const lastCandleTime = sortedCandles[sortedCandles.length - 1].time.getTime();
    if (endDate.getTime() - lastCandleTime > expectedIntervalMs * 2) {
      gaps.push({
        start: new Date(lastCandleTime + expectedIntervalMs),
        end: endDate
      });
    }

    return gaps;
  }

  private calculateExpectedCandleCount(
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): number {
    const totalMinutes = (endDate.getTime() - startDate.getTime()) / (60 * 1000);
    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    const tradingDaysRatio = 5 / 7;
    const tradingHoursRatio = 24 / 24;

    return Math.floor((totalMinutes / timeframeMinutes) * tradingDaysRatio * tradingHoursRatio);
  }

  private getTimeframeMinutes(timeframe: Timeframe): number {
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

  private calculatePriority(timeframe: Timeframe, gapStart: Date): number {
    const now = Date.now();
    const ageHours = (now - gapStart.getTime()) / (60 * 60 * 1000);

    const timeframePriority: Record<Timeframe, number> = {
      M1: 1,
      M5: 2,
      M15: 3,
      M30: 4,
      H1: 5,
      H4: 6,
      D1: 7,
      W1: 8,
      MN1: 9
    };

    const recencyBonus = Math.max(0, 100 - ageHours);
    let basePriority = timeframePriority[timeframe] * 10 + recencyBonus;

    if (this.currentTimeframe === timeframe) {
      basePriority += 1000;
    }

    return basePriority;
  }

  private addBackfillTask(task: BackfillTask): void {
    const exists = this.backfillQueue.some(
      t => t.symbol === task.symbol &&
           t.timeframe === task.timeframe &&
           t.startDate.getTime() === task.startDate.getTime()
    );

    if (!exists) {
      this.backfillQueue.push(task);
      this.backfillQueue.sort((a, b) => b.priority - a.priority);
      console.log(`📋 Added backfill task: ${task.symbol} ${task.timeframe} (priority: ${task.priority})`);
    }
  }

  private startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    console.log('🚀 Starting backfill processing');

    this.processingInterval = setInterval(() => {
      this.processNextTask();
    }, 2000);
  }

  private async processNextTask(): Promise<void> {
    if (this.backfillQueue.length === 0) {
      this.stopProcessing();
      return;
    }

    const task = this.backfillQueue.shift();
    if (!task) return;

    try {
      console.log(`⏳ Processing backfill: ${task.symbol} ${task.timeframe} from ${task.startDate.toISOString()}`);

      await this.fetchAndStoreData(task);

      console.log(`✅ Completed backfill: ${task.symbol} ${task.timeframe}`);
    } catch (error) {
      console.error(`❌ Backfill failed for ${task.symbol} ${task.timeframe}:`, error);

      if (task.priority > 0) {
        task.priority -= 10;
        this.backfillQueue.push(task);
      }
    }
  }

  private async fetchAndStoreData(task: BackfillTask): Promise<void> {
    try {
      const limit = Math.min(1000, this.calculateExpectedCandleCount(
        task.timeframe,
        task.startDate,
        task.endDate
      ));

      const candles = await metaApiService.getHistoricalCandles(
        task.symbol,
        task.timeframe,
        task.startDate,
        limit
      );

      if (candles.length > 0) {
        await marketDataCache.saveCandles(candles, true);
        console.log(`💾 Stored ${candles.length} candles for ${task.symbol} ${task.timeframe}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('demo mode')) {
        console.warn(`⚠️ Cannot backfill in demo mode: ${task.symbol} ${task.timeframe}`);
      } else {
        throw error;
      }
    }
  }

  private stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.isProcessing = false;
    console.log('✅ Backfill processing completed');
  }

  getQueueStatus(): { pending: number; tasks: BackfillTask[] } {
    return {
      pending: this.backfillQueue.length,
      tasks: [...this.backfillQueue]
    };
  }

  stop(): void {
    this.stopProcessing();
    this.backfillQueue = [];
  }
}

export const timeframeBackfillService = new TimeframeBackfillService();
