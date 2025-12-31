import { logger, LogCategory } from '../lib/logger';
import { FreshnessBlockCategory, type BlockMetadata } from '../types/freshness-block';

export interface FreshnessValidationResult {
  isValid: boolean;
  reason?: string;
  ageSeconds?: number;
  maxAgeSeconds?: number;
  staleBrains?: string[];
  blockCategory?: FreshnessBlockCategory;
  blockMetadata?: BlockMetadata;
}

export interface IntelligenceData {
  brainName: string;
  cacheAgeSeconds: number;
  timeframe: string;
}

const MAX_AGE_BY_TIMEFRAME: Record<string, number> = {
  'M1': 120,
  '1m': 120,
  'M5': 300,
  '5m': 300,
  'M15': 600,
  '15m': 600,
  'M30': 900,
  '30m': 900,
  'H1': 1200,
  '1h': 1200,
  'H4': 2400,
  '4h': 2400,
  'D1': 7200,
  '1d': 7200
};

export class IntelligenceFreshnessValidator {
  validateOmegaIntelligence(
    omegaVotes: IntelligenceData[],
    timeframe: string
  ): FreshnessValidationResult {
    if (!omegaVotes || omegaVotes.length === 0) {
      return {
        isValid: false,
        reason: 'No Omega intelligence provided for validation'
      };
    }

    const maxAge = this.getMaxAgeForTimeframe(timeframe);
    const staleBrains: string[] = [];
    let oldestAge = 0;

    for (const vote of omegaVotes) {
      if (vote.cacheAgeSeconds > maxAge) {
        staleBrains.push(vote.brainName);
        oldestAge = Math.max(oldestAge, vote.cacheAgeSeconds);
      }
    }

    if (staleBrains.length > 0) {
      const minutesOld = Math.floor(oldestAge / 60);
      const secondsOld = oldestAge % 60;

      const blockMetadata: BlockMetadata = {
        staleBrains,
        ageSeconds: oldestAge,
        maxAgeSeconds: maxAge,
        timeframe
      };

      logger.error(
        LogCategory.AI_TRADING,
        `[Freshness Gate] 🚫 ${FreshnessBlockCategory.BLOCK_STALE_OMEGA_INTELLIGENCE}: ${staleBrains.length} stale brain(s): ${staleBrains.join(', ')}. Oldest: ${minutesOld}m ${secondsOld}s (max: ${Math.floor(maxAge / 60)}m)`,
        blockMetadata
      );

      return {
        isValid: false,
        reason: `Stale intelligence detected: ${staleBrains.join(', ')} are ${minutesOld}m ${secondsOld}s old (max allowed: ${Math.floor(maxAge / 60)}m)`,
        ageSeconds: oldestAge,
        maxAgeSeconds: maxAge,
        staleBrains,
        blockCategory: FreshnessBlockCategory.BLOCK_STALE_OMEGA_INTELLIGENCE,
        blockMetadata
      };
    }

    const avgAge = omegaVotes.reduce((sum, v) => sum + v.cacheAgeSeconds, 0) / omegaVotes.length;
    logger.info(
      LogCategory.AI_TRADING,
      `[Freshness Gate] ✅ PASS: All ${omegaVotes.length} Omega brains fresh (avg age: ${Math.floor(avgAge)}s, max: ${maxAge}s)`
    );

    return {
      isValid: true,
      ageSeconds: avgAge,
      maxAgeSeconds: maxAge
    };
  }

  validateAlphaIntelligence(
    cacheAgeSeconds: number,
    timeframe: string
  ): FreshnessValidationResult {
    const maxAge = this.getMaxAgeForTimeframe(timeframe) * 0.6;

    if (cacheAgeSeconds > maxAge) {
      const minutesOld = Math.floor(cacheAgeSeconds / 60);
      const secondsOld = cacheAgeSeconds % 60;

      const blockMetadata: BlockMetadata = {
        ageSeconds: cacheAgeSeconds,
        maxAgeSeconds: maxAge,
        timeframe
      };

      logger.error(
        LogCategory.AI_TRADING,
        `[Freshness Gate] 🚫 ${FreshnessBlockCategory.BLOCK_STALE_ALPHA_INTELLIGENCE}: ${minutesOld}m ${secondsOld}s old (max: ${Math.floor(maxAge / 60)}m)`,
        blockMetadata
      );

      return {
        isValid: false,
        reason: `Alpha intelligence is ${minutesOld}m ${secondsOld}s old (max allowed: ${Math.floor(maxAge / 60)}m)`,
        ageSeconds: cacheAgeSeconds,
        maxAgeSeconds: maxAge,
        blockCategory: FreshnessBlockCategory.BLOCK_STALE_ALPHA_INTELLIGENCE,
        blockMetadata
      };
    }

    logger.info(
      LogCategory.AI_TRADING,
      `[Freshness Gate] ✅ PASS: Alpha intelligence fresh (age: ${Math.floor(cacheAgeSeconds)}s, max: ${Math.floor(maxAge)}s)`
    );

    return {
      isValid: true,
      ageSeconds: cacheAgeSeconds,
      maxAgeSeconds: maxAge
    };
  }

  validateScoutState(
    cacheAgeSeconds: number
  ): FreshnessValidationResult {
    const maxAge = 60;

    if (cacheAgeSeconds > maxAge) {
      logger.error(
        LogCategory.AI_TRADING,
        `[Freshness Gate] 🚫 BLOCKED: Scout state is ${cacheAgeSeconds}s old (max: ${maxAge}s)`
      );

      return {
        isValid: false,
        reason: `Scout state is ${cacheAgeSeconds}s old (max allowed: ${maxAge}s)`,
        ageSeconds: cacheAgeSeconds,
        maxAgeSeconds: maxAge
      };
    }

    logger.info(
      LogCategory.AI_TRADING,
      `[Freshness Gate] ✅ PASS: Scout state fresh (age: ${cacheAgeSeconds}s, max: ${maxAge}s)`
    );

    return {
      isValid: true,
      ageSeconds: cacheAgeSeconds,
      maxAgeSeconds: maxAge
    };
  }

  private getMaxAgeForTimeframe(timeframe: string): number {
    const normalized = timeframe.toUpperCase();
    return MAX_AGE_BY_TIMEFRAME[normalized] || MAX_AGE_BY_TIMEFRAME[timeframe] || 600;
  }

  shouldForceRefresh(
    currentAge: number,
    timeframe: string,
    priceMovementPercent: number
  ): boolean {
    const maxAge = this.getMaxAgeForTimeframe(timeframe);
    const ageRatio = currentAge / maxAge;

    if (ageRatio > 0.8) {
      logger.warn(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ⚠️ Age ratio ${(ageRatio * 100).toFixed(1)}% - approaching staleness`
      );
      return true;
    }

    if (priceMovementPercent > 0.3) {
      logger.warn(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ⚠️ Price moved ${priceMovementPercent.toFixed(2)}% since analysis - recommend refresh`
      );
      return true;
    }

    return false;
  }
}

export const intelligenceFreshnessValidator = new IntelligenceFreshnessValidator();
