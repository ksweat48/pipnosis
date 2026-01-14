/**
 * TRADE FORENSICS LOGGER
 * SSOT for post-trade analysis and learning data capture
 *
 * Captures entry quality, thesis validation, and outcome classification
 * after trades close for continuous AI learning and improvement.
 *
 * AUTHORITY: Only this service writes to trade_forensics table
 * TRIGGER: Called after trade closes (from trade-lifecycle-manager)
 * NON-BLOCKING: Failures do not affect trading
 */

import { supabase } from '../lib/supabase';
import { productionLogger as logger } from '../lib/production-logger';
import type { ThesisType, StyleIntent, ExecutionPreference } from '../types/thesis';

interface TradeForensicsInput {
  trade_id: string;
  user_id: string;
  session_id?: string;

  thesis: ThesisType;
  style_intent: StyleIntent;
  execution_preference: ExecutionPreference;

  eqs_at_entry: number;
  alpha_confidence: number;
  requirements_met: Record<string, any>;
  requirements_missed: Record<string, any>;
  critical_gaps: string[];

  entry_price: number;
  entry_slippage_pips?: number;
  time_to_fill_seconds?: number;

  outcome: 'win' | 'loss' | 'breakeven';
  pnl_usd: number;
  pnl_percent: number;
  duration_minutes: number;
  mfe_pips?: number;
  mae_pips?: number;
  mfe_reached_at?: string;
  mae_reached_at?: string;
}

export class TradeForensicsLogger {
  /**
   * SSOT: Log trade forensics after trade closes
   * Non-blocking - failures logged but do not throw
   */
  async logTradeForensics(input: TradeForensicsInput): Promise<void> {
    try {
      const classification = this.classifyOutcome(input);
      const thesisValidated = this.validateThesis(input);
      const entryQualityValidated = this.validateEntryQuality(input);
      const confidenceCalibrated = this.calibrateConfidence(input);
      const lessonsLearned = this.generateLessons(input, classification);

      const { error } = await supabase
        .from('trade_forensics')
        .insert({
          trade_id: input.trade_id,
          user_id: input.user_id,
          session_id: input.session_id,

          thesis: input.thesis,
          style_intent: input.style_intent,
          execution_preference: input.execution_preference,

          eqs_at_entry: input.eqs_at_entry,
          alpha_confidence: input.alpha_confidence,
          requirements_met: input.requirements_met,
          requirements_missed: input.requirements_missed,
          critical_gaps: input.critical_gaps,

          entry_price: input.entry_price,
          entry_slippage_pips: input.entry_slippage_pips,
          time_to_fill_seconds: input.time_to_fill_seconds,

          outcome: input.outcome,
          pnl_usd: input.pnl_usd,
          pnl_percent: input.pnl_percent,
          duration_minutes: input.duration_minutes,
          mfe_pips: input.mfe_pips,
          mae_pips: input.mae_pips,
          mfe_reached_at: input.mfe_reached_at,
          mae_reached_at: input.mae_reached_at,

          classification: classification.type,
          classification_reason: classification.reason,

          thesis_validated: thesisValidated,
          entry_quality_validated: entryQualityValidated,
          alpha_confidence_calibrated: confidenceCalibrated,
          lessons_learned: lessonsLearned,
        });

      if (error) {
        logger.error('Trade forensics logging failed (non-blocking)', {
          trade_id: input.trade_id,
          error: error.message,
        });
      } else {
        logger.info('Trade forensics logged successfully', {
          trade_id: input.trade_id,
          thesis: input.thesis,
          classification: classification.type,
        });
      }
    } catch (error: any) {
      logger.error('Trade forensics logging exception (non-blocking)', {
        trade_id: input.trade_id,
        error: error.message,
      });
    }
  }

  /**
   * Classify trade outcome for learning purposes
   */
  private classifyOutcome(input: TradeForensicsInput): { type: string; reason: string } {
    if (input.outcome === 'loss') {
      if (this.isGoodLoss(input)) {
        return {
          type: 'good_loss',
          reason: 'Valid thesis and entry quality, market went against us within normal variance'
        };
      }

      if (this.isLogicFailure(input)) {
        return {
          type: 'logic_failure',
          reason: 'Thesis invalidated or critical gaps ignored'
        };
      }

      return {
        type: 'execution_error',
        reason: 'Poor entry timing or slippage exceeded acceptable levels'
      };
    }

    if (input.outcome === 'win') {
      if (this.isGoodWin(input)) {
        return {
          type: 'good_win',
          reason: 'Thesis validated, entry quality high, edge captured'
        };
      }

      return {
        type: 'lucky_win',
        reason: 'Won despite poor entry quality or thesis gaps'
      };
    }

    return {
      type: 'good_loss',
      reason: 'Breakeven - no significant edge captured'
    };
  }

  private isGoodLoss(input: TradeForensicsInput): boolean {
    const hasReasonableEQS = input.eqs_at_entry >= 40;
    const hasReasonableConfidence = input.alpha_confidence >= 60;
    const noCriticalGaps = input.critical_gaps.length === 0 ||
                           input.critical_gaps.length === 1;
    const maeAcceptable = input.mae_pips ? Math.abs(input.mae_pips) < 30 : true;

    return hasReasonableEQS && hasReasonableConfidence && noCriticalGaps && maeAcceptable;
  }

