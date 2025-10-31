interface RefreshResult {
  success: boolean;
  symbol: string;
  timeframe: string;
  candlesFetched: number;
  candlesSaved: number;
  duration: number;
  error?: string;
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
    console.log(`Refreshing ${options.symbol} ${options.timeframe} (${options.daysBack} days back)`);

    const result: RefreshResult = {
      success: true,
      symbol: options.symbol,
      timeframe: options.timeframe,
      candlesFetched: 0,
      candlesSaved: 0,
      duration: Date.now() - startTime
    };

    return result;
  } catch (error) {
    return {
      success: false,
      symbol: options.symbol,
      timeframe: options.timeframe,
      candlesFetched: 0,
      candlesSaved: 0,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function refreshBatchSchedules(): Promise<BatchRefreshResult> {
  const startTime = Date.now();

  try {
    console.log('Starting batch refresh of all schedules...');

    const results: RefreshResult[] = [];

    const commonSymbols = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
    const timeframes: ('5m' | '15m' | '1h')[] = ['5m', '15m', '1h'];

    for (const symbol of commonSymbols) {
      for (const timeframe of timeframes) {
        const result = await refreshSingleSymbol({
          symbol,
          timeframe,
          daysBack: 3,
          overwrite: true
        });

        results.push(result);
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

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
