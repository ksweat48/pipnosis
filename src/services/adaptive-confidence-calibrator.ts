import { supabase } from '../lib/supabase';
import { tradeSequenceAnalyzer } from './trade-sequence-analyzer';

/**
 * Adaptive Confidence Calibrator
 *
 * Dynamic confidence scoring that adjusts based on:
 * - Recent performance (last 20 trades)
 * - Current win/loss streak
 * - Session context (time of day, day of week)
 * - Market regime alignment
 * - Volatility conditions
 * - Correlation exposure
 *
 * Formula: Adjusted Confidence = Base Confidence × Session Modifier × Performance Modifier × Regime Modifier
 */

export interface ConfidenceCalibration {
  baseConfidence: number; // Pattern confidence (0-100)
  adjustedConfidence: number; // Final confidence (0-100)
  confidenceAdjustmentPercent: number; // How much was adjusted

  // Base Factors
  patternConfidence: number;
  regimeConfidence: number;
  timingConfidence: number;
  volatilityConfidence: number;

  // Contextual Modifiers
  sessionModifier: number; // 0.5 - 1.5
  dayOfWeekModifier: number; // 0.8 - 1.2
  correlationModifier: number; // 0.7 - 1.0
  recentPerformanceModifier: number; // 0.5 - 1.5

  // Recent Performance Context
  last20WinRate: number;
  last20ProfitFactor: number;
  consecutiveWins: number;
  consecutiveLosses: number;

  // Recommendations
  positionSizeMultiplier: number; // 0.25 - 1.5
  shouldTrade: boolean;
  skipReason?: string;
}

class AdaptiveConfidenceCalibrator {
  /**
   * Calculate calibrated confidence for a trade setup
   */
  async calibrateConfidence(
    userId: string,
    symbol: string,
    baseConfidence: number,
    context: {
      patternName?: string;
      regime?: string;
      volatility?: string;
      session?: string;
      hourOfDay?: number;
      dayOfWeek?: number;
      correlationRisk?: number;
    }
  ): Promise<ConfidenceCalibration> {
    console.log(`[Confidence Calibrator] Calibrating confidence for ${symbol}...`);

    // Get recent performance
    const recentPerformance = await this.getRecentPerformance(userId, 20);

    // Get current sequence
    const sequence = await tradeSequenceAnalyzer.analyzeCurrentSequence(userId);

    // Calculate base factors
    const patternConfidence = baseConfidence;
    const regimeConfidence = this.calculateRegimeConfidence(context.regime, context.patternName);
    const timingConfidence = this.calculateTimingConfidence(context.session, context.hourOfDay);
    const volatilityConfidence = this.calculateVolatilityConfidence(context.volatility);

    // Calculate contextual modifiers
    const sessionModifier = this.getSessionModifier(context.session, context.hourOfDay);
    const dayOfWeekModifier = this.getDayOfWeekModifier(context.dayOfWeek);
    const correlationModifier = this.getCorrelationModifier(context.correlationRisk);
    const recentPerformanceModifier = this.getPerformanceModifier(
      recentPerformance.winRate,
      recentPerformance.profitFactor,
      sequence.currentStreak
    );

    // Calculate adjusted confidence
    const baseScore = (patternConfidence + regimeConfidence + timingConfidence + volatilityConfidence) / 4;
    const adjustedConfidence = Math.min(100, Math.max(0,
      baseScore * sessionModifier * dayOfWeekModifier * correlationModifier * recentPerformanceModifier
    ));

    const confidenceAdjustment = ((adjustedConfidence - baseConfidence) / baseConfidence) * 100;

    // Determine position sizing
    const positionSizeMultiplier = this.calculatePositionSizeMultiplier(
      adjustedConfidence,
      recentPerformance,
      sequence.currentStreak
    );

    // Determine if should trade
    const { shouldTrade, skipReason } = this.shouldTrade(
      adjustedConfidence,
      recentPerformance,
      sequence.currentStreak
    );

    const calibration: ConfidenceCalibration = {
      baseConfidence,
      adjustedConfidence,
      confidenceAdjustmentPercent: confidenceAdjustment,
      patternConfidence,
      regimeConfidence,
      timingConfidence,
      volatilityConfidence,
      sessionModifier,
      dayOfWeekModifier,
      correlationModifier,
      recentPerformanceModifier,
      last20WinRate: recentPerformance.winRate,
      last20ProfitFactor: recentPerformance.profitFactor,
      consecutiveWins: sequence.currentStreak?.sequenceType === 'win_streak'
        ? sequence.currentStreak.sequenceLength : 0,
      consecutiveLosses: sequence.currentStreak?.sequenceType === 'loss_streak'
        ? sequence.currentStreak.sequenceLength : 0,
      positionSizeMultiplier,
      shouldTrade,
      skipReason
    };

    // Save to database
    await this.saveCalibration(userId, calibration);

    console.log(`[Confidence Calibrator] Base: ${baseConfidence} → Adjusted: ${adjustedConfidence.toFixed(1)} (${confidenceAdjustment > 0 ? '+' : ''}${confidenceAdjustment.toFixed(1)}%)`);

    return calibration;
  }

