import { marketDataService } from './market-data-service';
import { entryThesisMemoryService } from './entry-thesis-memory-service';
import { logger } from '../lib/logger';
import type { EntryPreFlightResult, EntryOutcomeReason } from '../types/entry';

/**
 * Entry Pre-Flight Validator
 *
 * Validates entry intent creation BEFORE creating the intent.
 * Prevents creating invalid intents that will be immediately abandoned.
 *
 * Phase 1 Fix: Stops the infinite loop by:
 * 1. Checking distance from entry zone at creation time
 * 2. Checking thesis memory for expired theses
 * 3. Rejecting intents that are already outside viable execution range
 */
export class EntryPreFlightValidator {
  private static readonly MAX_DISTANCE_ATR_MULTIPLIER = 3.0;

  /**
   * Validate entry intent before creation
   *
   * @param userId User ID
   * @param sessionId Session ID
   * @param symbol Trading symbol
   * @param direction Trade direction
   * @param entryZoneMin Minimum entry price
   * @param entryZoneMax Maximum entry price
   * @param timeframe Timeframe (default M15)
   * @returns Validation result with rejection reason if not viable
   */
  static async validateBeforeCreation(
    userId: string,
    sessionId: string,
    symbol: string,
    direction: 'BUY' | 'SELL',
    entryZoneMin: number,
    entryZoneMax: number,
    timeframe: string = 'M15'
  ): Promise<EntryPreFlightResult> {
    try {
      const entryZoneCenter = (entryZoneMin + entryZoneMax) / 2;

      // Check 1: Thesis Memory - Is this thesis already expired?
      logger.debug('[PreFlight] Checking thesis memory', {
        symbol,
        direction,
        entryZoneCenter,
      });

      const thesisCheck = await entryThesisMemoryService.shouldCreateIntent(
        userId,
        sessionId,
        symbol,
        direction,
        entryZoneCenter,
        timeframe
      );

      if (!thesisCheck.allowed) {
        logger.warn('[PreFlight] Thesis already expired', {
          symbol,
          direction,
          fingerprint: thesisCheck.fingerprint,
          reason: thesisCheck.reason,
        });

        return {
          is_viable: false,
          rejection_reason: 'TIMEOUT',
          message: thesisCheck.reason || 'Thesis already expired - execution window closed',
        };
      }

      // Check 2: Distance Validation - Is price too far from entry zone?
      logger.debug('[PreFlight] Checking distance from entry zone', {
        symbol,
        entryZoneMin,
        entryZoneMax,
      });

      const currentPriceData = await marketDataService.getCurrentPrice(symbol);
      if (!currentPriceData || currentPriceData.freshness === 'invalid') {
        logger.warn('[PreFlight] Cannot validate - invalid price data', { symbol });
        return {
          is_viable: true,
          message: 'Price data unavailable - proceeding with caution',
        };
      }

      const currentPrice = currentPriceData.price;
      const marketConditions = await marketDataService.getMarketConditions(symbol);

      if (!marketConditions || !marketConditions.atr) {
        logger.warn('[PreFlight] Cannot validate - no ATR data', { symbol });
        return {
          is_viable: true,
          message: 'Market conditions unavailable - proceeding with caution',
        };
      }

      // Calculate distance from entry zone
      const inEntryZone = currentPrice >= entryZoneMin && currentPrice <= entryZoneMax;
      const distanceToZone = inEntryZone
        ? 0
        : currentPrice < entryZoneMin
        ? entryZoneMin - currentPrice
        : currentPrice - entryZoneMax;

      const distanceInATR = distanceToZone / marketConditions.atr;

      logger.info('[PreFlight] Distance check', {
        symbol,
        currentPrice: currentPrice.toFixed(5),
        entryZone: `${entryZoneMin.toFixed(5)} - ${entryZoneMax.toFixed(5)}`,
        inZone: inEntryZone,
        distanceToZone: distanceToZone.toFixed(5),
        distanceInATR: distanceInATR.toFixed(2),
        atr: marketConditions.atr.toFixed(5),
        threshold: EntryPreFlightValidator.MAX_DISTANCE_ATR_MULTIPLIER,
      });

      // If price is already > 3x ATR away, reject immediately
      if (distanceInATR > EntryPreFlightValidator.MAX_DISTANCE_ATR_MULTIPLIER) {
        const rejectionReason: EntryOutcomeReason = 'RUNAWAY_DETECTED';

        logger.warn('[PreFlight] REJECTED - Price too far from entry zone', {
          symbol,
          direction,
          currentPrice,
          entryZone: `${entryZoneMin} - ${entryZoneMax}`,
          distanceInATR: distanceInATR.toFixed(2),
          threshold: EntryPreFlightValidator.MAX_DISTANCE_ATR_MULTIPLIER,
        });

        // Store in thesis memory as expired
        const thesis = entryThesisMemoryService.generateFingerprint(
          symbol,
          direction,
          entryZoneCenter,
          timeframe
        );

        await entryThesisMemoryService.storeThesis(userId, sessionId, thesis, 'EXPIRED', {
          abandonmentReason: rejectionReason,
          expirationMinutes: 10,
        });

        return {
          is_viable: false,
          distance_from_zone_atr: distanceInATR,
          rejection_reason: rejectionReason,
          current_price: currentPrice,
          entry_zone_center: entryZoneCenter,
          message: `Price already ${distanceInATR.toFixed(
            2
          )}x ATR away from entry zone (threshold: ${
            EntryPreFlightValidator.MAX_DISTANCE_ATR_MULTIPLIER
          }x). Execution window closed.`,
        };
      }

      // All checks passed
      logger.info('[PreFlight] PASSED - Intent is viable', {
        symbol,
        direction,
        distanceInATR: distanceInATR.toFixed(2),
      });

      return {
        is_viable: true,
        distance_from_zone_atr: distanceInATR,
        current_price: currentPrice,
        entry_zone_center: entryZoneCenter,
        message: 'Intent is viable for creation',
      };
    } catch (error) {
      logger.error('[PreFlight] Validation error', { error, symbol });

      // On error, allow creation but log warning
      return {
        is_viable: true,
        message: 'Pre-flight validation failed - proceeding with caution',
      };
    }
  }

  /**
   * Get distance threshold in ATR
   */
  static getDistanceThreshold(): number {
    return EntryPreFlightValidator.MAX_DISTANCE_ATR_MULTIPLIER;
  }
}
