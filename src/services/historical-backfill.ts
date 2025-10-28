import { metaApiService } from './metaapi-stub';
import { supabase } from '../lib/supabase';
import { CandleData, Timeframe } from '../types/market-data';
import { marketDataCache } from './market-data-cache';
import { gapDetectionService, DateGap } from './gap-detection';
import { dataValidator } from './data-validator';

export interface BackfillTask {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  startDate: Date;
  endDate: Date;
  priority: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  candlesTarget: number;
  candlesFetched: number;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface BackfillProgress {
  taskId: string;
  totalSteps: number;
  completedSteps: number;
  currentStep: string;
  percentComplete: number;
}

class HistoricalBackfillService {
  private activeTasks: Map<string, BackfillTask> = new Map();
  private progressCallbacks: Map<string, (progress: BackfillProgress) => void> = new Map();

  async backfillDateRange(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date,
    priority: number = 100
  ): Promise<BackfillTask> {
    const taskId = `${symbol}_${timeframe}_${startDate.getTime()}_${endDate.getTime()}`;

    const existingTask = this.activeTasks.get(taskId);
    if (existingTask && existingTask.status === 'in_progress') {
      console.log(`⚠️ Task ${taskId} is already in progress`);
      return existingTask;
    }

    const expectedCandles = this.calculateExpectedCandles(timeframe, startDate, endDate);

    const task: BackfillTask = {
      id: taskId,
      symbol,
      timeframe,
      startDate,
      endDate,
      priority,
      status: 'pending',
      candlesTarget: expectedCandles,
      candlesFetched: 0,
      createdAt: new Date()
    };

    this.activeTasks.set(taskId, task);

    await this.saveBackfillTask(task);

    this.executeBackfillTask(task);

    return task;
  }

  async backfillOctoberEighth(
    symbols: string[] = ['EURUSD', 'GBPUSD', 'XAUUSD'],
    timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']
  ): Promise<BackfillTask[]> {
    const oct8Start = new Date('2024-10-08T00:00:00Z');
    const oct8End = new Date('2024-10-08T23:59:59Z');

    console.log('🎯 Starting October 8th backfill operation...');
    console.log(`📊 Symbols: ${symbols.join(', ')}`);
    console.log(`⏱️ Timeframes: ${timeframes.join(', ')}`);

    const tasks: BackfillTask[] = [];

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        const priority = this.calculatePriority(timeframe, oct8Start);

        const task = await this.backfillDateRange(
          symbol,
          timeframe,
          oct8Start,
          oct8End,
          priority
        );

        tasks.push(task);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return tasks;
  }

