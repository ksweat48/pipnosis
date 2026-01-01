/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Market Schedule Service - SINGLE SOURCE OF TRUTH
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This is the AUTHORITATIVE source for ALL market schedule logic:
 * - Market open/close times
 * - Holiday detection
 * - Early closures
 * - Weekend protection timing
 *
 * ALL other services MUST delegate to this service. NO duplication allowed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';

// Market Constants
export const FOREX_MARKET_CONSTANTS = {
  WEEKLY_OPEN_DAY: 0, // Sunday
  WEEKLY_OPEN_HOUR_EST: 17, // 5:00 PM EST
  WEEKLY_CLOSE_DAY: 5, // Friday
  WEEKLY_CLOSE_HOUR_EST: 17, // 5:00 PM EST
  TIMEZONE: 'America/New_York',
  EST_UTC_OFFSET: -5, // Standard time offset (EDT is -4 during DST)
} as const;

export interface MarketStatus {
  isOpen: boolean;
  status: 'open' | 'closed' | 'early_close' | 'holiday';
  reason?: string;
  nextChangeTime?: Date;
  hoursUntilChange?: number;
  minutesUntilChange?: number;
}

export interface MarketHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  type: 'full_day' | 'early_close';
  earlyCloseTimeEST?: string; // HH:MM format, e.g., "13:00" for 1 PM
}

export interface MarketScheduleOverride {
  date: string; // YYYY-MM-DD
  type: 'closed' | 'early_close';
  closeTimeEST?: string; // HH:MM format
  reason: string;
}

class MarketScheduleService {
  private holidayCache: Map<string, MarketHoliday> = new Map();
  private overrideCache: Map<string, MarketScheduleOverride> = new Map();
  private lastCacheUpdate: Date | null = null;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Hardcoded holidays for 2025-2026 (fallback if DB is not available)
  private readonly HARDCODED_HOLIDAYS: MarketHoliday[] = [
    // 2025
    { date: '2025-01-01', name: 'New Year\'s Day', type: 'full_day' },
    { date: '2025-01-20', name: 'Martin Luther King Jr. Day', type: 'full_day' },
    { date: '2025-02-17', name: 'Presidents Day', type: 'full_day' },
    { date: '2025-04-18', name: 'Good Friday', type: 'full_day' },
    { date: '2025-05-26', name: 'Memorial Day', type: 'full_day' },
    { date: '2025-07-04', name: 'Independence Day', type: 'full_day' },
    { date: '2025-09-01', name: 'Labor Day', type: 'full_day' },
    { date: '2025-11-27', name: 'Thanksgiving', type: 'full_day' },
    { date: '2025-12-24', name: 'Christmas Eve', type: 'early_close', earlyCloseTimeEST: '13:00' },
    { date: '2025-12-25', name: 'Christmas Day', type: 'full_day' },
    { date: '2025-12-31', name: 'New Year\'s Eve', type: 'early_close', earlyCloseTimeEST: '13:00' },

    // 2026
    { date: '2026-01-01', name: 'New Year\'s Day', type: 'full_day' },
    { date: '2026-01-19', name: 'Martin Luther King Jr. Day', type: 'full_day' },
    { date: '2026-02-16', name: 'Presidents Day', type: 'full_day' },
    { date: '2026-04-03', name: 'Good Friday', type: 'full_day' },
    { date: '2026-05-25', name: 'Memorial Day', type: 'full_day' },
    { date: '2026-07-03', name: 'Independence Day (Observed)', type: 'full_day' }, // July 4 falls on Saturday
    { date: '2026-09-07', name: 'Labor Day', type: 'full_day' },
    { date: '2026-11-26', name: 'Thanksgiving', type: 'full_day' },
    { date: '2026-12-24', name: 'Christmas Eve', type: 'early_close', earlyCloseTimeEST: '13:00' },
    { date: '2026-12-25', name: 'Christmas Day', type: 'full_day' },
    { date: '2026-12-31', name: 'New Year\'s Eve', type: 'early_close', earlyCloseTimeEST: '13:00' },
  ];

