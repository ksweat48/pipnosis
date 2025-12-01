/**
 * Backfill Orchestrator
 * Coordinates historical data backfill with validation and safety checks
 */

const { createClient } = require('@supabase/supabase-js');
const { CandleValidator } = require('./candle-validator');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

class BackfillOrchestrator {
  constructor(supabaseUrl, supabaseKey, dataFetcher) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.dataFetcher = dataFetcher;
    this.validator = new CandleValidator();
    this.executionId = this.generateExecutionId();
  }

  generateExecutionId() {
    return `backfill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Convert database timeframe format to data source format
  timeframeToSourceFormat(dbTimeframe) {
    const mapping = {
      'M1': '1m', 'M5': '5m', 'M15': '15m', 'M30': '30m',
      'H1': '1h', 'H4': '4h', 'D1': '1d', 'W1': '1w'
    };
    return mapping[dbTimeframe] || dbTimeframe;
  }

  // Log execution details
  async logExecution(symbol, timeframe, batchNumber, candlesCount, sourceUsed, durationMs, success, errorMessage = null) {
    try {
      await this.supabase.from('backfill_execution_log').insert({
        execution_id: this.executionId,
        symbol,
        timeframe,
        batch_number: batchNumber,
        candles_count: candlesCount,
        source_used: sourceUsed,
        duration_ms: durationMs,
        success,
        error_message: errorMessage,
      });
    } catch (error) {
      console.error('[BackfillOrchestrator] Error logging execution:', error.message);
    }
  }

  // Update progress
  async updateProgress(symbol, timeframe, startTime, endTime, status, candlesFetched, candlesInserted, candlesRejected, lastCandleTime, dataSource, errorMessage = null) {
    try {
      const { data, error } = await this.supabase
        .from('backfill_progress')
        .upsert({
          symbol,
          timeframe,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          candles_fetched: candlesFetched,
          candles_inserted: candlesInserted,
          candles_rejected: candlesRejected,
          status,
          data_source: dataSource,
          error_message: errorMessage,
          last_candle_time: lastCandleTime ? lastCandleTime.toISOString() : null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'symbol,timeframe,start_time',
        });

      if (error) {
        console.error('[BackfillOrchestrator] Error updating progress:', error);
      }
    } catch (error) {
      console.error('[BackfillOrchestrator] Error updating progress:', error.message);
    }
  }

  // Log validation stats
  async logValidationStats(symbol, timeframe, stats) {
    try {
      await this.supabase.from('backfill_validation_stats').insert({
        symbol,
        timeframe,
        date: new Date().toISOString().split('T')[0],
        total_candles: stats.total,
        valid_candles: stats.valid,
        invalid_range: stats.invalidRange,
        invalid_structure: stats.invalidStructure,
        contamination_detected: stats.contamination,
      });
    } catch (error) {
      console.error('[BackfillOrchestrator] Error logging validation stats:', error.message);
    }
  }

  // Check for existing candles to avoid duplicates
  async getExistingCandleTimes(symbol, timeframe, startTime, endTime) {
    try {
      const { data, error} = await this.supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('open_time', startTime.toISOString())
        .lte('open_time', endTime.toISOString());

      if (error) {
        console.error('[BackfillOrchestrator] Error fetching existing candles:', error);
        return new Set();
      }

      return new Set(data.map(row => Math.floor(new Date(row.open_time).getTime() / 1000)));
    } catch (error) {
      console.error('[BackfillOrchestrator] Error fetching existing candles:', error.message);
      return new Set();
    }
  }

  // Insert candles in batches
  async insertCandlesBatch(candles, batchSize = 1000) {
    const inserted = [];
    const failed = [];

    for (let i = 0; i < candles.length; i += batchSize) {
      const batch = candles.slice(i, i + batchSize);

      try {
        const { data, error } = await this.supabase
          .from('forex_candles')
          .upsert(
            batch.map(candle => {
              const openTime = new Date(candle.time * 1000);
              // Calculate close_time based on timeframe
              const timeframeMinutes = {
                'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
                'H1': 60, 'H4': 240, 'D1': 1440, 'W1': 10080
              };
              const minutes = timeframeMinutes[candle.timeframe] || 60;
              const closeTime = new Date(openTime.getTime() + minutes * 60 * 1000);

              return {
                symbol: candle.symbol,
                timeframe: candle.timeframe,
                open_time: openTime.toISOString(),
                close_time: closeTime.toISOString(),
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume || 0,
                data_source: candle.source || 'backfill',
              };
            }),
            {
              onConflict: 'symbol,timeframe,open_time',
              ignoreDuplicates: false,
            }
          );

        if (error) {
          console.error(`[BackfillOrchestrator] Batch insert error:`, error.message);
          failed.push(...batch);
        } else {
          inserted.push(...batch);
        }
      } catch (error) {
        console.error(`[BackfillOrchestrator] Batch insert exception:`, error.message);
        failed.push(...batch);
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return { inserted, failed };
  }

  // Backfill single symbol/timeframe
  async backfillSymbolTimeframe(symbol, timeframe, startDate, endDate) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔄 Starting backfill: ${symbol} ${timeframe}`);
    console.log(`   Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`${'='.repeat(80)}\n`);

    const startTime = Date.now();
    let totalFetched = 0;
    let totalInserted = 0;
    let totalRejected = 0;
    let lastCandleTime = null;
    let dataSource = null;

    try {
      // Update status to running
      await this.updateProgress(symbol, timeframe, startDate, endDate, 'running', 0, 0, 0, null, null);

      // Fetch candles from data source
      console.log(`[${symbol}] Fetching data...`);
      const sourceTimeframe = this.timeframeToSourceFormat(timeframe);
      const { candles: rawCandles, source } = await this.dataFetcher.fetchCandles(
        symbol,
        sourceTimeframe,
        startDate,
        endDate
      );

      dataSource = source;
      totalFetched = rawCandles.length;

      if (totalFetched === 0) {
        console.log(`[${symbol}] ⚠️  No data received from any source`);
        await this.updateProgress(
          symbol,
          timeframe,
          startDate,
          endDate,
          'failed',
          0,
          0,
          0,
          null,
          dataSource,
          'No data from any source'
        );
        return { success: false, inserted: 0, rejected: 0 };
      }

      console.log(`[${symbol}] ✅ Fetched ${totalFetched} candles from ${source}`);

      // Validate candles
      console.log(`[${symbol}] Validating candles...`);
      this.validator.resetStats();
      const validation = this.validator.validateBatch(
        rawCandles.map(c => ({ ...c, symbol })),
        symbol
      );

      totalRejected = validation.invalid.length;

      console.log(`[${symbol}] Validation results:`);
      console.log(`   ✅ Valid: ${validation.valid.length}`);
      console.log(`   ❌ Rejected: ${totalRejected}`);
      if (validation.stats.contamination > 0) {
        console.log(`   🚨 Contamination detected: ${validation.stats.contamination}`);
      }

      // Log validation stats
      await this.logValidationStats(symbol, timeframe, validation.stats);

      if (validation.valid.length === 0) {
        console.log(`[${symbol}] ⚠️  No valid candles after validation`);
        await this.updateProgress(
          symbol,
          timeframe,
          startDate,
          endDate,
          'failed',
          totalFetched,
          0,
          totalRejected,
          null,
          dataSource,
          'All candles rejected by validation'
        );
        return { success: false, inserted: 0, rejected: totalRejected };
      }

      // Check for existing candles to avoid duplicates
      console.log(`[${symbol}] Checking for existing candles...`);
      const existingTimes = await this.getExistingCandleTimes(symbol, timeframe, startDate, endDate);

      // Filter out duplicates
      const newCandles = validation.valid
        .filter(candle => !existingTimes.has(candle.time))
        .map(candle => ({
          ...candle,
          timeframe,
        }));

      console.log(`[${symbol}] New candles to insert: ${newCandles.length} (${existingTimes.size} already exist)`);

      if (newCandles.length === 0) {
        console.log(`[${symbol}] ✅ All candles already exist, marking as complete`);
        await this.updateProgress(
          symbol,
          timeframe,
          startDate,
          endDate,
          'completed',
          totalFetched,
          0,
          totalRejected,
          endDate,
          dataSource
        );
        return { success: true, inserted: 0, rejected: totalRejected };
      }

      // Insert candles
      console.log(`[${symbol}] Inserting candles...`);
      const { inserted, failed } = await this.insertCandlesBatch(newCandles);

      totalInserted = inserted.length;
      const insertFailed = failed.length;

      if (inserted.length > 0) {
        const times = inserted.map(c => c.time).sort((a, b) => b - a);
        lastCandleTime = new Date(times[0] * 1000);
      }

      console.log(`[${symbol}] Insert results:`);
      console.log(`   ✅ Inserted: ${totalInserted}`);
      console.log(`   ❌ Failed: ${insertFailed}`);

      // Log execution
      const duration = Date.now() - startTime;
      await this.logExecution(
        symbol,
        timeframe,
        1,
        totalInserted,
        dataSource,
        duration,
        true
      );

      // Update final progress
      await this.updateProgress(
        symbol,
        timeframe,
        startDate,
        endDate,
        'completed',
        totalFetched,
        totalInserted,
        totalRejected,
        lastCandleTime,
        dataSource
      );

      console.log(`\n✅ Backfill complete for ${symbol} ${timeframe}`);
      console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`   Success rate: ${((totalInserted / totalFetched) * 100).toFixed(1)}%\n`);

      return {
        success: true,
        inserted: totalInserted,
        rejected: totalRejected,
        duration,
      };

    } catch (error) {
      console.error(`\n❌ Backfill failed for ${symbol} ${timeframe}:`, error.message);

      await this.updateProgress(
        symbol,
        timeframe,
        startDate,
        endDate,
        'failed',
        totalFetched,
        totalInserted,
        totalRejected,
        lastCandleTime,
        dataSource,
        error.message
      );

      return { success: false, inserted: totalInserted, rejected: totalRejected };
    }
  }

  // Get backfill status
  async getBackfillStatus() {
    try {
      const { data, error } = await this.supabase
        .from('backfill_progress')
        .select('*')
        .order('symbol', { ascending: true })
        .order('timeframe', { ascending: true });

      if (error) {
        console.error('[BackfillOrchestrator] Error fetching status:', error);
        return [];
      }

      return data;
    } catch (error) {
      console.error('[BackfillOrchestrator] Error fetching status:', error.message);
      return [];
    }
  }
}

module.exports = { BackfillOrchestrator };