  async backfillDetectedGaps(
    symbol: string,
    timeframe: Timeframe,
    gaps: DateGap[]
  ): Promise<BackfillTask[]> {
    const tasks: BackfillTask[] = [];

    const criticalGaps = gaps.filter(g => g.severity === 'critical' && g.isTradingHours);
    const moderateGaps = gaps.filter(g => g.severity === 'moderate' && g.isTradingHours);

    console.log(`🔧 Backfilling ${criticalGaps.length} critical and ${moderateGaps.length} moderate gaps`);

    const gapsToFill = [...criticalGaps, ...moderateGaps];

    for (const gap of gapsToFill) {
      const priority = gap.severity === 'critical' ? 200 : 100;

      const task = await this.backfillDateRange(
        symbol,
        timeframe,
        gap.startTime,
        gap.endTime,
        priority
      );

      tasks.push(task);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return tasks;
  }

  async backfillProblemDates(
    symbol: string,
    timeframe: Timeframe,
    problemDates: string[]
  ): Promise<BackfillTask[]> {
    const tasks: BackfillTask[] = [];

    console.log(`📅 Backfilling ${problemDates.length} problem dates for ${symbol} ${timeframe}`);

    for (const dateStr of problemDates) {
      const date = new Date(dateStr);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const task = await this.backfillDateRange(
        symbol,
        timeframe,
        startOfDay,
        endOfDay,
        150
      );

      tasks.push(task);
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    return tasks;
  }

  private async executeBackfillTask(task: BackfillTask): Promise<void> {
    try {
      task.status = 'in_progress';
      await this.updateBackfillTask(task);

      this.reportProgress(task.id, {
        taskId: task.id,
        totalSteps: 4,
        completedSteps: 0,
        currentStep: 'Analyzing existing data',
        percentComplete: 0
      });

      const existingCandles = await this.getExistingCandles(
        task.symbol,
        task.timeframe,
        task.startDate,
        task.endDate
      );

      this.reportProgress(task.id, {
        taskId: task.id,
        totalSteps: 4,
        completedSteps: 1,
        currentStep: 'Fetching data from MetaAPI',
        percentComplete: 25
      });

      const fetchedCandles = await this.fetchHistoricalData(
        task.symbol,
        task.timeframe,
        task.startDate,
        task.endDate
      );

      task.candlesFetched = fetchedCandles.length;

      this.reportProgress(task.id, {
        taskId: task.id,
        totalSteps: 4,
        completedSteps: 2,
        currentStep: 'Validating and merging data',
        percentComplete: 50
      });

      const mergedCandles = this.mergeCandles(existingCandles, fetchedCandles, task.timeframe);

      this.reportProgress(task.id, {
        taskId: task.id,
        totalSteps: 4,
        completedSteps: 3,
        currentStep: 'Saving to database',
        percentComplete: 75
      });

      await this.saveMergedCandles(mergedCandles);

      task.status = 'completed';
      task.completedAt = new Date();

      this.reportProgress(task.id, {
        taskId: task.id,
        totalSteps: 4,
        completedSteps: 4,
        currentStep: 'Completed',
        percentComplete: 100
      });

      console.log(
        `✅ Backfill completed for ${task.symbol} ${task.timeframe}: ` +
        `${task.candlesFetched} candles fetched, ${mergedCandles.length} total after merge`
      );
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Backfill failed for ${task.symbol} ${task.timeframe}:`, error);
    } finally {
      await this.updateBackfillTask(task);
      this.activeTasks.delete(task.id);
    }
  }

  private async getExistingCandles(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<CandleData[]> {
    const { data, error } = await supabase
      .from('market_data')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Error fetching existing candles:', error);
      return [];
    }

    return (data || []).map(row => ({
      symbol: row.symbol,
      timeframe: row.timeframe,
      time: new Date(row.timestamp),
      brokerTime: row.broker_time || row.timestamp,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      tickVolume: row.tick_volume || 0,
      spread: row.spread || 0,
      volume: parseFloat(row.volume) || 0
    }));
  }

  private async fetchHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<CandleData[]> {
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(
          `📡 Fetching ${symbol} ${timeframe} from ${startDate.toISOString()} to ${endDate.toISOString()} ` +
          `(attempt ${attempt}/${MAX_RETRIES})`
        );

        const candles = await metaApiService.getHistoricalCandles(
          symbol,
          timeframe,
          startDate,
          1000
        );

        const filteredCandles = candles.filter(
          c => c.time >= startDate && c.time <= endDate
        );

        console.log(`📊 Fetched ${filteredCandles.length} candles from MetaAPI`);
        return filteredCandles;
      } catch (error) {
        lastError = error as Error;
        console.error(`⚠️ Attempt ${attempt} failed:`, error);

        if (attempt < MAX_RETRIES) {
          const delay = 1000 * Math.pow(2, attempt - 1);
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Failed to fetch historical data after retries');
  }

  private mergeCandles(
    existingCandles: CandleData[],
    fetchedCandles: CandleData[],
    timeframe: Timeframe
  ): CandleData[] {
    const candleMap = new Map<number, CandleData>();

    for (const candle of existingCandles) {
      const normalizedTime = this.normalizeTimestamp(candle.time, timeframe).getTime();
      candleMap.set(normalizedTime, candle);
    }

    let newCandlesAdded = 0;

    for (const candle of fetchedCandles) {
      const normalizedTime = this.normalizeTimestamp(candle.time, timeframe).getTime();

      if (!candleMap.has(normalizedTime)) {
        candleMap.set(normalizedTime, candle);
        newCandlesAdded++;
      }
    }

    console.log(`🔀 Merged ${newCandlesAdded} new candles with ${existingCandles.length} existing candles`);

    const mergedCandles = Array.from(candleMap.values()).sort(
      (a, b) => a.time.getTime() - b.time.getTime()
    );

    const validatedCandles = dataValidator.validateAndRepairCandleSequence(
      mergedCandles,
      timeframe,
      false
    );

    return validatedCandles;
  }

  private async saveMergedCandles(candles: CandleData[]): Promise<void> {
    if (candles.length === 0) return;

    const BATCH_SIZE = 100;

    for (let i = 0; i < candles.length; i += BATCH_SIZE) {
      const batch = candles.slice(i, i + BATCH_SIZE);
      await marketDataCache.saveCandles(batch, true);

      if (candles.length > BATCH_SIZE) {
        console.log(`💾 Saved batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(candles.length / BATCH_SIZE)}`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  private normalizeTimestamp(time: Date, timeframe: Timeframe): Date {
    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    const timestamp = time.getTime();
    const normalized = Math.floor(timestamp / (timeframeMinutes * 60 * 1000)) * (timeframeMinutes * 60 * 1000);
    return new Date(normalized);
  }

  private calculateExpectedCandles(
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): number {
    const durationMs = endDate.getTime() - startDate.getTime();
    const durationMinutes = durationMs / (60 * 1000);
    const timeframeMinutes = this.getTimeframeMinutes(timeframe);
    return Math.floor(durationMinutes / timeframeMinutes);
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

  private calculatePriority(timeframe: Timeframe, gapDate: Date): number {
    const now = Date.now();
    const ageHours = (now - gapDate.getTime()) / (60 * 60 * 1000);

    const timeframePriority: Record<Timeframe, number> = {
      M15: 100,
      M5: 90,
      M30: 80,
      H1: 70,
      M1: 60,
      H4: 50,
      D1: 40,
      W1: 30,
      MN1: 20
    };

    const recencyBonus = Math.max(0, 100 - ageHours);
    return timeframePriority[timeframe] + recencyBonus;
  }

  private async saveBackfillTask(task: BackfillTask): Promise<void> {
    const { error } = await supabase.from('backfill_tasks').upsert({
      id: task.id,
      symbol: task.symbol,
      timeframe: task.timeframe,
      start_date: task.startDate.toISOString(),
      end_date: task.endDate.toISOString(),
      priority: task.priority,
      status: task.status,
      candles_target: task.candlesTarget,
      candles_fetched: task.candlesFetched,
      error: task.error,
      created_at: task.createdAt.toISOString(),
      completed_at: task.completedAt?.toISOString()
    });

    if (error) {
      console.error('Error saving backfill task:', error);
    }
  }

  private async updateBackfillTask(task: BackfillTask): Promise<void> {
    const { error } = await supabase
      .from('backfill_tasks')
      .update({
        status: task.status,
        candles_fetched: task.candlesFetched,
        error: task.error,
        completed_at: task.completedAt?.toISOString()
      })
      .eq('id', task.id);

    if (error) {
      console.error('Error updating backfill task:', error);
    }
  }

  onProgress(taskId: string, callback: (progress: BackfillProgress) => void): void {
    this.progressCallbacks.set(taskId, callback);
  }

  private reportProgress(taskId: string, progress: BackfillProgress): void {
    const callback = this.progressCallbacks.get(taskId);
    if (callback) {
      callback(progress);
    }
  }

  getActiveTask(taskId: string): BackfillTask | undefined {
    return this.activeTasks.get(taskId);
  }

  async getTaskStatus(taskId: string): Promise<BackfillTask | null> {
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      return activeTask;
    }

    const { data, error } = await supabase
      .from('backfill_tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      symbol: data.symbol,
      timeframe: data.timeframe,
      startDate: new Date(data.start_date),
      endDate: new Date(data.end_date),
      priority: data.priority,
      status: data.status,
      candlesTarget: data.candles_target,
      candlesFetched: data.candles_fetched,
      error: data.error,
      createdAt: new Date(data.created_at),
      completedAt: data.completed_at ? new Date(data.completed_at) : undefined
    };
  }

  async getAllBackfillTasks(limit: number = 50): Promise<BackfillTask[]> {
    const { data, error } = await supabase
      .from('backfill_tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching backfill tasks:', error);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      symbol: row.symbol,
      timeframe: row.timeframe,
      startDate: new Date(row.start_date),
      endDate: new Date(row.end_date),
      priority: row.priority,
      status: row.status,
      candlesTarget: row.candles_target,
      candlesFetched: row.candles_fetched,
      error: row.error,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined
    }));
  }
}

export const historicalBackfillService = new HistoricalBackfillService();
