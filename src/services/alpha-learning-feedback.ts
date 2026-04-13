/**
 * Alpha Learning Feedback Service
 *
 * Closes the learning loop by automatically updating Alpha's intelligence
 * based on actual trade outcomes. This service:
 *
 * 1. Updates confidence calibration when trades close
 * 2. Tracks reasoning pattern effectiveness
 * 3. Generates meta-insights from performance patterns
 * 4. Updates execution quality metrics
 *
 * This is the heart of Alpha's continuous improvement system.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { shouldIncludeInLearning, getExclusionReason } from '../utils/trade-learning-filter';
import { mapAnalysisToCloseReason } from '../utils/close-reason-mapper';
import { isWinningTrade, calculateWinRate } from '../utils/trade-outcome-classifier';

export interface TradeOutcome {
  tradeId: string;
  userId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  closeReason: 'tp_hit' | 'tp1_only' | 'sl_hit' | 'near_miss' | 'manual_close' | 'timeout';
  pnl: number;
  pnlR: number;
  confidence: number;
  marketCondition: string;
  timeframe?: string;
  aiReasoningPattern?: string;
  executionSlippage?: number;
  goalSessionId?: string;
  tradeStyle?: string;
  patternIds?: string[];
  counterThesisFailureProbability?: number;
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
   *
   * IMPORTANT: System closures (weekend_protection, holiday_closure, etc.) and
   * manual closes BEFORE reaching any milestone are excluded from learning.
   * Alpha only learns from fully executed trades.
   */
  async processTradeOutcome(outcomeInput: TradeOutcome): Promise<void> {
    let outcome = outcomeInput;
    logger.info(`[Alpha Feedback] Processing trade outcome for ${outcome.symbol}`, {
      tradeId: outcome.tradeId,
      closeReason: outcome.closeReason,
      pnl: outcome.pnl
    });

    // ✅ SSOT: Fetch full trade data to check milestone status
    const { data: tradeData } = await supabase
      .from('goal_session_trades')
      .select('tp1_hit, tp2_hit, close_reason, alpha_style')
      .eq('id', outcome.tradeId)
      .maybeSingle();

    if (tradeData?.alpha_style && !outcome.tradeStyle) {
      outcome = { ...outcome, tradeStyle: tradeData.alpha_style };
    }

    // Map analysis close reason to CloseReason type for filtering
    const mappedCloseReason = mapAnalysisToCloseReason(outcome.closeReason);

    // Check if trade should be included in learning (with milestone data)
    const milestoneData = tradeData ? {
      tp1_hit: tradeData.tp1_hit,
      tp2_hit: tradeData.tp2_hit,
      sl_hit: mappedCloseReason === 'stop_loss',
    } : undefined;

    if (!shouldIncludeInLearning(mappedCloseReason, milestoneData)) {
      const exclusionReason = getExclusionReason(mappedCloseReason, milestoneData);
      logger.info(`[Alpha Feedback] ⚠️ Skipping learning update - ${exclusionReason}`, {
        tradeId: outcome.tradeId,
        closeReason: outcome.closeReason,
        mappedReason: mappedCloseReason,
        milestoneData
      });
      return; // Do NOT penalize Alpha for excluded trades
    }

    logger.info(`[Alpha Feedback] ✅ Trade included in learning`, {
      tradeId: outcome.tradeId,
      closeReason: outcome.closeReason,
      milestoneData
    });

    try {
      await Promise.all([
        this.updateConfidenceCalibration(outcome),
        this.updateReasoningPattern(outcome),
        this.updateExecutionQuality(outcome),
        this.checkForMetaInsights(outcome),
        this.updatePatternWeights(outcome),
        this.updateSlHuntCorrections(outcome),
        this.updateSessionStreakState(outcome),
        this.updateTpDistributionStats(outcome),
        this.updateCounterThesisAccuracy(outcome)
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

      // Determine if prediction was correct.
      // SSOT: near_miss and tp1_only are directional wins — Alpha called the move correctly.
      // They are counted as successes in the confidence calibration buckets so the
      // win-rate stat reflects Alpha's directional accuracy, not just TP-hit rate.
      // The distinction between near_miss/tp1_only and full tp_hit is captured in
      // avg_pnl_r (which will naturally be lower for these outcomes).
      const wasCorrect =
        outcome.closeReason === 'tp_hit' ||
        outcome.closeReason === 'tp1_only' ||
        outcome.closeReason === 'near_miss' ||
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

      const wasSuccessful =
        outcome.closeReason === 'tp_hit' ||
        outcome.closeReason === 'tp1_only' ||
        outcome.closeReason === 'near_miss' ||
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

      const winRate = calculateWinRate(recentTrades);

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
   * Get calibrated confidence for a given confidence level
   */
  private async updatePatternWeights(outcome: TradeOutcome): Promise<void> {
    if (!outcome.patternIds || outcome.patternIds.length === 0) return;
    const wasWin = outcome.closeReason === 'tp_hit' || outcome.closeReason === 'tp1_only' ||
      outcome.closeReason === 'near_miss' || (outcome.closeReason === 'manual_close' && outcome.pnl > 0);
    try {
      for (const patternId of outcome.patternIds) {
        const { data: existing } = await supabase
          .from('alpha_pattern_performance_weights')
          .select('advisory_weight, win_rate, total_trades')
          .eq('user_id', outcome.userId)
          .eq('pattern_id', patternId)
          .maybeSingle();

        if (existing) {
          const newTotal = existing.total_trades + 1;
          const prevWins = Math.round(existing.win_rate * existing.total_trades);
          const newWinRate = (prevWins + (wasWin ? 1 : 0)) / newTotal;
          const newWeight = Math.min(1.0, Math.max(0.1, newWinRate));
          await supabase.from('alpha_pattern_performance_weights').update({
            advisory_weight: newWeight,
            win_rate: newWinRate,
            total_trades: newTotal,
            updated_at: new Date().toISOString()
          }).eq('user_id', outcome.userId).eq('pattern_id', patternId);
        } else {
          await supabase.from('alpha_pattern_performance_weights').insert({
            user_id: outcome.userId,
            pattern_id: patternId,
            advisory_weight: wasWin ? 0.6 : 0.4,
            win_rate: wasWin ? 1.0 : 0.0,
            total_trades: 1
          });
        }
      }
    } catch (error) {
      logger.warn('[Alpha Feedback] updatePatternWeights non-blocking error:', error);
    }
  }

  private async updateSlHuntCorrections(outcome: TradeOutcome): Promise<void> {
    if (outcome.closeReason !== 'sl_hit') return;
    try {
      const slDistance = Math.abs(outcome.stopLoss - outcome.entryPrice);
      const exitDistance = Math.abs(outcome.exitPrice - outcome.entryPrice);
      const isHunt = exitDistance < slDistance * 0.3;

      const { data: existing } = await supabase
        .from('alpha_sl_hunt_bias_corrections')
        .select('hunt_rate, total_sl_hits, recommended_sl_widen_pct, confidence')
        .eq('user_id', outcome.userId)
        .eq('symbol', outcome.symbol)
        .maybeSingle();

      if (existing) {
        const newTotal = existing.total_sl_hits + 1;
        const prevHunts = Math.round(existing.hunt_rate * existing.total_sl_hits);
        const newHuntRate = (prevHunts + (isHunt ? 1 : 0)) / newTotal;
        const recommendedWiden = newHuntRate >= 0.4 ? Math.min(0.5, newHuntRate * 0.3) : 0.0;
        const newConfidence = Math.min(1.0, newTotal / 20);
        await supabase.from('alpha_sl_hunt_bias_corrections').update({
          hunt_rate: newHuntRate,
          recommended_sl_widen_pct: recommendedWiden,
          confidence: newConfidence,
          total_sl_hits: newTotal,
          updated_at: new Date().toISOString()
        }).eq('user_id', outcome.userId).eq('symbol', outcome.symbol);
      } else {
        await supabase.from('alpha_sl_hunt_bias_corrections').insert({
          user_id: outcome.userId,
          symbol: outcome.symbol,
          hunt_rate: isHunt ? 1.0 : 0.0,
          recommended_sl_widen_pct: 0.0,
          confidence: 0.05,
          total_sl_hits: 1
        });
      }
    } catch (error) {
      logger.warn('[Alpha Feedback] updateSlHuntCorrections non-blocking error:', error);
    }
  }

  private async updateSessionStreakState(outcome: TradeOutcome): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const isWin = outcome.closeReason === 'tp_hit' || outcome.closeReason === 'tp1_only' ||
        outcome.closeReason === 'near_miss' || (outcome.closeReason === 'manual_close' && outcome.pnl > 0);

      const { data: existing } = await supabase
        .from('alpha_session_streak_state')
        .select('session_trades, session_wins, session_losses, current_streak, streak_type, session_pnl_r')
        .eq('user_id', outcome.userId)
        .eq('trade_date', today)
        .maybeSingle();

      if (existing) {
        const newTrades = existing.session_trades + 1;
        const newWins = existing.session_wins + (isWin ? 1 : 0);
        const newLosses = existing.session_losses + (isWin ? 0 : 1);
        const newPnlR = existing.session_pnl_r + outcome.pnlR;

        let newStreak = existing.current_streak;
        let newStreakType: 'win' | 'loss' | 'neutral' = existing.streak_type as 'win' | 'loss' | 'neutral';
        if (isWin) {
          newStreak = existing.streak_type === 'win' ? existing.current_streak + 1 : 1;
          newStreakType = 'win';
        } else {
          newStreak = existing.streak_type === 'loss' ? existing.current_streak + 1 : 1;
          newStreakType = 'loss';
        }

        await supabase.from('alpha_session_streak_state').update({
          session_trades: newTrades,
          session_wins: newWins,
          session_losses: newLosses,
          current_streak: newStreak,
          streak_type: newStreakType,
          session_pnl_r: newPnlR,
          updated_at: new Date().toISOString()
        }).eq('user_id', outcome.userId).eq('trade_date', today);
      } else {
        await supabase.from('alpha_session_streak_state').insert({
          user_id: outcome.userId,
          trade_date: today,
          session_trades: 1,
          session_wins: isWin ? 1 : 0,
          session_losses: isWin ? 0 : 1,
          current_streak: 1,
          streak_type: isWin ? 'win' : 'loss',
          session_pnl_r: outcome.pnlR
        });
      }
    } catch (error) {
      logger.warn('[Alpha Feedback] updateSessionStreakState non-blocking error:', error);
    }
  }

  private async updateTpDistributionStats(outcome: TradeOutcome): Promise<void> {
    const style = outcome.tradeStyle;
    if (!style) return;
    try {
      const { data: existing } = await supabase
        .from('alpha_tp_distribution_stats')
        .select('total_trades, tp_full_rate, tp1_only_rate, sl_rate')
        .eq('user_id', outcome.userId)
        .eq('symbol', outcome.symbol)
        .eq('style', style)
        .maybeSingle();

      const isTpFull = outcome.closeReason === 'tp_hit';
      const isTp1Only = outcome.closeReason === 'tp1_only';
      const isSl = outcome.closeReason === 'sl_hit';

      if (existing) {
        const n = existing.total_trades;
        const newTotal = n + 1;
        const newTpFull = (existing.tp_full_rate * n + (isTpFull ? 1 : 0)) / newTotal;
        const newTp1Only = (existing.tp1_only_rate * n + (isTp1Only ? 1 : 0)) / newTotal;
        const newSl = (existing.sl_rate * n + (isSl ? 1 : 0)) / newTotal;
        await supabase.from('alpha_tp_distribution_stats').update({
          total_trades: newTotal,
          tp_full_rate: newTpFull,
          tp1_only_rate: newTp1Only,
          sl_rate: newSl,
          updated_at: new Date().toISOString()
        }).eq('user_id', outcome.userId).eq('symbol', outcome.symbol).eq('style', style);
      } else {
        await supabase.from('alpha_tp_distribution_stats').insert({
          user_id: outcome.userId,
          symbol: outcome.symbol,
          style,
          total_trades: 1,
          tp_full_rate: isTpFull ? 1.0 : 0.0,
          tp1_only_rate: isTp1Only ? 1.0 : 0.0,
          sl_rate: isSl ? 1.0 : 0.0
        });
      }
    } catch (error) {
      logger.warn('[Alpha Feedback] updateTpDistributionStats non-blocking error:', error);
    }
  }

  private async updateCounterThesisAccuracy(outcome: TradeOutcome): Promise<void> {
    if (outcome.counterThesisFailureProbability == null) return;
    try {
      const actualFailed = outcome.closeReason === 'sl_hit' ? 1.0 : 0.0;
      const predicted = outcome.counterThesisFailureProbability;

      const { data: existing } = await supabase
        .from('alpha_counter_thesis_accuracy')
        .select('avg_predicted_failure_rate, actual_failure_rate, calibration_error, total_trades')
        .eq('user_id', outcome.userId)
        .eq('symbol', outcome.symbol)
        .maybeSingle();

      if (existing) {
        const n = existing.total_trades;
        const newTotal = n + 1;
        const newAvgPredicted = (existing.avg_predicted_failure_rate * n + predicted) / newTotal;
        const newActualRate = (existing.actual_failure_rate * n + actualFailed) / newTotal;
        const newCalibError = Math.abs(newAvgPredicted - newActualRate);
        await supabase.from('alpha_counter_thesis_accuracy').update({
          avg_predicted_failure_rate: newAvgPredicted,
          actual_failure_rate: newActualRate,
          calibration_error: newCalibError,
          total_trades: newTotal,
          updated_at: new Date().toISOString()
        }).eq('user_id', outcome.userId).eq('symbol', outcome.symbol);
      } else {
        await supabase.from('alpha_counter_thesis_accuracy').insert({
          user_id: outcome.userId,
          symbol: outcome.symbol,
          avg_predicted_failure_rate: predicted,
          actual_failure_rate: actualFailed,
          calibration_error: Math.abs(predicted - actualFailed),
          total_trades: 1
        });
      }
    } catch (error) {
      logger.warn('[Alpha Feedback] updateCounterThesisAccuracy non-blocking error:', error);
    }
  }

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
