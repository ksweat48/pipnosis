/**
 * Symbol Registry - Centralized Symbol Configuration
 *
 * Single source of truth for all symbol-related configurations including:
 * - Categories (forex, crypto, index, metal, energy)
 * - Market hours (24/7 for crypto, forex hours for others)
 * - Data providers (MetaAPI for forex, Kraken for crypto)
 * - Pip values and lot sizes
 *
 * IMPORTANT - Dual PipValue System:
 *
 * This registry defines pipValue as MINIMUM TICK SIZE for market data:
 * - XAUUSD: 0.01 (smallest price increment)
 * - EURUSD: 0.0001 (smallest price increment)
 *
 * For POSITION SIZING, see currencyHelpers.ts which uses REASONING PIP:
 * - XAUUSD: 1.0 (allows natural reasoning: "20 pip stop" = 20 points)
 * - This maintains correct dollar values while simplifying LLM logic
 *
 * Both systems are mathematically correct for their purposes.
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
  typicalDailyRangePoints: number;
  typicalSessionMovePoints: number;
  atrMultiplierForStop: number;
}

export const SYMBOL_REGISTRY: Record<string, SymbolConfig> = {
  // Metals - Forex Hours
  // maxLotSize is a broker ceiling (not a position sizing cap).
  // Actual lot sizes always scale with account balance and user risk %.
  // Use getScaledMaxLotSize(symbol, accountBalance, riskPct) for dynamic risk-proportionate ceilings.
  // Math: derivedMax @ $500k/5% = $25,000 / (10 * 1.0) = 2,500 lots → ceiling 500.0
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 300,
    typicalSessionMovePoints: 150,
    atrMultiplierForStop: 1.5,
  },
  // Indices - Forex Hours
  // maxLotSize is a broker ceiling (not a position sizing cap).
  // Actual lot sizes always scale with account balance and user risk %.
  // Use getScaledMaxLotSize(symbol, accountBalance) for dynamic risk-proportionate ceilings.
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
    dollarPerPipPerLot: 100,
    minLotSize: 0.01,
    maxLotSize: 500.0,
    typicalDailyRangePoints: 400,
    typicalSessionMovePoints: 200,
    atrMultiplierForStop: 1.5,
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
    dollarPerPipPerLot: 100,
    minLotSize: 0.01,
    maxLotSize: 500.0,
    typicalDailyRangePoints: 500,
    typicalSessionMovePoints: 250,
    atrMultiplierForStop: 1.5,
  },
  // CCIP-2026-0515B-SPX500-RETIREMENT: SPX500 retired 2026-05-15.
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
    dollarPerPipPerLot: 100,
    minLotSize: 0.01,
    maxLotSize: 500.0,
    typicalDailyRangePoints: 250,
    typicalSessionMovePoints: 125,
    atrMultiplierForStop: 1.5,
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
    dollarPerPipPerLot: 100,
    minLotSize: 0.01,
    maxLotSize: 500.0,
    typicalDailyRangePoints: 350,
    typicalSessionMovePoints: 175,
    atrMultiplierForStop: 1.5,
  },

  // Forex - Major Pairs
  // maxLotSize is a broker ceiling (not a position sizing cap).
  // Math: derivedMax @ $500k/5% = $25,000 / (5 * 10) = 500 lots → ceiling 500.0
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 80,
    typicalSessionMovePoints: 40,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 100,
    typicalSessionMovePoints: 50,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 120,
    typicalSessionMovePoints: 60,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 70,
    typicalSessionMovePoints: 35,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 70,
    typicalSessionMovePoints: 35,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 65,
    typicalSessionMovePoints: 32,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 75,
    typicalSessionMovePoints: 38,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 60,
    typicalSessionMovePoints: 30,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 140,
    typicalSessionMovePoints: 70,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 160,
    typicalSessionMovePoints: 80,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 130,
    typicalSessionMovePoints: 65,
    atrMultiplierForStop: 1.2,
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 90,
    typicalSessionMovePoints: 45,
    atrMultiplierForStop: 1.2,
  },

  // Crypto - 24/7 Trading (via Kraken)
  // maxLotSize is a broker ceiling (not a position sizing cap).
  // Math: derivedMax @ $500k/5% = $25,000 / (50 * 1.0) = 500 lots → ceiling 500.0
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
    maxLotSize: 500.0,
    typicalDailyRangePoints: 3000,
    typicalSessionMovePoints: 1000,
    atrMultiplierForStop: 1.5,
  },
  ETHUSD: {
    symbol: 'ETHUSD',
    category: 'crypto',
    displayName: 'Ethereum',
    marketSchedule: '24/7',
    dataProvider: 'kraken',
    pipValue: 1.0,
    pipMultiplier: 1,
    decimalPlaces: 2,
    contractSize: 1,
    dollarPerPipPerLot: 1.0,
    minLotSize: 0.01,
    maxLotSize: 500.0,
    typicalDailyRangePoints: 150,
    typicalSessionMovePoints: 75,
    atrMultiplierForStop: 1.5,
  },

  // Energy - Forex Hours
  // maxLotSize is a broker ceiling (not a position sizing cap).
  // Math: derivedMax @ $500k/5% = $25,000 / (10 * 10) = 250 lots → ceiling 250.0
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
    maxLotSize: 250.0,
    typicalDailyRangePoints: 100,
    typicalSessionMovePoints: 50,
    atrMultiplierForStop: 1.5,
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
    maxLotSize: 250.0,
    typicalDailyRangePoints: 100,
    typicalSessionMovePoints: 50,
    atrMultiplierForStop: 1.5,
  },
};

/**
 * Broker Lot Tier Configuration
 *
 * SSOT for all broker contract-size calibration logic.
 * These are the only valid tier values across the DB constraint,
 * the calibration service, and the Settings UI.
 *
 * Standard multipliers:
 *   standard = 1.0  (full lot  — industry default, 100k units for forex)
 *   mini     = 0.1  (mini lot  — 10k units for forex)
 *   micro    = 0.01 (micro lot — 1k units for forex)
 *
 * Scope: the 9 in-scope calibratable instruments only.
 * All other symbols always use standard (no calibration needed / not user-facing).
 */
