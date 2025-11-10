import { supabase } from '@/lib/supabase';

/**
 * SPC (Session Profit Coefficient) Calculator
 *
 * Calculates Session Profit Coefficient with:
 * - Profit weight based on profit factor
 * - Comeback trade bonuses
 * - Tier evaluation against targets
 * - Defensive mode triggers
 */

interface SPCCalculation {
  baseSPC: number;
  comebackBonus: number;
  totalSPC: number;
  profitWeight: number;
  tier: string;
  grade: string;
}

interface TierRequirements {
  level: string;
  tradesRequired: number;
  winRateRequired: number;
  profitFactorRequired: number;
  spcTarget: number;
}

interface SPCProgress {
  currentSPC: number;
  targetSPC: number;
  progressPercent: number;
  spcNeeded: number;
  tier: string;
}

class SPCCalculator {
  // Tier requirements as per the plan
  private readonly tierRequirements: TierRequirements[] = [
    {
      level: 'Novice',
      tradesRequired: 0,
      winRateRequired: 0,
      profitFactorRequired: 0,
      spcTarget: 0
    },
    {
      level: 'Intermediate',
      tradesRequired: 100,
      winRateRequired: 50,
      profitFactorRequired: 1.0,
      spcTarget: 10
    },
    {
      level: 'Pro',
      tradesRequired: 500,
      winRateRequired: 60,
      profitFactorRequired: 1.3,
      spcTarget: 25
    },
    {
      level: 'Expert',
      tradesRequired: 1500,
      winRateRequired: 65,
      profitFactorRequired: 1.5,
      spcTarget: 50
    },
    {
      level: 'Master',
      tradesRequired: 5000,
      winRateRequired: 70,
      profitFactorRequired: 1.8,
      spcTarget: 100
    },
    {
      level: 'Exceptional',
      tradesRequired: 10000,
      winRateRequired: 80,
      profitFactorRequired: 2.0,
      spcTarget: 200
    }
  ];

  /**
   * Calculate SPC for a completed session
   */
  async calculateSessionSPC(
    userId: string,
    sessionId: string
  ): Promise<SPCCalculation | null> {
    try {
      // Get session trades
      const { data: trades, error } = await supabase
        .from('session_trades')
        .select('*')
        .eq('session_id', sessionId);

      if (error || !trades || trades.length === 0) {
        console.error('[SPC Calculator] Error fetching session trades:', error);
        return null;
      }

      // Calculate session metrics
      const wins = trades.filter(t => t.trade_outcome === 'win').length;
      const losses = trades.filter(t => t.trade_outcome === 'loss').length;

      const totalWinsPnl = trades
        .filter(t => t.trade_outcome === 'win')
        .reduce((sum, t) => sum + parseFloat(t.pnl), 0);

      const totalLossesPnl = Math.abs(
        trades
          .filter(t => t.trade_outcome === 'loss')
          .reduce((sum, t) => sum + parseFloat(t.pnl), 0)
      );

      const profitFactor = totalLossesPnl > 0
        ? totalWinsPnl / totalLossesPnl
        : (totalWinsPnl > 0 ? 99 : 0);

      // Calculate profit weight
      const profitWeight = this.calculateProfitWeight(profitFactor);

      // Calculate base SPC: (wins - losses) * profit_weight
      const baseSPC = (wins - losses) * profitWeight;

      // Calculate total comeback bonus
      const comebackBonus = trades.reduce(
        (sum, trade) => sum + (parseFloat(trade.comeback_bonus_applied) || 0),
        0
      );

      // Total SPC
      const totalSPC = baseSPC + comebackBonus;

      // Determine tier and grade
      const tier = this.getSPCTier(totalSPC);
      const winRate = (wins / trades.length) * 100;
      const grade = this.calculateGrade(winRate, profitFactor, totalSPC);

      return {
        baseSPC,
        comebackBonus,
        totalSPC,
        profitWeight,
        tier,
        grade
      };
    } catch (error) {
      console.error('[SPC Calculator] Exception calculating session SPC:', error);
      return null;
    }
  }

