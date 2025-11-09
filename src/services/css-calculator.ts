import { supabase } from '@/lib/supabase';

/**
 * Composite Success Score (CSS) Calculator
 *
 * Calculates a balanced profitability score using the formula:
 * CSS = (0.4 × Win Rate) + (0.3 × Profit Factor) + (0.2 × Avg R:R) + (0.1 × Drawdown Control)
 *
 * Target CSS: 0.85+ (Master level)
 * Target CSS: 0.90+ (Exceptional level)
 */

interface CSSComponents {
  winRateComponent: number;
  profitFactorComponent: number;
  avgRRComponent: number;
  drawdownControlComponent: number;
}

interface CSSCalculationResult {
  compositeSuccessScore: number;
  components: CSSComponents;
  rawMetrics: {
    winRate: number;
    profitFactor: number;
    avgRR: number;
    maxDrawdown: number;
  };
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  previousCSS?: number;
  cssChange?: number;
  isImproving: boolean;
  grade: 'F' | 'D' | 'C' | 'B' | 'A' | 'S';
  skillLevel: 'Novice' | 'Intermediate' | 'Pro' | 'Expert' | 'Master' | 'Exceptional';
}

interface TradeData {
  outcome: 'win' | 'loss' | 'breakeven';
  pnl: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
}

class CSSCalculator {
  // Component weights
  private readonly WEIGHT_WIN_RATE = 0.4;
  private readonly WEIGHT_PROFIT_FACTOR = 0.3;
  private readonly WEIGHT_AVG_RR = 0.2;
  private readonly WEIGHT_DRAWDOWN_CONTROL = 0.1;

  // Normalization caps
  private readonly MAX_PROFIT_FACTOR = 3.0;
  private readonly MAX_AVG_RR = 3.0;
  private readonly MAX_DRAWDOWN = 20.0;

  /**
   * Calculate CSS for a period (daily/weekly/monthly)
   */
  async calculatePeriodCSS(
    userId: string,
    startDate: Date,
    endDate: Date,
    periodType: 'daily' | 'weekly' | 'monthly' = 'daily'
  ): Promise<CSSCalculationResult | null> {
    try {
      const trades = await this.fetchTradesForPeriod(userId, startDate, endDate);

      if (trades.length === 0) {
        console.log('[CSS Calculator] No trades found for period');
        return null;
      }

      const cssResult = this.calculateCSSFromTrades(trades);

      // Fetch previous CSS for comparison
      const previousCSS = await this.getPreviousCSS(userId, startDate, periodType);
      if (previousCSS) {
        cssResult.previousCSS = previousCSS;
        cssResult.cssChange = ((cssResult.compositeSuccessScore - previousCSS) / previousCSS) * 100;
        cssResult.isImproving = cssResult.compositeSuccessScore > previousCSS;
      }

      // Store CSS in database
      await this.storeCSSResult(userId, startDate, periodType, cssResult);

      return cssResult;
    } catch (error) {
      console.error('[CSS Calculator] Error calculating period CSS:', error);
      return null;
    }
  }

  /**
   * Calculate CSS from an array of trade data
   */
  calculateCSSFromTrades(trades: TradeData[]): CSSCalculationResult {
    const wins = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');

    // Calculate Win Rate
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

    // Calculate Profit Factor
    const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    // Calculate Average R:R
    const rrValues = trades
      .filter(t => t.outcome !== 'breakeven')
      .map(t => this.calculateRR(t))
      .filter(rr => rr > 0);
    const avgRR = rrValues.length > 0
      ? rrValues.reduce((sum, rr) => sum + rr, 0) / rrValues.length
      : 0;

    // Calculate Max Drawdown
    const maxDrawdown = this.calculateMaxDrawdown(trades);

    // Calculate CSS Components
    const components = this.calculateComponents(winRate, profitFactor, avgRR, maxDrawdown);

    // Calculate final CSS
    const compositeSuccessScore =
      components.winRateComponent +
      components.profitFactorComponent +
      components.avgRRComponent +
      components.drawdownControlComponent;

    const grade = this.getGrade(compositeSuccessScore);
    const skillLevel = this.getSkillLevel(compositeSuccessScore, trades.length, winRate, profitFactor, avgRR);

    return {
      compositeSuccessScore,
      components,
      rawMetrics: {
        winRate,
        profitFactor,
        avgRR,
        maxDrawdown
      },
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      isImproving: false, // Will be set by caller if previous CSS available
      grade,
      skillLevel
    };
  }

