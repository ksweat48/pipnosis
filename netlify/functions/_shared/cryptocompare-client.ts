/**
 * CryptoCompare API Client - Real-time Price Data
 *
 * Provides access to crypto price data via CryptoCompare's public REST API.
 * No authentication required for free tier.
 *
 * Key Benefits:
 * - Real-time prices from multiple exchanges
 * - High accuracy and reliability
 * - Free tier available
 * - Good uptime
 */

interface CryptoCompareResponse {
  [symbol: string]: {
    USD: number;
  };
}

const SYMBOL_MAP: Record<string, string> = {
  BTCUSD: 'BTC',
  ETHUSD: 'ETH',
};

const CRYPTOCOMPARE_API_BASE = 'https://min-api.cryptocompare.com/data';

export async function fetchCryptoComparePrice(symbol: string): Promise<{ bid: number; ask: number }> {
  const cryptoSymbol = SYMBOL_MAP[symbol];

  if (!cryptoSymbol) {
    throw new Error(`Symbol ${symbol} not supported by CryptoCompare client`);
  }

  const url = `${CRYPTOCOMPARE_API_BASE}/pricemulti?fsyms=${cryptoSymbol}&tsyms=USD`;

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
      throw new Error(`CryptoCompare API error: ${response.status} ${response.statusText}`);
    }

    const data: CryptoCompareResponse = await response.json();

    if (!data[cryptoSymbol] || !data[cryptoSymbol].USD) {
      throw new Error(`No price data returned for ${symbol} from CryptoCompare`);
    }

    const price = data[cryptoSymbol].USD;

    if (isNaN(price) || price <= 0) {
      throw new Error(`Invalid price data from CryptoCompare: price=${price}`);
    }

    // CryptoCompare returns a single price, so we estimate bid/ask with a small spread (0.01%)
    const spreadPercent = 0.0001;
    const halfSpread = price * spreadPercent;
    const bid = price - halfSpread;
    const ask = price + halfSpread;

    return { bid, ask };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`CryptoCompare API timeout after 5 seconds for ${symbol}`);
    }
    throw error;
  }
}