  /**
   * Get confidence recommendation string
   */
  getRecommendation(calibration: ConfidenceCalibration): string {
    if (!calibration.shouldTrade) {
      return `🛑 SKIP TRADE: ${calibration.skipReason}`;
    }

    if (calibration.adjustedConfidence >= 85) {
      return `🚀 EXCELLENT SETUP: ${calibration.adjustedConfidence.toFixed(0)}% confidence. Position size: ${calibration.positionSizeMultiplier.toFixed(2)}x`;
    }

    if (calibration.adjustedConfidence >= 70) {
      return `✅ GOOD SETUP: ${calibration.adjustedConfidence.toFixed(0)}% confidence. Position size: ${calibration.positionSizeMultiplier.toFixed(2)}x`;
    }

    if (calibration.adjustedConfidence >= 60) {
      return `⚡ ACCEPTABLE: ${calibration.adjustedConfidence.toFixed(0)}% confidence. Reduce size to ${calibration.positionSizeMultiplier.toFixed(2)}x`;
    }

    return `⚠️ LOW CONFIDENCE: ${calibration.adjustedConfidence.toFixed(0)}%. Consider skipping.`;
  }

  /**
   * Get recent performance (last N trades)
   */
  private async getRecentPerformance(userId: string, count: number): Promise<{
    winRate: number;
    profitFactor: number;
    sampleSize: number;
  }> {
    const { data, error } = await supabase
      .from('ai_trade_analysis')
      .select('outcome, pnl')
      .eq('user_id', userId)
      .in('outcome', ['win', 'loss'])
      .order('entry_time', { ascending: false })
      .limit(count);

    if (error || !data || data.length === 0) {
      return { winRate: 50, profitFactor: 1, sampleSize: 0 };
    }

    const wins = data.filter(t => t.outcome === 'win');
    const losses = data.filter(t => t.outcome === 'loss');

    const winRate = (wins.length / data.length) * 100;

    const totalWins = wins.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 1;

    return { winRate, profitFactor, sampleSize: data.length };
  }

  /**
   * Calculate regime confidence
   */
  private calculateRegimeConfidence(regime?: string, patternName?: string): number {
    if (!regime || !patternName) return 70;

    // Trend patterns need trending regime
    if (patternName.toLowerCase().includes('breakout') || patternName.toLowerCase().includes('momentum')) {
      if (regime.includes('trending')) return 90;
      if (regime === 'ranging') return 40;
    }

    // Range patterns need ranging regime
    if (patternName.toLowerCase().includes('range') || patternName.toLowerCase().includes('reversal')) {
      if (regime === 'ranging') return 90;
      if (regime.includes('trending')) return 50;
    }

    return 70;
  }

