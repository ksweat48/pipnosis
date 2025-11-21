import { supabase } from '../lib/supabase';

interface PlateauAnalysis {
  isPlateaued: boolean;
  plateauDuration: number;
  currentWinRate: number;
  winRateRange: { min: number; max: number };
  profitFactorRange: { min: number; max: number; avg: number };
  profitFactorSpread: number;
  lastBreakthrough: Date | null;
  consecutiveSessionsInRange: number;
  recommendation: string;
  shouldTriggerExploration: boolean;
}

interface PerformanceWindow {
  sessionId: string;
  winRate: number;
  profitFactor: number;
  completedAt: Date;
  totalTrades: number;
}

class PlateauDetector {
  private readonly PLATEAU_THRESHOLD_SESSIONS = 10;
  private readonly PLATEAU_RANGE_PERCENT = 5;
  private readonly EXPLORATION_TRIGGER_SESSIONS = 15;
  private readonly MIN_TRADES_REQUIRED = 5;

  async detectPlateau(userId: string): Promise<PlateauAnalysis | null> {
    console.log('\n[Plateau Detector] 🔍 Analyzing performance for plateau detection...');

    try {
      const recentSessions = await this.getRecentBacktestSessions(userId, 10);

      if (recentSessions.length < this.PLATEAU_THRESHOLD_SESSIONS) {
        console.log(`[Plateau Detector] Insufficient data (${recentSessions.length} sessions)`);
        return null;
      }

      const currentWinRate = recentSessions[0].winRate;
      const winRates = recentSessions.map(s => s.winRate);
      const profitFactors = recentSessions.map(s => s.profitFactor);

      const minWR = Math.min(...winRates);
      const maxWR = Math.max(...winRates);
      const range = maxWR - minWR;
      const avgWR = winRates.reduce((sum, wr) => sum + wr, 0) / winRates.length;

      const minPF = Math.min(...profitFactors);
      const maxPF = Math.max(...profitFactors);
      const avgPF = profitFactors.reduce((sum, pf) => sum + pf, 0) / profitFactors.length;
      const pfSpread = maxPF - minPF;

      let consecutiveInRange = 0;
      for (const session of recentSessions) {
        if (Math.abs(session.winRate - avgWR) <= this.PLATEAU_RANGE_PERCENT) {
          consecutiveInRange++;
        } else {
          break;
        }
      }

      const isPlateaued = range <= this.PLATEAU_RANGE_PERCENT &&
                          consecutiveInRange >= this.PLATEAU_THRESHOLD_SESSIONS;

      const lastBreakthrough = await this.getLastBreakthrough(userId);
      const daysSinceBreakthrough = lastBreakthrough
        ? Math.floor((Date.now() - lastBreakthrough.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const shouldTriggerExploration = isPlateaued && consecutiveInRange >= this.EXPLORATION_TRIGGER_SESSIONS;

      let recommendation = '';
      if (isPlateaued) {
        if (currentWinRate < 60) {
          recommendation = 'CRITICAL: Stuck below 60% - activate defensive mode and review fundamentals';
        } else if (currentWinRate < 75) {
          recommendation = 'Plateau detected - trigger exploration mode to test new approaches';
        } else if (currentWinRate < 85) {
          recommendation = 'Intermediate plateau - test higher confidence thresholds and symbol specialization';
        } else {
          recommendation = 'High-performance plateau - fine-tune with micro-optimizations';
        }
      } else {
        recommendation = 'No plateau detected - continue current learning trajectory';
      }

      const analysis: PlateauAnalysis = {
        isPlateaued,
        plateauDuration: consecutiveInRange,
        currentWinRate,
        winRateRange: { min: minWR, max: maxWR },
        profitFactorRange: { min: minPF, max: maxPF, avg: avgPF },
        profitFactorSpread: pfSpread,
        lastBreakthrough,
        consecutiveSessionsInRange: consecutiveInRange,
        recommendation,
        shouldTriggerExploration
      };

      await this.logPlateauAnalysis(userId, analysis);

      console.log(`[Plateau Detector] ${isPlateaued ? '⚠️  PLATEAU DETECTED' : '✅ No Plateau'}`);
      console.log(`[Plateau Detector]   Win Rate: ${currentWinRate.toFixed(1)}% (Range: ${minWR.toFixed(1)}% - ${maxWR.toFixed(1)}%)`);
      console.log(`[Plateau Detector]   Profit Factor: ${avgPF.toFixed(2)} (Range: ${minPF.toFixed(2)} - ${maxPF.toFixed(2)}, Spread: ${pfSpread.toFixed(2)})`);
      console.log(`[Plateau Detector]   Duration: ${consecutiveInRange} sessions`);
      console.log(`[Plateau Detector]   Exploration: ${shouldTriggerExploration ? 'TRIGGER NOW' : 'Not needed'}`);

      return analysis;

    } catch (error) {
      console.error('[Plateau Detector] Error detecting plateau:', error);
      return null;
    }
  }

  private async getRecentBacktestSessions(userId: string, limit: number): Promise<PerformanceWindow[]> {
    const { data, error } = await supabase
      .from('synthetic_backtest_sessions')
      .select('id, win_rate, profit_factor, completed_at, total_trades')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('win_rate', 'is', null)
      .not('profit_factor', 'is', null)
      .not('total_trades', 'is', null)
      .gt('total_trades', 0)
      .order('completed_at', { ascending: false })
      .limit(limit * 2);

    if (error || !data) {
      console.error('[Plateau Detector] Error fetching sessions:', error);
      return [];
    }

    const validSessions = data
      .filter(s => {
        const totalTrades = s.total_trades || 0;
        const winRate = parseFloat(s.win_rate?.toString() || '0');
        const profitFactor = parseFloat(s.profit_factor?.toString() || '0');
        return totalTrades >= this.MIN_TRADES_REQUIRED && winRate > 0 && profitFactor > 0;
      })
      .slice(0, limit)
      .map(s => ({
        sessionId: s.id,
        winRate: parseFloat(s.win_rate?.toString() || '0'),
        profitFactor: parseFloat(s.profit_factor?.toString() || '0'),
        completedAt: new Date(s.completed_at),
        totalTrades: s.total_trades || 0
      }));

    const filteredCount = data.length - validSessions.length;
    if (filteredCount > 0) {
      console.log(`[Plateau Detector] Filtered out ${filteredCount} invalid sessions (0 trades or < ${this.MIN_TRADES_REQUIRED} trades)`);
    }
    console.log(`[Plateau Detector] Analyzing ${validSessions.length} valid sessions`);

    return validSessions;
  }

  private async getLastBreakthrough(userId: string): Promise<Date | null> {
    const { data, error } = await supabase
      .from('ai_learning_milestones')
      .select('achieved_at')
      .eq('user_id', userId)
      .in('milestone_type', ['skill_level_up', 'breakthrough'])
      .order('achieved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Plateau Detector] Error fetching last breakthrough:', error);
      return null;
    }

    if (!data) {
      console.log('[Plateau Detector] No breakthrough milestones found yet');
      return null;
    }

    return new Date(data.achieved_at);
  }

  private async logPlateauAnalysis(userId: string, analysis: PlateauAnalysis): Promise<void> {
    try {
      await supabase.from('plateau_detection_log').insert({
        user_id: userId,
        is_plateaued: analysis.isPlateaued,
        plateau_duration: analysis.plateauDuration,
        current_win_rate: analysis.currentWinRate,
        win_rate_range_min: analysis.winRateRange.min,
        win_rate_range_max: analysis.winRateRange.max,
        profit_factor_min: analysis.profitFactorRange.min,
        profit_factor_max: analysis.profitFactorRange.max,
        profit_factor_avg: analysis.profitFactorRange.avg,
        profit_factor_spread: analysis.profitFactorSpread,
        consecutive_sessions_in_range: analysis.consecutiveSessionsInRange,
        recommendation: analysis.recommendation,
        should_trigger_exploration: analysis.shouldTriggerExploration,
        detected_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Plateau Detector] Error logging analysis:', error);
    }
  }

  async shouldRunExplorationMode(userId: string): Promise<boolean> {
    const analysis = await this.detectPlateau(userId);
    return analysis?.shouldTriggerExploration || false;
  }

  async getPlateauStatus(userId: string): Promise<{
    hasActivePlateau: boolean;
    durationSessions: number;
    recommendation: string;
  }> {
    const analysis = await this.detectPlateau(userId);

    if (!analysis) {
      return {
        hasActivePlateau: false,
        durationSessions: 0,
        recommendation: 'Insufficient data for plateau detection'
      };
    }

    return {
      hasActivePlateau: analysis.isPlateaued,
      durationSessions: analysis.plateauDuration,
      recommendation: analysis.recommendation
    };
  }
}

export const plateauDetector = new PlateauDetector();
export type { PlateauAnalysis, PerformanceWindow };
