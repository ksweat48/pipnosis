import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

export interface PriceStalenessResult {
  isValid: boolean;
  ageSeconds?: number;
  maxAgeSeconds: number;
  reason?: string;
  shouldBlockTrading: boolean;
}

const MAX_PRICE_AGE_SECONDS = 120;
const WARNING_THRESHOLD_SECONDS = 60;

export class RealtimePriceStalenessValidator {
  async validatePriceFreshness(symbol: string): Promise<PriceStalenessResult> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('bid, updated_at')
        .eq('symbol', symbol)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        logger.error(
          LogCategory.AI_TRADING,
          `[Price Staleness Gate] 🚫 BLOCKED: No price data for ${symbol}`
        );

        return {
          isValid: false,
          maxAgeSeconds: MAX_PRICE_AGE_SECONDS,
          reason: `No realtime price data available for ${symbol}`,
          shouldBlockTrading: true
        };
      }

      const priceTimestamp = new Date(data.updated_at).getTime();
      const ageSeconds = Math.floor((Date.now() - priceTimestamp) / 1000);

      if (ageSeconds > MAX_PRICE_AGE_SECONDS) {
        const minutesOld = Math.floor(ageSeconds / 60);
        const secondsOld = ageSeconds % 60;

        logger.error(
          LogCategory.AI_TRADING,
          `[Price Staleness Gate] 🚫 BLOCKED: ${symbol} price is ${minutesOld}m ${secondsOld}s old (max: ${Math.floor(MAX_PRICE_AGE_SECONDS / 60)}m)`
        );

        return {
          isValid: false,
          ageSeconds,
          maxAgeSeconds: MAX_PRICE_AGE_SECONDS,
          reason: `Realtime price is ${minutesOld}m ${secondsOld}s old (max: ${Math.floor(MAX_PRICE_AGE_SECONDS / 60)}m)`,
          shouldBlockTrading: true
        };
      }

      if (ageSeconds > WARNING_THRESHOLD_SECONDS) {
        logger.warn(
          LogCategory.AI_TRADING,
          `[Price Staleness Gate] ⚠️ WARNING: ${symbol} price is ${ageSeconds}s old (threshold: ${WARNING_THRESHOLD_SECONDS}s)`
        );
      } else {
        logger.info(
          LogCategory.AI_TRADING,
          `[Price Staleness Gate] ✅ PASS: ${symbol} price is fresh (age: ${ageSeconds}s)`
        );
      }

      return {
        isValid: true,
        ageSeconds,
        maxAgeSeconds: MAX_PRICE_AGE_SECONDS,
        shouldBlockTrading: false
      };
    } catch (err) {
      logger.error(
        LogCategory.AI_TRADING,
        `[Price Staleness Gate] ❌ Error validating price freshness for ${symbol}:`,
        err
      );

      return {
        isValid: false,
        maxAgeSeconds: MAX_PRICE_AGE_SECONDS,
        reason: 'Failed to validate price freshness',
        shouldBlockTrading: true
      };
    }
  }

  async validateMultipleSymbols(symbols: string[]): Promise<Map<string, PriceStalenessResult>> {
    const results = new Map<string, PriceStalenessResult>();

    const validations = await Promise.all(
      symbols.map(async (symbol) => {
        const result = await this.validatePriceFreshness(symbol);
        return { symbol, result };
      })
    );

    for (const { symbol, result } of validations) {
      results.set(symbol, result);
    }

    const staleSymbols = validations.filter(v => !v.result.isValid);
    if (staleSymbols.length > 0) {
      logger.error(
        LogCategory.AI_TRADING,
        `[Price Staleness Gate] 🚫 ${staleSymbols.length}/${symbols.length} symbols have stale prices: ${staleSymbols.map(s => s.symbol).join(', ')}`
      );
    }

    return results;
  }

  async getOldestPriceAge(): Promise<{ symbol: string; ageSeconds: number } | null> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('symbol, updated_at')
        .order('updated_at', { ascending: true })
        .limit(1)
        .single();

      if (error || !data) {
        return null;
      }

      const priceTimestamp = new Date(data.updated_at).getTime();
      const ageSeconds = Math.floor((Date.now() - priceTimestamp) / 1000);

      return {
        symbol: data.symbol,
        ageSeconds
      };
    } catch (err) {
      return null;
    }
  }
}

export const realtimePriceStalenessValidator = new RealtimePriceStalenessValidator();
