/**
 * Kraken API Client - Real-time Ticker Data
 *
 * Provides unrestricted access to crypto price data via Kraken's public REST API.
 * No authentication required for public ticker endpoint.
 *
 * Key Benefits:
 * - No geo-restrictions (unlike Binance)
 * - Real-time bid/ask prices
 * - Tick-by-tick accuracy for BTC and ETH
 * - Reliable 99.9%+ uptime
 */

interface KrakenTickerData {
  a: string[];  // ask [price, whole lot volume, lot volume]
  b: string[];  // bid [price, whole lot volume, lot volume]
  c: string[];  // last trade closed [price, lot volume]
  v: string[];  // volume [today, last 24 hours]
  p: string[];  // volume weighted average price [today, last 24 hours]
  t: number[];  // number of trades [today, last 24 hours]
  l: string[];  // low [today, last 24 hours]
  h: string[];  // high [today, last 24 hours]
  o: string;    // opening price today
}

interface KrakenTickerResponse {
  error: string[];
  result: {
    [key: string]: KrakenTickerData;
  };
}

const SYMBOL_MAP: Record<string, string> = {
  BTCUSD: 'XBTUSD',  // Kraken uses XBT instead of BTC
  ETHUSD: 'ETHUSD',
};

const KRAKEN_API_BASE = 'https://api.kraken.com/0/public';

export async function fetchKrakenTicker(symbol: string): Promise<{ bid: number; ask: number }> {
  const krakenSymbol = SYMBOL_MAP[symbol];

  if (!krakenSymbol) {
    throw new Error(`Symbol ${symbol} not supported by Kraken client`);
  }

  const url = `${KRAKEN_API_BASE}/Ticker?pair=${krakenSymbol}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
  }

  const data: KrakenTickerResponse = await response.json();

  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken API error: ${data.error.join(', ')}`);
  }

  const resultKeys = Object.keys(data.result);
  if (resultKeys.length === 0) {
    throw new Error(`No ticker data returned for ${symbol}`);
  }

  const tickerKey = resultKeys[0];
  const ticker = data.result[tickerKey];

  const bid = parseFloat(ticker.b[0]);
  const ask = parseFloat(ticker.a[0]);

  if (isNaN(bid) || isNaN(ask)) {
    throw new Error(`Invalid price data from Kraken: bid=${ticker.b[0]}, ask=${ticker.a[0]}`);
  }

  return { bid, ask };
}