  /**
   * Update cumulative SPC in ai_skill_progression
   */
  async updateCumulativeSPC(
    userId: string,
    sessionSPC: number
  ): Promise<{ success: boolean; newCumulativeSPC?: number }> {
    try {
      // Get current progression
      const { data: progression, error: fetchError } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        console.error('[SPC Calculator] Error fetching progression:', fetchError);
        return { success: false };
      }

      // Initialize if doesn't exist
      if (!progression) {
        const { error: insertError } = await supabase
          .from('ai_skill_progression')
          .insert({
            user_id: userId,
            current_skill_level: 'Novice',
            skill_level_numeric: 1,
            cumulative_spc: sessionSPC,
            session_count: 1,
            average_session_spc: sessionSPC,
            best_session_spc: sessionSPC,
            worst_session_spc: sessionSPC,
            last_session_spc: sessionSPC,
            consecutive_negative_sessions: sessionSPC < 0 ? 1 : 0
          });

        if (insertError) {
          console.error('[SPC Calculator] Error inserting progression:', insertError);
          return { success: false };
        }

        return { success: true, newCumulativeSPC: sessionSPC };
      }

      // Update cumulative SPC
      const currentCumulativeSPC = parseFloat(progression.cumulative_spc) || 0;
      const newCumulativeSPC = currentCumulativeSPC + sessionSPC;

      const sessionCount = (progression.session_count || 0) + 1;
      const averageSessionSPC = newCumulativeSPC / sessionCount;

      const bestSessionSPC = Math.max(
        parseFloat(progression.best_session_spc) || sessionSPC,
        sessionSPC
      );

      const worstSessionSPC = Math.min(
        parseFloat(progression.worst_session_spc) || sessionSPC,
        sessionSPC
      );

      // Track consecutive negative sessions
      const consecutiveNegative = sessionSPC < 0
        ? (progression.consecutive_negative_sessions || 0) + 1
        : 0;

      // Update
      const { error: updateError } = await supabase
        .from('ai_skill_progression')
        .update({
          cumulative_spc: newCumulativeSPC,
          session_count: sessionCount,
          average_session_spc: averageSessionSPC,
          best_session_spc: bestSessionSPC,
          worst_session_spc: worstSessionSPC,
          last_session_spc: sessionSPC,
          consecutive_negative_sessions: consecutiveNegative,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('[SPC Calculator] Error updating progression:', updateError);
        return { success: false };
      }

      console.log(`[SPC Calculator] ✅ Updated cumulative SPC: ${newCumulativeSPC.toFixed(2)} (+${sessionSPC.toFixed(2)})`);

      return { success: true, newCumulativeSPC };
    } catch (error) {
      console.error('[SPC Calculator] Exception updating cumulative SPC:', error);
      return { success: false };
    }
  }

