import { marketDataService } from './market-data-service';
import { entryThesisMemoryService } from './entry-thesis-memory-service';
import { logger } from '../lib/logger';
import type { EntryPreFlightResult, EntryOutcomeReason, PreFlightAdvisoryLevel } from '../types/entry';

/**
 * Entry Pre-Flight Validator - ADVISORY SYSTEM (Not a Gate)
 *
 * Provides advisories on entry intent creation quality.
 * Does NOT hard block execution - Alpha retains authority.
 *
 * Advisory Levels:
 * - GREEN (0-1.5x ATR): Optimal pullback entry conditions
 * - AMBER (1.5-3x ATR): Suboptimal but acceptable (continuation candidate)
 * - RED (3x+ ATR): Strong advisory - Alpha should reconsider or escalate to continuation
 *
 * Only REJECTS for data integrity issues:
 * - Stale price data
 * - Missing market conditions
 * - Thesis already expired (duplicate prevention)
 */
export class EntryPreFlightValidator {
  // Advisory thresholds (NOT hard gates)
  private static readonly GREEN_ZONE_ATR = 1.5;   // Optimal entry range
  private static readonly AMBER_ZONE_ATR = 3.0;   // Suboptimal but acceptable
  // RED zone = anything beyond AMBER_ZONE_ATR

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
        logger.warn('[PreFlight] Thesis already expired - preventing duplicate', {
          symbol,
          direction,
          fingerprint: thesisCheck.fingerprint,
          reason: thesisCheck.reason,
        });

        return {
          is_viable: false,
          advisory_level: 'RED',
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
          advisory_level: 'AMBER',
          message: 'Price data unavailable - proceeding with caution (AMBER advisory)',
        };
      }

      const currentPrice = currentPriceData.price;
      const marketConditions = await marketDataService.getMarketConditions(symbol);

      if (!marketConditions || !marketConditions.atr) {
        logger.warn('[PreFlight] Cannot validate - no ATR data', { symbol });
        return {
          is_viable: true,
          advisory_level: 'AMBER',
          message: 'Market conditions unavailable - proceeding with caution (AMBER advisory)',
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

      // Determine advisory level based on distance (NOT a gate)
      let advisoryLevel: PreFlightAdvisoryLevel;
      let advisoryMessage: string;
      let shouldConsultAlpha = false;

      if (distanceInATR <= EntryPreFlightValidator.GREEN_ZONE_ATR) {
        advisoryLevel = 'GREEN';
        advisoryMessage = inEntryZone
          ? '✅ Optimal entry conditions - price in pullback zone'
          : `✅ Good entry conditions - price ${distanceInATR.toFixed(2)}x ATR from zone`;
      } else if (distanceInATR <= EntryPreFlightValidator.AMBER_ZONE_ATR) {
        advisoryLevel = 'AMBER';
        advisoryMessage = `⚠️ Suboptimal entry - price ${distanceInATR.toFixed(
          2
        )}x ATR from zone. Consider continuation entry if direction confirmed.`;
      } else {
        advisoryLevel = 'RED';
        shouldConsultAlpha = true;
        advisoryMessage = `🔴 Strong advisory - price ${distanceInATR.toFixed(
          2
        )}x ATR from zone. Alpha should reconsider or escalate to continuation entry.`;
      }

      logger.info(`[PreFlight] ${advisoryLevel} Advisory`, {
        symbol,
        direction,
        currentPrice: currentPrice.toFixed(5),
        entryZone: `${entryZoneMin.toFixed(5)} - ${entryZoneMax.toFixed(5)}`,
        inZone: inEntryZone,
        distanceToZone: distanceToZone.toFixed(5),
        distanceInATR: distanceInATR.toFixed(2),
        atr: marketConditions.atr.toFixed(5),
        advisoryLevel,
        shouldConsultAlpha,
      });

      // Return advisory (NOT rejection)
      return {
        is_viable: true,
        advisory_level: advisoryLevel,
        distance_from_zone_atr: distanceInATR,
        current_price: currentPrice,
        entry_zone_center: entryZoneCenter,
        should_consult_alpha: shouldConsultAlpha,
        message: advisoryMessage,
      };
    } catch (error) {
      logger.error('[PreFlight] Validation error', { error, symbol });

      // On error, allow creation but log warning
      return {
        is_viable: true,
        advisory_level: 'AMBER',
        message: 'Pre-flight validation failed - proceeding with caution (AMBER advisory)',
      };
    }
  }

  /**
   * Get advisory zone thresholds
   */
  static getGreenZoneThreshold(): number {
    return EntryPreFlightValidator.GREEN_ZONE_ATR;
  }

  static getAmberZoneThreshold(): number {
    return EntryPreFlightValidator.AMBER_ZONE_ATR;
  }
}
