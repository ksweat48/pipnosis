/**
 * Kraken REST API Client
 *
 * Fetches complete, validated OHLC candles from Kraken's REST API.
 * Used for backfilling historical data and repairing gaps/DOJIs in database.
 *
 * KEY DIFFERENCE FROM WEBSOCKET:
 * - WebSocket: Real-time ticks (bid/ask updates)
 * - REST API: Complete historical candles (OHLC with volume)
 *
 * API Docs: https://docs.kraken.com/rest/#tag/Market-Data/operation/getOHLCData
 */

import { logger, LogCategory } from '@/lib/logger';

export interface KrakenCandle {
  time: number;        // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;        // Volume-weighted average price
  count: number;       // Number of trades
}

export interface KrakenOHLCResponse {
  error: string[];
  result: {
    [pair: string]: Array<[number, string, string, string, string, string, string, number]>;
    last: number;
  };
}

const KRAKEN_API_BASE = 'https://api.kraken.com/0/public';
const REQUEST_TIMEOUT = 15000; // 15 seconds

// Map our symbols to Kraken pairs
const SYMBOL_TO_KRAKEN_PAIR: Record<string, string> = {
  'BTCUSD': 'XXBTZUSD',
  'ETHUSD': 'XETHZUSD'
};

// Kraken interval codes (in minutes)
const INTERVAL_MAP: Record<number, number> = {
  1: 1,
  5: 5,
  15: 15,
  30: 30,
  60: 60,
  240: 240,
  1440: 1440
};

class KrakenRestClient {
  private lastRequestTime = 0;
  private minRequestInterval = 1000; // 1 second between requests (rate limit protection)

  /**
   * Fetch OHLC candles from Kraken REST API
   *
   * @param symbol - Our internal symbol (BTCUSD, ETHUSD)
   * @param interval - Interval in minutes (1, 5, 15, 30, 60, 240, 1440)
   * @param since - Optional Unix timestamp to fetch from (0 = earliest available)
   * @returns Array of complete OHLC candles
   */
  async fetchOHLC(
    symbol: string,
    interval: number,
    since: number = 0
  ): Promise<KrakenCandle[]> {
    const krakenPair = SYMBOL_TO_KRAKEN_PAIR[symbol];
    if (!krakenPair) {
      throw new Error(`Symbol ${symbol} not supported by Kraken REST API`);
    }

    const krakenInterval = INTERVAL_MAP[interval];
    if (!krakenInterval) {
      throw new Error(`Interval ${interval} minutes not supported by Kraken (supported: 1, 5, 15, 30, 60, 240, 1440)`);
    }

    // Rate limit protection
    await this.respectRateLimit();

    const url = new URL(`${KRAKEN_API_BASE}/OHLC`);
    url.searchParams.set('pair', krakenPair);
    url.searchParams.set('interval', krakenInterval.toString());
    if (since > 0) {
      url.searchParams.set('since', since.toString());
    }

    logger.info(LogCategory.DATA, `[KrakenREST] Fetching OHLC: ${symbol} (${krakenPair}), ${interval}m, since=${since}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`Kraken API request timeout after ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT);

      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'PipnosisTrader/1.0'
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
      }

      const data: KrakenOHLCResponse = await response.json();

      // Check for API errors
      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API error: ${data.error.join(', ')}`);
      }

      // Extract candles from response
      const pairData = data.result[krakenPair];
      if (!pairData || !Array.isArray(pairData)) {
        logger.warn(LogCategory.DATA, `[KrakenREST] No data returned for ${symbol}`);
        return [];
      }

      // Parse candles
      const candles: KrakenCandle[] = pairData.map(raw => ({
        time: raw[0],
        open: parseFloat(raw[1]),
        high: parseFloat(raw[2]),
        low: parseFloat(raw[3]),
        close: parseFloat(raw[4]),
        vwap: parseFloat(raw[5]),
        volume: parseFloat(raw[6]),
        count: raw[7]
      }));

      logger.info(LogCategory.DATA, `[KrakenREST] ✅ Fetched ${candles.length} candles for ${symbol}`);

      return candles;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error(LogCategory.DATA, `[KrakenREST] Request timeout after ${REQUEST_TIMEOUT}ms`);
        throw new Error('Kraken API request timed out');
      }

      logger.error(LogCategory.DATA, `[KrakenREST] Failed to fetch OHLC: ${error}`);
      throw error;
    }
  }

  /**
   * Fetch recent candles (last N candles)
   * Useful for backfilling gaps or recent missing data
   */
  async fetchRecentCandles(
    symbol: string,
    interval: number,
    count: number = 720
  ): Promise<KrakenCandle[]> {
    // Calculate "since" timestamp based on count
    const now = Math.floor(Date.now() / 1000);
    const intervalSeconds = interval * 60;
    const since = now - (count * intervalSeconds);

    return this.fetchOHLC(symbol, interval, since);
  }

  /**
   * Fetch candles for a specific time range
   */
  async fetchCandleRange(
    symbol: string,
    interval: number,
    startTime: number,
    endTime: number
  ): Promise<KrakenCandle[]> {
    const allCandles: KrakenCandle[] = [];
    let currentSince = startTime;

    // Kraken returns max 720 candles per request
    // We need to paginate if requesting more than 720 candles
    const intervalSeconds = interval * 60;
    const maxCandlesPerRequest = 720;

    while (currentSince < endTime) {
      const candles = await this.fetchOHLC(symbol, interval, currentSince);

      if (candles.length === 0) {
        break; // No more data available
      }

      // Filter candles within our requested range
      const filteredCandles = candles.filter(c => c.time >= startTime && c.time <= endTime);
      allCandles.push(...filteredCandles);

      // Check if we got a full batch (720 candles = need to paginate)
      if (candles.length < maxCandlesPerRequest) {
        break; // We've reached the end of available data
      }

      // Move to next batch using the last candle's timestamp
      const lastCandle = candles[candles.length - 1];
      currentSince = lastCandle.time + intervalSeconds;

      // Safety check: don't loop forever
      if (allCandles.length > 10000) {
        logger.warn(LogCategory.DATA, `[KrakenREST] Fetched 10,000+ candles, stopping pagination`);
        break;
      }
    }

    logger.info(LogCategory.DATA, `[KrakenREST] Fetched ${allCandles.length} candles for range ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`);

    return allCandles;
  }

  /**
   * Validate if a symbol is supported
   */
  isSymbolSupported(symbol: string): boolean {
    return symbol in SYMBOL_TO_KRAKEN_PAIR;
  }

  /**
   * Get supported symbols
   */
  getSupportedSymbols(): string[] {
    return Object.keys(SYMBOL_TO_KRAKEN_PAIR);
  }

  /**
   * Rate limit protection - ensure we don't spam Kraken API
   */
  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }
}

export const krakenRestClient = new KrakenRestClient();
