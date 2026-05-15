import { logger, LogCategory } from '../lib/logger';
import { FreshnessBlockCategory, type BlockMetadata } from '../types/freshness-block';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';

export interface PriceDriftResult {
  isValid: boolean;
  driftPips?: number;
  driftPercent?: number;
  maxDriftPips?: number;
  maxDriftPercent?: number;
  reason?: string;
  shouldBlock: boolean;
  blockCategory?: FreshnessBlockCategory;
  blockMetadata?: BlockMetadata;
}

const DRIFT_THRESHOLDS_BY_ASSET: Record<string, { pips?: number; percent?: number }> = {
  EURUSD: { pips: 10 },
  GBPUSD: { pips: 10 },
  USDJPY: { pips: 10 },
  USDCHF: { pips: 10 },
  AUDUSD: { pips: 10 },
  USDCAD: { pips: 10 },
  NZDUSD: { pips: 10 },
  XAUUSD: { pips: 30 },
  BTCUSD: { percent: 0.5 },
  ETHUSD: { percent: 0.5 },
  US30: { percent: 0.3 },
  NAS100: { percent: 0.3 },
};

export class PriceDriftDetector {
  validateDrift(
    symbol: string,
    signalPrice: number,
    currentPrice: number
  ): PriceDriftResult {
    if (!signalPrice || !currentPrice) {
      return {
        isValid: true,
        shouldBlock: false
      };
    }

    const threshold = DRIFT_THRESHOLDS_BY_ASSET[symbol] || { pips: 10 };
    const priceDiff = Math.abs(currentPrice - signalPrice);

    if (threshold.pips !== undefined) {
      const pipValue = this.getPipValue(symbol);
      const driftPips = priceDiff / pipValue;

      if (driftPips > threshold.pips) {
        const blockMetadata: BlockMetadata = {
          symbol,
          driftPips,
          maxDrift: threshold.pips,
          signalPrice,
          currentPrice
        };

        logger.error(
          LogCategory.AI_TRADING,
          `[Price Drift Gate] 🚫 ${FreshnessBlockCategory.BLOCK_PRICE_DRIFT}: ${symbol} drifted ${driftPips.toFixed(1)} pips (max: ${threshold.pips} pips). Signal: ${signalPrice}, Current: ${currentPrice}`,
          blockMetadata
        );

        return {
          isValid: false,
          driftPips,
          maxDriftPips: threshold.pips,
          reason: `Price drifted ${driftPips.toFixed(1)} pips from signal price (max: ${threshold.pips} pips)`,
          shouldBlock: true,
          blockCategory: FreshnessBlockCategory.BLOCK_PRICE_DRIFT,
          blockMetadata
        };
      }

      logger.info(
        LogCategory.AI_TRADING,
        `[Price Drift Gate] ✅ PASS: ${symbol} drift ${driftPips.toFixed(1)} pips < ${threshold.pips} pips`
      );

      return {
        isValid: true,
        driftPips,
        maxDriftPips: threshold.pips,
        shouldBlock: false
      };
    }

    if (threshold.percent !== undefined) {
      const driftPercent = (priceDiff / signalPrice) * 100;

      if (driftPercent > threshold.percent) {
        const blockMetadata: BlockMetadata = {
          symbol,
          driftPercent,
          maxDrift: threshold.percent,
          signalPrice,
          currentPrice
        };

        logger.error(
          LogCategory.AI_TRADING,
          `[Price Drift Gate] 🚫 ${FreshnessBlockCategory.BLOCK_PRICE_DRIFT}: ${symbol} drifted ${driftPercent.toFixed(2)}% (max: ${threshold.percent}%). Signal: ${signalPrice}, Current: ${currentPrice}`,
          blockMetadata
        );

        return {
          isValid: false,
          driftPercent,
          maxDriftPercent: threshold.percent,
          reason: `Price drifted ${driftPercent.toFixed(2)}% from signal price (max: ${threshold.percent}%)`,
          shouldBlock: true,
          blockCategory: FreshnessBlockCategory.BLOCK_PRICE_DRIFT,
          blockMetadata
        };
      }

      logger.info(
        LogCategory.AI_TRADING,
        `[Price Drift Gate] ✅ PASS: ${symbol} drift ${driftPercent.toFixed(2)}% < ${threshold.percent}%`
      );

      return {
        isValid: true,
        driftPercent,
        maxDriftPercent: threshold.percent,
        shouldBlock: false
      };
    }

    return {
      isValid: true,
      shouldBlock: false
    };
  }

  calculateDriftFromSnapshot(
    symbol: string,
    snapshotPrice: number,
    currentPrice: number,
    atr: number
  ): { driftATR: number; shouldInvalidateCache: boolean } {
    const priceDiff = Math.abs(currentPrice - snapshotPrice);
    const driftATR = atr > 0 ? priceDiff / atr : 0;

    const shouldInvalidateCache = driftATR > 0.5;

    if (shouldInvalidateCache) {
      logger.warn(
        LogCategory.AI_TRADING,
        `[Price Drift Cache] ⚠️ ${symbol} drifted ${driftATR.toFixed(2)} ATR from snapshot - invalidating cache`
      );
    }

    return { driftATR, shouldInvalidateCache };
  }

  // ❌ REMOVED: getPipValue() - replaced with SSOT getCurrencyPipInfo()
  // All pip value queries must go through currencyHelpers.ts
  private getPipValue(symbol: string): number {
    return getCurrencyPipInfo(symbol).pipValue;
  }

  getDriftThreshold(symbol: string): { pips?: number; percent?: number } {
    return DRIFT_THRESHOLDS_BY_ASSET[symbol] || { pips: 10 };
  }
}

export const priceDriftDetector = new PriceDriftDetector();
