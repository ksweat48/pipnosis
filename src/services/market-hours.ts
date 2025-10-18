export interface MarketDay {
  date: Date;
  isWeekend: boolean;
  isHoliday: boolean;
  isTradingDay: boolean;
}

class MarketHoursService {
  private forexHolidays2025: Date[] = [
    new Date('2025-01-01'),
    new Date('2025-12-25'),
  ];

  // Forex market opens Sunday 5:00 PM EST (10:00 PM UTC / 22:00 UTC)
  private readonly MARKET_OPEN_UTC_HOUR = 22;
  // Forex market closes Friday 5:00 PM EST (10:00 PM UTC / 22:00 UTC)
  private readonly MARKET_CLOSE_UTC_HOUR = 22;

  isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  isHoliday(date: Date): boolean {
    const dateStr = date.toISOString().split('T')[0];
    return this.forexHolidays2025.some(
      holiday => holiday.toISOString().split('T')[0] === dateStr
    );
  }

  /**
   * Check if the market is currently open based on day AND hour
   * Sunday: Opens at 22:00 UTC (5:00 PM EST)
   * Monday-Thursday: Open all day
   * Friday: Closes at 22:00 UTC (5:00 PM EST)
   * Saturday: Closed all day
   */
  isMarketOpen(date: Date): boolean {
    const utcDay = date.getUTCDay();
    const utcHour = date.getUTCHours();

    // Check if it's a holiday
    if (this.isHoliday(date)) {
      return false;
    }

    // Saturday: Market is closed
    if (utcDay === 6) {
      return false;
    }

    // Sunday: Market opens at 22:00 UTC
    if (utcDay === 0) {
      return utcHour >= this.MARKET_OPEN_UTC_HOUR;
    }

    // Friday: Market closes at 22:00 UTC
    if (utcDay === 5) {
      return utcHour < this.MARKET_CLOSE_UTC_HOUR;
    }

    // Monday (1) through Thursday (4): Market is open all day
    return true;
  }

  /**
   * Legacy method for backward compatibility
   * Use isMarketOpen() instead for accurate hour-based detection
   */
  isTradingDay(date: Date): boolean {
    return !this.isWeekend(date) && !this.isHoliday(date);
  }

  getMarketDayInfo(date: Date): MarketDay {
    const isWeekend = this.isWeekend(date);
    const isHoliday = this.isHoliday(date);
    return {
      date,
      isWeekend,
      isHoliday,
      isTradingDay: this.isMarketOpen(date)
    };
  }

  getTradingDaysBetween(startDate: Date, endDate: Date): Date[] {
    const tradingDays: Date[] = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (this.isTradingDay(current)) {
        tradingDays.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }

    return tradingDays;
  }

  getDayOfWeekName(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  }

  /**
   * Get detailed market status message with day and time context
   */
  getMarketStatusMessage(date: Date): string {
    const isOpen = this.isMarketOpen(date);
    const utcDay = date.getUTCDay();
    const utcHour = date.getUTCHours();
    const dayName = this.getDayOfWeekName(date);

    if (this.isHoliday(date)) {
      return 'Market Closed - Holiday';
    }

    if (utcDay === 6) {
      return `Market Closed - ${dayName}`;
    }

    if (utcDay === 0) {
      if (utcHour < this.MARKET_OPEN_UTC_HOUR) {
        return `Market Closed - ${dayName} (Opens 5:00 PM EST)`;
      }
      return 'Market Open';
    }

    if (utcDay === 5) {
      if (utcHour >= this.MARKET_CLOSE_UTC_HOUR) {
        return `Market Closed - ${dayName} (Closed 5:00 PM EST)`;
      }
      return 'Market Open';
    }

    return isOpen ? 'Market Open' : 'Market Closed';
  }

  getCurrentMarketClosePeriod(fromDate: Date): { start: Date; end: Date } | null {
    const current = new Date(fromDate);

    if (!this.isTradingDay(current)) {
      let start = new Date(current);
      start.setHours(0, 0, 0, 0);

      while (start.getTime() > 0 && !this.isTradingDay(start)) {
        start.setDate(start.getDate() - 1);
        if (start.getTime() < current.getTime() - 7 * 24 * 60 * 60 * 1000) {
          break;
        }
      }

      if (this.isTradingDay(start)) {
        start.setDate(start.getDate() + 1);
      }
      start.setHours(0, 0, 0, 0);

      let end = new Date(current);
      end.setHours(0, 0, 0, 0);

      while (!this.isTradingDay(end)) {
        end.setDate(end.getDate() + 1);
        if (end.getTime() - start.getTime() > 7 * 24 * 60 * 60 * 1000) {
          break;
        }
      }

      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);

      return { start, end };
    }

    return null;
  }

  getNextMarketClosePeriod(fromDate: Date): { start: Date; end: Date } | null {
    const current = new Date(fromDate);
    current.setHours(0, 0, 0, 0);

    const startCheckFrom = this.isTradingDay(current) ? 1 : 0;

    for (let i = startCheckFrom; i < 30; i++) {
      const checkDate = new Date(current);
      checkDate.setDate(checkDate.getDate() + i);

      if (!this.isTradingDay(checkDate)) {
        const start = new Date(checkDate);
        start.setHours(0, 0, 0, 0);

        let end = new Date(start);

        while (!this.isTradingDay(end)) {
          end.setDate(end.getDate() + 1);
          if (end.getTime() - start.getTime() > 7 * 24 * 60 * 60 * 1000) {
            break;
          }
        }

        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);

        return { start, end };
      }
    }

    return null;
  }
}

export const marketHoursService = new MarketHoursService();
