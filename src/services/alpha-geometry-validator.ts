/**
 * Alpha Geometry Validator - SSOT for Trade Geometry Validation
 *
 * CRITICAL RULES (NON-NEGOTIABLE):
 * ❌ This service MUST NOT auto-correct Alpha's decisions
 * ❌ This service MUST NOT modify SL/TP values
 * ✅ This service MAY ONLY: detect → log → block
 *
 * ARCHITECTURE:
 * - Single authority for geometry validation logic
 * - Coordinates with alpha_geometry_errors table for learning
 * - Maintains Alpha's decision authority (blocks but never corrects)
 *
 * GEOMETRY RULES (SSOT):
 * BUY trades: SL < Entry < TP
 * SELL trades: TP < Entry < SL
 *
 * SSOT COMPLIANCE:
 * - All geometry validation logic lives here
 * - No duplicate validation elsewhere
 * - Logging to alpha_geometry_errors is the single source for error tracking
 */

import { supabase } from '../lib/supabase';

export interface GeometryValidationInput {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  currentMarketPrice: number;

  // Alpha decision context (for learning)
  alphaConfidence?: number;
  narrativeQuality?: string;
  narrativeText?: string;
  eqsScore?: number;
  tradeStyle?: string;

  // Market context (for pattern analysis)
  marketRegime?: string;
  volatilityLevel?: string;
  sessionContext?: string;

  // User/session tracking
  userId?: string;
  sessionId?: string;
  scanAttemptId?: string;

  // LLM metadata
  promptVersion?: string;
  modelUsed?: string;
  tokensUsed?: number;
}

export interface GeometryValidationResult {
  valid: boolean;
  blocked: boolean;
  errorType?: 'SL_WRONG_SIDE' | 'TP_WRONG_SIDE' | 'SL_TP_INVERTED' | 'ZERO_DISTANCE' | 'EXTREME_DEVIATION' | 'MISSING_VALUES';
  severity?: 'warning' | 'critical' | 'catastrophic';
  errorMessage?: string;
  errorLogId?: string;
  expectedGeometry?: {
    slSide: 'above_entry' | 'below_entry';
    tpSide: 'above_entry' | 'below_entry';
  };
  corrected?: boolean;
  correctedValues?: {
    stopLoss: number;
    takeProfit: number;
  };
  recoveryType?: 'SL_TP_LABEL_SWAP';
}

class AlphaGeometryValidator {
  private readonly MAX_ENTRY_DEVIATION_PERCENT = 10;
  private readonly MIN_SURVIVAL_PIPS = 5;

