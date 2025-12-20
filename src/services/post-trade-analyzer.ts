/**
 * Post-Trade Analyzer
 *
 * Analyzes trade outcomes vs LLM predictions to determine accuracy and lessons learned.
 * Triggered when a trade closes, this service:
 * 1. Compares expected outcome vs actual outcome
 * 2. Evaluates prediction accuracy
 * 3. Generates natural language lessons
 * 4. Updates journal with post-trade analysis
 * 5. Feeds data back to confidence calibration
 * 6. Populates AI learning tables (ai_trade_analysis, alpha_meta_insights, etc.)
 */

import { supabase } from '../lib/supabase';
import { llmReasoningLogger, PostTradeAnalysis } from './llm-reasoning-logger';
import { logger } from '../lib/logger';

interface TradeData {
  id: string;
  userId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  entryTime: Date;
  exitTime: Date;
  journalEntryId?: string;
  expectedOutcome?: string;
  convictionLevel?: number;
  patternIdentified?: string;
}

class PostTradeAnalyzer {
  /**
   * Analyze trade outcome when position closes
   */
  async analyzeClosedTrade(tradeData: TradeData): Promise<void> {
    try {
      console.log(`[Post-Trade Analyzer] Analyzing trade ${tradeData.id} for ${tradeData.symbol}`);

      // Determine actual outcome
      const outcome = this.determineOutcome(tradeData.pnl);

      // Get journal entry if exists
      let journalEntry = await this.getJournalEntry(tradeData.id);

      if (!journalEntry) {
        console.warn(`[Post-Trade Analyzer] No journal entry found for trade ${tradeData.id} - creating retroactive entry`);

        // FALLBACK: Create retroactive journal entry from trade data
        journalEntry = await this.createRetroactiveJournalEntry(tradeData);

        if (!journalEntry) {
          console.error(`[Post-Trade Analyzer] Failed to create retroactive journal entry for trade ${tradeData.id}`);
          return;
        }

        console.log(`[Post-Trade Analyzer] ✅ Retroactive journal entry created for trade ${tradeData.id}`);
      }

      // Analyze prediction accuracy
      const { wasPredictionCorrect, accuracyScore, actualOutcome } = this.analyzePredictionAccuracy(
        tradeData,
        journalEntry.expected_outcome
      );

      // Generate lesson learned
      const lessonLearned = this.generateLessonLearned(
        tradeData,
        journalEntry,
        wasPredictionCorrect
      );

      // Identify mistakes or successes
      const mistakeIdentified = wasPredictionCorrect ? undefined : this.identifyMistake(tradeData, journalEntry);
      const whatWorked = wasPredictionCorrect ? this.identifyWhatWorked(tradeData, journalEntry) : undefined;

      // Update journal with post-trade analysis
      const analysis: PostTradeAnalysis = {
        journalEntryId: journalEntry.id,
        exitTime: tradeData.exitTime,
        exitPrice: tradeData.exitPrice,
        pnl: tradeData.pnl,
        outcome,
        actualOutcome,
        wasPredictionCorrect,
        accuracyScore,
        lessonLearned,
        mistakeIdentified,
        whatWorked
      };

      await llmReasoningLogger.logPostTradeAnalysis(analysis);

      // Log accuracy tracking
      await this.logAccuracyTracking(tradeData, journalEntry, wasPredictionCorrect);

      // Populate AI learning tables
      await this.populateAILearningTables(tradeData, journalEntry, outcome, wasPredictionCorrect);

      console.log(`[Post-Trade Analyzer] ✅ Analysis complete for ${tradeData.symbol}`);
    } catch (error) {
      console.error('[Post-Trade Analyzer] Error analyzing trade:', error);
    }
  }

  /**
   * Get journal entry for a trade
   */
  private async getJournalEntry(tradeId: string): Promise<any | null> {
    const { data, error } = await supabase
      .from('ai_trade_journal')
      .select('*')
      .eq('trade_id', tradeId)
      .maybeSingle();

    if (error) {
      console.error('[Post-Trade Analyzer] Error fetching journal:', error);
      return null;
    }

    return data;
  }

