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
    const targetCandleCount = 500;

    this.activeSymbol = symbol;
    if (priorityTimeframe) {
      this.currentTimeframe = priorityTimeframe;
    }

    console.log(`🔍 Checking data completeness for ${symbol} across all timeframes ${priorityTimeframe ? `(priority: ${priorityTimeframe})` : ''}`);

    if (priorityTimeframe) {
      await this.checkTimeframeCompleteness(symbol, priorityTimeframe, targetCandleCount, true);
    }

    for (const timeframe of ALL_TIMEFRAMES) {
      if (timeframe !== priorityTimeframe) {
        await this.checkTimeframeCompleteness(symbol, timeframe, targetCandleCount, false);
      }
    }

    if (!this.isProcessing && this.backfillQueue.length > 0) {
      this.startProcessing();
    }
  }

  async checkAndBackfillTimeframe(symbol: string, timeframe: Timeframe): Promise<void> {
    const targetCandleCount = 500;

    this.activeSymbol = symbol;
    this.currentTimeframe = timeframe;

    console.log(`🔍 Checking data completeness for ${symbol} ${timeframe} (immediate check)`);
    await this.checkTimeframeCompleteness(symbol, timeframe, targetCandleCount, true);

    if (!this.isProcessing && this.backfillQueue.length > 0) {
      this.startProcessing();
    }
  }

  private async checkTimeframeCompleteness(
    symbol: string,
    timeframe: Timeframe,
    targetCandleCount: number = 500,
    isPriority: boolean = false
  ): Promise<void> {
    try {
      const existingCandles = await marketDataCache.getCachedCandles(
        symbol,
        timeframe,
        targetCandleCount
      );

      const actualCandles = existingCandles.length;
      const completeness = actualCandles / targetCandleCount;

      const completenessThreshold = isPriority ? 0.98 : 0.95;
      console.log(`📊 ${symbol} ${timeframe}: ${actualCandles}/${targetCandleCount} candles (${(completeness * 100).toFixed(1)}%) ${isPriority ? '[PRIORITY]' : ''}`);

      if (completeness < completenessThreshold) {
        console.log(`📥 Scheduling backfill for ${symbol} ${timeframe} (need ${targetCandleCount - actualCandles} more candles)`);

        const now = new Date();
        const startDate = this.calculateStartDateForCandleCount(timeframe, targetCandleCount, now);

        this.addBackfillTask({
          symbol,
          timeframe,
          startDate,
          endDate: now,
          priority: this.calculatePriority(timeframe, startDate)
        });
      } else {
        console.log(`✅ ${symbol} ${timeframe} has ${actualCandles}/${targetCandleCount} candles (complete)`);
      }
    } catch (error) {
      console.error(`Error checking ${symbol} ${timeframe}:`, error);
    }
  }

  private calculateStartDateForCandleCount(
    timeframe: Timeframe,
    candleCount: number,
    endDate: Date
  ): Date {
    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    const totalMinutes = timeframeMinutes * candleCount;
    const tradingDaysRatio = 7 / 5;
    const adjustedMinutes = totalMinutes * tradingDaysRatio;

    return new Date(endDate.getTime() - adjustedMinutes * 60 * 1000);
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
      const candles = await metaApiService.getHistoricalCandles(
        task.symbol,
        task.timeframe,
        task.startDate,
        500
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
