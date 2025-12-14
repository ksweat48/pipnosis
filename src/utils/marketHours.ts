export interface MarketStatus {
  isOpen: boolean;
  status: 'Open' | 'Closed';
}

/**
 * Determines if the Forex market is currently open
 * Forex market closes Friday 5:00 PM EST and reopens Sunday 5:00 PM EST
 */
export function getForexMarketStatus(): MarketStatus {
  const now = new Date();

  // Convert current time to EST/EDT (New York timezone)
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const dayOfWeek = estTime.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Friday 5:00 PM = 17:00 = 1020 minutes
  const fridayCloseTime = 17 * 60; // 1020 minutes

  // Sunday 5:00 PM = 17:00 = 1020 minutes
  const sundayOpenTime = 17 * 60; // 1020 minutes

  let isOpen = true;

  // Market is closed on Saturday (all day)
  if (dayOfWeek === 6) {
    isOpen = false;
  }
  // Market is closed Friday after 5:00 PM
  else if (dayOfWeek === 5 && totalMinutes >= fridayCloseTime) {
    isOpen = false;
  }
  // Market is closed Sunday before 5:00 PM
  else if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
    isOpen = false;
  }

  return {
    isOpen,
    status: isOpen ? 'Open' : 'Closed'
  };
}

/**
 * Calculates time remaining until market opens or closes
 */
export function getTimeUntilMarketChange(): { hours: number; minutes: number; isOpening: boolean } {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const marketStatus = getForexMarketStatus();

  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();

  if (marketStatus.isOpen) {
    // Market is open, calculate time until Friday 5 PM close
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
    // Market is closed, calculate time until Sunday 5 PM open
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