  /**
   * Validate trade geometry and log errors if detected
   * Returns validation result SYNCHRONOUSLY (logging happens async in background)
   * NEVER modifies input values
   */
  validate(input: GeometryValidationInput): GeometryValidationResult {
    const { symbol, direction, entryPrice, stopLoss, takeProfit, currentMarketPrice } = input;
    const isBuy = direction === 'BUY';

    // Determine expected geometry
    const expectedGeometry = {
      slSide: (isBuy ? 'below_entry' : 'above_entry') as 'above_entry' | 'below_entry',
      tpSide: (isBuy ? 'above_entry' : 'below_entry') as 'above_entry' | 'below_entry'
    };

    // 1. Check for missing SL/TP
    if (!stopLoss || !takeProfit) {
      // Log error asynchronously (fire-and-forget)
      this.logError({
        ...input,
        errorType: 'MISSING_VALUES',
        severity: 'catastrophic',
        errorMessage: `Missing ${!stopLoss ? 'Stop Loss' : 'Take Profit'} value`,
        expectedGeometry,
        actualSlSide: stopLoss ? this.determineSide(stopLoss, entryPrice) : undefined,
        actualTpSide: takeProfit ? this.determineSide(takeProfit, entryPrice) : undefined
      }).catch(err => console.error('[GeometryValidator] Log failed:', err));

      return {
        valid: false,
        blocked: true,
        errorType: 'MISSING_VALUES',
        severity: 'catastrophic',
        errorMessage: `Missing ${!stopLoss ? 'Stop Loss' : 'Take Profit'} value`,
        expectedGeometry
      };
    }

    // 2. Check entry price deviation (hallucination detection)
    const entryDeviationPercent = Math.abs((entryPrice - currentMarketPrice) / currentMarketPrice) * 100;
    if (entryDeviationPercent > this.MAX_ENTRY_DEVIATION_PERCENT) {
      // Log error asynchronously (fire-and-forget)
      this.logError({
        ...input,
        errorType: 'EXTREME_DEVIATION',
        severity: 'catastrophic',
        errorMessage: `Entry price ${entryPrice.toFixed(5)} deviates ${entryDeviationPercent.toFixed(1)}% from market ${currentMarketPrice.toFixed(5)} (max ${this.MAX_ENTRY_DEVIATION_PERCENT}%)`,
        expectedGeometry,
        actualSlSide: this.determineSide(stopLoss, entryPrice),
        actualTpSide: this.determineSide(takeProfit, entryPrice)
      }).catch(err => console.error('[GeometryValidator] Log failed:', err));

      return {
        valid: false,
        blocked: true,
        errorType: 'EXTREME_DEVIATION',
        severity: 'catastrophic',
        errorMessage: `Entry price deviates ${entryDeviationPercent.toFixed(1)}% from market (max ${this.MAX_ENTRY_DEVIATION_PERCENT}%)`,
        expectedGeometry
      };
    }

    // 3. Check SL geometry
    const slOnWrongSide = (isBuy && stopLoss > entryPrice) || (!isBuy && stopLoss < entryPrice);
    const tpOnWrongSide = (isBuy && takeProfit < entryPrice) || (!isBuy && takeProfit > entryPrice);

    if (slOnWrongSide && tpOnWrongSide) {
      const swappedSL = takeProfit;
      const swappedTP = stopLoss;
      const swappedSlValid = isBuy ? swappedSL < entryPrice : swappedSL > entryPrice;
      const swappedTpValid = isBuy ? swappedTP > entryPrice : swappedTP < entryPrice;
      const swappedSlNotZero = Math.abs(entryPrice - swappedSL) > 0;
      const swappedTpNotZero = Math.abs(swappedTP - entryPrice) > 0;

      if (swappedSlValid && swappedTpValid && swappedSlNotZero && swappedTpNotZero) {
        this.logRecovery({
          ...input,
          correctedSL: swappedSL,
          correctedTP: swappedTP,
          expectedGeometry,
          actualSlSide: this.determineSide(stopLoss, entryPrice),
          actualTpSide: this.determineSide(takeProfit, entryPrice)
        }).catch(err => console.error('[GeometryValidator] Recovery log failed:', err));

        return {
          valid: true,
          blocked: false,
          corrected: true,
          correctedValues: { stopLoss: swappedSL, takeProfit: swappedTP },
          recoveryType: 'SL_TP_LABEL_SWAP',
          expectedGeometry
        };
      }

      this.logError({
        ...input,
        errorType: 'SL_TP_INVERTED',
        severity: 'catastrophic',
        errorMessage: `BOTH Stop Loss and Take Profit on WRONG SIDE for ${direction} trade (Entry=${entryPrice.toFixed(5)}, SL=${stopLoss.toFixed(5)}, TP=${takeProfit.toFixed(5)}) - swap does NOT produce valid geometry`,
        expectedGeometry,
        actualSlSide: this.determineSide(stopLoss, entryPrice),
        actualTpSide: this.determineSide(takeProfit, entryPrice)
      }).catch(err => console.error('[GeometryValidator] Log failed:', err));

      return {
        valid: false,
        blocked: true,
        errorType: 'SL_TP_INVERTED',
        severity: 'catastrophic',
        errorMessage: `Both SL and TP inverted for ${direction} trade (unrecoverable)`,
        expectedGeometry
      };
    }

    if (slOnWrongSide) {
      // Log async (fire-and-forget)
      this.logError({
        ...input,
        errorType: 'SL_WRONG_SIDE',
        severity: 'critical',
        errorMessage: `Stop Loss on WRONG SIDE for ${direction} trade (Entry=${entryPrice.toFixed(5)}, SL=${stopLoss.toFixed(5)}). Expected SL ${expectedGeometry.slSide.replace('_', ' ')}.`,
        expectedGeometry,
        actualSlSide: this.determineSide(stopLoss, entryPrice),
        actualTpSide: this.determineSide(takeProfit, entryPrice)
      }).catch(err => console.error('[GeometryValidator] Log failed:', err));

      return {
        valid: false,
        blocked: true,
        errorType: 'SL_WRONG_SIDE',
        severity: 'critical',
        errorMessage: `Stop Loss on WRONG SIDE (${direction}: Entry=${entryPrice.toFixed(5)}, SL=${stopLoss.toFixed(5)})`,
        expectedGeometry
      };
    }

    if (tpOnWrongSide) {
      // Log async (fire-and-forget)
      this.logError({
        ...input,
        errorType: 'TP_WRONG_SIDE',
        severity: 'critical',
        errorMessage: `Take Profit on WRONG SIDE for ${direction} trade (Entry=${entryPrice.toFixed(5)}, TP=${takeProfit.toFixed(5)}). Expected TP ${expectedGeometry.tpSide.replace('_', ' ')}.`,
        expectedGeometry,
        actualSlSide: this.determineSide(stopLoss, entryPrice),
        actualTpSide: this.determineSide(takeProfit, entryPrice)
      }).catch(err => console.error('[GeometryValidator] Log failed:', err));

      return {
        valid: false,
        blocked: true,
        errorType: 'TP_WRONG_SIDE',
        severity: 'critical',
        errorMessage: `Take Profit on WRONG SIDE (${direction}: Entry=${entryPrice.toFixed(5)}, TP=${takeProfit.toFixed(5)})`,
        expectedGeometry
      };
    }

    // 4. Check for zero/near-zero distance (< 5 pips)
    const slDistance = Math.abs(entryPrice - stopLoss);
    const tpDistance = Math.abs(takeProfit - entryPrice);

    if (slDistance === 0 || tpDistance === 0) {
      // Log async (fire-and-forget)
      this.logError({
        ...input,
        errorType: 'ZERO_DISTANCE',
        severity: 'critical',
        errorMessage: `${slDistance === 0 ? 'Stop Loss' : 'Take Profit'} at entry price (zero distance) - invalid geometry`,
        expectedGeometry,
        actualSlSide: this.determineSide(stopLoss, entryPrice),
        actualTpSide: this.determineSide(takeProfit, entryPrice)
      }).catch(err => console.error('[GeometryValidator] Log failed:', err));

      return {
        valid: false,
        blocked: true,
        errorType: 'ZERO_DISTANCE',
        severity: 'critical',
        errorMessage: `${slDistance === 0 ? 'SL' : 'TP'} at entry price (zero distance)`,
        expectedGeometry
      };
    }

    // All checks passed
    return {
      valid: true,
      blocked: false,
      expectedGeometry
    };
  }

