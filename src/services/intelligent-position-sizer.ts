import { supabase } from '../lib/supabase';
import { currencyCorrelationService } from './currency-correlation-service';

/**
 * Intelligent Position Sizer with Kelly Criterion
 *
 * Professional position sizing that considers:
 * - Kelly Criterion (optimal bet size based on edge)
 * - Fractional Kelly (conservative: 0.25-0.5)
 * - Pattern quality and win rate
 * - Current drawdown state
 * - Correlation exposure
 * - Win/loss streak adjustments
 * - Volatility-based sizing (ATR)
 *
 * Formula: Position Size = Kelly% × Fraction × Volatility Adjustment × Drawdown Adjustment × Streak Adjustment
 */

export interface PositionSizeRecommendation {
  symbol: string;
  patternName: string;
  calculatedAt: Date;

  // Pattern Statistics
  patternWinRate: number;
  patternAvgWin: number;
  patternAvgLoss: number;
  patternSampleSize: number;

  // Kelly Criterion
  kellyPercentage: number; // Optimal % of capital
  kellyFraction: number; // Conservative multiplier (0.25-0.5)
  recommendedRiskPercent: number; // Kelly × Fraction

  // Adjustments
  basePositionSize: number;
  volatilityAdjustment: number; // ATR-based
  correlationAdjustment: number; // Reduced for correlated positions
  drawdownAdjustment: number; // Reduced during drawdowns
  streakAdjustment: number; // Modified by win/loss streaks

  // Final Recommendation
  finalPositionSize: number;
  finalRiskPercent: number;
  maxPositionSize: number; // Account-based cap

  // Context
  currentAccountBalance: number;
  currentDrawdownPct: number;
  openPositionsCount: number;
  correlatedExposurePct: number;
  consecutiveWins: number;
  consecutiveLosses: number;

  // Reasoning
  sizeIncreaseReason?: string;
  sizeDecreaseReason?: string;
}

class IntelligentPositionSizer {
  private readonly MAX_RISK_PER_TRADE = 2.0; // 2% max per trade
  private readonly MAX_TOTAL_RISK = 6.0; // 6% max total exposure
  private readonly DEFAULT_KELLY_FRACTION = 0.25; // Quarter Kelly (conservative)

  /**
   * Calculate optimal position size using Kelly Criterion
   */
  async calculatePositionSize(
    userId: string,
    symbol: string,
    patternName: string,
    setupConfidence: number,
    currentPrice: number,
    stopLoss: number
  ): Promise<PositionSizeRecommendation> {
    console.log(`[Position Sizer] Calculating size for ${symbol} - ${patternName}...`);

    // Get pattern statistics
    const patternStats = await this.getPatternStatistics(userId, patternName, symbol);

    // Get account info
    const accountInfo = await this.getAccountInfo(userId);

    // Calculate Kelly percentage
    const kellyPercentage = this.calculateKellyPercentage(
      patternStats.winRate,
      patternStats.avgWin,
      patternStats.avgLoss
    );

    // Apply fractional Kelly
    const kellyFraction = this.determineKellyFraction(
      patternStats.sampleSize,
      setupConfidence
    );
    const recommendedRiskPercent = kellyPercentage * kellyFraction;

    // Calculate base position size
    const basePositionSize = this.calculateBasePositionSize(
      accountInfo.balance,
      recommendedRiskPercent,
      currentPrice,
      stopLoss
    );

    // Calculate adjustments
    const volatilityAdjustment = await this.calculateVolatilityAdjustment(symbol);
    const correlationAdjustment = await this.calculateCorrelationAdjustment(userId, symbol);
    const drawdownAdjustment = this.calculateDrawdownAdjustment(accountInfo.drawdownPct);
    const streakAdjustment = this.calculateStreakAdjustment(
      accountInfo.consecutiveWins,
      accountInfo.consecutiveLosses
    );

    // Calculate final position size
    let finalPositionSize = basePositionSize *
      volatilityAdjustment *
      correlationAdjustment *
      drawdownAdjustment *
      streakAdjustment;

    // Apply maximum limits
    const maxPositionSize = this.calculateMaxPositionSize(
      accountInfo.balance,
      currentPrice
    );
    finalPositionSize = Math.min(finalPositionSize, maxPositionSize);

    // Calculate final risk percent
    const finalRiskPercent = this.calculateRiskPercent(
      finalPositionSize,
      currentPrice,
      stopLoss,
      accountInfo.balance
    );

    // Determine reasoning
    const reasoning = this.determineReasoning(
      basePositionSize,
      finalPositionSize,
      volatilityAdjustment,
      correlationAdjustment,
      drawdownAdjustment,
      streakAdjustment
    );

    const recommendation: PositionSizeRecommendation = {
      symbol,
      patternName,
      calculatedAt: new Date(),
      patternWinRate: patternStats.winRate,
      patternAvgWin: patternStats.avgWin,
      patternAvgLoss: patternStats.avgLoss,
      patternSampleSize: patternStats.sampleSize,
      kellyPercentage,
      kellyFraction,
      recommendedRiskPercent,
      basePositionSize,
      volatilityAdjustment,
      correlationAdjustment,
      drawdownAdjustment,
      streakAdjustment,
      finalPositionSize,
      finalRiskPercent,
      maxPositionSize,
      currentAccountBalance: accountInfo.balance,
      currentDrawdownPct: accountInfo.drawdownPct,
      openPositionsCount: accountInfo.openPositions,
      correlatedExposurePct: accountInfo.correlatedExposure,
      consecutiveWins: accountInfo.consecutiveWins,
      consecutiveLosses: accountInfo.consecutiveLosses,
      sizeIncreaseReason: reasoning.increaseReason,
      sizeDecreaseReason: reasoning.decreaseReason
    };

    // Save to database
    await this.saveRecommendation(userId, recommendation);

    console.log(`[Position Sizer] Recommended: ${finalPositionSize.toFixed(2)} units (${finalRiskPercent.toFixed(2)}% risk)`);

    return recommendation;
  }

