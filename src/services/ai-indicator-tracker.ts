import { supabase } from '@/lib/supabase';

export type IndicatorCategory = 'momentum' | 'trend' | 'volatility' | 'volume' | 'custom' | 'composite';
export type ExperimentStatus = 'testing' | 'adopted' | 'rejected' | 'under_review';

interface IndicatorExperiment {
  id: string;
  indicatorName: string;
  indicatorCategory: IndicatorCategory;
  experimentStatus: ExperimentStatus;
  tradesWithIndicator: number;
  winsWithIndicator: number;
  lossesWithIndicator: number;
  winRateWithIndicator: number;
  improvementVsBaseline: number;
  adoptionReasoning?: string;
  rejectionReasoning?: string;
  startedTestingDate: string;
}

interface IndicatorEffectiveness {
  indicatorName: string;
  symbol: string;
  timeframe: string;
  winRate: number;
  totalSignals: number;
  signalQualityScore: number;
  isCurrentlyActive: boolean;
  weightInDecision: number;
}

interface IndicatorUsageHistory {
  indicatorName: string;
  actionType: string;
  actionDate: string;
  reasoning: string;
  wasBeneficial: boolean | null;
}

interface CoreIndicatorsStatus {
  rsi: IndicatorEffectiveness | null;
  movingAverages: IndicatorEffectiveness | null;
  macd: IndicatorEffectiveness | null;
  bollingerBands: IndicatorEffectiveness | null;
  stochastic: IndicatorEffectiveness | null;
  atr: IndicatorEffectiveness | null;
}

class AIIndicatorTracker {
  // Core indicators that AI starts with
  private readonly CORE_INDICATORS = [
    { name: 'RSI', category: 'momentum' as IndicatorCategory, params: { period: 14, overbought: 70, oversold: 30 } },
    { name: 'Moving Averages', category: 'trend' as IndicatorCategory, params: { fast: 9, slow: 21, long: 50 } },
    { name: 'MACD', category: 'momentum' as IndicatorCategory, params: { fast: 12, slow: 26, signal: 9 } },
    { name: 'Bollinger Bands', category: 'volatility' as IndicatorCategory, params: { period: 20, stdDev: 2 } }
  ];

  // Advanced indicators AI can experiment with
  private readonly EXPERIMENTAL_INDICATORS = [
    { name: 'Stochastic', category: 'momentum' as IndicatorCategory },
    { name: 'ATR', category: 'volatility' as IndicatorCategory },
    { name: 'Volume Profile', category: 'volume' as IndicatorCategory },
    { name: 'Ichimoku Cloud', category: 'trend' as IndicatorCategory },
    { name: 'Fibonacci Retracement', category: 'custom' as IndicatorCategory },
    { name: 'Pivot Points', category: 'custom' as IndicatorCategory }
  ];

  /**
   * Initialize core indicators for a new user
   */
  async initializeCoreIndicators(userId: string): Promise<void> {
    console.log('[AI Indicator Tracker] Initializing core indicators...');

    for (const indicator of this.CORE_INDICATORS) {
      try {
        // Create experiment record
        const { error: expError } = await supabase
          .from('ai_indicator_experiments')
          .insert({
            user_id: userId,
            indicator_name: indicator.name,
            indicator_category: indicator.category,
            indicator_parameters: indicator.params,
            experiment_status: 'adopted',
            started_testing_date: new Date().toISOString(),
            completed_testing_date: new Date().toISOString(),
            adoption_reasoning: 'Core indicator - fundamental for technical analysis'
          });

        if (expError) {
          console.error(`[AI Indicator Tracker] Error initializing ${indicator.name}:`, expError);
        }

        // Create effectiveness record for each common symbol
        const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];
        for (const symbol of symbols) {
          const { error: effError } = await supabase
            .from('ai_indicator_effectiveness')
            .insert({
              user_id: userId,
              indicator_name: indicator.name,
              is_combination: false,
              symbol,
              timeframe: 'H1',
              is_currently_active: true,
              weight_in_decision: 50.0,
              signal_quality_score: 50.0,
              first_used_date: new Date().toISOString()
            });

          if (effError) {
            console.error(`[AI Indicator Tracker] Error initializing effectiveness for ${indicator.name} on ${symbol}:`, effError);
          }
        }
      } catch (error) {
        console.error(`[AI Indicator Tracker] Exception initializing ${indicator.name}:`, error);
      }
    }