  private isLogicFailure(input: TradeForensicsInput): boolean {
    const poorEQS = input.eqs_at_entry < 30;
    const manyCriticalGaps = input.critical_gaps.length >= 3;
    const lowConfidence = input.alpha_confidence < 50;

    const specialThesisViolations =
      (input.thesis === 'liquidity_sweep_reversal' &&
       input.critical_gaps.some(g => g.includes('BOS') || g.includes('acceptance'))) ||
      (input.thesis === 'momentum_scalp' &&
       input.critical_gaps.some(g => g.includes('Momentum')));

    return poorEQS || manyCriticalGaps || (lowConfidence && specialThesisViolations);
  }

  private isGoodWin(input: TradeForensicsInput): boolean {
    const goodEQS = input.eqs_at_entry >= 50;
    const goodConfidence = input.alpha_confidence >= 65;
    const fewGaps = input.critical_gaps.length <= 1;

    const goodMFE = input.mfe_pips ? input.mfe_pips > 10 : true;

    return (goodEQS && goodConfidence) || (fewGaps && goodMFE);
  }

  /**
   * Validate if thesis played out as expected
   */
  private validateThesis(input: TradeForensicsInput): boolean {
    if (input.outcome === 'loss') {
      return false;
    }

    switch (input.thesis) {
      case 'momentum_scalp':
        return input.duration_minutes <= 120 && (input.mfe_pips || 0) > 5;

      case 'liquidity_sweep_reversal':
        return !input.critical_gaps.some(g => g.includes('BOS') || g.includes('acceptance'));

      case 'trend_pullback':
        return input.eqs_at_entry >= 50;

      case 'mean_reversion':
        return (input.mae_pips || 0) < 20;

      default:
        return input.outcome === 'win';
    }
  }

  /**
   * Validate if entry quality prediction was accurate
   */
  private validateEntryQuality(input: TradeForensicsInput): boolean {
    const highEQS = input.eqs_at_entry >= 70;
    const mediumEQS = input.eqs_at_entry >= 50;
    const lowEQS = input.eqs_at_entry < 40;

    if (highEQS && input.outcome === 'win') return true;
    if (lowEQS && input.outcome === 'loss') return true;
    if (mediumEQS) return true;

    return false;
  }

  /**
   * Check if Alpha's confidence matched outcome
   */
  private calibrateConfidence(input: TradeForensicsInput): boolean {
    const highConfidence = input.alpha_confidence >= 80;
    const lowConfidence = input.alpha_confidence < 60;

    if (highConfidence && input.outcome === 'win') return true;
    if (lowConfidence && input.outcome === 'loss') return true;
    if (input.alpha_confidence >= 60 && input.alpha_confidence < 80) return true;

    return false;
  }

  /**
   * Generate lessons learned for future trades
   */
  private generateLessons(
    input: TradeForensicsInput,
    classification: { type: string; reason: string }
  ): string[] {
    const lessons: string[] = [];

    if (classification.type === 'logic_failure') {
      lessons.push('Do not ignore critical gaps in thesis requirements');

      if (input.thesis === 'liquidity_sweep_reversal') {
        lessons.push('Wait for BOS confirmation and acceptance candles on sweep reversals');
      }

      if (input.eqs_at_entry < 30) {
        lessons.push('Avoid entries with EQS below 30 unless extreme high confidence');
      }
    }

    if (classification.type === 'execution_error') {
      if (input.entry_slippage_pips && input.entry_slippage_pips > 5) {
        lessons.push('Reduce slippage by waiting for better zone entry');
      }

      if (input.time_to_fill_seconds && input.time_to_fill_seconds > 300) {
        lessons.push('Consider abandoning setups that take >5 minutes to trigger');
      }
    }

    if (classification.type === 'lucky_win') {
      lessons.push('Do not repeat this entry - won despite poor quality');
    }

    if (input.thesis === 'momentum_scalp' && input.duration_minutes > 180) {
      lessons.push('Momentum scalps should not extend beyond 3 hours');
    }

    if (input.critical_gaps.length >= 3 && input.outcome === 'loss') {
      lessons.push(`Thesis ${input.thesis} requires more confirmation when ${input.critical_gaps.length} gaps present`);
    }

    return lessons;
  }

  /**
   * Get thesis performance for user (analytics)
   */
  async getThesisPerformance(userId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .rpc('get_thesis_performance', { p_user_id: userId });

      if (error) throw error;
      return data;
    } catch (error: any) {
      logger.error('Failed to get thesis performance', {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get EQS calibration data (analytics)
   */
  async getEQSCalibration(userId: string, thesis?: ThesisType): Promise<any> {
    try {
      const { data, error } = await supabase
        .rpc('get_eqs_calibration', {
          p_user_id: userId,
          p_thesis: thesis || null,
        });

      if (error) throw error;
      return data;
    } catch (error: any) {
      logger.error('Failed to get EQS calibration', {
        userId,
        error: error.message,
      });
      return [];
    }
  }
}

export const tradeForensicsLogger = new TradeForensicsLogger();
