/**
 * Broker Lot Config Service
 *
 * SSOT for reading and writing a user's per-symbol broker lot tier calibration.
 *
 * Responsibility boundary:
 *   - Owns all DB I/O for user_broker_lot_config
 *   - Exposes getCalibrationMultiplier() as the single runtime accessor
 *   - Silent fallback to 'standard' (1.0x) when no row exists — trading is never blocked
 *
 * CCIP / SSOT compliance:
 *   - No other service or component reads user_broker_lot_config directly
 *   - No other service duplicates getBrokerTierMultiplier() logic
 *   - All tier arithmetic is delegated to getBrokerTierMultiplier() in symbol-registry.ts
 *
 * GOVERNANCE:
 *   - Changing a tier invalidates the in-memory cache so the next trade
 *     sizing call picks up the new value without a page reload.
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';
import {
  LotTier,
  getBrokerTierMultiplier,
  isCalibratableSymbol,
} from '../config/symbol-registry';

interface TierRow {
  symbol: string;
  lot_tier: LotTier;
}

class BrokerLotConfigService {
  private cache: Map<string, LotTier> = new Map();
  private cacheLoadedFor: string | null = null;

  private cacheKey(userId: string, symbol: string): string {
    return `${userId}:${symbol.toUpperCase()}`;
  }

  private invalidateCache(): void {
    this.cache.clear();
    this.cacheLoadedFor = null;
  }

  /**
   * Pre-load all tier rows for a user into memory.
   * Called once per session startup — subsequent calls are no-ops if already loaded.
   */
  async preload(userId: string): Promise<void> {
    if (this.cacheLoadedFor === userId) return;

    try {
      const { data, error } = await supabase
        .from('user_broker_lot_config')
        .select('symbol, lot_tier')
        .eq('user_id', userId);

      if (error) {
        logger.warn(
          LogCategory.GOVERNANCE,
          '[BrokerLotConfig] Failed to preload calibration config — defaulting to standard',
          { userId, error }
        );
        this.cacheLoadedFor = userId;
        return;
      }

      this.cache.clear();
      (data as TierRow[]).forEach(row => {
        this.cache.set(this.cacheKey(userId, row.symbol), row.lot_tier);
      });
      this.cacheLoadedFor = userId;

      logger.info(
        LogCategory.GOVERNANCE,
        '[BrokerLotConfig] Calibration config preloaded',
        { userId, rowCount: data?.length ?? 0 }
      );
    } catch (err) {
      logger.warn(
        LogCategory.GOVERNANCE,
        '[BrokerLotConfig] Preload exception — defaulting to standard',
        { userId, err }
      );
      this.cacheLoadedFor = userId;
    }
  }

  /**
   * Returns the lot-size multiplier for a given user + symbol.
   * Falls back to 1.0 (standard) silently if no row exists.
   * Never throws — trading must not be blocked by missing calibration.
   */
  getCalibrationMultiplier(userId: string, symbol: string): number {
    const tier = this.cache.get(this.cacheKey(userId, symbol)) ?? 'standard';
    return getBrokerTierMultiplier(tier);
  }

  /**
   * Returns the stored LotTier for display purposes (e.g., Settings UI).
   * Returns 'standard' if not calibrated.
   */
  getTier(userId: string, symbol: string): LotTier {
    return this.cache.get(this.cacheKey(userId, symbol)) ?? 'standard';
  }

  /**
   * Upsert a tier selection for a user + symbol.
   * Updates the in-memory cache immediately so the next sizing call reflects the change.
   *
   * GOVERNANCE: Only valid for CALIBRATABLE_SYMBOLS — silently ignores unknown symbols.
   */
  async saveCalibration(userId: string, symbol: string, tier: LotTier): Promise<boolean> {
    const normalizedSymbol = symbol.toUpperCase();

    if (!isCalibratableSymbol(normalizedSymbol)) {
      logger.warn(
        LogCategory.GOVERNANCE,
        '[BrokerLotConfig] saveCalibration called for non-calibratable symbol — ignored',
        { userId, symbol: normalizedSymbol }
      );
      return false;
    }

    try {
      const { error } = await supabase
        .from('user_broker_lot_config')
        .upsert(
          {
            user_id: userId,
            symbol: normalizedSymbol,
            lot_tier: tier,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,symbol' }
        );

      if (error) {
        logger.error(
          LogCategory.GOVERNANCE,
          '[BrokerLotConfig] Failed to save calibration',
          { userId, symbol: normalizedSymbol, tier, error }
        );
        return false;
      }

      this.cache.set(this.cacheKey(userId, normalizedSymbol), tier);

      logger.info(
        LogCategory.GOVERNANCE,
        '[BrokerLotConfig] Calibration saved',
        { userId, symbol: normalizedSymbol, tier }
      );

      return true;
    } catch (err) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[BrokerLotConfig] saveCalibration exception',
        { userId, symbol: normalizedSymbol, tier, err }
      );
      return false;
    }
  }

  /**
   * Load all tiers for a user as a plain record (used by the Settings UI for initial render).
   * Does NOT use the internal cache — always fetches fresh from DB.
   */
  async loadAllTiers(userId: string): Promise<Record<string, LotTier>> {
    try {
      const { data, error } = await supabase
        .from('user_broker_lot_config')
        .select('symbol, lot_tier')
        .eq('user_id', userId);

      if (error || !data) return {};

      return Object.fromEntries(
        (data as TierRow[]).map(row => [row.symbol, row.lot_tier])
      );
    } catch {
      return {};
    }
  }
}

export const brokerLotConfigService = new BrokerLotConfigService();
