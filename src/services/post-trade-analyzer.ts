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
 */

import { supabase } from '../lib/supabase';
import { llmReasoningLogger, PostTradeAnalysis } from './llm-reasoning-logger';

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
      const journalEntry = await this.getJournalEntry(tradeData.id);

      if (!journalEntry) {
        console.warn(`[Post-Trade Analyzer] No journal entry found for trade ${tradeData.id}`);
        return;
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
}

export const postTradeAnalyzer = new PostTradeAnalyzer();
