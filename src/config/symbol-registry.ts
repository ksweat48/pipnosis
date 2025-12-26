/**
 * Symbol Registry - Centralized Symbol Configuration
 *
 * Single source of truth for all symbol-related configurations including:
 * - Categories (forex, crypto, index, metal, energy)
 * - Market hours (24/7 for crypto, forex hours for others)
 * - Data providers (MetaAPI for forex, Kraken for crypto)
 * - Pip values and lot sizes
 */

export type SymbolCategory = 'forex' | 'crypto' | 'index' | 'metal' | 'energy';
export type DataProvider = 'metaapi' | 'twelvedata' | 'finnhub' | 'kraken';
export type MarketSchedule = 'forex' | '24/7';

export interface SymbolConfig {
  symbol: string;
  category: SymbolCategory;
  displayName: string;
  marketSchedule: MarketSchedule;
  dataProvider: DataProvider;
  pipValue: number;
  pipMultiplier: number;
  decimalPlaces: number;
  contractSize: number;
  dollarPerPipPerLot: number;
  minLotSize: number;
  maxLotSize: number;
}

export const SYMBOL_REGISTRY: Record<string, SymbolConfig> = {
  // Metals - Forex Hours
  XAUUSD: {
    symbol: 'XAUUSD',
    category: 'metal',
    displayName: 'Gold',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.01,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 100,
    dollarPerPipPerLot: 1.0,
    minLotSize: 0.01,
    maxLotSize: 10.0,
  },
  XAGUSD: {
    symbol: 'XAGUSD',
    category: 'metal',
    displayName: 'Silver',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.001,
    pipMultiplier: 1,
    decimalPlaces: 3,
    contractSize: 5000,
    dollarPerPipPerLot: 5.0,
    minLotSize: 0.01,
    maxLotSize: 10.0,
  },

  // Indices - Forex Hours
  US30: {
    symbol: 'US30',
    category: 'index',
    displayName: 'Dow Jones',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 1.0,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1,
    dollarPerPipPerLot: 1.0,
    minLotSize: 0.01,
    maxLotSize: 1.0,
  },
  NAS100: {
    symbol: 'NAS100',
    category: 'index',
    displayName: 'NASDAQ 100',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 1.0,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1,
    dollarPerPipPerLot: 1.0,
    minLotSize: 0.01,
    maxLotSize: 1.0,
  },
  SPX500: {
    symbol: 'SPX500',
    category: 'index',
    displayName: 'S&P 500',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 1.0,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1,
    dollarPerPipPerLot: 1.0,
    minLotSize: 0.01,
    maxLotSize: 1.0,
  },
  UK100: {
    symbol: 'UK100',
    category: 'index',
    displayName: 'FTSE 100',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 1.0,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1,
    dollarPerPipPerLot: 1.0,
    minLotSize: 0.01,
    maxLotSize: 1.0,
  },
  GER40: {
    symbol: 'GER40',
    category: 'index',
    displayName: 'DAX 40',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 1.0,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1,
    dollarPerPipPerLot: 1.0,
    minLotSize: 0.01,
    maxLotSize: 1.0,
  },

  // Forex - Major Pairs
  EURUSD: {
    symbol: 'EURUSD',
    category: 'forex',
    displayName: 'EUR/USD',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.0001,
    pipMultiplier: 1,
    decimalPlaces: 5,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  GBPUSD: {
    symbol: 'GBPUSD',
    category: 'forex',
    displayName: 'GBP/USD',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.0001,
    pipMultiplier: 1,
    decimalPlaces: 5,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  USDJPY: {
    symbol: 'USDJPY',
    category: 'forex',
    displayName: 'USD/JPY',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.01,
    pipMultiplier: 100,
    decimalPlaces: 2,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  AUDUSD: {
    symbol: 'AUDUSD',
    category: 'forex',
    displayName: 'AUD/USD',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.0001,
    pipMultiplier: 1,
    decimalPlaces: 5,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  USDCAD: {
    symbol: 'USDCAD',
    category: 'forex',
    displayName: 'USD/CAD',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.0001,
    pipMultiplier: 1,
    decimalPlaces: 5,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  NZDUSD: {
    symbol: 'NZDUSD',
    category: 'forex',
    displayName: 'NZD/USD',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.0001,
    pipMultiplier: 1,
    decimalPlaces: 5,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  USDCHF: {
    symbol: 'USDCHF',
    category: 'forex',
    displayName: 'USD/CHF',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.0001,
    pipMultiplier: 1,
    decimalPlaces: 5,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },

  // Forex - Cross Pairs
  EURGBP: {
    symbol: 'EURGBP',
    category: 'forex',
    displayName: 'EUR/GBP',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.0001,
    pipMultiplier: 1,
    decimalPlaces: 5,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  EURJPY: {
    symbol: 'EURJPY',
    category: 'forex',
    displayName: 'EUR/JPY',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.01,
    pipMultiplier: 100,
    decimalPlaces: 2,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  GBPJPY: {
    symbol: 'GBPJPY',
    category: 'forex',
    displayName: 'GBP/JPY',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.01,
    pipMultiplier: 100,
    decimalPlaces: 2,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  AUDJPY: {
    symbol: 'AUDJPY',
    category: 'forex',
    displayName: 'AUD/JPY',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.01,
    pipMultiplier: 100,
    decimalPlaces: 2,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },
  EURAUD: {
    symbol: 'EURAUD',
    category: 'forex',
    displayName: 'EUR/AUD',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.0001,
    pipMultiplier: 1,
    decimalPlaces: 5,
    contractSize: 100000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 5.0,
  },

  // Crypto - 24/7 Trading (via Kraken)
  BTCUSD: {
    symbol: 'BTCUSD',
    category: 'crypto',
    displayName: 'Bitcoin',
    marketSchedule: '24/7',
    dataProvider: 'kraken',
    pipValue: 1.0,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1,
    dollarPerPipPerLot: 1.0,
    minLotSize: 0.001,
    maxLotSize: 10.0,
  },
  ETHUSD: {
    symbol: 'ETHUSD',
    category: 'crypto',
    displayName: 'Ethereum',
    marketSchedule: '24/7',
    dataProvider: 'kraken',
    pipValue: 0.1,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1,
    dollarPerPipPerLot: 0.1,
    minLotSize: 0.01,
    maxLotSize: 100.0,
  },

  // Energy - Forex Hours
  USOIL: {
    symbol: 'USOIL',
    category: 'energy',
    displayName: 'WTI Crude',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.01,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 10.0,
  },
  UKOIL: {
    symbol: 'UKOIL',
    category: 'energy',
    displayName: 'Brent Crude',
    marketSchedule: 'forex',
    dataProvider: 'metaapi',
    pipValue: 0.01,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1000,
    dollarPerPipPerLot: 10,
    minLotSize: 0.01,
    maxLotSize: 10.0,
  },
};

export function getSymbolConfig(symbol: string): SymbolConfig | undefined {
  return SYMBOL_REGISTRY[symbol.toUpperCase()];
}

export function isKnownSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in SYMBOL_REGISTRY;
}

export function getSymbolsByCategory(category: SymbolCategory): string[] {
  return Object.keys(SYMBOL_REGISTRY).filter(
    sym => SYMBOL_REGISTRY[sym].category === category
  );
}

export function getSymbolsByMarketSchedule(schedule: MarketSchedule): string[] {
  return Object.keys(SYMBOL_REGISTRY).filter(
    sym => SYMBOL_REGISTRY[sym].marketSchedule === schedule
  );
}

export function getSymbolsByDataProvider(provider: DataProvider): string[] {
  return Object.keys(SYMBOL_REGISTRY).filter(
    sym => SYMBOL_REGISTRY[sym].dataProvider === provider
  );
}

export function is24HourMarket(symbol: string): boolean {
  const config = getSymbolConfig(symbol);
  return config?.marketSchedule === '24/7';
}

export const ALL_SYMBOLS = Object.keys(SYMBOL_REGISTRY);
export const FOREX_SYMBOLS = getSymbolsByCategory('forex');
export const CRYPTO_SYMBOLS = getSymbolsByCategory('crypto');
export const INDEX_SYMBOLS = getSymbolsByCategory('index');
export const METAL_SYMBOLS = getSymbolsByCategory('metal');
export const ENERGY_SYMBOLS = getSymbolsByCategory('energy');

export const SYMBOLS_24_7 = getSymbolsByMarketSchedule('24/7');
export const SYMBOLS_FOREX_HOURS = getSymbolsByMarketSchedule('forex');

export const METAAPI_SYMBOLS = getSymbolsByDataProvider('metaapi');
export const KRAKEN_SYMBOLS = getSymbolsByDataProvider('kraken');
