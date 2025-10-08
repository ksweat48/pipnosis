import { CandleData, Timeframe } from './metaapi';
import { validateOHLC, validateCandleSequence, timeframeToMinutes } from './candle-utils';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class DataValidator {
  validateCandle(candle: CandleData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!validateOHLC(candle.open, candle.high, candle.low, candle.close)) {
      errors.push(`Invalid OHLC values: O=${candle.open}, H=${candle.high}, L=${candle.low}, C=${candle.close}`);
    }

    if (candle.spread < 0) {
      errors.push(`Negative spread: ${candle.spread}`);
    }

    if (candle.tickVolume < 0) {
      errors.push(`Negative tick volume: ${candle.tickVolume}`);
    }

    if (candle.volume < 0) {
      errors.push(`Negative volume: ${candle.volume}`);
    }

    const priceRange = candle.high - candle.low;
    const avgPrice = (candle.high + candle.low) / 2;
    const rangePercent = (priceRange / avgPrice) * 100;

    if (rangePercent > 10) {
      warnings.push(`Unusually large price range: ${rangePercent.toFixed(2)}%`);
    }

    if (priceRange === 0 && candle.tickVolume > 1) {
      warnings.push(`No price movement despite ${candle.tickVolume} ticks`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  validateCandleSequence(candles: CandleData[], timeframe: Timeframe): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (candles.length === 0) {
      return { isValid: true, errors, warnings };
    }

    if (!validateCandleSequence(candles, timeframe)) {
      errors.push('Candle sequence has timing inconsistencies');
    }

    const intervalMs = timeframeToMinutes(timeframe) * 60 * 1000;

    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currCandle = candles[i];

      const timeDiff = currCandle.time.getTime() - prevCandle.time.getTime();

      if (timeDiff < 0) {
        errors.push(`Candles out of order at index ${i}: ${prevCandle.time.toISOString()} -> ${currCandle.time.toISOString()}`);
      }

      if (timeDiff > intervalMs * 2 && timeframe !== 'D1' && timeframe !== 'W1' && timeframe !== 'MN1') {
        warnings.push(`Large gap detected at index ${i}: ${timeDiff / 60000} minutes (expected ${intervalMs / 60000})`);
      }

      if (prevCandle.time.getTime() === currCandle.time.getTime()) {
        errors.push(`Duplicate timestamp at index ${i}: ${currCandle.time.toISOString()}`);
      }

      const priceGap = Math.abs(currCandle.open - prevCandle.close);
      const avgPrice = (prevCandle.close + currCandle.open) / 2;
      const gapPercent = (priceGap / avgPrice) * 100;

      if (gapPercent > 5) {
        warnings.push(`Large price gap at index ${i}: ${gapPercent.toFixed(2)}%`);
      }
    }

    for (let i = 0; i < candles.length; i++) {
      const candleValidation = this.validateCandle(candles[i]);
      if (!candleValidation.isValid) {
        errors.push(`Candle ${i} (${candles[i].time.toISOString()}): ${candleValidation.errors.join(', ')}`);
      }
      warnings.push(...candleValidation.warnings.map(w => `Candle ${i}: ${w}`));
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  detectMissingCandles(candles: CandleData[], timeframe: Timeframe): Date[] {
    if (candles.length < 2) return [];

    const missingTimes: Date[] = [];
    const intervalMs = timeframeToMinutes(timeframe) * 60 * 1000;

    for (let i = 1; i < candles.length; i++) {
      const prevTime = candles[i - 1].time.getTime();
      const currTime = candles[i].time.getTime();
      const expectedTime = prevTime + intervalMs;

      if (currTime > expectedTime && timeframe !== 'D1' && timeframe !== 'W1' && timeframe !== 'MN1') {
        let missingTime = expectedTime;
        while (missingTime < currTime) {
          missingTimes.push(new Date(missingTime));
          missingTime += intervalMs;
        }
      }
    }

    return missingTimes;
  }

  repairCandle(candle: CandleData): CandleData {
    const repairedCandle = { ...candle };

    if (repairedCandle.high < repairedCandle.low) {
      [repairedCandle.high, repairedCandle.low] = [repairedCandle.low, repairedCandle.high];
    }

    repairedCandle.high = Math.max(
      repairedCandle.high,
      repairedCandle.open,
      repairedCandle.close,
      repairedCandle.low
    );

    repairedCandle.low = Math.min(
      repairedCandle.low,
      repairedCandle.open,
      repairedCandle.close,
      repairedCandle.high
    );

    if (repairedCandle.spread < 0) {
      repairedCandle.spread = 0;
    }

    if (repairedCandle.tickVolume < 0) {
      repairedCandle.tickVolume = 0;
    }

    if (repairedCandle.volume < 0) {
      repairedCandle.volume = 0;
    }

    return repairedCandle;
  }

  logValidationResults(result: ValidationResult, context: string): void {
    if (!result.isValid) {
      console.error(`❌ Validation failed for ${context}:`, result.errors);
    }

    if (result.warnings.length > 0) {
      console.warn(`⚠️ Validation warnings for ${context}:`, result.warnings);
    }

    if (result.isValid && result.warnings.length === 0) {
      console.log(`✅ Validation passed for ${context}`);
    }
  }
}

export const dataValidator = new DataValidator();
