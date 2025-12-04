import axios from 'axios';

interface FinnhubCandle {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  t: number[];
  v: number[];
  s: string;
}

interface ForexCandle {
  symbol: string;
  timeframe: string;
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  data_source: string;
}

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const RATE_LIMIT_DELAY_MS = 1100;

const SYMBOL_MAPPING: Record<string, string> = {
  'EURUSD': 'OANDA:EUR_USD',
  'GBPUSD': 'OANDA:GBP_USD',
  'USDJPY': 'OANDA:USD_JPY',
  'XAUUSD': 'OANDA:XAU_USD',
  'US30': 'OANDA:US30_USD'
};

const RESOLUTION_MAPPING: Record<string, string> = {
  'M1': '1',
  'M5': '5',
  'M15': '15',
  'M30': '30',
  'H1': '60',
  'H4': '240',
  'D1': 'D'
};

function mapSymbolToFinnhub(symbol: string): string {
  const mapped = SYMBOL_MAPPING[symbol];
  if (!mapped) {
    throw new Error(`Unsupported symbol: ${symbol}. Supported: ${Object.keys(SYMBOL_MAPPING).join(', ')}`);
  }
  return mapped;
}

function mapTimeframeToResolution(timeframe: string): string {
  const resolution = RESOLUTION_MAPPING[timeframe];
  if (!resolution) {
    throw new Error(`Unsupported timeframe: ${timeframe}. Supported: ${Object.keys(RESOLUTION_MAPPING).join(', ')}`);
  }
  return resolution;
}

function calculateCandleInterval(timeframe: string): number {
  const intervals: Record<string, number> = {
    'M1': 60,
    'M5': 300,
    'M15': 900,
    'M30': 1800,
    'H1': 3600,
    'H4': 14400,
    'D1': 86400
  };
  return intervals[timeframe] || 3600;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class FinnhubClient {
  private apiKey: string;
  private lastCallTime: number = 0;

  constructor(apiKey: string) {
    if (!apiKey || apiKey === 'your_finnhub_api_key_here') {
      throw new Error('Valid Finnhub API key is required');
    }
    this.apiKey = apiKey;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;

    if (timeSinceLastCall < RATE_LIMIT_DELAY_MS) {
      const waitTime = RATE_LIMIT_DELAY_MS - timeSinceLastCall;
      await sleep(waitTime);
    }

    this.lastCallTime = Date.now();
  }

  private async fetchWithRetry(
    url: string,
    maxRetries: number = 3
  ): Promise<FinnhubCandle> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.rateLimit();

        const response = await axios.get<FinnhubCandle>(url, {
          params: {
            token: this.apiKey
          },
          timeout: 30000
        });

        if (response.data.s === 'no_data') {
          throw new Error('No data available for this time range');
        }

        if (response.data.s !== 'ok') {
          throw new Error(`Finnhub API error: ${response.data.s}`);
        }

        return response.data;
      } catch (error: any) {
        lastError = error;

        if (error.response?.status === 429) {
          const backoffTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`Rate limited, waiting ${backoffTime}ms before retry ${attempt}/${maxRetries}`);
          await sleep(backoffTime);
          continue;
        }

        if (error.response?.status === 401) {
          throw new Error('Invalid Finnhub API key');
        }

        if (error.response?.status >= 500) {
          const backoffTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`Server error, waiting ${backoffTime}ms before retry ${attempt}/${maxRetries}`);
          await sleep(backoffTime);
          continue;
        }

        if (attempt === maxRetries) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Failed to fetch data after retries');
  }

  async fetchForexCandles(
    symbol: string,
    timeframe: string,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<ForexCandle[]> {
    const finnhubSymbol = mapSymbolToFinnhub(symbol);
    const resolution = mapTimeframeToResolution(timeframe);
    const intervalSeconds = calculateCandleInterval(timeframe);

    const url = `${FINNHUB_BASE_URL}/forex/candle`;
    const fullUrl = `${url}?symbol=${finnhubSymbol}&resolution=${resolution}&from=${fromTimestamp}&to=${toTimestamp}`;

    console.log(`Fetching ${symbol} ${timeframe} from Finnhub:`, {
      finnhubSymbol,
      resolution,
      fromDate: new Date(fromTimestamp * 1000).toISOString(),
      toDate: new Date(toTimestamp * 1000).toISOString()
    });

    const data = await this.fetchWithRetry(fullUrl);

    if (!data.t || data.t.length === 0) {
      console.log(`No candles returned for ${symbol} ${timeframe}`);
      return [];
    }

    const candles: ForexCandle[] = [];
    for (let i = 0; i < data.t.length; i++) {
      const openTime = new Date(data.t[i] * 1000);
      const closeTime = new Date((data.t[i] + intervalSeconds) * 1000);

      if (data.h[i] < data.l[i]) {
        console.warn(`Invalid candle at ${openTime.toISOString()}: high ${data.h[i]} < low ${data.l[i]}, skipping`);
        continue;
      }

      if (data.o[i] <= 0 || data.h[i] <= 0 || data.l[i] <= 0 || data.c[i] <= 0) {
        console.warn(`Invalid prices at ${openTime.toISOString()}, skipping`);
        continue;
      }

      candles.push({
        symbol,
        timeframe,
        open_time: openTime.toISOString(),
        close_time: closeTime.toISOString(),
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i] || 0,
        data_source: 'finnhub_import'
      });
    }

    console.log(`Successfully transformed ${candles.length} candles for ${symbol} ${timeframe}`);
    return candles;
  }

  async fetchMultipleRanges(
    symbol: string,
    timeframe: string,
    fromTimestamp: number,
    toTimestamp: number,
    chunkSizeDays: number = 7
  ): Promise<ForexCandle[]> {
    const allCandles: ForexCandle[] = [];
    const chunkSizeSeconds = chunkSizeDays * 24 * 60 * 60;

    let currentFrom = fromTimestamp;

    while (currentFrom < toTimestamp) {
      const currentTo = Math.min(currentFrom + chunkSizeSeconds, toTimestamp);

      try {
        const candles = await this.fetchForexCandles(symbol, timeframe, currentFrom, currentTo);
        allCandles.push(...candles);

        console.log(`Fetched ${candles.length} candles for range ${new Date(currentFrom * 1000).toISOString()} to ${new Date(currentTo * 1000).toISOString()}`);
      } catch (error: any) {
        console.error(`Failed to fetch range ${new Date(currentFrom * 1000).toISOString()} to ${new Date(currentTo * 1000).toISOString()}:`, error.message);
      }

      currentFrom = currentTo;
    }

    return allCandles;
  }
}

export function createFinnhubClient(): FinnhubClient {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    throw new Error('FINNHUB_API_KEY environment variable is not set');
  }

  return new FinnhubClient(apiKey);
}
