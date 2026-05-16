/**
 * USER RISK PREFERENCE SERVICE (SSOT)
 *
 * ARCHITECTURE: Single Source of Truth for user-specified maximum risk per trade.
 * This service is the AUTHORITATIVE owner of user risk preferences.
 *
 * GOVERNANCE PRINCIPLES:
 * 1. Users express their risk tolerance ceiling (default 5%)
 * 2. Alpha retains full authority to calculate optimal sizing
 * 3. Alpha degrades position size DOWN if needed to respect user ceiling
 * 4. All negotiations logged for transparency and governance
 *
 * CCIP COMPLIANCE:
 * - Immutable read: fetches from single source (user_max_risk_preferences table)
 * - Mutations tracked: all updates recorded with timestamps
 * - Cached: short TTL to prevent stale data
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export interface UserRiskPreference {
  userId: string;
  maxRiskPercent: number;
  createdAt: string;
  updatedAt: string;
}

interface RiskPreferenceUpdateResult {
  success: boolean;
  userId: string;
  oldMaxRiskPercent?: number;
  newMaxRiskPercent: number;
  updatedAt?: string;
  error?: string;
}

class UserRiskPreferenceService {
  private cache = new Map<string, { data: UserRiskPreference; timestamp: number }>();
  private cacheTTL = 30000; // 30 seconds - short TTL for critical safety data

  /**
   * GET user's maximum risk preference
   * SSOT: Fetches from user_max_risk_preferences table
   * Returns platform default (5%) if user hasn't set preference
   */
  async getUserMaxRiskPercent(userId: string): Promise<number> {
    if (!userId) {
      logger.warn('[UserRiskPreferenceService] Missing userId, returning default 5%');
      return 5.0;
    }

    // Check cache
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.debug('[UserRiskPreferenceService] Cache hit for', userId);
      return cached.data.maxRiskPercent;
    }

    try {
      const { data, error } = await supabase.rpc('get_user_max_risk_preference', {
        p_user_id: userId
      });

      if (error) {
        logger.error('[UserRiskPreferenceService] Error fetching preference:', error);
        return 5.0; // Fallback to platform default
      }

      if (data === null || data === undefined) {
        logger.debug('[UserRiskPreferenceService] No preference set, returning default 5%');
        return 5.0;
      }

      // Cache the result
      const preference: UserRiskPreference = {
        userId,
        maxRiskPercent: parseFloat(data),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      this.cache.set(userId, {
        data: preference,
        timestamp: Date.now()
      });

      logger.info('[UserRiskPreferenceService] Fetched max risk preference:', {
        userId,
        maxRiskPercent: data
      });

      return parseFloat(data);
    } catch (error) {
      logger.error('[UserRiskPreferenceService] Exception fetching preference:', error);
      return 5.0; // Fallback to safe default
    }
  }

  /**
   * UPDATE user's maximum risk preference
   * GOVERNANCE: Validates bounds and logs changes
   * Only service role or user themselves can update
   */
  async updateUserMaxRiskPercent(
    userId: string,
    maxRiskPercent: number
  ): Promise<RiskPreferenceUpdateResult> {
    // Validate input
    if (!userId) {
      return { success: false, userId, newMaxRiskPercent: maxRiskPercent, error: 'Missing userId' };
    }

    if (maxRiskPercent < 1 || maxRiskPercent > 100) {
      return {
        success: false,
        userId,
        newMaxRiskPercent: maxRiskPercent,
        error: 'Risk percent must be between 1% and 100%'
      };
    }

    // Get current value for comparison
    const oldValue = await this.getUserMaxRiskPercent(userId);

    try {
      const { data, error } = await supabase.rpc('update_user_max_risk_preference', {
        p_user_id: userId,
        p_percent: maxRiskPercent
      });

      if (error) {
        logger.error('[UserRiskPreferenceService] Error updating preference:', error);
        return {
          success: false,
          userId,
          oldMaxRiskPercent: oldValue,
          newMaxRiskPercent: maxRiskPercent,
          error: error.message
        };
      }

      // Invalidate cache
      this.cache.delete(userId);

      logger.info('[UserRiskPreferenceService] Updated max risk preference:', {
        userId,
        oldMaxRiskPercent: oldValue,
        newMaxRiskPercent: maxRiskPercent
      });

      return {
        success: true,
        userId,
        oldMaxRiskPercent: oldValue,
        newMaxRiskPercent: maxRiskPercent,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('[UserRiskPreferenceService] Exception updating preference:', error);
      return {
        success: false,
        userId,
        oldMaxRiskPercent: oldValue,
        newMaxRiskPercent: maxRiskPercent,
        error: 'Failed to update preference'
      };
    }
  }

  /**
   * RESET user's preference to platform default (5%)
   * Used when user wants to clear custom preference
   */
  async resetToDefault(userId: string): Promise<RiskPreferenceUpdateResult> {
    return this.updateUserMaxRiskPercent(userId, 5.0);
  }

  /**
   * BULK INITIALIZE new user with default preference
   * Called during user signup/login
   *
   * SSOT COMPLIANCE: Uses initialize_user_risk_preference_if_not_exists RPC
   * IDEMPOTENT: Safe to call multiple times, never overwrites existing preferences
   * RESPECTS USER CHOICES: Only creates default for new users
   *
   * Architecture:
   * - If preference exists: Do nothing (preserve user's custom setting)
   * - If preference missing: Create with 5% default
   * - Never overwrites existing preferences
   */
  async initializeNewUser(userId: string): Promise<boolean> {
    try {
      // Use idempotent initialization RPC
      const { data, error } = await supabase.rpc('initialize_user_risk_preference_if_not_exists', {
        p_user_id: userId
      });

      if (error) {
        logger.error('[UserRiskPreferenceService] Error initializing user preference:', error);
        // Don't fail signup/login if this fails - service will use default
        return false;
      }

      if (data && data.success === false) {
        logger.error('[UserRiskPreferenceService] RPC returned failure:', data);
        return false;
      }

      if (data && data.action === 'created') {
        logger.info('[UserRiskPreferenceService] ✅ Created new preference with default 5%:', userId);
      } else if (data && data.action === 'skipped') {
        logger.debug('[UserRiskPreferenceService] ✓ Preference already exists, preserved:', {
          userId,
          existingPercent: data.max_risk_percent
        });
      }

      return true;
    } catch (error) {
      logger.error('[UserRiskPreferenceService] Exception initializing user:', error);
      return false;
    }
  }

  /**
   * CLEAR cache (used after trades or when preferences change)
   */
  clearCache(userId?: string): void {
    if (userId) {
      this.cache.delete(userId);
      logger.debug('[UserRiskPreferenceService] Cleared cache for user:', userId);
    } else {
      this.cache.clear();
      logger.debug('[UserRiskPreferenceService] Cleared entire cache');
    }
  }

  /**
   * GET cache status (for debugging)
   */
  getCacheStatus(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

export const userRiskPreferenceService = new UserRiskPreferenceService();
