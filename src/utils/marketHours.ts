import { marketScheduleService } from '@/services/market-schedule-service';

export interface MarketStatus {
  isOpen: boolean;
  status: 'Open' | 'Closed';
}

/**
 * DEPRECATED: Use marketScheduleService.isHoliday() instead
 * This function is kept for backwards compatibility but delegates to the SSOT
 */
function isTradingHoliday(estTime: Date): boolean {
  // This is now synchronous fallback - for async version use marketScheduleService
  const month = estTime.getMonth();
  const date = estTime.getDate();

  // Basic holiday check without database
  // Christmas Day
  if (month === 11 && date === 25) return true;
  // New Year's Day
  if (month === 0 && date === 1) return true;

  // For full holiday checking including database, use marketScheduleService.isHoliday()
  return false;
}

/**
 * Determines if the Forex market is currently open
 * DELEGATES to marketScheduleService (SINGLE SOURCE OF TRUTH)
 *
 * Note: This is a synchronous wrapper. For full holiday checking, use getForexMarketStatusAsync()
 */
export function getForexMarketStatus(): MarketStatus {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  // Basic holiday check (synchronous fallback)
  if (isTradingHoliday(estTime)) {
    return {
      isOpen: false,
      status: 'Closed'
    };
  }

  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const fridayCloseTime = 17 * 60;
  const sundayOpenTime = 17 * 60;

  let isOpen = true;

  if (dayOfWeek === 6) {
    isOpen = false;
  }
  else if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) {
    isOpen = false;
  }
  else if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
    isOpen = false;
  }

  return {
    isOpen,
    status: isOpen ? 'Open' : 'Closed'
  };
}

/**
 * Async version that checks database for holidays and early closures
 * USE THIS for accurate market status including holidays
 */
export async function getForexMarketStatusAsync(): Promise<MarketStatus> {
  const status = await marketScheduleService.getMarketStatus();
  return {
    isOpen: status.isOpen,
    status: status.isOpen ? 'Open' : 'Closed'
  };
}

/**
 * Calculates time remaining until market opens or closes
 * SYNCHRONOUS version - for full accuracy including holidays, use getTimeUntilMarketChangeAsync()
 */
export function getTimeUntilMarketChange(): { hours: number; minutes: number; isOpening: boolean } {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const marketStatus = getForexMarketStatus();

  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();

  if (marketStatus.isOpen) {
    let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    if (daysUntilFriday === 0 && (hours > 17 || (hours === 17 && minutes > 0))) {
      daysUntilFriday = 7;
    }

    const closeTime = new Date(estTime);
    closeTime.setDate(closeTime.getDate() + daysUntilFriday);
    closeTime.setHours(17, 0, 0, 0);

    const diffMs = closeTime.getTime() - estTime.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    return {
      hours: diffHours,
      minutes: diffMinutes,
      isOpening: false
    };
  } else {
    let daysUntilSunday = (7 - dayOfWeek) % 7;
    if (daysUntilSunday === 0 && hours >= 17) {
      daysUntilSunday = 7;
    }

    const openTime = new Date(estTime);
    openTime.setDate(openTime.getDate() + daysUntilSunday);
    openTime.setHours(17, 0, 0, 0);

    const diffMs = openTime.getTime() - estTime.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    return {
      hours: diffHours,
      minutes: diffMinutes,
      isOpening: true
    };
  }
}

/**
 * Async version that checks holidays and early closures from database
 * USE THIS for accurate time calculations including holidays
 */
export async function getTimeUntilMarketChangeAsync(): Promise<{ hours: number; minutes: number; isOpening: boolean }> {
  const result = await marketScheduleService.getTimeUntilMarketChange();
  return {
    hours: result.hours,
    minutes: result.minutes,
    isOpening: result.isOpening
  };
}

/**
 * CRITICAL: Check if a specific timestamp (Unix seconds) was during open market hours
 * This prevents displaying fake candles from Saturday/Sunday when market is closed
 *
 * @param unixTimestamp - Unix timestamp in seconds
 * @returns true if timestamp is during open market hours
 */
export function isMarketOpenAt(unixTimestamp: number): boolean {
  // Convert Unix timestamp to Date
  const date = new Date(unixTimestamp * 1000);

  // Convert to EST/EDT (New York timezone)
  const estTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const dayOfWeek = estTime.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Friday 5:00 PM = 17:00 = 1020 minutes
  const fridayCloseTime = 17 * 60;

  // Sunday 5:00 PM = 17:00 = 1020 minutes
  const sundayOpenTime = 17 * 60;

  // Market is closed on Saturday (all day)
  if (dayOfWeek === 6) {
    return false;
  }

  // Market is closed Friday after 5:00 PM
  if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) {
    return false;
  }

  // Market is closed Sunday before 5:00 PM
  if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
    return false;
  }

  return true;
}

