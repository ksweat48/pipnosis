interface CandleData {
  symbol: string;
  timeframe: string;
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MetaApiCandle {
  time: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  tickVolume?: string | number;
}

interface FetchCandlesOptions {
  symbol: string;
  timeframe: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

function getTimeframeMinutes(timeframe: string): number {
  const map: Record<string, number> = {
    'M1': 1,
    'm1': 1,
    '1m': 1,
    'M5': 5,
    'm5': 5,
    '5m': 5,
    'M15': 15,
    'm15': 15,
    '15m': 15,
    'M30': 30,
    'm30': 30,
    '30m': 30,
    'H1': 60,
    'h1': 60,
    '1h': 60,
    'H4': 240,
    'h4': 240,
    '4h': 240,
    'D1': 1440,
    'd1': 1440,
    '1d': 1440
  };
  return map[timeframe] || 15;
}

function normalizeTimeframe(timeframe: string): string {
  const map: Record<string, string> = {
    '1m': 'M1',
    'm1': 'M1',
    '5m': 'M5',
    'm5': 'M5',
    '15m': 'M15',
    'm15': 'M15',
    '30m': 'M30',
    'm30': 'M30',
    '1h': 'H1',
    'h1': 'H1',
    '4h': 'H4',
    'h4': 'H4',
    '1d': 'D1',
    'd1': 'D1'
  };
  return map[timeframe.toLowerCase()] || timeframe.toUpperCase();
}

export async function fetchCandlesFromMetaApi(
  options: FetchCandlesOptions
): Promise<CandleData[]> {
  const token = import.meta.env.VITE_METAAPI_TOKEN;
  const accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
  const region = import.meta.env.VITE_METAAPI_REGION || 'new-york';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured. Set METAAPI_TOKEN and METAAPI_ACCOUNT_ID');
  }

  const { symbol, timeframe, startTime, endTime, limit = 1000 } = options;
  const normalizedTimeframe = normalizeTimeframe(timeframe);
  const timeframeMinutes = getTimeframeMinutes(normalizedTimeframe);

  let url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${normalizedTimeframe}/candles`;

  const params = new URLSearchParams();

  if (startTime) {
    params.append('startTime', startTime.toISOString());
  }

  if (endTime) {
    params.append('endTime', endTime.toISOString());
  }

  if (limit && !startTime && !endTime) {
    const calculatedStartTime = new Date();
    calculatedStartTime.setHours(calculatedStartTime.getHours() - (limit * timeframeMinutes / 60));
    params.append('startTime', calculatedStartTime.toISOString());
  }

  if (params.toString()) {
    url += `?${params.toString()}`;
  }

  console.log(`Fetching candles for ${symbol} ${normalizedTimeframe} from MetaAPI (${region})`);
  console.log(`Time range: ${startTime?.toISOString() || 'auto'} to ${endTime?.toISOString() || 'now'}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'auth-token': token,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MetaAPI error: ${response.status} - ${errorText}`);
  }

  const candles = await response.json() as MetaApiCandle[];

  if (!Array.isArray(candles)) {
    throw new Error('Invalid candle data from MetaAPI');
  }

  console.log(`Received ${candles.length} candles from MetaAPI`);

  return candles.map(candle => {
    // CRITICAL FIX: Ensure candle.time is always stored as ISO string, never as object
    const openTime = new Date(candle.time);
    const closeTime = new Date(openTime.getTime() + timeframeMinutes * 60000);

    return {
      symbol,
      timeframe: normalizedTimeframe,
      open_time: openTime.toISOString(),
      close_time: closeTime.toISOString(),
      open: parseFloat(String(candle.open)),
      high: parseFloat(String(candle.high)),
      low: parseFloat(String(candle.low)),
      close: parseFloat(String(candle.close)),
      volume: parseFloat(String(candle.tickVolume || 0))
    };
  });
}

export async function fetchHistoricalCandles(
  symbol: string,
  timeframe: string,
  daysBack: number
): Promise<CandleData[]> {
  const endTime = new Date();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - daysBack);

  console.log(`Fetching historical data for ${symbol} ${timeframe}`);
  console.log(`Date range: ${startTime.toISOString()} to ${endTime.toISOString()}`);

  const timeframeMinutes = getTimeframeMinutes(timeframe);
  const totalMinutes = daysBack * 24 * 60;
  const expectedCandles = Math.floor(totalMinutes / timeframeMinutes);

  console.log(`Expected approximately ${expectedCandles} candles`);

  const chunkSize = 1000;
  const allCandles: CandleData[] = [];

  const chunksNeeded = Math.ceil(expectedCandles / chunkSize);
  console.log(`Will fetch in ${chunksNeeded} chunk(s) of ${chunkSize} candles`);

  let currentStartTime = new Date(startTime);

  for (let i = 0; i < chunksNeeded; i++) {
    const currentEndTime = new Date(currentStartTime);
    currentEndTime.setMinutes(currentEndTime.getMinutes() + (chunkSize * timeframeMinutes));

    if (currentEndTime > endTime) {
      currentEndTime.setTime(endTime.getTime());
    }

    try {
      console.log(`Fetching chunk ${i + 1}/${chunksNeeded}...`);

      const chunkCandles = await fetchCandlesFromMetaApi({
        symbol,
        timeframe,
        startTime: currentStartTime,
        endTime: currentEndTime,
        limit: chunkSize
      });

      allCandles.push(...chunkCandles);

      console.log(`Chunk ${i + 1} complete: ${chunkCandles.length} candles`);

      if (chunkCandles.length === 0 || currentEndTime >= endTime) {
        break;
      }

      currentStartTime = new Date(currentEndTime);

      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`Error fetching chunk ${i + 1}:`, error);

      if (allCandles.length > 0) {
        console.log(`Returning ${allCandles.length} candles fetched before error`);
        break;
      }
      throw error;
    }
  }

  console.log(`Total candles fetched: ${allCandles.length}`);

  const uniqueCandles = Array.from(
    new Map(allCandles.map(c => [`${c.symbol}-${c.timeframe}-${c.open_time}`, c])).values()
  );

  console.log(`Unique candles after deduplication: ${uniqueCandles.length}`);

  return uniqueCandles.sort((a, b) =>
    new Date(a.open_time).getTime() - new Date(b.open_time).getTime()
  );
}

export { CandleData, getTimeframeMinutes, normalizeTimeframe };
