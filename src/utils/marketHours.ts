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
