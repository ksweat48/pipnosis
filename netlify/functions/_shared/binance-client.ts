/**
 * Binance API Client - Real-time Ticker Data
 *
 * Provides access to crypto price data via Binance's public REST API.
 * No authentication required for public ticker endpoint.
 *
 * Key Benefits:
 * - Highest liquidity crypto exchange globally
 * - Real-time bid/ask prices
 * - Very low latency (typically <100ms)
 * - 99.99% uptime
 */

interface BinanceTickerData {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

const SYMBOL_MAP: Record<string, string> = {
  BTCUSD: 'BTCUSDT',  // Binance uses USDT pairs
  ETHUSD: 'ETHUSDT',
};

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';

export async function fetchBinanceTicker(symbol: string): Promise<{ bid: number; ask: number }> {
  const binanceSymbol = SYMBOL_MAP[symbol];

  if (!binanceSymbol) {
    throw new Error(`Symbol ${symbol} not supported by Binance client`);
  }

  const url = `${BINANCE_API_BASE}/ticker/bookTicker?symbol=${binanceSymbol}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
    }

    const data: BinanceTickerData = await response.json();

    const bid = parseFloat(data.bidPrice);
    const ask = parseFloat(data.askPrice);

    if (isNaN(bid) || isNaN(ask)) {
      throw new Error(`Invalid price data from Binance: bid=${data.bidPrice}, ask=${data.askPrice}`);
    }

    if (bid <= 0 || ask <= 0) {
      throw new Error(`Invalid price values from Binance: bid=${bid}, ask=${ask}`);
    }

    return { bid, ask };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Binance API timeout after 5 seconds for ${symbol}`);
    }
    throw error;
  }
}