  /**
   * Calculate timing confidence
   */
  private calculateTimingConfidence(session?: string, hourOfDay?: number): number {
    if (!session) return 70;

    // London/NY overlap is best (13:00-16:00 UTC)
    if (session === 'overlap') return 95;

    // London session is excellent (07:00-16:00 UTC)
    if (session === 'london') return 85;

    // NY session is good (13:00-22:00 UTC)
    if (session === 'newyork') return 75;

    // Asian session is lower volatility (00:00-07:00 UTC)
    if (session === 'asian') return 55;

    return 70;
  }

  /**
   * Calculate volatility confidence
   */
  private calculateVolatilityConfidence(volatility?: string): number {
    if (!volatility) return 70;

    if (volatility === 'extreme') return 40; // Too volatile
    if (volatility === 'high') return 75; // Good for breakouts
    if (volatility === 'medium') return 85; // Ideal
    if (volatility === 'low') return 55; // Not much movement

    return 70;
  }

  /**
   * Get session modifier
   */
  private getSessionModifier(session?: string, hourOfDay?: number): number {
    if (!session) return 1.0;

    if (session === 'overlap') return 1.3; // 30% boost for overlap
    if (session === 'london') return 1.15; // 15% boost for London
    if (session === 'newyork') return 1.05; // 5% boost for NY
    if (session === 'asian') return 0.8; // 20% reduction for Asian

    return 1.0;
  }

  /**
   * Get day of week modifier
   */
  private getDayOfWeekModifier(dayOfWeek?: number): number {
    if (dayOfWeek === undefined) return 1.0;

    // Tuesday-Thursday are best (most movement, clear trends)
    if (dayOfWeek >= 2 && dayOfWeek <= 4) return 1.1; // 10% boost

    // Monday can be choppy (weekend gap reactions)
    if (dayOfWeek === 1) return 0.95; // 5% reduction

    // Friday can be volatile (week-end positioning)
    if (dayOfWeek === 5) return 0.9; // 10% reduction

    // Weekend
    if (dayOfWeek === 0 || dayOfWeek === 6) return 0.7; // 30% reduction

    return 1.0;
  }

  /**
   * Get correlation modifier
   */
  private getCorrelationModifier(correlationRisk?: number): number {
    if (correlationRisk === undefined) return 1.0;

    // High correlation risk = reduce confidence
    if (correlationRisk > 80) return 0.7; // 30% reduction
    if (correlationRisk > 60) return 0.85; // 15% reduction
    if (correlationRisk > 40) return 0.95; // 5% reduction

    return 1.0;
  }

  /**
   * Get performance modifier based on recent results
   */
  private getPerformanceModifier(
    winRate: number,
    profitFactor: number,
    currentStreak: any
  ): number {
    let modifier = 1.0;

    // Recent win rate adjustment
    if (winRate >= 70) modifier *= 1.2; // Hot streak: 20% boost
    else if (winRate >= 60) modifier *= 1.1; // Good: 10% boost
    else if (winRate < 40) modifier *= 0.8; // Cold: 20% reduction
    else if (winRate < 30) modifier *= 0.6; // Very cold: 40% reduction

    // Profit factor adjustment
    if (profitFactor >= 2.0) modifier *= 1.1; // Excellent: 10% boost
    else if (profitFactor < 1.0) modifier *= 0.85; // Losing: 15% reduction

    // Current streak adjustment
    if (currentStreak) {
      if (currentStreak.sequenceType === 'win_streak') {
        if (currentStreak.sequenceLength >= 3) modifier *= 1.15; // 3+ wins: 15% boost
        else if (currentStreak.sequenceLength >= 2) modifier *= 1.1; // 2 wins: 10% boost
      } else if (currentStreak.sequenceType === 'loss_streak') {
        if (currentStreak.sequenceLength >= 5) modifier *= 0.5; // 5+ losses: 50% reduction
        else if (currentStreak.sequenceLength >= 3) modifier *= 0.7; // 3+ losses: 30% reduction
        else if (currentStreak.sequenceLength >= 2) modifier *= 0.85; // 2 losses: 15% reduction
      }
    }

    return modifier;
  }