  /**
   * Check if user meets tier requirements
   */
  async checkTierEligibility(
    userId: string,
    targetTier: string
  ): Promise<{
    eligible: boolean;
    requirements: TierRequirements;
    currentStats: any;
    missingRequirements: string[];
  }> {
    try {
      // Get tier requirements
      const requirements = this.tierRequirements.find(t => t.level === targetTier);
      if (!requirements) {
        return {
          eligible: false,
          requirements: this.tierRequirements[0],
          currentStats: {},
          missingRequirements: ['Invalid tier']
        };
      }

      // Get user progression
      const { data: progression } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!progression) {
        return {
          eligible: false,
          requirements,
          currentStats: {},
          missingRequirements: ['No progression data']
        };
      }

      const currentStats = {
        trades: progression.total_trades_analyzed || 0,
        winRate: progression.current_win_rate || 0,
        profitFactor: progression.current_profit_factor || 0,
        cumulativeSPC: progression.cumulative_spc || 0
      };

      // Check each requirement
      const missingRequirements: string[] = [];

      if (currentStats.trades < requirements.tradesRequired) {
        missingRequirements.push(
          `Need ${requirements.tradesRequired - currentStats.trades} more trades`
        );
      }

      if (currentStats.winRate < requirements.winRateRequired) {
        missingRequirements.push(
          `Need ${(requirements.winRateRequired - currentStats.winRate).toFixed(1)}% higher win rate`
        );
      }

      if (currentStats.profitFactor < requirements.profitFactorRequired) {
        missingRequirements.push(
          `Need profit factor of ${requirements.profitFactorRequired} (current: ${currentStats.profitFactor.toFixed(2)})`
        );
      }

      if (currentStats.cumulativeSPC < requirements.spcTarget) {
        missingRequirements.push(
          `Need ${(requirements.spcTarget - currentStats.cumulativeSPC).toFixed(1)} more SPC points`
        );
      }

      const eligible = missingRequirements.length === 0;

      return {
        eligible,
        requirements,
        currentStats,
        missingRequirements
      };
    } catch (error) {
      console.error('[SPC Calculator] Error checking tier eligibility:', error);
      return {
        eligible: false,
        requirements: this.tierRequirements[0],
        currentStats: {},
        missingRequirements: ['Error checking requirements']
      };
    }
  }

  /**
   * Get SPC progress toward next tier
   */
  async getSPCProgress(userId: string): Promise<SPCProgress | null> {
    try {
      const { data: progression } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!progression) return null;

      const currentLevel = progression.current_skill_level;
      const currentSPC = parseFloat(progression.cumulative_spc) || 0;

      // Find current and next tier
      const currentTierIndex = this.tierRequirements.findIndex(t => t.level === currentLevel);
      const nextTier = this.tierRequirements[currentTierIndex + 1];

      if (!nextTier) {
        // Already at max level
        return {
          currentSPC,
          targetSPC: currentSPC,
          progressPercent: 100,
          spcNeeded: 0,
          tier: 'Exceptional'
        };
      }

      const targetSPC = nextTier.spcTarget;
      const previousTierSPC = this.tierRequirements[currentTierIndex]?.spcTarget || 0;

      const spcRange = targetSPC - previousTierSPC;
      const spcProgress = currentSPC - previousTierSPC;
      const progressPercent = Math.min(100, Math.max(0, (spcProgress / spcRange) * 100));

      return {
        currentSPC,
        targetSPC,
        progressPercent,
        spcNeeded: Math.max(0, targetSPC - currentSPC),
        tier: nextTier.level
      };
    } catch (error) {
      console.error('[SPC Calculator] Error getting SPC progress:', error);
      return null;
    }
  }

  /**
   * Check if defensive mode should be triggered
   */
  async shouldActivateDefensiveMode(userId: string): Promise<{
    shouldActivate: boolean;
    reason?: string;
  }> {
    try {
      const { data: progression } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!progression) {
        return { shouldActivate: false };
      }

      // Trigger 1: Profit Factor < 0.8 for 3 sessions
      // (Would need session history to check this properly)

      // Trigger 2: 2 consecutive negative SPC sessions
      const consecutiveNegative = progression.consecutive_negative_sessions || 0;
      if (consecutiveNegative >= 2) {
        return {
          shouldActivate: true,
          reason: `${consecutiveNegative} consecutive negative SPC sessions`
        };
      }

      // Trigger 3: Last session SPC very negative (< -2)
      const lastSessionSPC = parseFloat(progression.last_session_spc) || 0;
      if (lastSessionSPC <= -2) {
        return {
          shouldActivate: true,
          reason: `Severe negative session SPC: ${lastSessionSPC.toFixed(2)}`
        };
      }

      return { shouldActivate: false };
    } catch (error) {
      console.error('[SPC Calculator] Error checking defensive mode:', error);
      return { shouldActivate: false };
    }
  }

  /**
   * Calculate profit weight based on profit factor
   */
  private calculateProfitWeight(profitFactor: number): number {
    if (profitFactor >= 1.5) return 1.25;
    if (profitFactor >= 1.0) return 1.0;
    if (profitFactor >= 0.8) return 0.75;
    return 0.5;
  }

  /**
   * Get SPC tier label
   */
  private getSPCTier(spc: number): string {
    if (spc >= 5.0) return 'exceptional';
    if (spc >= 2.0) return 'strong';
    if (spc > 0) return 'positive';
    if (spc === 0) return 'flat';
    return 'negative';
  }

  /**
   * Calculate session grade
   */
  private calculateGrade(winRate: number, profitFactor: number, spc: number): string {
    if (winRate >= 75 && profitFactor >= 2.0 && spc >= 5.0) return 'A+';
    if (winRate >= 70 && profitFactor >= 1.5 && spc >= 3.0) return 'A';
    if (winRate >= 60 && profitFactor >= 1.2 && spc >= 1.0) return 'B';
    if (winRate >= 50 && profitFactor >= 1.0 && spc >= 0) return 'C';
    if (winRate >= 40 && profitFactor >= 0.8) return 'D';
    return 'F';
  }

  /**
   * Get tier requirements list
   */
  getTierRequirements(): TierRequirements[] {
    return this.tierRequirements;
  }
}

export const spcCalculator = new SPCCalculator();
export type { SPCCalculation, TierRequirements, SPCProgress };