export type LotTier = 'standard' | 'mini' | 'micro';

// CCIP-2026-0515B-SPX500-RETIREMENT: SPX500 retired from calibratable instruments.
export const CALIBRATABLE_SYMBOLS = [
  'XAUUSD', 'US30', 'NAS100',
  'EURUSD', 'GBPUSD', 'USDJPY',
  'BTCUSD', 'ETHUSD',
] as const;

export type CalibratableSymbol = typeof CALIBRATABLE_SYMBOLS[number];

export const LOT_TIER_MULTIPLIERS: Record<LotTier, number> = {
  standard: 1.0,
  mini:     0.1,
  micro:    0.01,
};

export function getBrokerTierMultiplier(tier: LotTier | undefined | null): number {
  if (!tier || !(tier in LOT_TIER_MULTIPLIERS)) return 1.0;
  return LOT_TIER_MULTIPLIERS[tier];
}

export function isCalibratableSymbol(symbol: string): symbol is CalibratableSymbol {
  return (CALIBRATABLE_SYMBOLS as readonly string[]).includes(symbol.toUpperCase());
}

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

/**
 * @deprecated DO NOT USE directly - Query via assetClassifier.getSymbolsByCategory('crypto')
 * This constant is kept for backward compatibility but should not be used in new code.
 * Use the SSOT: assetClassifier service for all asset classification queries.
 */
export const CRYPTO_SYMBOLS = getSymbolsByCategory('crypto');

export const INDEX_SYMBOLS = getSymbolsByCategory('index');
export const METAL_SYMBOLS = getSymbolsByCategory('metal');
export const ENERGY_SYMBOLS = getSymbolsByCategory('energy');

export const SYMBOLS_24_7 = getSymbolsByMarketSchedule('24/7');
export const SYMBOLS_FOREX_HOURS = getSymbolsByMarketSchedule('forex');

export const METAAPI_SYMBOLS = getSymbolsByDataProvider('metaapi');
export const KRAKEN_SYMBOLS = getSymbolsByDataProvider('kraken');

/**
 * SSOT: Account-balance-scaled maximum lot size
 *
 * Returns the maximum lot size appropriate for the given account balance
 * and risk percentage. This replaces ALL hardcoded maxLotSize caps
 * in position sizing functions.
 *
 * GOVERNANCE: This is the single authority for dynamic lot ceilings.
 * No function should cap lot size using a hardcoded constant — always
 * call this function to respect account scale.
 *
 * Formula: maxLot = (accountBalance × riskPct / 100) / (minReasonableStop × dollarPerPipPerLot)
 * where minReasonableStop is the smallest stop that makes sense for this instrument.
 *
 * The result is additionally bounded by the symbol registry's maxLotSize
 * (which is a broker ceiling, not a position sizing constraint).
 *
 * @param symbol - The trading symbol
 * @param accountBalance - Current account balance in USD
 * @param riskPercentage - User's max risk per trade (e.g., 5 for 5%)
 * @returns Maximum safe lot size for this account and risk setting
 */
/**
 * SSOT: Account-balance-proportionate lot ceiling.
 *
 * Returns the maximum lot size for a given symbol, account balance, and risk %.
 * This is the sole authority for dynamic lot ceilings used across:
 *   - calculatePositionSize() in currencyHelpers.ts
 *   - calculateGoalAwareLotSize() in currencyHelpers.ts
 *   - unified-risk-authority.ts broker ceiling enforcement
 *
 * RISK-FIRST formula:
 *   riskDollars = accountBalance × riskPct / 100
 *   derivedMax  = riskDollars / (minReasonableSL × dollarPerPipPerLot)
 *   effectiveMax = Math.min(derivedMax, config.maxLotSize)
 *
 * riskPercentage = the % of balance the user is willing to LOSE at the SL (not a profit target).
 * minReasonableSL prevents astronomically large lots from micro-pip SL inputs.
 * config.maxLotSize is a BROKER CEILING ONLY — never a position sizing constraint.
 */
export function getScaledMaxLotSize(
  symbol: string,
  accountBalance: number,
  riskPercentage: number
): number {
  const config = getSymbolConfig(symbol);
  if (!config) return 500.0;

  // riskDollars = what the user is willing to lose at the SL
  const riskDollars = accountBalance * (riskPercentage / 100);

  // Ceiling formula: riskDollars / (minimumReasonableSL × dollarPerPipPerLot)
  // Using minimum SL distance keeps the ceiling generous — actual lot will always be
  // smaller because the real SL distance is always >= minReasonableSL.
  const minReasonableSLByCategory: Record<SymbolCategory, number> = {
    forex: 1,    // 1 pip minimum SL
    index: 5,    // 5 points minimum SL
    metal: 2,    // 2 points minimum SL (XAUUSD)
    crypto: 20,  // 20 points minimum SL (BTC/ETH)
    energy: 5,   // 5 points minimum SL
  };

  const minSL = minReasonableSLByCategory[config.category] ?? 5;
  const derivedMax = riskDollars / (minSL * config.dollarPerPipPerLot);

  return Math.min(derivedMax, config.maxLotSize);
}