/**
 * Get the timestamp of the last market close (Friday 5pm EST)
 * This is useful for determining the cutoff for historical data
 *
 * @returns Unix timestamp in seconds of last market close
 */
export function getLastMarketCloseTime(): number {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();

  // Calculate the most recent Friday 5pm
  let daysToSubtract = 0;

  if (dayOfWeek === 6) {
    // Saturday - go back 1 day to Friday
    daysToSubtract = 1;
  } else if (dayOfWeek === 0) {
    // Sunday - go back 2 days to Friday
    daysToSubtract = 2;
  } else if (dayOfWeek === 5 && (hours < 17 || (hours === 17 && minutes === 0))) {
    // Friday before 5pm - go back 7 days to last Friday
    daysToSubtract = 7;
  } else if (dayOfWeek === 5) {
    // Friday after 5pm - this is the close time
    daysToSubtract = 0;
  } else {
    // Monday-Thursday - go back to previous Friday
    daysToSubtract = (dayOfWeek + 2) % 7;
  }

  const lastClose = new Date(estTime);
  lastClose.setDate(lastClose.getDate() - daysToSubtract);
  lastClose.setHours(17, 0, 0, 0);

  return Math.floor(lastClose.getTime() / 1000);
}

/**
 * Get appropriate lookback time in hours based on timeframe
 * Lower timeframes need more hours to get enough candles
 *
 * @param timeframe - The chart timeframe (M1, M5, M15, etc.)
 * @returns Number of hours to look back
 */
export function getTimeframeLookbackHours(timeframe: string): number {
  const lookbackMap: Record<string, number> = {
    'M1': 336,   // 14 days = 20,160 candles (increased from 48h to show backfill data)
    'M5': 720,   // 30 days = 8,640 candles (increased from 72h to show backfill data)
    'M15': 1440, // 60 days = 5,760 candles (increased from 96h to show backfill data)
    'M30': 2160, // 90 days = 4,320 candles (increased from 120h to show backfill data)
    'H1': 4320,  // 180 days = 4,320 candles (increased to match other timeframes)
    'H4': 8760,  // 365 days = 2,190 candles (1 year of data)
    'D1': 8760   // 365 days = 365 candles (1 year of data)
  };

  return lookbackMap[timeframe] || 720; // Default to 30 days
}

const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'];

export function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_SYMBOLS.includes(symbol.toUpperCase());
}

export function is24HourSymbol(symbol: string): boolean {
  return isCryptoSymbol(symbol);
}

export interface SymbolMarketStatus {
  symbol: string;
  isOpen: boolean;
  status: 'Open' | 'Closed';
  is24Hour: boolean;
  reason?: string;
}

export function getSymbolMarketStatus(symbol: string): SymbolMarketStatus {
  const normalizedSymbol = symbol.toUpperCase();

  if (is24HourSymbol(normalizedSymbol)) {
    return {
      symbol: normalizedSymbol,
      isOpen: true,
      status: 'Open',
      is24Hour: true,
      reason: 'Crypto markets are open 24/7'
    };
  }

  const forexStatus = getForexMarketStatus();

  return {
    symbol: normalizedSymbol,
    isOpen: forexStatus.isOpen,
    status: forexStatus.status,
    is24Hour: false,
    reason: forexStatus.isOpen
      ? 'Forex/Index market open'
      : 'Forex/Index market closed (Weekend: Fri 5pm - Sun 5pm EST)'
  };
}

export function isSymbolMarketOpen(symbol: string): boolean {
  return getSymbolMarketStatus(symbol).isOpen;
}

export function isSymbolMarketOpenAt(symbol: string, unixTimestamp: number): boolean {
  if (is24HourSymbol(symbol)) {
    return true;
  }
  return isMarketOpenAt(unixTimestamp);
}

export function getOpenSymbols(symbols: string[]): string[] {
  return symbols.filter(symbol => isSymbolMarketOpen(symbol));
}

export function getClosedSymbols(symbols: string[]): string[] {
  return symbols.filter(symbol => !isSymbolMarketOpen(symbol));
}

export function hasAnyOpenMarket(symbols: string[]): boolean {
  return symbols.some(symbol => isSymbolMarketOpen(symbol));
}

