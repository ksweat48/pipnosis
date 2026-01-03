/**
 * WebSocket Configuration
 *
 * Configuration for browser-based WebSocket price feeds.
 * This is an enhancement layer on top of server-side REST polling.
 */

export const WEBSOCKET_CONFIG = {
  enabled: import.meta.env.VITE_ENABLE_BROWSER_WEBSOCKET === 'true',

  kraken: {
    url: 'wss://ws.kraken.com/v2',
    symbols: ['BTCUSD', 'ETHUSD'],
    symbolMap: {
      'BTCUSD': 'BTC/USD',  // v2 API uses BTC/USD, not XBT/USD
      'ETHUSD': 'ETH/USD',
    } as Record<string, string>,
    reverseSymbolMap: {
      'BTC/USD': 'BTCUSD',  // v2 API uses BTC/USD, not XBT/USD
      'ETH/USD': 'ETHUSD',
    } as Record<string, string>,
    reconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
    heartbeatIntervalMs: 30000,
  },

  metaapi: {
    symbols: ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'NAS100', 'SPX500'],
    reconnectDelayMs: 2000,
    maxReconnectDelayMs: 60000,
  },

  persistence: {
    maxWritesPerSecondPerSymbol: 10,
    batchIntervalMs: 100,
    maxBatchSize: 50,
  },

  monitoring: {
    logTicksEnabled: false,
    metricsIntervalMs: 60000,
  },
};

export function isWebSocketEnabled(): boolean {
  return WEBSOCKET_CONFIG.enabled;
}

export function isCryptoSymbol(symbol: string): boolean {
  return WEBSOCKET_CONFIG.kraken.symbols.includes(symbol);
}

export function isForexSymbol(symbol: string): boolean {
  return WEBSOCKET_CONFIG.metaapi.symbols.includes(symbol);
}

export function getKrakenSymbol(platformSymbol: string): string | null {
  return WEBSOCKET_CONFIG.kraken.symbolMap[platformSymbol] || null;
}

export function getPlatformSymbol(krakenSymbol: string): string | null {
  return WEBSOCKET_CONFIG.kraken.reverseSymbolMap[krakenSymbol] || null;
}
