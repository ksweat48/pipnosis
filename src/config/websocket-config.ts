/**
 * WebSocket Configuration
 *
 * Configuration for browser-based WebSocket price feeds.
 * This is an enhancement layer on top of server-side REST polling.
 */

export const WEBSOCKET_CONFIG = {
  enabled: import.meta.env.VITE_ENABLE_BROWSER_WEBSOCKET === 'true',

  kraken: {
    url: 'wss://ws.kraken.com',  // v1 public API (stable)
    symbols: ['BTCUSD', 'ETHUSD'],
    symbolMap: {
      'BTCUSD': 'XBT/USD',  // v1 API uses XBT/USD for Bitcoin
      'ETHUSD': 'ETH/USD',
    } as Record<string, string>,
    reverseSymbolMap: {
      'XBT/USD': 'BTCUSD',  // v1 API uses XBT/USD for Bitcoin
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