export function getAllMarketsStatus(symbols: string[]): {
  allOpen: boolean;
  allClosed: boolean;
  cryptoOpen: boolean;
  forexOpen: boolean;
  openCount: number;
  closedCount: number;
} {
  const cryptoSymbols = symbols.filter(s => is24HourSymbol(s));
  const forexSymbols = symbols.filter(s => !is24HourSymbol(s));

  const forexStatus = getForexMarketStatus();
  const cryptoOpen = cryptoSymbols.length > 0;
  const forexOpen = forexSymbols.length > 0 && forexStatus.isOpen;

  const openCount = cryptoSymbols.length + (forexStatus.isOpen ? forexSymbols.length : 0);
  const closedCount = symbols.length - openCount;

  return {
    allOpen: openCount === symbols.length,
    allClosed: openCount === 0,
    cryptoOpen,
    forexOpen,
    openCount,
    closedCount
  };
}

/**
 * Market session detection for entry intent timeout adjustment
 */
export type MarketSession =
  | 'london_ny_overlap'  // High liquidity: 08:00-12:00 EST (13:00-17:00 UTC)
  | 'london_session'     // Good liquidity: 03:00-12:00 EST (08:00-17:00 UTC)
  | 'ny_session'         // Good liquidity: 08:00-17:00 EST (13:00-22:00 UTC)
  | 'tokyo_session'      // Low liquidity for EUR/GBP: 19:00-04:00 EST (00:00-09:00 UTC)
  | 'dead_zone';         // Very low liquidity: 17:00-19:00 EST (22:00-00:00 UTC)

export interface SessionInfo {
  session: MarketSession;
  liquidity: 'high' | 'medium' | 'low' | 'very_low';
  timeoutMultiplier: number; // Multiply base timeout by this
  description: string;
}

export function getCurrentMarketSession(): SessionInfo {
  const now = new Date();
  const utcHours = now.getUTCHours();

  // London/NY Overlap: 13:00-17:00 UTC (8am-12pm EST)
  if (utcHours >= 13 && utcHours < 17) {
    return {
      session: 'london_ny_overlap',
      liquidity: 'high',
      timeoutMultiplier: 1.0,
      description: 'London/NY overlap - highest liquidity'
    };
  }

  // London Session: 08:00-17:00 UTC (3am-12pm EST)
  if (utcHours >= 8 && utcHours < 17) {
    return {
      session: 'london_session',
      liquidity: 'medium',
      timeoutMultiplier: 1.0,
      description: 'London session - good liquidity'
    };
  }

  // NY Session: 13:00-22:00 UTC (8am-5pm EST)
  if (utcHours >= 13 && utcHours < 22) {
    return {
      session: 'ny_session',
      liquidity: 'medium',
      timeoutMultiplier: 1.0,
      description: 'NY session - good liquidity'
    };
  }

  // Dead Zone: 22:00-00:00 UTC (5pm-7pm EST)
  if (utcHours >= 22 || utcHours < 0) {
    return {
      session: 'dead_zone',
      liquidity: 'very_low',
      timeoutMultiplier: 0.2, // Reduce timeouts to 20% (e.g., 90min -> 18min)
      description: 'Dead zone - very low liquidity, reduce timeouts'
    };
  }

  // Tokyo Session: 00:00-09:00 UTC (7pm-4am EST)
  return {
    session: 'tokyo_session',
    liquidity: 'low',
    timeoutMultiplier: 0.5, // Reduce timeouts to 50% for non-JPY pairs
    description: 'Tokyo session - low liquidity for EUR/GBP'
  };
}

/**
 * Adjust entry intent timeout based on market session
 * @param baseTimeoutMinutes - Original timeout in minutes
 * @param symbol - Trading symbol (JPY pairs get different treatment)
 * @returns Adjusted timeout in minutes
 */
export function getSessionAdjustedTimeout(baseTimeoutMinutes: number, symbol?: string): number {
  const session = getCurrentMarketSession();

  // JPY pairs perform better in Tokyo session
  const isJPYPair = symbol?.includes('JPY');

  if (session.session === 'tokyo_session' && isJPYPair) {
    // Don't reduce timeout for JPY pairs during Tokyo session
    return baseTimeoutMinutes;
  }

  const adjusted = Math.max(
    5, // Minimum 5 minutes
    Math.round(baseTimeoutMinutes * session.timeoutMultiplier)
  );

  if (adjusted !== baseTimeoutMinutes) {
    console.log(`[Session Timeout] ${session.description}: ${baseTimeoutMinutes}min -> ${adjusted}min`);
  }

  return adjusted;
}