  /**
   * Calculate position size multiplier
   */
  private calculatePositionSizeMultiplier(
    adjustedConfidence: number,
    recentPerformance: any,
    currentStreak: any
  ): number {
    let multiplier = 1.0;

    // Confidence-based sizing
    if (adjustedConfidence >= 85) multiplier = 1.5; // Excellent: 1.5x
    else if (adjustedConfidence >= 75) multiplier = 1.25; // Very good: 1.25x
    else if (adjustedConfidence >= 65) multiplier = 1.0; // Good: 1x
    else if (adjustedConfidence >= 55) multiplier = 0.75; // Acceptable: 0.75x
    else multiplier = 0.5; // Low: 0.5x

    // Loss streak override
    if (currentStreak?.sequenceType === 'loss_streak') {
      if (currentStreak.sequenceLength >= 5) return 0; // No trading after 5 losses
      if (currentStreak.sequenceLength >= 3) multiplier *= 0.5; // Half size after 3 losses
      if (currentStreak.sequenceLength >= 2) multiplier *= 0.75; // 75% size after 2 losses
    }

    // Win streak boost
    if (currentStreak?.sequenceType === 'win_streak' && currentStreak.sequenceLength >= 3) {
      multiplier *= 1.15; // 15% boost during win streak
    }

    return Math.min(1.5, Math.max(0, multiplier));
  }

  /**
   * Determine if should trade
   */
  private shouldTrade(
    adjustedConfidence: number,
    recentPerformance: any,
    currentStreak: any
  ): { shouldTrade: boolean; skipReason?: string } {
    // Block trading after 5+ consecutive losses
    if (currentStreak?.sequenceType === 'loss_streak' && currentStreak.sequenceLength >= 5) {
      return {
        shouldTrade: false,
        skipReason: `5+ consecutive losses. Take a break and reset.`
      };
    }

    // Block very low confidence trades
    if (adjustedConfidence < 50) {
      return {
        shouldTrade: false,
        skipReason: `Confidence too low (${adjustedConfidence.toFixed(0)}%). Minimum 50% required.`
      };
    }

    // Warn on cold streaks
    if (recentPerformance.winRate < 30 && recentPerformance.sampleSize >= 10) {
      return {
        shouldTrade: false,
        skipReason: `Recent performance too weak (${recentPerformance.winRate.toFixed(0)}% win rate). Review and adjust.`
      };
    }

    return { shouldTrade: true };
  }

  /**
   * Save calibration to database
   */
  private async saveCalibration(userId: string, calibration: ConfidenceCalibration): Promise<void> {
    const { error } = await supabase
      .from('confidence_calibration_history')
      .insert({
        user_id: userId,
        calibration_time: new Date().toISOString(),
        pattern_confidence: calibration.patternConfidence,
        regime_confidence: calibration.regimeConfidence,
        timing_confidence: calibration.timingConfidence,
        volatility_confidence: calibration.volatilityConfidence,
        session_modifier: calibration.sessionModifier,
        day_of_week_modifier: calibration.dayOfWeekModifier,
        correlation_modifier: calibration.correlationModifier,
        recent_performance_modifier: calibration.recentPerformanceModifier,
        last_20_win_rate: calibration.last20WinRate,
        last_20_profit_factor: calibration.last20ProfitFactor,
        consecutive_wins: calibration.consecutiveWins,
        consecutive_losses: calibration.consecutiveLosses,
        base_confidence: calibration.baseConfidence,
        adjusted_confidence: calibration.adjustedConfidence,
        confidence_adjustment_percent: calibration.confidenceAdjustmentPercent,
        position_size_multiplier: calibration.positionSizeMultiplier,
        should_trade: calibration.shouldTrade,
        skip_reason: calibration.skipReason
      });

    if (error) {
      console.error('[Confidence Calibrator] Error saving calibration:', error);
    }
  }
}

export const adaptiveConfidenceCalibrator = new AdaptiveConfidenceCalibrator();
