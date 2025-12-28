/**
 * CoinGecko API Client - Real-time Price Data
 *
 * Provides access to crypto price data via CoinGecko's public REST API.
 * No authentication required for free tier (demo plan).
 *
 * Key Benefits:
 * - Aggregated price data from 600+ exchanges
 * - Very reliable uptime
 * - Free tier available with generous rate limits
 * - No API key required for basic usage
 */

interface CoinGeckoSimplePriceResponse {
  [coinId: string]: {
    usd: number;
    usd_24h_change?: number;
  };
}

const SYMBOL_MAP: Record<string, string> = {
  BTCUSD: 'bitcoin',
  ETHUSD: 'ethereum',
};

const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

export async function fetchCoinGeckoPrice(symbol: string): Promise<{ bid: number; ask: number }> {
  const coinId = SYMBOL_MAP[symbol];

  if (!coinId) {
    throw new Error(`Symbol ${symbol} not supported by CoinGecko client`);
  }

  const url = `${COINGECKO_API_BASE}/simple/price?ids=${coinId}&vs_currencies=usd`;

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
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data: CoinGeckoSimplePriceResponse = await response.json();

    if (!data[coinId] || !data[coinId].usd) {
      throw new Error(`No price data returned for ${symbol} from CoinGecko`);
    }

    const price = data[coinId].usd;

    if (isNaN(price) || price <= 0) {
      throw new Error(`Invalid price data from CoinGecko: price=${price}`);
    }

    // CoinGecko returns a single price, so we estimate bid/ask with a small spread (0.01%)
    const spreadPercent = 0.0001;
    const halfSpread = price * spreadPercent;
    const bid = price - halfSpread;
    const ask = price + halfSpread;

    return { bid, ask };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`CoinGecko API timeout after 5 seconds for ${symbol}`);
    }
    throw error;
  }
}