  /**
   * Calculate Kelly percentage (optimal bet size)
   * Formula: Kelly% = (W × B - L) / B
   * Where: W = win rate, B = avg win / avg loss, L = loss rate
   */
  private calculateKellyPercentage(
    winRate: number,
    avgWin: number,
    avgLoss: number
  ): number {
    if (avgLoss === 0 || avgWin === 0) return 0.01; // 1% default

    const W = winRate / 100; // Convert to decimal
    const L = 1 - W;
    const B = avgWin / avgLoss; // Reward-to-risk ratio

    const kelly = (W * B - L) / B;

    // Kelly can be negative if edge is negative (don't trade!)
    // Cap at 25% for safety
    return Math.max(0, Math.min(0.25, kelly));
  }

  /**
   * Determine Kelly fraction based on confidence and sample size
   */
  private determineKellyFraction(sampleSize: number, confidence: number): number {
    let fraction = this.DEFAULT_KELLY_FRACTION;

    // Reduce fraction for small sample sizes
    if (sampleSize < 30) fraction *= 0.5; // Half Kelly for < 30 trades
    else if (sampleSize < 50) fraction *= 0.75; // 3/4 Kelly for < 50 trades

    // Adjust based on confidence
    if (confidence >= 85) fraction *= 1.2; // 20% boost for high confidence
    else if (confidence < 60) fraction *= 0.8; // 20% reduction for low confidence

    return Math.max(0.1, Math.min(0.5, fraction));
  }

  /**
   * Calculate base position size
   */
  private calculateBasePositionSize(
    accountBalance: number,
    riskPercent: number,
    currentPrice: number,
    stopLoss: number
  ): number {
    const riskAmount = accountBalance * (riskPercent / 100);
    const stopDistance = Math.abs(currentPrice - stopLoss);

    if (stopDistance === 0) return 0;

    return riskAmount / stopDistance;
  }

  /**
   * Calculate volatility adjustment (ATR-based)
   */
  private async calculateVolatilityAdjustment(symbol: string): Promise<number> {
    // Fetch recent ATR
    const { data: candles } = await supabase
      .from('forex_candles')
      .select('high, low, close')
      .eq('symbol', symbol)
      .eq('timeframe', 'H1')
      .order('open_time', { ascending: false })
      .limit(20);

    if (!candles || candles.length < 14) return 1.0;

    // Calculate simple ATR
    const tr: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = parseFloat(candles[i].high.toString());
      const low = parseFloat(candles[i].low.toString());
      const prevClose = parseFloat(candles[i - 1].close.toString());

      tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }

