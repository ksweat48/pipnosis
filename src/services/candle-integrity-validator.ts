/**
 * Candle Data Integrity Validator
 *
 * CRITICAL: Ensures candle data is never artificially extended or modified
 * beyond actual market prices. Logs any suspicious modifications for audit.
 *
 * This service helps detect and prevent the artificial wick extension bug
 * that was corrupting Alpha's trading decisions.
 */

import { logger, LogCategory } from '@/lib/logger';

export interface CandleValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  originalCandle: any;
  modifiedCandle: any;
  modifications: {
    highExtended: boolean;
    lowExtended: boolean;
    rangeIncreased: boolean;
    percentageChange: number;
  };
}

/**
 * Validate that a candle hasn't been artificially extended
 * Compare original vs modified versions to detect data corruption
 */
export function validateCandleIntegrity(
  originalCandle: {
    open: number;
    high: number;
    low: number;
    close: number;
    symbol?: string;
    timeframe?: string;
    time?: number | string;
  },
  modifiedCandle: {
    open: number;
    high: number;
    low: number;
    close: number;
  }
): CandleValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let isValid = true;

  const modifications = {
    highExtended: modifiedCandle.high > originalCandle.high,
    lowExtended: modifiedCandle.low < originalCandle.low,
    rangeIncreased: false,
    percentageChange: 0
  };

  const originalRange = originalCandle.high - originalCandle.low;
  const modifiedRange = modifiedCandle.high - modifiedCandle.low;
  const rangeIncrease = modifiedRange - originalRange;
  const avgPrice = (originalCandle.open + originalCandle.close) / 2;

  if (rangeIncrease > 0) {
    modifications.rangeIncreased = true;
    modifications.percentageChange = (rangeIncrease / avgPrice) * 100;
  }

  // Check if high was artificially extended
  if (modifications.highExtended) {
    const extensionAmount = modifiedCandle.high - originalCandle.high;
    const extensionPercent = (extensionAmount / avgPrice) * 100;

    warnings.push(
      `High artificially extended by ${extensionAmount.toFixed(5)} ` +
      `(${extensionPercent.toFixed(3)}%) - ${originalCandle.high} → ${modifiedCandle.high}`
    );

    // If extension is > 0.1%, this is a serious integrity violation
    if (extensionPercent > 0.1) {
      isValid = false;
      errors.push(
        `CRITICAL: High extended beyond acceptable threshold (${extensionPercent.toFixed(3)}% > 0.1%)`
      );
    }
  }

  // Check if low was artificially extended
  if (modifications.lowExtended) {
    const extensionAmount = originalCandle.low - modifiedCandle.low;
    const extensionPercent = (extensionAmount / avgPrice) * 100;

    warnings.push(
      `Low artificially extended by ${extensionAmount.toFixed(5)} ` +
      `(${extensionPercent.toFixed(3)}%) - ${originalCandle.low} → ${modifiedCandle.low}`
    );

    // If extension is > 0.1%, this is a serious integrity violation
    if (extensionPercent > 0.1) {
      isValid = false;
      errors.push(
        `CRITICAL: Low extended beyond acceptable threshold (${extensionPercent.toFixed(3)}% > 0.1%)`
      );
    }
  }

  // Check if range was significantly increased
  if (modifications.rangeIncreased && modifications.percentageChange > 0.2) {
    warnings.push(
      `Candle range artificially increased by ${rangeIncrease.toFixed(5)} ` +
      `(${modifications.percentageChange.toFixed(3)}%) - ` +
      `${originalRange.toFixed(5)} → ${modifiedRange.toFixed(5)}`
    );

    if (modifications.percentageChange > 1.0) {
      isValid = false;
      errors.push(
        `CRITICAL: Range increased beyond acceptable threshold ` +
        `(${modifications.percentageChange.toFixed(3)}% > 1.0%)`
      );
    }
  }

  // Log any integrity violations
  if (warnings.length > 0 || errors.length > 0) {
    const symbol = originalCandle.symbol || 'UNKNOWN';
    const timeframe = originalCandle.timeframe || 'UNKNOWN';
    const time = originalCandle.time || 'UNKNOWN';

    logger.warn(
      LogCategory.CHART_POLLER,
      `[CandleIntegrity] ⚠️ Candle modification detected for ${symbol} ${timeframe} at ${time}:`
    );

    warnings.forEach(warning => {
      logger.warn(LogCategory.CHART_POLLER, `  WARNING: ${warning}`);
    });

    errors.forEach(error => {
      logger.error(LogCategory.CHART_POLLER, `  ERROR: ${error}`);
    });

    logger.warn(
      LogCategory.CHART_POLLER,
      `  Original OHLC: ${originalCandle.open.toFixed(5)} / ${originalCandle.high.toFixed(5)} / ` +
      `${originalCandle.low.toFixed(5)} / ${originalCandle.close.toFixed(5)}`
    );
    logger.warn(
      LogCategory.CHART_POLLER,
      `  Modified OHLC: ${modifiedCandle.open.toFixed(5)} / ${modifiedCandle.high.toFixed(5)} / ` +
      `${modifiedCandle.low.toFixed(5)} / ${modifiedCandle.close.toFixed(5)}`
    );
  }

  return {
    isValid,
    warnings,
    errors,
    originalCandle,
    modifiedCandle,
    modifications
  };
}