  /**
   * Create retroactive journal entry for trades that were opened without one
   * This is a safety net for legacy trades or system failures
   */
  private async createRetroactiveJournalEntry(tradeData: TradeData): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('ai_trade_journal')
        .insert({
          user_id: tradeData.userId,
          trade_id: tradeData.id,
          symbol: tradeData.symbol,
          direction: tradeData.direction,
          entry_time: tradeData.entryTime.toISOString(),
          entry_price: tradeData.entryPrice,
          stop_loss: tradeData.stopLoss,
          take_profit: tradeData.takeProfit,
          llm_reasoning: `Retroactive entry: ${tradeData.direction.toUpperCase()} trade on ${tradeData.symbol}. This journal entry was created after trade closure due to missing entry data.`,
          market_read: `Trade opened at ${tradeData.entryPrice.toFixed(5)}. Market conditions and setup details were not captured at entry time.`,
          expected_outcome: `Expected to reach take profit at ${tradeData.takeProfit.toFixed(5)}. Stop loss placed at ${tradeData.stopLoss.toFixed(5)}.`,
          pattern_identified: tradeData.patternIdentified || 'System Trade',
          conviction_level: tradeData.convictionLevel || 70,
          rank_at_time: 'System',
          outcome: 'open',
          journal_entry_type: 'trade',
          // Immediately add closure data since we're doing this retroactively
          exit_time: tradeData.exitTime.toISOString(),
          exit_price: tradeData.exitPrice,
          pnl: tradeData.pnl
        })
        .select()
        .single();

      if (error) {
        console.error('[Post-Trade Analyzer] Error creating retroactive journal:', error);
        return null;
      }