    console.log('[AI Indicator Tracker] ✓ Core indicators initialized');
  }

  /**
   * Start testing a new experimental indicator
   */
  async startExperiment(userId: string, indicatorName: string, category: IndicatorCategory): Promise<void> {
    try {
      const { error } = await supabase
        .from('ai_indicator_experiments')
        .insert({
          user_id: userId,
          indicator_name: indicatorName,
          indicator_category: category,
          experiment_status: 'testing',
          started_testing_date: new Date().toISOString()
        });

      if (error) {
        console.error('[AI Indicator Tracker] Error starting experiment:', error);
      } else {
        console.log(`[AI Indicator Tracker] 🧪 Started testing ${indicatorName}`);
      }
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception starting experiment:', error);
    }
  }

  /**
   * Update indicator experiment with trade results
   */
  async updateExperiment(
    userId: string,
    indicatorName: string,
    tradeOutcome: 'win' | 'loss',
    usedIndicator: boolean
  ): Promise<void> {
    try {
      const { data: experiment, error: fetchError } = await supabase
        .from('ai_indicator_experiments')
        .select('*')
        .eq('user_id', userId)
        .eq('indicator_name', indicatorName)
        .eq('experiment_status', 'testing')
        .maybeSingle();

      if (fetchError || !experiment) {
        return;
      }

      if (usedIndicator) {
        const newTrades = experiment.trades_with_indicator + 1;
        const newWins = experiment.wins_with_indicator + (tradeOutcome === 'win' ? 1 : 0);
        const newLosses = experiment.losses_with_indicator + (tradeOutcome === 'loss' ? 1 : 0);
        const newWinRate = (newWins / newTrades) * 100;

        await supabase
          .from('ai_indicator_experiments')
          .update({
            trades_with_indicator: newTrades,
            wins_with_indicator: newWins,
            losses_with_indicator: newLosses,
            win_rate_with_indicator: newWinRate,
            updated_at: new Date().toISOString()
          })
          .eq('id', experiment.id);
      } else {
        const newTrades = experiment.trades_without_indicator + 1;
        const newWins = tradeOutcome === 'win' ? 1 : 0;
        const currentWinsWithout = (experiment.win_rate_without_indicator / 100) * experiment.trades_without_indicator;
        const newWinRate = ((currentWinsWithout + newWins) / newTrades) * 100;

        await supabase
          .from('ai_indicator_experiments')
          .update({
            trades_without_indicator: newTrades,
            win_rate_without_indicator: newWinRate,
            updated_at: new Date().toISOString()
          })
          .eq('id', experiment.id);
      }

      // Check if experiment should be concluded
      await this.evaluateExperiment(userId, indicatorName);
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception updating experiment:', error);
    }
  }

  /**
   * Evaluate if experiment is ready for conclusion
   */
  private async evaluateExperiment(userId: string, indicatorName: string): Promise<void> {
    try {
      const { data: experiment, error } = await supabase
        .from('ai_indicator_experiments')
        .select('*')
        .eq('user_id', userId)
        .eq('indicator_name', indicatorName)
        .eq('experiment_status', 'testing')
        .maybeSingle();

      if (error || !experiment) return;

      // Need at least 30 trades with and 30 without to evaluate
      if (experiment.trades_with_indicator < 30 || experiment.trades_without_indicator < 30) {
        return;
      }

      const improvement = experiment.win_rate_with_indicator - experiment.win_rate_without_indicator;

      // Adopt if improvement is significant (>5% better win rate)
      if (improvement >= 5) {
        await this.concludeExperiment(
          userId,
          indicatorName,
          'adopted',
          `Indicator improves win rate by ${improvement.toFixed(1)}%. Significant positive impact on performance.`,
          null
        );
      }
      // Reject if performance is worse (-3% or more)
      else if (improvement <= -3) {
        await this.concludeExperiment(
          userId,
          indicatorName,
          'rejected',
          null,
          `Indicator reduces win rate by ${Math.abs(improvement).toFixed(1)}%. Negative impact on performance.`
        );
      }
      // Continue testing if results are inconclusive
      else if (experiment.trades_with_indicator >= 100) {
        await this.concludeExperiment(
          userId,
          indicatorName,
          'rejected',
          null,
          `After ${experiment.trades_with_indicator} trades, no significant improvement observed (${improvement.toFixed(1)}% difference).`
        );
      }
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception evaluating experiment:', error);
    }
  }

  /**
   * Conclude an indicator experiment
   */
  private async concludeExperiment(
    userId: string,
    indicatorName: string,
    status: 'adopted' | 'rejected',
    adoptionReasoning: string | null,
    rejectionReasoning: string | null
  ): Promise<void> {
    try {
      const { error: updateError } = await supabase
        .from('ai_indicator_experiments')
        .update({
          experiment_status: status,
          completed_testing_date: new Date().toISOString(),
          adoption_reasoning: adoptionReasoning,
          rejection_reasoning: rejectionReasoning,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('indicator_name', indicatorName)
        .eq('experiment_status', 'testing');

      if (updateError) {
        console.error('[AI Indicator Tracker] Error concluding experiment:', updateError);
        return;
      }

      // Record in usage history
      const { error: historyError } = await supabase
        .from('ai_indicator_usage_history')
        .insert({
          user_id: userId,
          indicator_name: indicatorName,
          action_type: status,
          reasoning: adoptionReasoning || rejectionReasoning || '',
          action_date: new Date().toISOString()
        });

      if (historyError) {
        console.error('[AI Indicator Tracker] Error recording history:', historyError);
      }

      if (status === 'adopted') {
        console.log(`[AI Indicator Tracker] ✅ Adopted ${indicatorName}: ${adoptionReasoning}`);
      } else {
        console.log(`[AI Indicator Tracker] ❌ Rejected ${indicatorName}: ${rejectionReasoning}`);
      }
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception concluding experiment:', error);
    }
  }

  /**
   * Update indicator effectiveness after trade
   */
  async updateIndicatorEffectiveness(
    userId: string,
    indicatorName: string,
    symbol: string,
    timeframe: string,
    signalTaken: boolean,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const { data: existing, error: fetchError } = await supabase
        .from('ai_indicator_effectiveness')
        .select('*')
        .eq('user_id', userId)
        .eq('indicator_name', indicatorName)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .maybeSingle();

      if (fetchError) {
        console.error('[AI Indicator Tracker] Error fetching effectiveness:', fetchError);
        return;
      }

      if (existing) {
        const newTotalSignals = existing.total_signals + 1;
        const newSignalsTaken = existing.signals_taken + (signalTaken ? 1 : 0);
        const newSignalsWon = existing.signals_won + (signalTaken && outcome === 'win' ? 1 : 0);
        const newSignalsLost = existing.signals_lost + (signalTaken && outcome === 'loss' ? 1 : 0);
        const newWinRate = newSignalsTaken > 0 ? (newSignalsWon / newSignalsTaken) * 100 : 0;

        // Calculate quality score based on win rate and usage
        const qualityScore = this.calculateQualityScore(newWinRate, newSignalsTaken, newTotalSignals);

        await supabase
          .from('ai_indicator_effectiveness')
          .update({
            total_signals: newTotalSignals,
            signals_taken: newSignalsTaken,
            signals_won: newSignalsWon,
            signals_lost: newSignalsLost,
            win_rate: newWinRate,
            signal_quality_score: qualityScore,
            last_used_date: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      }
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception updating effectiveness:', error);
    }
  }

  /**
   * Calculate indicator quality score
   */
  private calculateQualityScore(winRate: number, signalsTaken: number, totalSignals: number): number {
    // Base score from win rate (0-70 points)
    let score = (winRate / 100) * 70;

    // Bonus for high usage rate (0-15 points)
    const usageRate = signalsTaken / Math.max(1, totalSignals);
    score += usageRate * 15;

    // Bonus for sample size (0-15 points)
    const sampleBonus = Math.min(15, (signalsTaken / 100) * 15);
    score += sampleBonus;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Get all active experiments
   */
  async getActiveExperiments(userId: string): Promise<IndicatorExperiment[]> {
    try {
      const { data, error } = await supabase
        .from('ai_indicator_experiments')
        .select('*')
        .eq('user_id', userId)
        .eq('experiment_status', 'testing')
        .order('started_testing_date', { ascending: false });

      if (error) {
        console.error('[AI Indicator Tracker] Error fetching experiments:', error);
        return [];
      }

      return (data || []).map(exp => ({
        id: exp.id,
        indicatorName: exp.indicator_name,
        indicatorCategory: exp.indicator_category,
        experimentStatus: exp.experiment_status,
        tradesWithIndicator: exp.trades_with_indicator,
        winsWithIndicator: exp.wins_with_indicator,
        lossesWithIndicator: exp.losses_with_indicator,
        winRateWithIndicator: parseFloat(exp.win_rate_with_indicator),
        improvementVsBaseline: parseFloat(exp.improvement_vs_baseline),
        adoptionReasoning: exp.adoption_reasoning,
        rejectionReasoning: exp.rejection_reasoning,
        startedTestingDate: exp.started_testing_date
      }));
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception fetching experiments:', error);
      return [];
    }
  }

  /**
   * Get adopted indicators
   */
  async getAdoptedIndicators(userId: string): Promise<IndicatorExperiment[]> {
    try {
      const { data, error } = await supabase
        .from('ai_indicator_experiments')
        .select('*')
        .eq('user_id', userId)
        .eq('experiment_status', 'adopted')
        .order('completed_testing_date', { ascending: false });

      if (error) {
        console.error('[AI Indicator Tracker] Error fetching adopted indicators:', error);
        return [];
      }

      return (data || []).map(exp => ({
        id: exp.id,
        indicatorName: exp.indicator_name,
        indicatorCategory: exp.indicator_category,
        experimentStatus: exp.experiment_status,
        tradesWithIndicator: exp.trades_with_indicator,
        winsWithIndicator: exp.wins_with_indicator,
        lossesWithIndicator: exp.losses_with_indicator,
        winRateWithIndicator: parseFloat(exp.win_rate_with_indicator),
        improvementVsBaseline: parseFloat(exp.improvement_vs_baseline),
        adoptionReasoning: exp.adoption_reasoning,
        rejectionReasoning: exp.rejection_reasoning,
        startedTestingDate: exp.started_testing_date
      }));
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception fetching adopted indicators:', error);
      return [];
    }
  }

  /**
   * Get indicator effectiveness for a symbol
   */
  async getIndicatorEffectiveness(userId: string, symbol: string): Promise<IndicatorEffectiveness[]> {
    try {
      const { data, error } = await supabase
        .from('ai_indicator_effectiveness')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('is_currently_active', true)
        .order('signal_quality_score', { ascending: false });

      if (error) {
        console.error('[AI Indicator Tracker] Error fetching effectiveness:', error);
        return [];
      }

      return (data || []).map(eff => ({
        indicatorName: eff.indicator_name,
        symbol: eff.symbol,
        timeframe: eff.timeframe,
        winRate: parseFloat(eff.win_rate),
        totalSignals: eff.total_signals,
        signalQualityScore: parseFloat(eff.signal_quality_score),
        isCurrentlyActive: eff.is_currently_active,
        weightInDecision: parseFloat(eff.weight_in_decision)
      }));
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception fetching effectiveness:', error);
      return [];
    }
  }

  /**
   * Get indicator usage history
   */
  async getUsageHistory(userId: string, limit: number = 20): Promise<IndicatorUsageHistory[]> {
    try {
      const { data, error } = await supabase
        .from('ai_indicator_usage_history')
        .select('*')
        .eq('user_id', userId)
        .order('action_date', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[AI Indicator Tracker] Error fetching usage history:', error);
        return [];
      }

      return (data || []).map(hist => ({
        indicatorName: hist.indicator_name,
        actionType: hist.action_type,
        actionDate: hist.action_date,
        reasoning: hist.reasoning,
        wasBeneficial: hist.was_beneficial
      }));
    } catch (error) {
      console.error('[AI Indicator Tracker] Exception fetching usage history:', error);
      return [];
    }
  }
}

export const aiIndicatorTracker = new AIIndicatorTracker();
export type { IndicatorExperiment, IndicatorEffectiveness, IndicatorUsageHistory, CoreIndicatorsStatus };
