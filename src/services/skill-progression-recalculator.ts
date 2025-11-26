/**
 * Skill Progression Recalculator Service
 *
 * Provides functions to manually recalculate profit factor and skill levels
 * when data corruption or calculation errors are detected.
 *
 * This service uses the weighted average method for profit factor calculation:
 * - Each session's PF is weighted by its trade count
 * - Formula: SUM(session_pf * session_trades) / SUM(session_trades)
 * - Properly reflects performance across varying session sizes
 */

import { supabase } from '@/lib/supabase';

interface RecalculationResult {
  success: boolean;
  message: string;
  oldProfitFactor?: number;
  newProfitFactor?: number;
  oldSkillLevel?: string;
  newSkillLevel?: string;
  leveledUp?: boolean;
}

interface ProfitFactorDetails {
  calculatedProfitFactor: number;
  totalSessions: number;
  totalTradesUsed: number;
  weightedSum: number;
  tradeCountSum: number;
}

class SkillProgressionRecalculator {
  /**
   * Recalculate profit factor from historical session data
   * Uses weighted average method to properly reflect performance
   */
  async recalculateProfitFactor(userId: string): Promise<RecalculationResult> {
    try {
      console.log('[Skill Recalculator] Starting profit factor recalculation for user:', userId);

      // Get current state
      const { data: currentProgression, error: fetchError } = await supabase
        .from('ai_skill_progression')
        .select('current_skill_level, current_profit_factor')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError || !currentProgression) {
        console.error('[Skill Recalculator] Failed to fetch current progression:', fetchError);
        return {
          success: false,
          message: 'Failed to fetch current skill progression data'
        };
      }

      const oldProfitFactor = parseFloat(currentProgression.current_profit_factor);
      const oldSkillLevel = currentProgression.current_skill_level;

      // Call database function to recalculate
      const { data: pfDetails, error: calcError } = await supabase
        .rpc('recalculate_profit_factor_from_history', { p_user_id: userId });

      if (calcError || !pfDetails || pfDetails.length === 0) {
        console.error('[Skill Recalculator] Calculation failed:', calcError);
        return {
          success: false,
          message: 'Failed to calculate profit factor from historical data'
        };
      }

      const details = pfDetails[0] as ProfitFactorDetails;
      const newProfitFactor = parseFloat(details.calculatedProfitFactor.toString());

      console.log('[Skill Recalculator] Calculation complete:');
      console.log(`  Old PF: ${oldProfitFactor.toFixed(2)}`);
      console.log(`  New PF: ${newProfitFactor.toFixed(2)}`);
      console.log(`  Sessions: ${details.totalSessions}`);
      console.log(`  Total Trades: ${details.totalTradesUsed}`);

      // Update profit factor
      const { error: updateError } = await supabase
        .from('ai_skill_progression')
        .update({
          current_profit_factor: newProfitFactor,
          total_trades_for_pf_calc: details.totalTradesUsed,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('[Skill Recalculator] Update failed:', updateError);
        return {
          success: false,
          message: 'Failed to update profit factor in database'
        };
      }

      // Re-evaluate skill level
      const levelResult = await this.reevaluateSkillLevel(userId);

      return {
        success: true,
        message: `Profit factor recalculated successfully. Updated from ${oldProfitFactor.toFixed(2)} to ${newProfitFactor.toFixed(2)}.`,
        oldProfitFactor,
        newProfitFactor,
        oldSkillLevel,
        newSkillLevel: levelResult.newSkillLevel,
        leveledUp: levelResult.leveledUp
      };
    } catch (error) {
      console.error('[Skill Recalculator] Exception:', error);
      return {
        success: false,
        message: `Exception during recalculation: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Re-evaluate skill level based on current metrics
   */
  async reevaluateSkillLevel(userId: string): Promise<{
    success: boolean;
    oldSkillLevel?: string;
    newSkillLevel?: string;
    leveledUp: boolean;
  }> {
    try {
      // Get current progression
      const { data: progression, error } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !progression) {
        return { success: false, leveledUp: false };
      }

      const oldSkillLevel = progression.current_skill_level;
      const trades = progression.total_trades_analyzed;
      const winRate = parseFloat(progression.current_win_rate);
      const profitFactor = parseFloat(progression.current_profit_factor);

      // Determine new skill level
      let newSkillLevel = 'Novice';
      let newSkillLevelNumeric = 1;

      if (trades >= 100000 && winRate >= 85 && profitFactor >= 2.5) {
        newSkillLevel = 'Exceptional';
        newSkillLevelNumeric = 6;
      } else if (trades >= 50000 && winRate >= 75 && profitFactor >= 2.0) {
        newSkillLevel = 'Master';
        newSkillLevelNumeric = 5;
      } else if (trades >= 10000 && winRate >= 65 && profitFactor >= 1.8) {
        newSkillLevel = 'Expert';
        newSkillLevelNumeric = 4;
      } else if (trades >= 5000 && winRate >= 55 && profitFactor >= 1.5) {
        newSkillLevel = 'Pro';
        newSkillLevelNumeric = 3;
      } else if (trades >= 1000 && winRate >= 45 && profitFactor >= 1.2) {
        newSkillLevel = 'Intermediate';
        newSkillLevelNumeric = 2;
      }

      const leveledUp = newSkillLevel !== oldSkillLevel;

      if (leveledUp) {
        console.log(`[Skill Recalculator] Level up detected: ${oldSkillLevel} -> ${newSkillLevel}`);

        // Update skill level
        const { error: updateError } = await supabase
          .from('ai_skill_progression')
          .update({
            current_skill_level: newSkillLevel,
            skill_level_numeric: newSkillLevelNumeric,
            previous_skill_level: oldSkillLevel,
            last_level_up_date: new Date().toISOString(),
            last_level_up_trade_count: trades,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);

        if (updateError) {
          console.error('[Skill Recalculator] Failed to update skill level:', updateError);
          return { success: false, leveledUp: false };
        }

        // Create milestone
        await this.createLevelUpMilestone(userId, oldSkillLevel, newSkillLevel, trades, winRate, profitFactor);
      }

      return {
        success: true,
        oldSkillLevel,
        newSkillLevel,
        leveledUp
      };
    } catch (error) {
      console.error('[Skill Recalculator] Exception in reevaluateSkillLevel:', error);
      return { success: false, leveledUp: false };
    }
  }

  /**
   * Create milestone for skill level advancement
   */
  private async createLevelUpMilestone(
    userId: string,
    oldLevel: string,
    newLevel: string,
    trades: number,
    winRate: number,
    profitFactor: number
  ): Promise<void> {
    try {
      // Check if milestone already exists (prevent duplicates)
      const { data: existing } = await supabase
        .from('ai_learning_milestones')
        .select('id')
        .eq('user_id', userId)
        .eq('milestone_type', 'skill_level_up')
        .eq('skill_level_at_achievement', newLevel)
        .gte('achieved_at', new Date(Date.now() - 3600000).toISOString()) // Within last hour
        .maybeSingle();

      if (existing) {
        console.log('[Skill Recalculator] Milestone already exists, skipping creation');
        return;
      }

      const { error } = await supabase
        .from('ai_learning_milestones')
        .insert({
          user_id: userId,
          milestone_type: 'skill_level_up',
          milestone_title: `Reached ${newLevel} Level!`,
          milestone_description: `Advanced from ${oldLevel} to ${newLevel} with ${trades} winning trades, ${winRate.toFixed(1)}% win rate, and ${profitFactor.toFixed(2)} profit factor.`,
          skill_level_at_achievement: newLevel,
          total_trades_at_achievement: trades,
          win_rate_at_achievement: winRate
        });

      if (error) {
        console.error('[Skill Recalculator] Failed to create milestone:', error);
      } else {
        console.log(`[Skill Recalculator] Milestone created: ${newLevel} level achieved!`);
      }
    } catch (error) {
      console.error('[Skill Recalculator] Exception creating milestone:', error);
    }
  }

  /**
   * Get profit factor calculation details for debugging
   */
  async getProfitFactorDetails(userId: string): Promise<ProfitFactorDetails | null> {
    try {
      const { data, error } = await supabase
        .rpc('recalculate_profit_factor_from_history', { p_user_id: userId });

      if (error || !data || data.length === 0) {
        console.error('[Skill Recalculator] Failed to get PF details:', error);
        return null;
      }

      return data[0] as ProfitFactorDetails;
    } catch (error) {
      console.error('[Skill Recalculator] Exception getting PF details:', error);
      return null;
    }
  }
}

export const skillProgressionRecalculator = new SkillProgressionRecalculator();
export type { RecalculationResult, ProfitFactorDetails };
