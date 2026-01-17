/**
 * Alpha Learning Feedback Service
 *
 * Closes the learning loop by automatically updating Alpha's intelligence
 * based on actual trade outcomes. This service:
 *
 * 1. Updates confidence calibration when trades close
 * 2. Tracks reasoning pattern effectiveness
 * 3. Resolves override outcomes (correct/incorrect)
 * 4. Generates meta-insights from performance patterns
 * 5. Updates execution quality metrics
 *
 * This is the heart of Alpha's continuous improvement system.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface TradeOutcome {
  tradeId: string;
  userId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  closeReason: 'tp_hit' | 'sl_hit' | 'manual_close' | 'timeout';
  pnl: number;
  pnlR: number;
  confidence: number;
  marketCondition: string;
  timeframe?: string;
  aiReasoningPattern?: string;
  overrideId?: string;
  executionSlippage?: number;
  goalSessionId?: string;
}

export interface CalibrationUpdate {
  confidenceBucket: number;
  marketCondition: string;
  symbol?: string;
  wasCorrect: boolean;
  pnlR: number;
}

export interface ReasoningPatternUpdate {
  patternId: string;
  wasSuccessful: boolean;
  pnlR: number;
  marketConditions: string[];
  symbols: string[];
}

export class AlphaLearningFeedbackService {
  /**
   * Process trade outcome and update all learning systems
   */
  async processTradeOutcome(outcome: TradeOutcome): Promise<void> {
    logger.info(`[Alpha Feedback] Processing trade outcome for ${outcome.symbol}`, {
      tradeId: outcome.tradeId,
      closeReason: outcome.closeReason,
      pnl: outcome.pnl
    });

    try {
      await Promise.all([
        this.updateConfidenceCalibration(outcome),
        this.updateReasoningPattern(outcome),
        this.resolveOverrideOutcome(outcome),
        this.updateExecutionQuality(outcome),
        this.checkForMetaInsights(outcome)
      ]);

      logger.info('[Alpha Feedback] ✅ Successfully updated all learning systems');
    } catch (error) {
      logger.error('[Alpha Feedback] ❌ Failed to process trade outcome:', error);
    }
  }

  /**
   * Update confidence calibration based on trade outcome
   */
  private async updateConfidenceCalibration(outcome: TradeOutcome): Promise<void> {
    try {
      // Round confidence to nearest 10 for bucketing
      const confidenceBucket = Math.round(outcome.confidence / 10) * 10;

      // Determine if prediction was correct
      const wasCorrect = outcome.closeReason === 'tp_hit' ||
                        (outcome.closeReason === 'manual_close' && outcome.pnl > 0);

      // Get or create calibration record
      const { data: existing } = await supabase
        .from('alpha_confidence_calibration')
        .select('*')
        .eq('user_id', outcome.userId)
        .eq('confidence_bucket', confidenceBucket)
        .eq('market_condition', outcome.marketCondition)
        .eq('symbol', outcome.symbol || '')
        .maybeSingle();

      if (existing) {
        // Update existing record
        const newTotalTrades = existing.total_trades + 1;
        const newWinningTrades = existing.winning_trades + (wasCorrect ? 1 : 0);
        const newLosingTrades = existing.losing_trades + (wasCorrect ? 0 : 1);
        const newActualWinRate = (newWinningTrades / newTotalTrades) * 100;
        const newCalibrationError = Math.abs(confidenceBucket - newActualWinRate);

        // Calculate new average PnL in R
        const newAvgPnlR = ((existing.avg_pnl_r * existing.total_trades) + outcome.pnlR) / newTotalTrades;

        await supabase
          .from('alpha_confidence_calibration')
          .update({
            total_trades: newTotalTrades,
            winning_trades: newWinningTrades,
            losing_trades: newLosingTrades,
            actual_win_rate: newActualWinRate,
            calibration_error: newCalibrationError,
            avg_pnl_r: newAvgPnlR,
            sample_size: newTotalTrades,
            last_updated: new Date().toISOString()
          })
          .eq('id', existing.id);

        logger.info(`[Alpha Feedback] Updated calibration for ${confidenceBucket}% bucket: ${newActualWinRate.toFixed(1)}% WR (n=${newTotalTrades})`);
      } else {
        // Create new record
        const actualWinRate = wasCorrect ? 100 : 0;
        const calibrationError = Math.abs(confidenceBucket - actualWinRate);

        await supabase
          .from('alpha_confidence_calibration')
          .insert({
            user_id: outcome.userId,
            confidence_bucket: confidenceBucket,
            market_condition: outcome.marketCondition,
            symbol: outcome.symbol,
            timeframe: outcome.timeframe,
            predicted_win_rate: confidenceBucket,
            actual_win_rate: actualWinRate,
            sample_size: 1,
            calibration_error: calibrationError,
            total_trades: 1,
            winning_trades: wasCorrect ? 1 : 0,
            losing_trades: wasCorrect ? 0 : 1,
            avg_pnl_r: outcome.pnlR
          });

        logger.info(`[Alpha Feedback] Created new calibration record for ${confidenceBucket}% bucket`);
      }
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to update confidence calibration:', error);
    }
  }

  /**
   * Update reasoning pattern effectiveness
   */
  private async updateReasoningPattern(outcome: TradeOutcome): Promise<void> {
    if (!outcome.aiReasoningPattern) {
      return; // No pattern to update
    }

    try {
      const { data: existing } = await supabase
        .from('alpha_reasoning_patterns')
        .select('*')
        .eq('user_id', outcome.userId)
        .eq('pattern_id', outcome.aiReasoningPattern)
        .maybeSingle();

      const wasSuccessful = outcome.closeReason === 'tp_hit' ||
                           (outcome.closeReason === 'manual_close' && outcome.pnl > 0);

      if (existing) {
        // Update existing pattern
        const newUsageCount = existing.usage_count + 1;
        const newWinCount = existing.win_count + (wasSuccessful ? 1 : 0);
        const newLossCount = existing.loss_count + (wasSuccessful ? 0 : 1);
        const newWinRate = (newWinCount / newUsageCount) * 100;

        // Update average PnL R
        const newAvgPnlR = ((existing.avg_pnl_r * existing.usage_count) + outcome.pnlR) / newUsageCount;

        // Calculate effectiveness score (win rate * avg R)
        const effectivenessScore = newWinRate * Math.abs(newAvgPnlR);

        // Update market conditions and symbols arrays (add if not present)
        const updatedMarketConditions = Array.from(new Set([
          ...(existing.market_conditions || []),
          outcome.marketCondition
        ]));

        const updatedSymbols = Array.from(new Set([
          ...(existing.symbols || []),
          outcome.symbol
        ]));

        await supabase
          .from('alpha_reasoning_patterns')
          .update({
            usage_count: newUsageCount,
            win_count: newWinCount,
            loss_count: newLossCount,
            win_rate: newWinRate,
            avg_pnl_r: newAvgPnlR,
            effectiveness_score: effectivenessScore,
            market_conditions: updatedMarketConditions,
            symbols: updatedSymbols,
            last_used: new Date().toISOString(),
            last_updated: new Date().toISOString()
          })
          .eq('id', existing.id);

        logger.info(`[Alpha Feedback] Updated reasoning pattern "${outcome.aiReasoningPattern}": ${newWinRate.toFixed(1)}% WR, ${newAvgPnlR.toFixed(2)}R`);
      } else {
        // Create new pattern (this should have been created during decision, but handle gracefully)
        logger.warn(`[Alpha Feedback] Reasoning pattern "${outcome.aiReasoningPattern}" not found, skipping update`);
      }
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to update reasoning pattern:', error);
    }
  }

  /**
   * Resolve override outcome (was the override correct?)
   */
  private async resolveOverrideOutcome(outcome: TradeOutcome): Promise<void> {
    if (!outcome.overrideId) {
      return; // No override to resolve
    }

    try {
      const { data: override } = await supabase
        .from('alpha_authority_overrides')
        .select('*')
        .eq('decision_id', outcome.overrideId)
        .maybeSingle();

      if (!override) {
        return; // Override not found
      }

      // Determine if override was correct
      // Correct = achieved positive outcome despite safety recommendation
      const wasCorrect = outcome.closeReason === 'tp_hit' ||
                        (outcome.closeReason === 'manual_close' && outcome.pnl > 0);

      const actualOutcome = wasCorrect ? 'correct' : 'incorrect';

      // Calculate realized edge
      const realizedEdge = outcome.pnlR;

      await supabase
        .from('alpha_authority_overrides')
        .update({
          actual_outcome: actualOutcome,
          outcome_pnl: outcome.pnl,
          outcome_details: {
            close_reason: outcome.closeReason,
            pnl_r: outcome.pnlR,
            entry_price: outcome.entryPrice,
            exit_price: outcome.exitPrice
          },
          resolved_at: new Date().toISOString()
        })
        .eq('id', override.id);

      logger.info(`[Alpha Feedback] Resolved override outcome: ${actualOutcome} (${realizedEdge.toFixed(2)}R)`);

      // If this was a successful override, consider generating a meta-insight
      if (wasCorrect && realizedEdge > 1.5) {
        await this.generateSuccessfulOverrideInsight(outcome, override);
      }
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to resolve override outcome:', error);
    }
  }

  /**
   * Update execution quality metrics
   */
  private async updateExecutionQuality(outcome: TradeOutcome): Promise<void> {
    if (!outcome.executionSlippage) {
      return; // No execution data
    }

    try {
      // Check if SL was hit suspiciously close to entry
      const slDistance = Math.abs(outcome.stopLoss - outcome.entryPrice);
      const exitDistance = Math.abs(outcome.exitPrice - outcome.entryPrice);
      const slHuntingSuspected = outcome.closeReason === 'sl_hit' &&
                                 exitDistance < slDistance * 0.3; // Hit within 30% of SL

      await supabase
        .from('execution_quality_log')
        .insert({
          user_id: outcome.userId,
          trade_id: outcome.tradeId,
          goal_session_id: outcome.goalSessionId,
          symbol: outcome.symbol,
          session: outcome.marketCondition,
          expected_entry: outcome.entryPrice,
          actual_entry: outcome.entryPrice, // Assume actual = expected for now
          slippage_pips: outcome.executionSlippage,
          expected_sl: outcome.stopLoss,
          actual_sl_hit: outcome.closeReason === 'sl_hit' ? outcome.exitPrice : null,
          sl_hunting_suspected: slHuntingSuspected
        });

      if (slHuntingSuspected) {
        logger.warn(`[Alpha Feedback] ⚠️ SL hunting suspected on ${outcome.symbol}`);
      }
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to update execution quality:', error);
    }
  }

  /**
   * Check for meta-insights based on performance patterns
   */
  private async checkForMetaInsights(outcome: TradeOutcome): Promise<void> {
    try {
      // Get recent trades for this user/symbol combination
      const { data: recentTrades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', outcome.userId)
        .eq('symbol', outcome.symbol)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      if (!recentTrades || recentTrades.length < 10) {
        return; // Need more data
      }

      // Check for consistent winning or losing patterns
      const wins = recentTrades.filter(t =>
        t.close_reason === 'tp_hit' || (t.close_reason === 'manual_close' && (t.realized_pnl || 0) > 0)
      ).length;
      const winRate = (wins / recentTrades.length) * 100;

      // Generate insight if we find a pattern
      if (winRate >= 70) {
        await this.generateStrengthInsight(outcome, winRate, recentTrades.length);
      } else if (winRate <= 30) {
        await this.generateWeaknessInsight(outcome, winRate, recentTrades.length);
      }
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to check for meta-insights:', error);
    }
  }

  /**
   * Generate strength insight
   */
  private async generateStrengthInsight(
    outcome: TradeOutcome,
    winRate: number,
    sampleSize: number
  ): Promise<void> {
    try {
      const insightDescription = `Strong performance on ${outcome.symbol} in ${outcome.marketCondition} conditions`;
      const actionableAdjustment = `Increase confidence and position sizing for ${outcome.symbol} during ${outcome.marketCondition}`;

      // Check if similar insight already exists
      const { data: existing } = await supabase
        .from('alpha_meta_insights')
        .select('*')
        .eq('user_id', outcome.userId)
        .eq('insight_type', 'strength')
        .ilike('insight_description', `%${outcome.symbol}%`)
        .maybeSingle();

      if (existing) {
        // Update existing insight
        await supabase
          .from('alpha_meta_insights')
          .update({
            confidence_in_insight: Math.min(95, existing.confidence_in_insight + 5),
            times_applied: existing.times_applied + 1,
            improvement_seen: winRate,
            validated: winRate >= 65,
            last_validated: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Create new insight
        await supabase
          .from('alpha_meta_insights')
          .insert({
            user_id: outcome.userId,
            insight_type: 'strength',
            market_condition: outcome.marketCondition,
            symbols: [outcome.symbol],
            timeframes: outcome.timeframe ? [outcome.timeframe] : [],
            insight_description: insightDescription,
            supporting_evidence: {
              win_rate: winRate,
              sample_size: sampleSize,
              recent_trade: outcome.tradeId
            },
            confidence_in_insight: Math.min(85, 50 + (winRate - 50)),
            actionable_adjustment: actionableAdjustment,
            validated: winRate >= 65
          });

        logger.info(`[Alpha Feedback] 💡 Generated strength insight for ${outcome.symbol}`);
      }
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to generate strength insight:', error);
    }
  }

  /**
   * Generate weakness insight
   */
  private async generateWeaknessInsight(
    outcome: TradeOutcome,
    winRate: number,
    sampleSize: number
  ): Promise<void> {
    try {
      const insightDescription = `Struggling with ${outcome.symbol} in ${outcome.marketCondition} conditions`;
      const actionableAdjustment = `Reduce position sizing or avoid ${outcome.symbol} during ${outcome.marketCondition}`;

      // Check if similar insight already exists
      const { data: existing } = await supabase
        .from('alpha_meta_insights')
        .select('*')
        .eq('user_id', outcome.userId)
        .eq('insight_type', 'weakness')
        .ilike('insight_description', `%${outcome.symbol}%`)
        .maybeSingle();

      if (existing) {
        // Update existing insight
        await supabase
          .from('alpha_meta_insights')
          .update({
            confidence_in_insight: Math.min(95, existing.confidence_in_insight + 5),
            times_applied: existing.times_applied + 1,
            improvement_seen: winRate,
            validated: winRate <= 35,
            last_validated: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Create new insight
        await supabase
          .from('alpha_meta_insights')
          .insert({
            user_id: outcome.userId,
            insight_type: 'weakness',
            market_condition: outcome.marketCondition,
            symbols: [outcome.symbol],
            timeframes: outcome.timeframe ? [outcome.timeframe] : [],
            insight_description: insightDescription,
            supporting_evidence: {
              win_rate: winRate,
              sample_size: sampleSize,
              recent_trade: outcome.tradeId
            },
            confidence_in_insight: Math.min(85, 50 + (50 - winRate)),
            actionable_adjustment: actionableAdjustment,
            validated: winRate <= 35
          });

        logger.info(`[Alpha Feedback] 💡 Generated weakness insight for ${outcome.symbol}`);
      }
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to generate weakness insight:', error);
    }
  }

  /**
   * Generate insight from successful override
   */
  private async generateSuccessfulOverrideInsight(
    outcome: TradeOutcome,
    override: any
  ): Promise<void> {
    try {
      const insightDescription = `Successfully overrode ${override.override_type} recommendation`;
      const actionableAdjustment = `Trust statistical edge when ${override.override_type} flags appear but market structure supports trade`;

      await supabase
        .from('alpha_meta_insights')
        .insert({
          user_id: outcome.userId,
          insight_type: 'discovery',
          market_condition: outcome.marketCondition,
          symbols: [outcome.symbol],
          insight_description: insightDescription,
          supporting_evidence: {
            override_type: override.override_type,
            pnl_r: outcome.pnlR,
            justification: override.statistical_justification
          },
          confidence_in_insight: Math.min(85, 60 + (outcome.pnlR * 10)),
          actionable_adjustment: actionableAdjustment,
          validated: true,
          last_validated: new Date().toISOString()
        });

      logger.info(`[Alpha Feedback] 💡 Generated successful override insight`);
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to generate override insight:', error);
    }
  }

  /**
   * Get calibrated confidence for a given confidence level
   */
  async getCalibratedConfidence(
    userId: string | undefined,
    rawConfidence: number,
    marketCondition: string,
    symbol?: string
  ): Promise<number> {
    try {
      // ✅ SSOT FIX: Validate required parameters before querying
      // Prevents "user_id=eq.undefined" and "market_condition=eq.undefined" errors
      if (!userId || userId === 'undefined' || typeof userId !== 'string') {
        logger.warn('[Alpha Feedback] getCalibratedConfidence called with invalid userId', { userId, rawConfidence });
        return rawConfidence;
      }

      if (!marketCondition || marketCondition === 'undefined' || typeof marketCondition !== 'string') {
        logger.warn('[Alpha Feedback] getCalibratedConfidence called with invalid marketCondition', { marketCondition, rawConfidence });
        return rawConfidence;
      }

      const confidenceBucket = Math.round(rawConfidence / 10) * 10;

      // Build query with validated parameters
      let query = supabase
        .from('alpha_confidence_calibration')
        .select('actual_win_rate, sample_size')
        .eq('user_id', userId)
        .eq('confidence_bucket', confidenceBucket)
        .eq('market_condition', marketCondition)
        .gte('sample_size', 10);

      // Only filter by symbol if provided and valid
      if (symbol && symbol !== 'undefined') {
        query = query.eq('symbol', symbol);
      }

      const { data } = await query.maybeSingle();

      if (data && data.sample_size >= 10) {
        logger.info(`[Alpha Feedback] Using calibrated confidence: ${rawConfidence}% → ${data.actual_win_rate.toFixed(1)}% (n=${data.sample_size})`);
        return data.actual_win_rate;
      }

      return rawConfidence; // Not enough data yet
    } catch (error) {
      logger.error('[Alpha Feedback] Failed to get calibrated confidence:', error);
      return rawConfidence;
    }
  }
}

export const alphaLearningFeedback = new AlphaLearningFeedbackService();