/**
 * Check if a candle is completely flat (needs reconstruction)
 * Returns true only if ALL OHLC values are identical
 */
export function isCompletelyFlatCandle(candle: {
  open: number;
  high: number;
  low: number;
  close: number;
}): boolean {
  return (
    candle.high === candle.low &&
    candle.open === candle.close &&
    candle.high === candle.open
  );
}

/**
 * Validate OHLC relationships are correct
 * high >= max(open, close) >= min(open, close) >= low
 */
export function validateOHLCRelationships(candle: {
  open: number;
  high: number;
  low: number;
  close: number;
  symbol?: string;
  timeframe?: string;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  let isValid = true;

  const maxOC = Math.max(candle.open, candle.close);
  const minOC = Math.min(candle.open, candle.close);

  if (candle.high < maxOC) {
    isValid = false;
    errors.push(
      `High (${candle.high}) is less than max(open, close) (${maxOC})`
    );
  }

  if (candle.low > minOC) {
    isValid = false;
    errors.push(
      `Low (${candle.low}) is greater than min(open, close) (${minOC})`
    );
  }

  if (candle.high < candle.low) {
    isValid = false;
    errors.push(
      `High (${candle.high}) is less than low (${candle.low})`
    );
  }

  if (!isFinite(candle.open) || !isFinite(candle.high) ||
      !isFinite(candle.low) || !isFinite(candle.close)) {
    isValid = false;
    errors.push('Candle contains non-finite values (NaN or Infinity)');
  }

  if (candle.open <= 0 || candle.high <= 0 ||
      candle.low <= 0 || candle.close <= 0) {
    isValid = false;
    errors.push('Candle contains non-positive values');
  }

  if (!isValid && errors.length > 0) {
    const symbol = candle.symbol || 'UNKNOWN';
    const timeframe = candle.timeframe || 'UNKNOWN';

    logger.error(
      LogCategory.CHART_POLLER,
      `[CandleIntegrity] ❌ Invalid OHLC relationships for ${symbol} ${timeframe}:`
    );
    errors.forEach(error => {
      logger.error(LogCategory.CHART_POLLER, `  ${error}`);
    });
    logger.error(
      LogCategory.CHART_POLLER,
      `  OHLC: ${candle.open} / ${candle.high} / ${candle.low} / ${candle.close}`
    );
  }

  return { isValid, errors };
}

/**
 * Calculate candle quality metrics
 */
export function calculateCandleQualityMetrics(candle: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}): {
  range: number;
  bodySize: number;
  upperWickSize: number;
  lowerWickSize: number;
  totalWickSize: number;
  wickToBodyRatio: number;
  isFlat: boolean;
  hasMinimalRange: boolean;
} {
  const range = candle.high - candle.low;
  const bodySize = Math.abs(candle.close - candle.open);
  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBottom = Math.min(candle.open, candle.close);
  const upperWickSize = candle.high - bodyTop;
  const lowerWickSize = bodyBottom - candle.low;
  const totalWickSize = upperWickSize + lowerWickSize;
  const wickToBodyRatio = bodySize > 0 ? totalWickSize / bodySize : Infinity;

  const isFlat = isCompletelyFlatCandle(candle);
  const avgPrice = (candle.open + candle.close) / 2;
  const rangePercent = (range / avgPrice) * 100;
  const hasMinimalRange = rangePercent < 0.01; // Less than 0.01% range

  return {
    range,
    bodySize,
    upperWickSize,
    lowerWickSize,
    totalWickSize,
    wickToBodyRatio,
    isFlat,
    hasMinimalRange
  };
}

/**
 * Get a summary report of candle integrity issues
 */
export function getIntegrityReport(
  validationResults: CandleValidationResult[]
): {
  totalCandles: number;
  validCandles: number;
  invalidCandles: number;
  candlesWithHighExtension: number;
  candlesWithLowExtension: number;
  candlesWithRangeIncrease: number;
  averageRangeIncrease: number;
  maxRangeIncrease: number;
} {
  const totalCandles = validationResults.length;
  const validCandles = validationResults.filter(r => r.isValid).length;
  const invalidCandles = totalCandles - validCandles;
  const candlesWithHighExtension = validationResults.filter(
    r => r.modifications.highExtended
  ).length;
  const candlesWithLowExtension = validationResults.filter(
    r => r.modifications.lowExtended
  ).length;
  const candlesWithRangeIncrease = validationResults.filter(
    r => r.modifications.rangeIncreased
  ).length;

  const rangeIncreases = validationResults
    .filter(r => r.modifications.rangeIncreased)
    .map(r => r.modifications.percentageChange);

  const averageRangeIncrease = rangeIncreases.length > 0
    ? rangeIncreases.reduce((sum, val) => sum + val, 0) / rangeIncreases.length
    : 0;

  const maxRangeIncrease = rangeIncreases.length > 0
    ? Math.max(...rangeIncreases)
    : 0;

  return {
    totalCandles,
    validCandles,
    invalidCandles,
    candlesWithHighExtension,
    candlesWithLowExtension,
    candlesWithRangeIncrease,
    averageRangeIncrease,
    maxRangeIncrease
  };
}
