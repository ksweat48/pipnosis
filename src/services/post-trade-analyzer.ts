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
import { tpQualityTracker } from './tp-quality-tracker';
import { shouldIncludeInLearning, getExclusionReason } from '../utils/trade-learning-filter';
import { mapCloseReasonToAnalysis } from '../utils/close-reason-mapper';
import { CloseReason } from '../types/position';

interface TradeData {
  id: string;
  userId: string;
  symbol: string;
  direction?: 'buy' | 'sell';
  entryPrice?: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  pnl: number;
  entryTime?: Date;
  exitTime?: Date;
  journalEntryId?: string;
  expectedOutcome?: string;
  convictionLevel?: number;
  patternIdentified?: string;
  closeReason?: string;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
}

class PostTradeAnalyzer {
  /**
   * Analyze trade outcome when position closes
   *
   * IMPORTANT: System closures (weekend_protection, holiday_closure, etc.) are
   * excluded from learning as they are NOT Alpha's fault
   */
  async analyzeClosedTrade(tradeData: TradeData): Promise<void> {
    try {
      console.log(`[Post-Trade Analyzer] Analyzing trade ${tradeData.id} for ${tradeData.symbol}`);

      const outcome = this.determineOutcome(tradeData.pnl);

      // STEP 1: ALWAYS ensure journal entry exists (user-facing record of every trade)
      // Journal creation is DECOUPLED from learning eligibility per SSOT principles:
      // - Journal = authoritative record of ALL trades (user-facing)
      // - Learning = selective AI analysis (only for eligible trades)
      let journalEntry = await this.getJournalEntry(tradeData.id);

      if (!journalEntry) {
        console.log(`[Post-Trade Analyzer] No journal entry for trade ${tradeData.id} - creating`);
        journalEntry = await this.createRetroactiveJournalEntry(tradeData);

        if (!journalEntry) {
          console.error(`[Post-Trade Analyzer] Failed to create journal entry for trade ${tradeData.id}`);
          return;
        }

        console.log(`[Post-Trade Analyzer] Journal entry created for trade ${tradeData.id}`);
      }

      // STEP 2: Always update journal with closure data (outcome, pnl, exit info)
      await this.updateJournalWithClosureData(journalEntry, tradeData, outcome);

      // STEP 3: Check learning eligibility - only AI learning tables are gated
      const learningEligible = shouldIncludeInLearning(tradeData.closeReason, {
        tp1_hit: tradeData.tp1Hit,
        tp2_hit: tradeData.tp2Hit,
      });

      if (!learningEligible) {
        const exclusionReason = getExclusionReason(tradeData.closeReason, {
          tp1_hit: tradeData.tp1Hit,
          tp2_hit: tradeData.tp2Hit,
        });
        console.log(`[Post-Trade Analyzer] Skipping AI learning - ${exclusionReason} (journal entry preserved)`);
        return;
      }

      // STEP 4: Full analysis pipeline (only for learning-eligible trades)
      const fullTradeData = await this.enrichTradeData(tradeData);

      const { wasPredictionCorrect, accuracyScore, actualOutcome } = this.analyzePredictionAccuracy(
        fullTradeData,
        journalEntry.expected_outcome
      );

      const lessonLearned = this.generateLessonLearned(
        fullTradeData,
        journalEntry,
        wasPredictionCorrect
      );

      const mistakeIdentified = wasPredictionCorrect ? undefined : this.identifyMistake(fullTradeData, journalEntry);
      const whatWorked = wasPredictionCorrect ? this.identifyWhatWorked(fullTradeData, journalEntry) : undefined;

      if (fullTradeData.exitTime && fullTradeData.exitPrice) {
        const analysis: PostTradeAnalysis = {
          journalEntryId: journalEntry.id,
          exitTime: fullTradeData.exitTime,
          exitPrice: fullTradeData.exitPrice,
          pnl: fullTradeData.pnl,
          outcome,
          actualOutcome,
          wasPredictionCorrect,
          accuracyScore,
          lessonLearned,
          mistakeIdentified,
          whatWorked
        };

        await llmReasoningLogger.logPostTradeAnalysis(analysis);
      }

      await this.logAccuracyTracking(fullTradeData, journalEntry, wasPredictionCorrect);
      await this.populateAILearningTables(fullTradeData, journalEntry, outcome, wasPredictionCorrect);
      await this.trackTPOutcome(fullTradeData, outcome);

      console.log(`[Post-Trade Analyzer] Analysis complete for ${tradeData.symbol}`);
    } catch (error) {
      console.error('[Post-Trade Analyzer] Error analyzing trade:', error);
    }
  }