  /**
   * Calculate CSS components with normalization
   */
  private calculateComponents(
    winRate: number,
    profitFactor: number,
    avgRR: number,
    maxDrawdown: number
  ): CSSComponents {
    // Win Rate Component (0-40 points)
    // Normalize: 0-100% win rate → 0-40 points
    const winRateComponent = (winRate / 100) * this.WEIGHT_WIN_RATE * 100;

    // Profit Factor Component (0-30 points)
    // Normalize: 0-3.0 PF → 0-30 points (cap at 3.0)
    const normalizedPF = Math.min(profitFactor, this.MAX_PROFIT_FACTOR);
    const profitFactorComponent = (normalizedPF / this.MAX_PROFIT_FACTOR) * this.WEIGHT_PROFIT_FACTOR * 100;

    // Average R:R Component (0-20 points)
    // Normalize: 0-3.0 R:R → 0-20 points (cap at 3.0)
    const normalizedRR = Math.min(avgRR, this.MAX_AVG_RR);
    const avgRRComponent = (normalizedRR / this.MAX_AVG_RR) * this.WEIGHT_AVG_RR * 100;

    // Drawdown Control Component (0-10 points)
    // Inverse: lower drawdown is better (cap at 20%)
    const normalizedDD = Math.min(maxDrawdown, this.MAX_DRAWDOWN);
    const drawdownControlComponent = (1 - (normalizedDD / this.MAX_DRAWDOWN)) * this.WEIGHT_DRAWDOWN_CONTROL * 100;

    return {
      winRateComponent,
      profitFactorComponent,
      avgRRComponent,
      drawdownControlComponent
    };
  }

  /**
   * Calculate Risk:Reward ratio for a single trade
   */
  private calculateRR(trade: TradeData): number {
    const riskAmount = Math.abs(trade.entryPrice - trade.stopLoss);
    if (riskAmount === 0) return 0;

    const actualPnL = Math.abs(trade.exitPrice - trade.entryPrice);
    return actualPnL / riskAmount;
  }