    const atr = tr.slice(-14).reduce((sum, val) => sum + val, 0) / 14;
    const avgATR = tr.reduce((sum, val) => sum + val, 0) / tr.length;

    // Reduce size in high volatility, increase in low volatility
    const volatilityRatio = atr / avgATR;

    if (volatilityRatio > 1.5) return 0.7; // 30% reduction in extreme volatility
    if (volatilityRatio > 1.2) return 0.85; // 15% reduction in high volatility
    if (volatilityRatio < 0.8) return 1.1; // 10% increase in low volatility

    return 1.0;
  }

  /**
   * Calculate correlation adjustment
   */
  private async calculateCorrelationAdjustment(userId: string, symbol: string): Promise<number> {
    // Check open positions
    const { data: openTrades } = await supabase
      .from('ai_trade_analysis')
      .select('symbol, direction')
      .eq('user_id', userId)
      .is('exit_time', null);

    if (!openTrades || openTrades.length === 0) return 1.0;

    // Calculate correlation risk
    const positions = openTrades.map(t => ({
      symbol: t.symbol,
      direction: t.direction,
      size: 1
    }));

    positions.push({ symbol, direction: 'buy', size: 1 }); // Add proposed position

    const riskMultiplier = await currencyCorrelationService.calculatePortfolioRisk(positions);

    // High correlation = reduce position size
    if (riskMultiplier > 1.8) return 0.5; // 50% reduction for very high correlation
    if (riskMultiplier > 1.5) return 0.7; // 30% reduction
    if (riskMultiplier > 1.2) return 0.85; // 15% reduction

    return 1.0;
  }

  /**
   * Calculate drawdown adjustment
   */
  private calculateDrawdownAdjustment(drawdownPct: number): number {
    if (drawdownPct > 20) return 0.5; // 50% size at 20%+ drawdown
    if (drawdownPct > 15) return 0.65; // 35% reduction at 15%+ drawdown
    if (drawdownPct > 10) return 0.8; // 20% reduction at 10%+ drawdown
    if (drawdownPct > 5) return 0.9; // 10% reduction at 5%+ drawdown

    return 1.0;
  }

  /**
   * Calculate streak adjustment
   */
  private calculateStreakAdjustment(consecutiveWins: number, consecutiveLosses: number): number {
    // Increase size during win streaks
    if (consecutiveWins >= 5) return 1.3; // 30% increase
    if (consecutiveWins >= 3) return 1.2; // 20% increase
    if (consecutiveWins >= 2) return 1.1; // 10% increase

    // Decrease size during loss streaks
    if (consecutiveLosses >= 5) return 0; // No trading after 5 losses
    if (consecutiveLosses >= 4) return 0.4; // 60% reduction
    if (consecutiveLosses >= 3) return 0.6; // 40% reduction
    if (consecutiveLosses >= 2) return 0.8; // 20% reduction

    return 1.0;
  }

  /**
   * Calculate maximum position size
   */
  private calculateMaxPositionSize(accountBalance: number, currentPrice: number): number {
    // Never risk more than 2% per trade
    const maxRisk = accountBalance * (this.MAX_RISK_PER_TRADE / 100);

    // Assuming 1% stop loss
    const assumedStopPct = 0.01;
    const maxSize = maxRisk / (currentPrice * assumedStopPct);

    return maxSize;
  }

  /**
   * Calculate risk percentage
   */
  private calculateRiskPercent(
    positionSize: number,
    currentPrice: number,
    stopLoss: number,
    accountBalance: number
  ): number {
    const stopDistance = Math.abs(currentPrice - stopLoss);
    const riskAmount = positionSize * stopDistance;
    return (riskAmount / accountBalance) * 100;
  }

  /**
   * Get pattern statistics
   */
  private async getPatternStatistics(
    userId: string,
    patternName: string,
    symbol: string
  ): Promise<{ winRate: number; avgWin: number; avgLoss: number; sampleSize: number }> {
    const { data } = await supabase
      .from('ai_trade_analysis')
      .select('outcome, pnl')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .contains('matching_historical_patterns', [patternName])
      .in('outcome', ['win', 'loss']);

    if (!data || data.length === 0) {
      return { winRate: 50, avgWin: 1, avgLoss: 1, sampleSize: 0 };
    }

    const wins = data.filter(t => t.outcome === 'win');
    const losses = data.filter(t => t.outcome === 'loss');

    const winRate = (wins.length / data.length) * 100;
    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0) / wins.length
      : 1;
    const avgLoss = losses.length > 0
      ? Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0) / losses.length)
      : 1;

    return { winRate, avgWin, avgLoss, sampleSize: data.length };
  }

  /**
   * Get account info
   */
  private async getAccountInfo(userId: string): Promise<any> {
    // Fetch user balance
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();

    // Get recent trades for streak
    const { data: recentTrades } = await supabase
      .from('ai_trade_analysis')
      .select('outcome')
      .eq('user_id', userId)
      .in('outcome', ['win', 'loss'])
      .order('entry_time', { ascending: false })
      .limit(10);

    let consecutiveWins = 0;
    let consecutiveLosses = 0;

    if (recentTrades && recentTrades.length > 0) {
      const mostRecent = recentTrades[0].outcome;
      for (const trade of recentTrades) {
        if (trade.outcome === mostRecent) {
          if (mostRecent === 'win') consecutiveWins++;
          else consecutiveLosses++;
        } else {
          break;
        }
      }
    }

    return {
      balance: profile?.balance || 10000,
      drawdownPct: 0,
      openPositions: 0,
      correlatedExposure: 0,
      consecutiveWins,
      consecutiveLosses
    };
  }

  /**
   * Determine sizing reasoning
   */
  private determineReasoning(
    baseSize: number,
    finalSize: number,
    volAdj: number,
    corrAdj: number,
    ddAdj: number,
    streakAdj: number
  ): { increaseReason?: string; decreaseReason?: string } {
    const reasons: string[] = [];

    if (finalSize > baseSize * 1.1) {
      if (streakAdj > 1) reasons.push('Win streak momentum');
      if (volAdj > 1) reasons.push('Low volatility environment');
      return { increaseReason: reasons.join(', ') };
    }

    if (finalSize < baseSize * 0.9) {
      if (streakAdj < 1) reasons.push('Loss streak protection');
      if (corrAdj < 1) reasons.push('High correlation exposure');
      if (ddAdj < 1) reasons.push('Current drawdown');
      if (volAdj < 1) reasons.push('Extreme volatility');
      return { decreaseReason: reasons.join(', ') };
    }

    return {};
  }

  /**
   * Save recommendation
   */
  private async saveRecommendation(userId: string, rec: PositionSizeRecommendation): Promise<void> {
    await supabase.from('position_sizing_recommendations').insert({
      user_id: userId,
      calculated_at: rec.calculatedAt.toISOString(),
      symbol: rec.symbol,
      pattern_name: rec.patternName,
      setup_confidence: 0,
      pattern_win_rate: rec.patternWinRate,
      pattern_avg_win: rec.patternAvgWin,
      pattern_avg_loss: rec.patternAvgLoss,
      pattern_sample_size: rec.patternSampleSize,
      kelly_percentage: rec.kellyPercentage,
      kelly_fraction: rec.kellyFraction,
      recommended_risk_percent: rec.recommendedRiskPercent,
      base_position_size: rec.basePositionSize,
      volatility_adjustment: rec.volatilityAdjustment,
      correlation_adjustment: rec.correlationAdjustment,
      drawdown_adjustment: rec.drawdownAdjustment,
      streak_adjustment: rec.streakAdjustment,
      final_position_size: rec.finalPositionSize,
      final_risk_percent: rec.finalRiskPercent,
      max_position_size: rec.maxPositionSize,
      current_account_balance: rec.currentAccountBalance,
      current_drawdown_pct: rec.currentDrawdownPct,
      open_positions_count: rec.openPositionsCount,
      correlated_exposure_pct: rec.correlatedExposurePct,
      consecutive_wins: rec.consecutiveWins,
      consecutive_losses: rec.consecutiveLosses,
      size_increase_reason: rec.sizeIncreaseReason,
      size_decrease_reason: rec.sizeDecreaseReason
    });
  }
}

export const intelligentPositionSizer = new IntelligentPositionSizer();