      console.log(`[Post-Trade Analyzer] ✅ Retroactive journal entry created: ${data.id}`);
      return data;
    } catch (error) {
      console.error('[Post-Trade Analyzer] Exception creating retroactive journal:', error);
      return null;
    }
  }

  /**
   * Determine trade outcome
   */
  private determineOutcome(pnl: number): 'win' | 'loss' | 'breakeven' {
    if (pnl > 0) return 'win';
    if (pnl < 0) return 'loss';
    return 'breakeven';
  }

  /**
   * Analyze how accurate the LLM's prediction was
   */
  private analyzePredictionAccuracy(
    tradeData: TradeData,
    expectedOutcome?: string
  ): { wasPredictionCorrect: boolean; accuracyScore: number; actualOutcome: string } {
    const actualOutcome = this.describeActualOutcome(tradeData);

    // Did price hit TP or SL?
    const hitTP = this.didHitTargetProfit(tradeData);
    const hitSL = this.didHitStopLoss(tradeData);

    // Was the prediction correct?
    let wasPredictionCorrect = false;
    let accuracyScore = 50; // Default

    if (!expectedOutcome) {
      // No prediction logged, assume neutral
      wasPredictionCorrect = tradeData.pnl > 0;
      accuracyScore = tradeData.pnl > 0 ? 75 : 25;
    } else {
      // Check if prediction matches outcome
      const expectedTP = expectedOutcome.toLowerCase().includes('take profit') ||
                         expectedOutcome.toLowerCase().includes('target') ||
                         expectedOutcome.toLowerCase().includes('win');

      wasPredictionCorrect = (expectedTP && hitTP) || (!expectedTP && hitSL);

      // Calculate accuracy score based on how close we got
      if (wasPredictionCorrect) {
        accuracyScore = 90 + (Math.random() * 10); // 90-100 for correct predictions
      } else {
        // Partial credit if we made money despite prediction
        if (tradeData.pnl > 0 && !expectedTP) {
          accuracyScore = 60; // Better than expected
        } else if (tradeData.pnl < 0 && expectedTP) {
          accuracyScore = 30; // Worse than expected
        } else {
          accuracyScore = 45; // Close but wrong
        }
      }
    }

    return { wasPredictionCorrect, accuracyScore, actualOutcome };
  }

  /**
   * Describe what actually happened in the trade
   */
  private describeActualOutcome(tradeData: TradeData): string {
    const hitTP = this.didHitTargetProfit(tradeData);
    const hitSL = this.didHitStopLoss(tradeData);

    if (hitTP) {
      return `Price moved in the expected direction and hit the take profit target at ${tradeData.takeProfit.toFixed(5)}. The trade was a success.`;
    } else if (hitSL) {
      return `Price reversed against the position and hit the stop loss at ${tradeData.stopLoss.toFixed(5)}. The trade resulted in a loss.`;
    } else if (tradeData.pnl > 0) {
      return `Trade was closed manually for a profit of $${tradeData.pnl.toFixed(2)} before hitting TP.`;
    } else if (tradeData.pnl < 0) {
      return `Trade was closed manually for a loss of $${Math.abs(tradeData.pnl).toFixed(2)} before hitting SL.`;
    } else {
      return `Trade was closed at breakeven.`;
    }
  }

  /**
   * Check if trade hit take profit
   */
  private didHitTargetProfit(tradeData: TradeData): boolean {
    const priceDiff = Math.abs(tradeData.exitPrice - tradeData.takeProfit);
    const threshold = Math.abs(tradeData.takeProfit - tradeData.entryPrice) * 0.02; // Within 2%
    return priceDiff <= threshold;
  }

  /**
   * Check if trade hit stop loss
   */
  private didHitStopLoss(tradeData: TradeData): boolean {
    const priceDiff = Math.abs(tradeData.exitPrice - tradeData.stopLoss);
    const threshold = Math.abs(tradeData.stopLoss - tradeData.entryPrice) * 0.02; // Within 2%
    return priceDiff <= threshold;
  }

  /**
   * Generate natural language lesson learned
   */
  private generateLessonLearned(
    tradeData: TradeData,
    journalEntry: any,
    wasPredictionCorrect: boolean
  ): string {
    if (wasPredictionCorrect && tradeData.pnl > 0) {
      return `My market analysis was accurate. The ${journalEntry.pattern_identified || 'setup'} pattern played out as expected, validating my ${journalEntry.conviction_level}% conviction. I should continue trusting similar setups with this confidence level.`;
    } else if (wasPredictionCorrect && tradeData.pnl < 0) {
      return `My market read was correct, but the pattern didn't follow through. This suggests that while my analysis was sound, external factors (news, liquidity, or market regime shift) overrode the technical setup. I need to be more cautious even with high conviction.`;
    } else if (!wasPredictionCorrect && tradeData.pnl > 0) {
      return `I was wrong about the direction but still made a profit. This was likely due to quick adaptation or luck. I shouldn't rely on this - my initial analysis needs improvement for ${journalEntry.pattern_identified || 'this type of setup'}.`;
    } else {
      return `My prediction was incorrect and the trade lost. The ${journalEntry.pattern_identified || 'pattern'} didn't work as expected. I need to re-evaluate my understanding of this setup, possibly adjusting my confidence threshold or avoiding similar conditions.`;
    }
  }

  /**
   * Identify what mistake was made (for losses)
   */
  private identifyMistake(tradeData: TradeData, journalEntry: any): string {
    if (tradeData.pnl >= 0) return '';

    const mistakes = [];

    // Overconfidence
    if (journalEntry.conviction_level > 85 && tradeData.pnl < 0) {
      mistakes.push('I was overconfident with ' + journalEntry.conviction_level + '% conviction on a losing trade');
    }

    // Pattern misread
    if (journalEntry.pattern_identified) {
      mistakes.push(`The ${journalEntry.pattern_identified} pattern didn't validate before entry`);
    }

    // Market regime mismatch
    if (journalEntry.market_read && journalEntry.market_read.includes('volatile')) {
      mistakes.push('I traded in high volatility without proper risk adjustment');
    }

    return mistakes.length > 0 ? mistakes.join('. ') : 'Trade setup did not materialize as expected';
  }

  /**
   * Identify what worked well (for wins)
   */
  private identifyWhatWorked(tradeData: TradeData, journalEntry: any): string {
    if (tradeData.pnl <= 0) return '';

    const successes = [];

    // Pattern recognition
    if (journalEntry.pattern_identified) {
      successes.push(`The ${journalEntry.pattern_identified} pattern was correctly identified and executed`);
    }

    // Confidence calibration
    if (journalEntry.conviction_level >= 80) {
      successes.push('High conviction (' + journalEntry.conviction_level + '%) was justified');
    }

    // Market read
    if (journalEntry.market_read) {
      successes.push('Market analysis was accurate');
    }

    return successes.length > 0 ? successes.join('. ') : 'Trade execution was sound';
  }

  /**
   * Log accuracy data for calibration tracking
   */
  private async logAccuracyTracking(
    tradeData: TradeData,
    journalEntry: any,
    predictionCorrect: boolean
  ): Promise<void> {
    try {
      const predictedOutcome = journalEntry.expected_outcome?.toLowerCase().includes('profit') ? 'tp_hit' : 'sl_hit';
      const actualOutcome = tradeData.pnl > 0 ? 'tp_hit' : tradeData.pnl < 0 ? 'sl_hit' : 'breakeven';

      await supabase.from('trade_accuracy_tracking').insert({
        user_id: tradeData.userId,
        trade_id: tradeData.id,
        journal_entry_id: journalEntry.id,
        predicted_outcome: predictedOutcome,
        actual_outcome: actualOutcome,
        prediction_correct: predictionCorrect,
        llm_confidence: journalEntry.conviction_level,
        pattern_name: journalEntry.pattern_identified,
        pattern_worked: predictionCorrect,
        trade_date: tradeData.exitTime.toISOString()
      });
    } catch (error) {
      console.error('[Post-Trade Analyzer] Error logging accuracy:', error);
    }
  }

  /**
   * Populate AI learning tables for platform intelligence
   */
  private async populateAILearningTables(
    tradeData: TradeData,
    journalEntry: any,
    outcome: 'win' | 'loss' | 'breakeven',
    predictionCorrect: boolean
  ): Promise<void> {
    try {
      logger.info('[Post-Trade Analyzer] Populating AI learning tables');

      // Write to ai_trade_analysis
      await this.writeAITradeAnalysis(tradeData, journalEntry, outcome);

      // Update alpha_meta_insights
      if (journalEntry.pattern_identified) {
        await this.updateAlphaMetaInsights(tradeData, journalEntry, outcome);
      }

      // Update alpha_confidence_calibration
      if (journalEntry.conviction_level) {
        await this.updateAlphaConfidenceCalibration(
          tradeData.userId,
          journalEntry.conviction_level,
          predictionCorrect,
          outcome
        );
      }

      // Log execution quality
      await this.logExecutionQuality(tradeData, journalEntry);

      logger.info('[Post-Trade Analyzer] ✅ AI learning tables updated');
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error populating AI learning tables:', error);
    }
  }

  /**
   * Write comprehensive analysis to ai_trade_analysis table
   */
  private async writeAITradeAnalysis(
    tradeData: TradeData,
    journalEntry: any,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const riskReward = this.calculateRiskReward(tradeData);
      const durationMinutes = this.calculateTradeDuration(tradeData);

      await supabase.from('ai_trade_analysis').insert({
        user_id: tradeData.userId,
        live_trade_id: tradeData.id,
        symbol: tradeData.symbol,
        direction: tradeData.direction,
        entry_time: tradeData.entryTime.toISOString(),
        exit_time: tradeData.exitTime.toISOString(),
        entry_price: tradeData.entryPrice,
        exit_price: tradeData.exitPrice,
        stop_loss: tradeData.stopLoss,
        take_profit: tradeData.takeProfit,
        entry_confidence: journalEntry.conviction_level || 0,
        outcome: outcome,
        pnl: tradeData.pnl,
        risk_reward_at_entry: riskReward,
        duration_minutes: durationMinutes,
        close_reason: this.determineCloseReason(tradeData),
        ai_reasoning: journalEntry.llm_reasoning,
        entry_indicators_alignment: {
          setup: journalEntry.pattern_identified || 'unknown',
          market_read: journalEntry.market_read
        },
        contributed_to_global_learning: true
      });
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error writing ai_trade_analysis:', error);
    }
  }

  /**
   * Update alpha meta-insights for pattern learning
   */
  private async updateAlphaMetaInsights(
    tradeData: TradeData,
    journalEntry: any,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const pattern = journalEntry.pattern_identified;
      const winRate = outcome === 'win' ? 100 : 0;

      // Check if insight exists
      const { data: existing } = await supabase
        .from('alpha_meta_insights')
        .select('*')
        .eq('user_id', tradeData.userId)
        .eq('symbol', tradeData.symbol)
        .eq('insight_description', `${pattern} on ${tradeData.symbol}`)
        .maybeSingle();

      if (existing) {
        // Update existing
        const sampleSize = (existing.supporting_evidence?.sample_size || 0) + 1;
        const newWinRate = ((existing.improvement_seen || 0) * (sampleSize - 1) + winRate) / sampleSize;

        await supabase
          .from('alpha_meta_insights')
          .update({
            improvement_seen: newWinRate,
            confidence_in_insight: Math.min(95, 50 + (sampleSize * 2)),
            supporting_evidence: {
              sample_size: sampleSize,
              last_updated: new Date().toISOString()
            },
            validated: sampleSize >= 10,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Create new
        const insightType = outcome === 'win' ? 'strength' : outcome === 'loss' ? 'weakness' : 'neutral';

        await supabase.from('alpha_meta_insights').insert({
          user_id: tradeData.userId,
          symbol: tradeData.symbol,
          insight_type: insightType,
          insight_description: `${pattern} on ${tradeData.symbol}`,
          improvement_seen: winRate,
          confidence_in_insight: 50,
          supporting_evidence: {
            sample_size: 1,
            last_updated: new Date().toISOString()
          },
          validated: false
        });
      }
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error updating alpha_meta_insights:', error);
    }
  }

  /**
   * Update alpha confidence calibration buckets
   */
  private async updateAlphaConfidenceCalibration(
    userId: string,
    confidence: number,
    predictionCorrect: boolean,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const bucket = this.getConfidenceBucket(confidence);
      const actualWinRate = outcome === 'win' ? 100 : 0;

      const { data: existing } = await supabase
        .from('alpha_confidence_calibration')
        .select('*')
        .eq('user_id', userId)
        .eq('confidence_bucket', bucket)
        .maybeSingle();

      if (existing) {
        const newSampleSize = existing.sample_size + 1;
        const newActualWR = ((existing.actual_win_rate * existing.sample_size) + actualWinRate) / newSampleSize;
        const calibrationError = Math.abs(confidence - newActualWR);

        await supabase
          .from('alpha_confidence_calibration')
          .update({
            sample_size: newSampleSize,
            actual_win_rate: newActualWR,
            predicted_win_rate: confidence,
            calibration_error: calibrationError,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        const calibrationError = Math.abs(confidence - actualWinRate);

        await supabase.from('alpha_confidence_calibration').insert({
          user_id: userId,
          confidence_bucket: bucket,
          sample_size: 1,
          actual_win_rate: actualWinRate,
          predicted_win_rate: confidence,
          calibration_error: calibrationError
        });
      }
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error updating alpha_confidence_calibration:', error);
    }
  }

  /**
   * Log execution quality metrics
   */
  private async logExecutionQuality(tradeData: TradeData, journalEntry: any): Promise<void> {
    try {
      // Detect SL hunting
      const slHunting = this.didHitStopLoss(tradeData) && tradeData.pnl < 0;

      await supabase.from('execution_quality_log').insert({
        user_id: tradeData.userId,
        symbol: tradeData.symbol,
        trade_id: tradeData.id,
        entry_time: tradeData.entryTime.toISOString(),
        slippage_pips: 0, // Would need real-time tracking
        sl_hunting_suspected: slHunting,
        spread_at_entry: 0,
        spread_at_exit: 0,
        rejection_occurred: false,
        session: this.determineSession(tradeData.entryTime)
      });
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error logging execution quality:', error);
    }
  }

  /**
   * Calculate risk-reward ratio
   */
  private calculateRiskReward(tradeData: TradeData): number {
    const risk = Math.abs(tradeData.entryPrice - tradeData.stopLoss);
    const reward = Math.abs(tradeData.takeProfit - tradeData.entryPrice);
    return risk > 0 ? reward / risk : 0;
  }

  /**
   * Calculate trade duration in minutes
   */
  private calculateTradeDuration(tradeData: TradeData): number {
    const entryTime = tradeData.entryTime.getTime();
    const exitTime = tradeData.exitTime.getTime();
    return Math.round((exitTime - entryTime) / 60000);
  }

  /**
   * Determine close reason
   */
  private determineCloseReason(tradeData: TradeData): string {
    if (this.didHitTargetProfit(tradeData)) return 'tp_hit';
    if (this.didHitStopLoss(tradeData)) return 'sl_hit';
    return 'manual_close';
  }

  /**
   * Get confidence bucket
   */
  private getConfidenceBucket(confidence: number): number {
    if (confidence >= 95) return 95;
    if (confidence >= 90) return 90;
    if (confidence >= 85) return 85;
    if (confidence >= 80) return 80;
    if (confidence >= 75) return 75;
    return 70;
  }

  /**
   * Determine trading session
   */
  private determineSession(date: Date): string {
    const hour = date.getUTCHours();
    if (hour >= 0 && hour < 8) return 'Tokyo';
    if (hour >= 8 && hour < 16) return 'London';
    if (hour >= 16 && hour < 24) return 'NewYork';
    return 'Unknown';
  }
}

export const postTradeAnalyzer = new PostTradeAnalyzer();