  /**
   * Get current date/time in EST
   */
  private getESTTime(date?: Date): Date {
    const targetDate = date || new Date();
    const estString = targetDate.toLocaleString('en-US', {
      timeZone: FOREX_MARKET_CONSTANTS.TIMEZONE
    });
    return new Date(estString);
  }

  /**
   * Format date as YYYY-MM-DD in EST
   */
  private formatDateEST(date: Date): string {
    const estDate = this.getESTTime(date);
    const year = estDate.getFullYear();
    const month = String(estDate.getMonth() + 1).padStart(2, '0');
    const day = String(estDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Load holidays and overrides from database
   */
  private async loadFromDatabase(): Promise<void> {
    try {
      // Load holidays
      const { data: holidays, error: holidayError } = await supabase
        .from('market_holidays')
        .select('*')
        .gte('date', this.formatDateEST(new Date()))
        .order('date', { ascending: true });

      if (!holidayError && holidays) {
        this.holidayCache.clear();
        for (const holiday of holidays) {
          this.holidayCache.set(holiday.date, {
            date: holiday.date,
            name: holiday.name,
            type: holiday.type,
            earlyCloseTimeEST: holiday.early_close_time_est
          });
        }
        logger.debug(LogCategory.TRADING, `Loaded ${holidays.length} holidays from database`);
      } else {
        logger.warn(LogCategory.TRADING, 'Failed to load holidays from database, using hardcoded fallback', holidayError);
        // Use hardcoded holidays as fallback
        this.holidayCache.clear();
        for (const holiday of this.HARDCODED_HOLIDAYS) {
          this.holidayCache.set(holiday.date, holiday);
        }
      }

      // Load schedule overrides
      const { data: overrides, error: overrideError } = await supabase
        .from('market_schedule_overrides')
        .select('*')
        .gte('date', this.formatDateEST(new Date()))
        .order('date', { ascending: true });

      if (!overrideError && overrides) {
        this.overrideCache.clear();
        for (const override of overrides) {
          this.overrideCache.set(override.date, {
            date: override.date,
            type: override.type,
            closeTimeEST: override.close_time_est,
            reason: override.reason
          });
        }
        logger.debug(LogCategory.TRADING, `Loaded ${overrides.length} schedule overrides from database`);
      }

      this.lastCacheUpdate = new Date();
    } catch (error) {
      logger.error(LogCategory.TRADING, 'Error loading market schedule from database', error);
      // Use hardcoded holidays as fallback
      this.holidayCache.clear();
      for (const holiday of this.HARDCODED_HOLIDAYS) {
        this.holidayCache.set(holiday.date, holiday);
      }
    }
  }

  /**
   * Ensure cache is fresh
   */
  private async ensureCacheFresh(): Promise<void> {
    if (!this.lastCacheUpdate ||
        Date.now() - this.lastCacheUpdate.getTime() > this.CACHE_TTL_MS) {
      await this.loadFromDatabase();
    }
  }

  /**
   * Check if a specific date is a holiday
   */
  public async isHoliday(date: Date = new Date()): Promise<MarketHoliday | null> {
    await this.ensureCacheFresh();

    const dateKey = this.formatDateEST(date);
    return this.holidayCache.get(dateKey) || null;
  }

  /**
   * Check if a specific date has a schedule override
   */
  public async getScheduleOverride(date: Date = new Date()): Promise<MarketScheduleOverride | null> {
    await this.ensureCacheFresh();

    const dateKey = this.formatDateEST(date);
    return this.overrideCache.get(dateKey) || null;
  }

  /**
   * Get comprehensive market status
   */
  public async getMarketStatus(date: Date = new Date()): Promise<MarketStatus> {
    const estTime = this.getESTTime(date);
    const dayOfWeek = estTime.getDay();
    const hours = estTime.getHours();
    const minutes = estTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // Check for holiday
    const holiday = await this.isHoliday(estTime);
    if (holiday) {
      if (holiday.type === 'full_day') {
        return {
          isOpen: false,
          status: 'holiday',
          reason: `Market closed for ${holiday.name}`
        };
      } else if (holiday.type === 'early_close' && holiday.earlyCloseTimeEST) {
        // Parse early close time
        const [earlyHour, earlyMinute] = holiday.earlyCloseTimeEST.split(':').map(Number);
        const earlyCloseMinutes = earlyHour * 60 + earlyMinute;

        if (totalMinutes >= earlyCloseMinutes) {
          return {
            isOpen: false,
            status: 'early_close',
            reason: `${holiday.name} - Market closed early at ${holiday.earlyCloseTimeEST} EST`
          };
        }
      }
    }

    // Check for schedule override
    const override = await this.getScheduleOverride(estTime);
    if (override) {
      if (override.type === 'closed') {
        return {
          isOpen: false,
          status: 'closed',
          reason: override.reason
        };
      } else if (override.type === 'early_close' && override.closeTimeEST) {
        const [overrideHour, overrideMinute] = override.closeTimeEST.split(':').map(Number);
        const overrideCloseMinutes = overrideHour * 60 + overrideMinute;

        if (totalMinutes >= overrideCloseMinutes) {
          return {
            isOpen: false,
            status: 'early_close',
            reason: override.reason
          };
        }
      }
    }

    // Standard weekend check
    // Market is closed Saturday (all day)
    if (dayOfWeek === 6) {
      return {
        isOpen: false,
        status: 'closed',
        reason: 'Weekend - Market closed'
      };
    }

    // Market is closed Friday after 5:00 PM EST
    const fridayCloseMinutes = FOREX_MARKET_CONSTANTS.WEEKLY_CLOSE_HOUR_EST * 60;
    if (dayOfWeek === 5 && totalMinutes >= fridayCloseMinutes) {
      return {
        isOpen: false,
        status: 'closed',
        reason: 'Weekend - Market closed Friday 5:00 PM EST'
      };
    }

    // Market is closed Sunday before 5:00 PM EST
    const sundayOpenMinutes = FOREX_MARKET_CONSTANTS.WEEKLY_OPEN_HOUR_EST * 60;
    if (dayOfWeek === 0 && totalMinutes < sundayOpenMinutes) {
      return {
        isOpen: false,
        status: 'closed',
        reason: 'Weekend - Market opens Sunday 5:00 PM EST'
      };
    }

    // Market is open
    return {
      isOpen: true,
      status: 'open',
      reason: 'Market is open'
    };
  }

  /**
   * Check if market is currently open (simple boolean)
   */
  public async isMarketOpen(date?: Date): Promise<boolean> {
    const status = await this.getMarketStatus(date);
    return status.isOpen;
  }

  /**
   * Get time until next market change (open/close)
   */
  public async getTimeUntilMarketChange(): Promise<{
    hours: number;
    minutes: number;
    isOpening: boolean;
    changeTime: Date;
    reason: string;
  }> {
    const now = new Date();
    const estTime = this.getESTTime(now);
    const status = await this.getMarketStatus(estTime);

    if (status.isOpen) {
      // Market is open - find next close time
      const nextCloseTime = await this.getNextCloseTime(estTime);
      const msUntilClose = nextCloseTime.getTime() - estTime.getTime();
      const hours = Math.floor(msUntilClose / (1000 * 60 * 60));
      const minutes = Math.floor((msUntilClose % (1000 * 60 * 60)) / (1000 * 60));

      return {
        hours,
        minutes,
        isOpening: false,
        changeTime: nextCloseTime,
        reason: 'Market closes'
      };
    } else {
      // Market is closed - find next open time
      const nextOpenTime = await this.getNextOpenTime(estTime);
      const msUntilOpen = nextOpenTime.getTime() - estTime.getTime();
      const hours = Math.floor(msUntilOpen / (1000 * 60 * 60));
      const minutes = Math.floor((msUntilOpen % (1000 * 60 * 60)) / (1000 * 60));

      return {
        hours,
        minutes,
        isOpening: true,
        changeTime: nextOpenTime,
        reason: 'Market opens'
      };
    }
  }

  /**
   * Get next market close time
   */
  private async getNextCloseTime(fromTime: Date): Promise<Date> {
    const estTime = this.getESTTime(fromTime);
    let checkDate = new Date(estTime);

    // Check next 14 days for early closures or Friday close
    for (let i = 0; i < 14; i++) {
      const dateKey = this.formatDateEST(checkDate);
      const dayOfWeek = checkDate.getDay();

      // Check for early closure
      const holiday = this.holidayCache.get(dateKey);
      if (holiday?.type === 'early_close' && holiday.earlyCloseTimeEST) {
        const [hour, minute] = holiday.earlyCloseTimeEST.split(':').map(Number);
        const closeTime = new Date(checkDate);
        closeTime.setHours(hour, minute, 0, 0);
        if (closeTime > estTime) {
          return closeTime;
        }
      }

      const override = this.overrideCache.get(dateKey);
      if (override?.type === 'early_close' && override.closeTimeEST) {
        const [hour, minute] = override.closeTimeEST.split(':').map(Number);
        const closeTime = new Date(checkDate);
        closeTime.setHours(hour, minute, 0, 0);
        if (closeTime > estTime) {
          return closeTime;
        }
      }

      // Check for regular Friday close
      if (dayOfWeek === 5) {
        const closeTime = new Date(checkDate);
        closeTime.setHours(FOREX_MARKET_CONSTANTS.WEEKLY_CLOSE_HOUR_EST, 0, 0, 0);
        if (closeTime > estTime) {
          return closeTime;
        }
      }

      checkDate.setDate(checkDate.getDate() + 1);
    }

    // Fallback: next Friday 5 PM
    const daysUntilFriday = (5 - estTime.getDay() + 7) % 7 || 7;
    const fallbackClose = new Date(estTime);
    fallbackClose.setDate(fallbackClose.getDate() + daysUntilFriday);
    fallbackClose.setHours(FOREX_MARKET_CONSTANTS.WEEKLY_CLOSE_HOUR_EST, 0, 0, 0);
    return fallbackClose;
  }

  /**
   * Get next market open time
   */
  private async getNextOpenTime(fromTime: Date): Promise<Date> {
    const estTime = this.getESTTime(fromTime);
    let checkDate = new Date(estTime);

    // Check next 14 days for market open (skip holidays)
    for (let i = 0; i < 14; i++) {
      checkDate.setDate(checkDate.getDate() + 1);
      const dateKey = this.formatDateEST(checkDate);
      const dayOfWeek = checkDate.getDay();

      // Skip holidays
      const holiday = this.holidayCache.get(dateKey);
      if (holiday?.type === 'full_day') {
        continue;
      }

      // Skip closed overrides
      const override = this.overrideCache.get(dateKey);
      if (override?.type === 'closed') {
        continue;
      }

      // Sunday 5 PM open
      if (dayOfWeek === 0) {
        const openTime = new Date(checkDate);
        openTime.setHours(FOREX_MARKET_CONSTANTS.WEEKLY_OPEN_HOUR_EST, 0, 0, 0);
        return openTime;
      }

      // Monday-Friday opens at start of day (if not a holiday)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const openTime = new Date(checkDate);
        openTime.setHours(0, 0, 0, 0);
        return openTime;
      }
    }

    // Fallback: next Sunday 5 PM
    const daysUntilSunday = (7 - estTime.getDay()) % 7 || 7;
    const fallbackOpen = new Date(estTime);
    fallbackOpen.setDate(fallbackOpen.getDate() + daysUntilSunday);
    fallbackOpen.setHours(FOREX_MARKET_CONSTANTS.WEEKLY_OPEN_HOUR_EST, 0, 0, 0);
    return fallbackOpen;
  }

  /**
   * Get upcoming holidays (next 30 days)
   */
  public async getUpcomingHolidays(days: number = 30): Promise<MarketHoliday[]> {
    await this.ensureCacheFresh();

    const now = new Date();
    const future = new Date(now);
    future.setDate(future.getDate() + days);

    const upcoming: MarketHoliday[] = [];
    for (const [dateStr, holiday] of this.holidayCache.entries()) {
      const holidayDate = new Date(dateStr);
      if (holidayDate >= now && holidayDate <= future) {
        upcoming.push(holiday);
      }
    }

    return upcoming.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Force refresh cache (useful after adding new holidays)
   */
  public async refreshCache(): Promise<void> {
    await this.loadFromDatabase();
  }
}

export const marketScheduleService = new MarketScheduleService();
