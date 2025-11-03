import { fetchHistoricalCandles } from './metaapi-service';
import { batchSaveCandles, getCandleStats } from './database-service';

interface RefreshResult {
  success: boolean;
  symbol: string;
  timeframe: string;
  candlesFetched: number;
  candlesSaved: number;
  duration: number;
  error?: string;
  stats?: {
    oldestCandle: string | null;
    newestCandle: string | null;
    totalCandles: number;
  };
}

interface BatchRefreshResult {
  totalSchedules: number;
  successful: number;
  failed: number;
  duration: number;
  results: RefreshResult[];
}

interface RefreshOptions {
  symbol: string;
  timeframe: '5m' | '15m' | '1h';
  daysBack: number;
  overwrite: boolean;
}

export async function refreshSingleSymbol(options: RefreshOptions): Promise<RefreshResult> {
  const startTime = Date.now();

  try {
    console.log('='.repeat(60));
    console.log(`Starting refresh for ${options.symbol} ${options.timeframe}`);
    console.log(`Days back: ${options.daysBack}, Overwrite: ${options.overwrite}`);
    console.log('='.repeat(60));

    console.log('\n[1/3] Fetching historical candles from MetaAPI...');
    const candles = await fetchHistoricalCandles(
      options.symbol,
      options.timeframe,
      options.daysBack
    );

    console.log(`\n[2/3] Fetched ${candles.length} candles from MetaAPI`);

    if (candles.length === 0) {
      console.log('No candles to save. Refresh complete.');
      return {
        success: true,
        symbol: options.symbol,
        timeframe: options.timeframe,
        candlesFetched: 0,
        candlesSaved: 0,
        duration: Date.now() - startTime
      };
    }

    console.log(`\n[3/3] Saving ${candles.length} candles to database...`);
    const saveResult = await batchSaveCandles(candles, 500, options.overwrite);

    console.log('\n[4/4] Fetching updated stats...');
    const stats = await getCandleStats(options.symbol, options.timeframe);

    const result: RefreshResult = {
      success: saveResult.success,
      symbol: options.symbol,
      timeframe: options.timeframe,
      candlesFetched: candles.length,
      candlesSaved: saveResult.candlesSaved,
      duration: Date.now() - startTime,
      stats
    };

    console.log('\n' + '='.repeat(60));
    console.log('REFRESH SUMMARY');
    console.log('='.repeat(60));
    console.log(`Symbol/Timeframe: ${options.symbol} ${options.timeframe}`);
    console.log(`Candles Fetched: ${result.candlesFetched}`);
    console.log(`Candles Saved: ${result.candlesSaved}`);
    console.log(`Total in Database: ${stats.totalCandles}`);
    console.log(`Oldest Candle: ${stats.oldestCandle || 'N/A'}`);
    console.log(`Newest Candle: ${stats.newestCandle || 'N/A'}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Success: ${result.success}`);
    console.log('='.repeat(60) + '\n');

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Refresh failed:', errorMessage);

    return {
      success: false,
      symbol: options.symbol,
      timeframe: options.timeframe,
      candlesFetched: 0,
      candlesSaved: 0,
      duration: Date.now() - startTime,
      error: errorMessage
    };
  }
}

export async function refreshBatchSchedules(): Promise<BatchRefreshResult> {
  const startTime = Date.now();

  try {
    console.log('\n' + '█'.repeat(80));
    console.log('BATCH REFRESH STARTED');
    console.log('█'.repeat(80) + '\n');

    const results: RefreshResult[] = [];

    const commonSymbols = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
    const timeframes: ('5m' | '15m' | '1h')[] = ['5m', '15m', '1h'];

    const totalSchedules = commonSymbols.length * timeframes.length;
    let currentSchedule = 0;

    for (const symbol of commonSymbols) {
      for (const timeframe of timeframes) {
        currentSchedule++;
        console.log(`\n[${currentSchedule}/${totalSchedules}] Processing ${symbol} ${timeframe}...`);

        try {
          const result = await refreshSingleSymbol({
            symbol,
            timeframe,
            daysBack: 3,
            overwrite: true
          });

          results.push(result);

          if (result.success) {
            console.log(`✅ Success: ${result.candlesSaved} candles saved`);
          } else {
            console.log(`❌ Failed: ${result.error}`);
          }

          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Exception processing ${symbol} ${timeframe}:`, errorMessage);

          results.push({
            success: false,
            symbol,
            timeframe,
            candlesFetched: 0,
            candlesSaved: 0,
            duration: 0,
            error: errorMessage
          });
        }
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalCandlesFetched = results.reduce((sum, r) => sum + r.candlesFetched, 0);
    const totalCandlesSaved = results.reduce((sum, r) => sum + r.candlesSaved, 0);

    console.log('\n' + '█'.repeat(80));
    console.log('BATCH REFRESH SUMMARY');
    console.log('█'.repeat(80));
    console.log(`Total Schedules: ${totalSchedules}`);
    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total Candles Fetched: ${totalCandlesFetched}`);
    console.log(`Total Candles Saved: ${totalCandlesSaved}`);
    console.log(`Duration: ${Date.now() - startTime}ms`);
    console.log('█'.repeat(80) + '\n');

    return {
      totalSchedules: results.length,
      successful,
      failed,
      duration: Date.now() - startTime,
      results
    };
  } catch (error) {
    console.error('Batch refresh failed:', error);

    return {
      totalSchedules: 0,
      successful: 0,
      failed: 0,
      duration: Date.now() - startTime,
      results: []
    };
  }
}