  private async updateJournalWithClosureData(
    journalEntry: any,
    tradeData: TradeData,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const updateData: Record<string, any> = {
        outcome,
        pnl: tradeData.pnl,
        updated_at: new Date().toISOString(),
      };

      if (tradeData.exitPrice) {
        updateData.exit_price = tradeData.exitPrice;
      }
      if (tradeData.exitTime) {
        updateData.exit_time = tradeData.exitTime.toISOString();
      }

      const closeReasonText = tradeData.closeReason || 'unknown';
      if (tradeData.pnl > 0) {
        updateData.actual_outcome = `Trade closed (${closeReasonText}) with profit of $${tradeData.pnl.toFixed(2)}`;
      } else if (tradeData.pnl < 0) {
        updateData.actual_outcome = `Trade closed (${closeReasonText}) with loss of $${Math.abs(tradeData.pnl).toFixed(2)}`;
      } else {
        updateData.actual_outcome = `Trade closed (${closeReasonText}) at breakeven`;
      }

      const { error } = await supabase
        .from('ai_trade_journal')
        .update(updateData)
        .eq('id', journalEntry.id);

      if (error) {
        console.error('[Post-Trade Analyzer] Failed to update journal closure data:', error);
      }
    } catch (error) {
      console.error('[Post-Trade Analyzer] Error updating journal closure data:', error);
    }
  }

  private async enrichTradeData(tradeData: TradeData): Promise<TradeData> {
    if (tradeData.direction && tradeData.entryPrice && tradeData.exitPrice && tradeData.stopLoss && tradeData.takeProfit) {
      return tradeData;
    }

    try {
      const { data: trade } = await supabase
        .from('goal_session_trades')
        .select('direction, entry_price, exit_price, stop_loss, take_profit, created_at, closed_at, tp1_hit, tp2_hit')
        .eq('id', tradeData.id)
        .maybeSingle();

      if (trade) {
        return {
          ...tradeData,
          direction: tradeData.direction || trade.direction,
          entryPrice: tradeData.entryPrice ?? trade.entry_price,
          exitPrice: tradeData.exitPrice ?? trade.exit_price,
          stopLoss: tradeData.stopLoss ?? trade.stop_loss,
          takeProfit: tradeData.takeProfit ?? trade.take_profit,
          entryTime: tradeData.entryTime || new Date(trade.created_at),
          exitTime: tradeData.exitTime || (trade.closed_at ? new Date(trade.closed_at) : new Date()),
          tp1Hit: tradeData.tp1Hit ?? trade.tp1_hit,
          tp2Hit: tradeData.tp2Hit ?? trade.tp2_hit,
        };
      }
    } catch (error) {
      console.error('[Post-Trade Analyzer] Failed to enrich trade data:', error);
    }

    return tradeData;
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
      const enriched = await this.enrichTradeData(tradeData);
      const dir = enriched.direction || 'buy';
      const entryPrice = enriched.entryPrice || 0;
      const stopLoss = enriched.stopLoss || 0;
      const takeProfit = enriched.takeProfit || 0;

      const insertData: Record<string, any> = {
        user_id: enriched.userId,
        trade_id: enriched.id,
        symbol: enriched.symbol,
        direction: dir,
        entry_time: enriched.entryTime ? enriched.entryTime.toISOString() : new Date().toISOString(),
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        llm_reasoning: `${dir.toUpperCase()} trade on ${enriched.symbol}. Close reason: ${enriched.closeReason || 'unknown'}.`,
        market_read: entryPrice > 0
          ? `Trade opened at ${entryPrice.toFixed(5)}.`
          : 'Entry conditions were not captured at open time.',
        expected_outcome: takeProfit > 0 && stopLoss > 0
          ? `Expected TP at ${takeProfit.toFixed(5)}, SL at ${stopLoss.toFixed(5)}.`
          : 'Target levels not recorded.',
        pattern_identified: enriched.patternIdentified || 'System Trade',
        conviction_level: enriched.convictionLevel || 70,
        rank_at_time: 'System',
        outcome: 'open',
        journal_entry_type: 'trade',
        pnl: enriched.pnl,
      };

      if (enriched.exitTime) insertData.exit_time = enriched.exitTime.toISOString();
      if (enriched.exitPrice) insertData.exit_price = enriched.exitPrice;

      const { data, error } = await supabase
        .from('ai_trade_journal')
        .upsert(insertData, { onConflict: 'trade_id' })
        .select()
        .single();

      if (error) {
        console.error('[Post-Trade Analyzer] Error creating retroactive journal:', error);
        return null;
      }

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
    if (!tradeData.exitPrice || !tradeData.takeProfit || !tradeData.entryPrice) return false;
    const priceDiff = Math.abs(tradeData.exitPrice - tradeData.takeProfit);
    const threshold = Math.abs(tradeData.takeProfit - tradeData.entryPrice) * 0.02;
    return priceDiff <= threshold;
  }

  private didHitStopLoss(tradeData: TradeData): boolean {
    if (!tradeData.exitPrice || !tradeData.stopLoss || !tradeData.entryPrice) return false;
    const priceDiff = Math.abs(tradeData.exitPrice - tradeData.stopLoss);
    const threshold = Math.abs(tradeData.stopLoss - tradeData.entryPrice) * 0.02;
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
        trade_date: tradeData.exitTime ? tradeData.exitTime.toISOString() : new Date().toISOString()
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
        direction: tradeData.direction || 'buy',
        outcome: outcome,
        pnl: tradeData.pnl,
        entry_time: tradeData.entryTime ? tradeData.entryTime.toISOString() : new Date().toISOString(),
        exit_time: tradeData.exitTime ? tradeData.exitTime.toISOString() : new Date().toISOString(),
        duration_minutes: durationMinutes,
        entry_confidence: journalEntry.conviction_level || 0,
        reasoning: journalEntry.llm_reasoning,  // Schema field: reasoning (not ai_reasoning)
        market_conditions: {  // Consolidate into schema field: market_conditions
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
        .ilike('insight_description', `%${pattern}%${tradeData.symbol}%`)
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
        entry_time: tradeData.entryTime ? tradeData.entryTime.toISOString() : new Date().toISOString(),
        slippage_pips: 0, // Would need real-time tracking
        sl_hunting_suspected: slHunting,
        spread_at_entry: 0,
        spread_at_exit: 0,
        rejection_occurred: false,
        session: this.determineSession(tradeData.entryTime || new Date())
      });
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error logging execution quality:', error);
    }
  }

  /**
   * Calculate risk-reward ratio
   */
  private calculateRiskReward(tradeData: TradeData): number {
    if (!tradeData.entryPrice || !tradeData.stopLoss || !tradeData.takeProfit) return 0;
    const risk = Math.abs(tradeData.entryPrice - tradeData.stopLoss);
    const reward = Math.abs(tradeData.takeProfit - tradeData.entryPrice);
    return risk > 0 ? reward / risk : 0;
  }

  private calculateTradeDuration(tradeData: TradeData): number {
    if (!tradeData.entryTime || !tradeData.exitTime) return 0;
    const entryTime = tradeData.entryTime.getTime();
    const exitTime = tradeData.exitTime.getTime();
    return Math.round((exitTime - entryTime) / 60000);
  }

  /**
   * Determine close reason
   * ✅ SSOT: Use centralized mapper for close reason conversion
   */
  private determineCloseReason(tradeData: TradeData): string {
    // Use provided close reason if available
    if (tradeData.closeReason) {
      // Map CloseReason type to analysis string using centralized mapper
      return mapCloseReasonToAnalysis(tradeData.closeReason as CloseReason);
    }

    // Fallback to price-based detection
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

  /**
   * Track TP outcome for Elite TP System learning
   */
  private async trackTPOutcome(
    tradeData: TradeData,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      if (!tradeData.entryPrice || !tradeData.exitPrice || !tradeData.stopLoss || !tradeData.takeProfit) {
        logger.debug('[Post-Trade Analyzer] Skipping TP tracking - missing price data');
        return;
      }

      let tpOutcome: 'hit' | 'stopped_out' | 'partial_hit' | 'manual_close' | 'timeout';
      let actualRR: number | undefined;

      const slDistance = Math.abs(tradeData.entryPrice - tradeData.stopLoss);
      const exitDistance = Math.abs(tradeData.exitPrice - tradeData.entryPrice);

      if (outcome === 'win') {
        const tpDistance = Math.abs(tradeData.takeProfit! - tradeData.entryPrice!);
        const hitRatio = exitDistance / tpDistance;

        if (hitRatio >= 0.95) {
          tpOutcome = 'hit';
        } else if (hitRatio >= 0.5) {
          tpOutcome = 'partial_hit';
        } else {
          tpOutcome = 'manual_close';
        }

        actualRR = exitDistance / slDistance;
      } else if (outcome === 'loss') {
        tpOutcome = 'stopped_out';
        actualRR = -(exitDistance / slDistance);
      } else {
        tpOutcome = 'manual_close';
        actualRR = 0;
      }

      const timeToFillMinutes = tradeData.exitTime && tradeData.entryTime
        ? Math.round((tradeData.exitTime.getTime() - tradeData.entryTime.getTime()) / (1000 * 60))
        : 0;

      await tpQualityTracker.updateTPOutcome(
        tradeData.id,
        tpOutcome,
        actualRR,
        timeToFillMinutes
      );

      logger.info('[Post-Trade Analyzer] TP outcome tracked', {
        tradeId: tradeData.id,
        tpOutcome,
        actualRR,
        timeToFillMinutes
      });
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Failed to track TP outcome', { error });
    }
  }
}

export const postTradeAnalyzer = new PostTradeAnalyzer();
