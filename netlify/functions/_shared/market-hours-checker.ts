/**
 * Market Hours Checker - Shared utility for Netlify Functions
 *
 * This module provides market hour checking that works in Netlify Functions.
 * It queries the database directly to check holidays and schedules.
 */

import { getSupabaseAdmin } from './supabase-admin';

const supabase = getSupabaseAdmin();

interface MarketHoliday {
  date: string;
  name: string;
  type: 'full_day' | 'early_close';
  early_close_time_est?: string;
}

interface MarketScheduleOverride {
  date: string;
  type: 'closed' | 'early_close';
  close_time_est?: string;
  reason: string;
}

/**
 * Get current time in EST
 */
function getESTTime(date?: Date): Date {
  const targetDate = date || new Date();
  const estString = targetDate.toLocaleString('en-US', {
    timeZone: 'America/New_York'
  });
  return new Date(estString);
}

/**
 * Format date as YYYY-MM-DD in EST
 */
function formatDateEST(date: Date): string {
  const estDate = getESTTime(date);
  const year = estDate.getFullYear();
  const month = String(estDate.getMonth() + 1).padStart(2, '0');
  const day = String(estDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if market is open (async version that checks database)
 */
export async function isForexMarketOpen(): Promise<boolean> {
  const now = new Date();
  const estTime = getESTTime(now);
  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Saturday - always closed
  if (dayOfWeek === 6) {
    return false;
  }

  // Friday after 5 PM - closed
  const fridayCloseMinutes = 17 * 60;
  if (dayOfWeek === 5 && totalMinutes >= fridayCloseMinutes) {
    return false;
  }

  // Sunday before 5 PM - closed
  const sundayOpenMinutes = 17 * 60;
  if (dayOfWeek === 0 && totalMinutes < sundayOpenMinutes) {
    return false;
  }

  // Check for holidays
  const dateKey = formatDateEST(estTime);

  try {
    // Check for full day holiday
    const { data: holiday } = await supabase
      .from('market_holidays')
      .select('*')
      .eq('date', dateKey)
      .maybeSingle();

    if (holiday) {
      if (holiday.type === 'full_day') {
        return false;
      } else if (holiday.type === 'early_close' && holiday.early_close_time_est) {
        // Check if past early close time
        const [earlyHour, earlyMinute] = holiday.early_close_time_est.split(':').map(Number);
        const earlyCloseMinutes = earlyHour * 60 + earlyMinute;
        if (totalMinutes >= earlyCloseMinutes) {
          return false;
        }
      }
    }

    // Check for schedule override
    const { data: override } = await supabase
      .from('market_schedule_overrides')
      .select('*')
      .eq('date', dateKey)
      .maybeSingle();

    if (override) {
      if (override.type === 'closed') {
        return false;
      } else if (override.type === 'early_close' && override.close_time_est) {
        const [overrideHour, overrideMinute] = override.close_time_est.split(':').map(Number);
        const overrideCloseMinutes = overrideHour * 60 + overrideMinute;
        if (totalMinutes >= overrideCloseMinutes) {
          return false;
        }
      }
    }
  } catch (error) {
    console.error('[MarketHours] Error checking holidays/overrides:', error);
    // Fall through to return true if database check fails
  }

  return true;
}

/**
 * Synchronous version (uses only day/time checks, no holiday checking)
 * Use this for quick checks when database access is not needed
 */
export function isForexMarketOpenSync(): boolean {
  const now = new Date();
  const estTime = getESTTime(now);
  const dayOfWeek = estTime.getDay();
  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const fridayCloseMinutes = 17 * 60;
  const sundayOpenMinutes = 17 * 60;

  if (dayOfWeek === 6) return false;
  if (dayOfWeek === 5 && totalMinutes >= fridayCloseMinutes) return false;
  if (dayOfWeek === 0 && totalMinutes < sundayOpenMinutes) return false;

  return true;
}
