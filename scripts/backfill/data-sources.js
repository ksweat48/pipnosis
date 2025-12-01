/**
 * Multi-source historical data fetcher
 * Uses free APIs with fallback support
 */

const axios = require('axios');

// Rate limiting helper
class RateLimiter {
  constructor(requestsPerMinute) {
    this.requestsPerMinute = requestsPerMinute;
    this.requests = [];
  }

  async throttle() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove old requests
    this.requests = this.requests.filter(time => time > oneMinuteAgo);

    if (this.requests.length >= this.requestsPerMinute) {
      const oldestRequest = this.requests[0];
      const waitTime = 60000 - (now - oldestRequest) + 100; // Add 100ms buffer
      if (waitTime > 0) {
        console.log(`[RateLimit] Waiting ${Math.round(waitTime / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.requests.push(Date.now());
  }
}

// Twelve Data API (free tier: 8 requests/minute, 800/day)
class TwelveDataSource {
  constructor(apiKey) {
    this.name = 'twelve_data';
    this.apiKey = apiKey || 'demo'; // Use demo for testing
    this.baseUrl = 'https://api.twelvedata.com';
    this.rateLimiter = new RateLimiter(8);
  }

  mapSymbol(symbol) {
    const mapping = {
      'EURUSD': 'EUR/USD',
      'GBPUSD': 'GBP/USD',
      'USDJPY': 'USD/JPY',
      'AUDUSD': 'AUD/USD',
      'USDCAD': 'USD/CAD',
      'NZDUSD': 'NZD/USD',
      'XAUUSD': 'XAU/USD',
      'BTCUSD': 'BTC/USD',
      'ETHUSD': 'ETH/USD',
    };
    return mapping[symbol] || symbol;
  }

  mapTimeframe(timeframe) {
    const mapping = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '1h',
      '4h': '4h',
      '1d': '1day',
      '1w': '1week',
    };
    return mapping[timeframe] || timeframe;
  }

  async fetchCandles(symbol, timeframe, startDate, endDate) {
    await this.rateLimiter.throttle();

    const mappedSymbol = this.mapSymbol(symbol);
    const mappedInterval = this.mapTimeframe(timeframe);

    try {
      const response = await axios.get(`${this.baseUrl}/time_series`, {
        params: {
          symbol: mappedSymbol,
          interval: mappedInterval,
          apikey: this.apiKey,
          outputsize: 5000,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          format: 'JSON',
        },
        timeout: 30000,
      });

      if (response.data.status === 'error') {
        throw new Error(response.data.message || 'API returned error');
      }

      if (!response.data.values || !Array.isArray(response.data.values)) {
        return [];
      }

      return response.data.values.map(candle => ({
        symbol,
        time: Math.floor(new Date(candle.datetime).getTime() / 1000),
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume) || 0,
        source: this.name,
      }));
    } catch (error) {
      console.error(`[${this.name}] Error fetching ${symbol}:`, error.message);
      return [];
    }
  }
}

// FCSAPI (Forex/Crypto free source)
class FCSAPISource {
  constructor(apiKey) {
    this.name = 'fcsapi';
    this.apiKey = apiKey;
    this.baseUrl = 'https://fcsapi.com/api-v3';
    this.rateLimiter = new RateLimiter(10);
  }

  mapSymbol(symbol) {
    return symbol.replace('/', '');
  }

  mapTimeframe(timeframe) {
    return timeframe;
  }

  async fetchCandles(symbol, timeframe, startDate, endDate) {
    if (!this.apiKey) {
      console.log(`[${this.name}] No API key provided`);
      return [];
    }

    await this.rateLimiter.throttle();

    try {
      const response = await axios.get(`${this.baseUrl}/forex/history`, {
        params: {
          symbol: this.mapSymbol(symbol),
          period: this.mapTimeframe(timeframe),
          from: Math.floor(startDate.getTime() / 1000),
          to: Math.floor(endDate.getTime() / 1000),
          access_key: this.apiKey,
        },
        timeout: 30000,
      });

      if (response.data.status !== true || !response.data.response) {
        return [];
      }

      return response.data.response.map(candle => ({
        symbol,
        time: parseInt(candle.tm),
        open: parseFloat(candle.o),
        high: parseFloat(candle.h),
        low: parseFloat(candle.l),
        close: parseFloat(candle.c),
        volume: 0,
        source: this.name,
      }));
    } catch (error) {
      console.error(`[${this.name}] Error fetching ${symbol}:`, error.message);
      return [];
    }
  }
}

// Polygon.io (free tier available)
class PolygonSource {
  constructor(apiKey) {
    this.name = 'polygon';
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.polygon.io';
    this.rateLimiter = new RateLimiter(5);
  }

  mapSymbol(symbol) {
    return `C:${symbol}`;
  }

  mapTimeframe(timeframe) {
    const mapping = {
      '1m': { multiplier: 1, timespan: 'minute' },
      '5m': { multiplier: 5, timespan: 'minute' },
      '15m': { multiplier: 15, timespan: 'minute' },
      '30m': { multiplier: 30, timespan: 'minute' },
      '1h': { multiplier: 1, timespan: 'hour' },
      '4h': { multiplier: 4, timespan: 'hour' },
      '1d': { multiplier: 1, timespan: 'day' },
      '1w': { multiplier: 1, timespan: 'week' },
    };
    return mapping[timeframe] || { multiplier: 1, timespan: 'hour' };
  }

  async fetchCandles(symbol, timeframe, startDate, endDate) {
    if (!this.apiKey) {
      console.log(`[${this.name}] No API key provided`);
      return [];
    }

    await this.rateLimiter.throttle();

    const { multiplier, timespan } = this.mapTimeframe(timeframe);
    const ticker = this.mapSymbol(symbol);

    try {
      const response = await axios.get(
        `${this.baseUrl}/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${startDate.toISOString().split('T')[0]}/${endDate.toISOString().split('T')[0]}`,
        {
          params: {
            apiKey: this.apiKey,
            limit: 50000,
          },
          timeout: 30000,
        }
      );

      if (!response.data.results || !Array.isArray(response.data.results)) {
        return [];
      }

      return response.data.results.map(candle => ({
        symbol,
        time: Math.floor(candle.t / 1000),
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
        volume: candle.v || 0,
        source: this.name,
      }));
    } catch (error) {
      console.error(`[${this.name}] Error fetching ${symbol}:`, error.message);
      return [];
    }
  }
}

// Yahoo Finance (free, no API key required)
class YahooFinanceSource {
  constructor() {
    this.name = 'yahoo_finance';
    this.baseUrl = 'https://query1.finance.yahoo.com';
    this.rateLimiter = new RateLimiter(30);
  }

  mapSymbol(symbol) {
    const mapping = {
      'EURUSD': 'EURUSD=X',
      'GBPUSD': 'GBPUSD=X',
      'USDJPY': 'USDJPY=X',
      'AUDUSD': 'AUDUSD=X',
      'USDCAD': 'USDCAD=X',
      'XAUUSD': 'GC=F',
      'BTCUSD': 'BTC-USD',
      'ETHUSD': 'ETH-USD',
    };
    return mapping[symbol] || symbol;
  }

  mapTimeframe(timeframe) {
    const mapping = {
      '1m': { interval: '1m', period: '7d' },
      '5m': { interval: '5m', period: '60d' },
      '15m': { interval: '15m', period: '60d' },
      '30m': { interval: '30m', period: '60d' },
      '1h': { interval: '1h', period: '730d' },
      '1d': { interval: '1d', period: '730d' },
      '1w': { interval: '1wk', period: '730d' },
    };
    return mapping[timeframe] || { interval: '1h', period: '730d' };
  }

  async fetchCandles(symbol, timeframe, startDate, endDate) {
    await this.rateLimiter.throttle();

    const mappedSymbol = this.mapSymbol(symbol);
    const { interval } = this.mapTimeframe(timeframe);

    try {
      const period1 = Math.floor(startDate.getTime() / 1000);
      const period2 = Math.floor(endDate.getTime() / 1000);

      const response = await axios.get(`${this.baseUrl}/v8/finance/chart/${mappedSymbol}`, {
        params: {
          period1,
          period2,
          interval,
          includePrePost: false,
        },
        timeout: 30000,
      });

      const result = response.data?.chart?.result?.[0];
      if (!result || !result.timestamp) {
        return [];
      }

      const timestamps = result.timestamp;
      const quotes = result.indicators?.quote?.[0];
      if (!quotes) {
        return [];
      }

      return timestamps.map((time, index) => ({
        symbol,
        time,
        open: quotes.open[index],
        high: quotes.high[index],
        low: quotes.low[index],
        close: quotes.close[index],
        volume: quotes.volume[index] || 0,
        source: this.name,
      })).filter(candle =>
        candle.open && candle.high && candle.low && candle.close
      );
    } catch (error) {
      console.error(`[${this.name}] Error fetching ${symbol}:`, error.message);
      return [];
    }
  }
}

// Multi-source fetcher with fallback
class MultiSourceFetcher {
  constructor(sources) {
    this.sources = sources.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  async fetchCandles(symbol, timeframe, startDate, endDate) {
    console.log(`[MultiSource] Fetching ${symbol} ${timeframe} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    for (const source of this.sources) {
      try {
        const candles = await source.fetchCandles(symbol, timeframe, startDate, endDate);
        if (candles && candles.length > 0) {
          console.log(`[MultiSource] ✅ Got ${candles.length} candles from ${source.name}`);
          return { candles, source: source.name };
        }
      } catch (error) {
        console.error(`[MultiSource] ❌ ${source.name} failed:`, error.message);
      }
    }

    console.log(`[MultiSource] ⚠️  No data from any source for ${symbol} ${timeframe}`);
    return { candles: [], source: null };
  }
}

module.exports = {
  TwelveDataSource,
  FCSAPISource,
  PolygonSource,
  YahooFinanceSource,
  MultiSourceFetcher,
  RateLimiter,
};