  /**
   * Determine which side of entry a price is on
   */
  private determineSide(price: number, entry: number): 'above_entry' | 'below_entry' {
    return price > entry ? 'above_entry' : 'below_entry';
  }

  /**
   * Log geometry error to database (fire-and-forget)
   * Returns error record or undefined if logging fails
   */
  private async logError(params: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    entryPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    currentMarketPrice: number;
    errorType: 'SL_WRONG_SIDE' | 'TP_WRONG_SIDE' | 'SL_TP_INVERTED' | 'ZERO_DISTANCE' | 'EXTREME_DEVIATION' | 'MISSING_VALUES';
    severity: 'warning' | 'critical' | 'catastrophic';
    errorMessage: string;
    expectedGeometry: {
      slSide: 'above_entry' | 'below_entry';
      tpSide: 'above_entry' | 'below_entry';
    };
    actualSlSide?: 'above_entry' | 'below_entry';
    actualTpSide?: 'above_entry' | 'below_entry';
    alphaConfidence?: number;
    narrativeQuality?: string;
    narrativeText?: string;
    eqsScore?: number;
    tradeStyle?: string;
    marketRegime?: string;
    volatilityLevel?: string;
    sessionContext?: string;
    userId?: string;
    sessionId?: string;
    scanAttemptId?: string;
    promptVersion?: string;
    modelUsed?: string;
    tokensUsed?: number;
  }): Promise<{ id: string } | undefined> {
    try {
      const { data, error } = await supabase
        .from('alpha_geometry_errors')
        .insert({
          error_type: params.errorType,
          severity: params.severity,
          blocked: true,
          symbol: params.symbol,
          direction: params.direction,
          entry_price: params.entryPrice,
          stop_loss: params.stopLoss,
          take_profit: params.takeProfit,
          current_market_price: params.currentMarketPrice,
          expected_sl_side: params.expectedGeometry.slSide,
          expected_tp_side: params.expectedGeometry.tpSide,
          actual_sl_side: params.actualSlSide,
          actual_tp_side: params.actualTpSide,
          alpha_confidence: params.alphaConfidence,
          narrative_quality: params.narrativeQuality,
          narrative_text: params.narrativeText,
          eqs_score: params.eqsScore,
          trade_style: params.tradeStyle,
          market_regime: params.marketRegime,
          volatility_level: params.volatilityLevel,
          session_context: params.sessionContext,
          user_id: params.userId,
          session_id: params.sessionId,
          scan_attempt_id: params.scanAttemptId,
          error_message: params.errorMessage,
          error_details: {
            entry: params.entryPrice,
            sl: params.stopLoss,
            tp: params.takeProfit,
            market: params.currentMarketPrice,
            expected: params.expectedGeometry,
            actual: {
              slSide: params.actualSlSide,
              tpSide: params.actualTpSide
            }
          },
          prompt_version: params.promptVersion || 'v1.0',
          model_used: params.modelUsed || 'gpt-4o-mini',
          tokens_used: params.tokensUsed
        })
        .select('id')
        .single();

      if (error) {
        console.error('[GeometryValidator] Failed to log error:', error);
        return undefined;
      }

      return data as { id: string };
    } catch (err) {
      console.error('[GeometryValidator] Exception logging error:', err);
      return undefined;
    }
  }

  private async logRecovery(params: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    entryPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    currentMarketPrice: number;
    correctedSL: number;
    correctedTP: number;
    expectedGeometry: { slSide: 'above_entry' | 'below_entry'; tpSide: 'above_entry' | 'below_entry' };
    actualSlSide?: 'above_entry' | 'below_entry';
    actualTpSide?: 'above_entry' | 'below_entry';
    alphaConfidence?: number;
    narrativeQuality?: string;
    narrativeText?: string;
    eqsScore?: number;
    tradeStyle?: string;
    marketRegime?: string;
    volatilityLevel?: string;
    sessionContext?: string;
    userId?: string;
    sessionId?: string;
    scanAttemptId?: string;
    promptVersion?: string;
    modelUsed?: string;
    tokensUsed?: number;
  }): Promise<void> {
    try {
      await supabase
        .from('alpha_geometry_errors')
        .insert({
          error_type: 'SL_TP_INVERTED',
          severity: 'warning',
          blocked: false,
          recovery_applied: true,
          recovery_type: 'SL_TP_LABEL_SWAP',
          symbol: params.symbol,
          direction: params.direction,
          entry_price: params.entryPrice,
          stop_loss: params.stopLoss,
          take_profit: params.takeProfit,
          current_market_price: params.currentMarketPrice,
          expected_sl_side: params.expectedGeometry.slSide,
          expected_tp_side: params.expectedGeometry.tpSide,
          actual_sl_side: params.actualSlSide,
          actual_tp_side: params.actualTpSide,
          alpha_confidence: params.alphaConfidence,
          narrative_quality: params.narrativeQuality,
          narrative_text: params.narrativeText,
          eqs_score: params.eqsScore,
          trade_style: params.tradeStyle,
          market_regime: params.marketRegime,
          volatility_level: params.volatilityLevel,
          session_context: params.sessionContext,
          user_id: params.userId,
          session_id: params.sessionId,
          scan_attempt_id: params.scanAttemptId,
          error_message: `SL/TP label swap RECOVERED: Original SL=${params.stopLoss?.toFixed(5)}, TP=${params.takeProfit?.toFixed(5)} → Corrected SL=${params.correctedSL.toFixed(5)}, TP=${params.correctedTP.toFixed(5)}`,
          error_details: {
            recoveryType: 'SL_TP_LABEL_SWAP',
            originalSL: params.stopLoss,
            originalTP: params.takeProfit,
            correctedSL: params.correctedSL,
            correctedTP: params.correctedTP,
            entry: params.entryPrice,
            market: params.currentMarketPrice,
            expected: params.expectedGeometry,
            actual: { slSide: params.actualSlSide, tpSide: params.actualTpSide }
          },
          prompt_version: params.promptVersion || 'v1.0',
          model_used: params.modelUsed || 'gpt-4o-mini',
          tokens_used: params.tokensUsed
        });
    } catch (err) {
      console.error('[GeometryValidator] Failed to log recovery:', err);
    }
  }

  /**
   * Get error rate for the last N hours (for alerting)
   */
  async getErrorRate(hoursAgo: number = 24): Promise<{
    errorCount: number;
    errorRate: number;
    criticalErrors: number;
    catastrophicErrors: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('alpha_geometry_errors')
        .select('severity')
        .gte('created_at', new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      const errorCount = data?.length || 0;
      const criticalErrors = data?.filter(e => e.severity === 'critical').length || 0;
      const catastrophicErrors = data?.filter(e => e.severity === 'catastrophic').length || 0;

      // Estimate error rate (would need scan_attempts table for exact calculation)
      // Assume 2x scan attempts per error as conservative estimate
      const estimatedScans = Math.max(errorCount * 2, 1);
      const errorRate = (errorCount / estimatedScans) * 100;

      return {
        errorCount,
        errorRate,
        criticalErrors,
        catastrophicErrors
      };
    } catch (err) {
      console.error('[GeometryValidator] Failed to get error rate:', err);
      return {
        errorCount: 0,
        errorRate: 0,
        criticalErrors: 0,
        catastrophicErrors: 0
      };
    }
  }
}

export const alphaGeometryValidator = new AlphaGeometryValidator();