  /**
   * Calculate maximum drawdown from equity curve
   */
  private calculateMaxDrawdown(trades: TradeData[]): number {
    if (trades.length === 0) return 0;

    let equity = 10000; // Starting equity
    let peak = equity;
    let maxDrawdown = 0;

    for (const trade of trades) {
      equity += trade.pnl;

      if (equity > peak) {
        peak = equity;
      }

      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Fetch trades for a specific period
   */
  private async fetchTradesForPeriod(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TradeData[]> {
    try {
      // Query trade_history for period
      const { data: tradeHistory, error: historyError } = await supabase
        .from('trade_history')
        .select('*')
        .eq('user_id', userId)
        .gte('closed_at', startDate.toISOString())
        .lte('closed_at', endDate.toISOString())
        .order('closed_at', { ascending: true });

      if (historyError) {
        console.error('[CSS Calculator] Error fetching trade history:', historyError);
        return [];
      }

      const liveTradesData: TradeData[] = (tradeHistory || []).map(t => ({
        outcome: parseFloat(t.profit_loss.toString()) > 0 ? 'win' : (parseFloat(t.profit_loss.toString()) < 0 ? 'loss' : 'breakeven'),
        pnl: parseFloat(t.profit_loss.toString()),
        entryPrice: parseFloat(t.entry_price.toString()),
        exitPrice: parseFloat(t.exit_price.toString()),
        stopLoss: parseFloat(t.stop_loss.toString()),
        takeProfit: parseFloat(t.take_profit.toString())
      }));

      // Also query synthetic trades if any
      const { data: syntheticTrades, error: syntheticError } = await supabase
        .from('synthetic_trades')
        .select('*')
        .eq('user_id', userId)
        .gte('exit_time', startDate.toISOString())
        .lte('exit_time', endDate.toISOString())
        .order('exit_time', { ascending: true });

      if (!syntheticError && syntheticTrades && syntheticTrades.length > 0) {
        const syntheticTradesData: TradeData[] = syntheticTrades.map(t => ({
          outcome: t.outcome as 'win' | 'loss' | 'breakeven',
          pnl: parseFloat(t.profit_loss.toString()),
          entryPrice: parseFloat(t.entry_price.toString()),
          exitPrice: parseFloat(t.exit_price.toString()),
          stopLoss: parseFloat(t.stop_loss.toString()),
          takeProfit: parseFloat(t.take_profit.toString())
        }));

        return [...liveTradesData, ...syntheticTradesData].sort((a, b) => a.pnl - b.pnl);
      }

      return liveTradesData;
    } catch (error) {
      console.error('[CSS Calculator] Exception fetching trades:', error);
      return [];
    }
  }

  /**
   * Get previous CSS for comparison
   */
  private async getPreviousCSS(
    userId: string,
    currentDate: Date,
    periodType: 'daily' | 'weekly' | 'monthly'
  ): Promise<number | null> {
    try {
      let previousDate: Date;

      if (periodType === 'daily') {
        previousDate = new Date(currentDate);
        previousDate.setDate(previousDate.getDate() - 1);
      } else if (periodType === 'weekly') {
        previousDate = new Date(currentDate);
        previousDate.setDate(previousDate.getDate() - 7);
      } else {
        previousDate = new Date(currentDate);
        previousDate.setMonth(previousDate.getMonth() - 1);
      }

      const { data, error } = await supabase
        .from('ai_composite_scores')
        .select('composite_success_score')
        .eq('user_id', userId)
        .eq('measurement_date', previousDate.toISOString().split('T')[0])
        .eq('period_type', periodType)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return parseFloat(data.composite_success_score.toString());
    } catch (error) {
      console.error('[CSS Calculator] Error fetching previous CSS:', error);
      return null;
    }
  }

  /**
   * Store CSS result in database
   */
  private async storeCSSResult(
    userId: string,
    date: Date,
    periodType: 'daily' | 'weekly' | 'monthly',
    result: CSSCalculationResult
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('ai_composite_scores')
        .upsert({
          user_id: userId,
          measurement_date: date.toISOString().split('T')[0],
          period_type: periodType,
          win_rate_component: result.components.winRateComponent,
          profit_factor_component: result.components.profitFactorComponent,
          avg_rr_component: result.components.avgRRComponent,
          drawdown_control_component: result.components.drawdownControlComponent,
          composite_success_score: result.compositeSuccessScore,
          win_rate: result.rawMetrics.winRate,
          profit_factor: result.rawMetrics.profitFactor,
          avg_rr: result.rawMetrics.avgRR,
          max_drawdown: result.rawMetrics.maxDrawdown,
          total_trades: result.totalTrades,
          winning_trades: result.winningTrades,
          losing_trades: result.losingTrades,
          previous_css: result.previousCSS || null,
          css_change_percent: result.cssChange || null,
          is_improving: result.isImproving
        }, {
          onConflict: 'user_id,measurement_date,period_type'
        });

      if (error) {
        console.error('[CSS Calculator] Error storing CSS result:', error);
      } else {
        console.log(`[CSS Calculator] ✅ Stored CSS for ${date.toISOString().split('T')[0]}: ${result.compositeSuccessScore.toFixed(2)}`);
      }
    } catch (error) {
      console.error('[CSS Calculator] Exception storing CSS result:', error);
    }
  }

  /**
   * Get CSS grade (F to S)
   */
  private getGrade(css: number): 'F' | 'D' | 'C' | 'B' | 'A' | 'S' {
    if (css >= 90) return 'S';
    if (css >= 85) return 'A';
    if (css >= 70) return 'B';
    if (css >= 60) return 'C';
    if (css >= 50) return 'D';
    return 'F';
  }

  /**
   * Determine skill level based on CSS and supporting metrics
   */
  private getSkillLevel(
    css: number,
    totalTrades: number,
    winRate: number,
    profitFactor: number,
    avgRR: number
  ): 'Novice' | 'Intermediate' | 'Pro' | 'Expert' | 'Master' | 'Exceptional' {
    // Must meet ALL criteria for each level
    if (totalTrades >= 10000 && css >= 90 && winRate >= 75 && profitFactor >= 2.0 && avgRR >= 2.2) {
      return 'Exceptional';
    }
    if (totalTrades >= 5000 && css >= 85 && winRate >= 70 && profitFactor >= 1.8 && avgRR >= 2.0) {
      return 'Master';
    }
    if (totalTrades >= 1500 && css >= 80 && winRate >= 65 && profitFactor >= 1.6 && avgRR >= 1.8) {
      return 'Expert';
    }
    if (totalTrades >= 500 && css >= 70 && winRate >= 60 && profitFactor >= 1.3 && avgRR >= 1.5) {
      return 'Pro';
    }
    if (totalTrades >= 100 && css >= 60 && winRate >= 50 && profitFactor >= 1.0 && avgRR >= 1.2) {
      return 'Intermediate';
    }
    return 'Novice';
  }

  /**
   * Get latest CSS for user
   */
  async getLatestCSS(userId: string): Promise<CSSCalculationResult | null> {
    try {
      const { data, error } = await supabase
        .from('ai_composite_scores')
        .select('*')
        .eq('user_id', userId)
        .order('measurement_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        compositeSuccessScore: parseFloat(data.composite_success_score.toString()),
        components: {
          winRateComponent: parseFloat(data.win_rate_component.toString()),
          profitFactorComponent: parseFloat(data.profit_factor_component.toString()),
          avgRRComponent: parseFloat(data.avg_rr_component.toString()),
          drawdownControlComponent: parseFloat(data.drawdown_control_component.toString())
        },
        rawMetrics: {
          winRate: parseFloat(data.win_rate.toString()),
          profitFactor: parseFloat(data.profit_factor.toString()),
          avgRR: parseFloat(data.avg_rr.toString()),
          maxDrawdown: parseFloat(data.max_drawdown.toString())
        },
        totalTrades: data.total_trades,
        winningTrades: data.winning_trades,
        losingTrades: data.losing_trades,
        previousCSS: data.previous_css ? parseFloat(data.previous_css.toString()) : undefined,
        cssChange: data.css_change_percent ? parseFloat(data.css_change_percent.toString()) : undefined,
        isImproving: data.is_improving,
        grade: this.getGrade(parseFloat(data.composite_success_score.toString())),
        skillLevel: this.getSkillLevel(
          parseFloat(data.composite_success_score.toString()),
          data.total_trades,
          parseFloat(data.win_rate.toString()),
          parseFloat(data.profit_factor.toString()),
          parseFloat(data.avg_rr.toString())
        )
      };
    } catch (error) {
      console.error('[CSS Calculator] Error getting latest CSS:', error);
      return null;
    }
  }

  /**
   * Get CSS trend over time
   */
  async getCSSTrend(
    userId: string,
    periodType: 'daily' | 'weekly' | 'monthly' = 'daily',
    limit: number = 30
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_composite_scores')
        .select('measurement_date, composite_success_score, win_rate, profit_factor, avg_rr, max_drawdown')
        .eq('user_id', userId)
        .eq('period_type', periodType)
        .order('measurement_date', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[CSS Calculator] Error fetching CSS trend:', error);
        return [];
      }

      return (data || []).reverse(); // Return in chronological order
    } catch (error) {
      console.error('[CSS Calculator] Exception fetching CSS trend:', error);
      return [];
    }
  }
}

export const cssCalculator = new CSSCalculator();
export type { CSSCalculationResult, CSSComponents, TradeData };
