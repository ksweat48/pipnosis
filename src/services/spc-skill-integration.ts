import { supabase } from '@/lib/supabase';
import { spcCalculator } from './spc-calculator';
import { sessionManagementService } from './session-management-service';
import { sessionReportGenerator } from './session-report-generator';

/**
 * SPC Skill Integration Service
 *
 * Integrates SPC (Session Profit Coefficient) with AI Skill Progression:
 * - Combines SPC (60%) with CSS (40%) for skill evaluation
 * - Tracks session-based progress toward skill tiers
 * - Triggers defensive mode based on negative SPC trends
 * - Accelerates progression with exceptional SPC sessions
 */

interface IntegratedSkillScore {
  spcContribution: number; // 60% weight
  cssContribution: number; // 40% weight
  combinedScore: number;
  canLevelUp: boolean;
  reasoning: string[];
}

class SPCSkillIntegration {
  private readonly SPC_WEIGHT = 0.60;
  private readonly CSS_WEIGHT = 0.40;

  /**
   * Calculate integrated skill score combining SPC and CSS
   */
  async calculateIntegratedScore(userId: string): Promise<IntegratedSkillScore | null> {
    try {
      // Get skill progression data
      const { data: progression, error } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !progression) {
        console.error('[SPC Integration] No progression data found');
        return null;
      }

      // Get SPC data
      const cumulativeSPC = parseFloat(progression.cumulative_spc) || 0;
      const sessionCount = progression.session_count || 1;
      const averageSessionSPC = cumulativeSPC / sessionCount;

      // Get CSS data (latest)
      const latestCSS = parseFloat(progression.composite_success_score) || 0;

      // Normalize SPC to 0-100 scale
      // Average session SPC of +3 = good, +5 = excellent
      // Map: -5 to +10 range => 0-100
      const normalizedSPC = Math.max(0, Math.min(100, ((averageSessionSPC + 5) / 15) * 100));

      // Calculate weighted contributions
      const spcContribution = normalizedSPC * this.SPC_WEIGHT;
      const cssContribution = latestCSS * this.CSS_WEIGHT;
      const combinedScore = spcContribution + cssContribution;

      // Evaluate level-up eligibility
      const currentLevel = progression.current_skill_level;
      const eligibility = await spcCalculator.checkTierEligibility(userId, this.getNextLevel(currentLevel));

      const reasoning: string[] = [];

      // Add reasoning based on scores
      if (normalizedSPC >= 70) {
        reasoning.push(`Strong SPC momentum (${averageSessionSPC.toFixed(2)} avg per session)`);
      } else if (normalizedSPC < 40) {
        reasoning.push(`SPC needs improvement (${averageSessionSPC.toFixed(2)} avg per session)`);
      }

      if (latestCSS >= 80) {
        reasoning.push(`Excellent CSS foundation (${latestCSS.toFixed(1)})`);
      } else if (latestCSS < 60) {
        reasoning.push(`CSS needs improvement (${latestCSS.toFixed(1)})`);
      }

      // Check if can level up
      const canLevelUp = eligibility.eligible;

      if (!canLevelUp && eligibility.missingRequirements.length > 0) {
        reasoning.push(...eligibility.missingRequirements);
      }

      return {
        spcContribution,
        cssContribution,
        combinedScore,
        canLevelUp,
        reasoning
      };
    } catch (error) {
      console.error('[SPC Integration] Error calculating integrated score:', error);
      return null;
    }
  }

  /**
   * Process session end and update skill progression
   */
  async processSessionEnd(
    userId: string,
    sessionId: string
  ): Promise<{ success: boolean; leveledUp?: boolean; newLevel?: string }> {
    try {
      console.log(`\n[SPC Integration] 📊 Processing session end for skill progression`);

      // End the session (this calculates final metrics)
      const sessionResult = await sessionManagementService.endSession(userId, sessionId);

      if (!sessionResult.success || !sessionResult.metrics) {
        return { success: false };
      }

      // Get session data
      const { data: session } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (!session) {
        return { success: false };
      }

      const sessionSPC = parseFloat(session.session_spc);

      // Update cumulative SPC
      const spcResult = await spcCalculator.updateCumulativeSPC(userId, sessionSPC);

      if (!spcResult.success) {
        return { success: false };
      }

      // Generate session report
      await sessionReportGenerator.generateSessionReport(userId, sessionId);

      // Check for level up
      const { data: progression } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!progression) {
        return { success: true };
      }

      const currentLevel = progression.current_skill_level;
      const nextLevel = this.getNextLevel(currentLevel);

      // Check if eligible for next level
      const eligibility = await spcCalculator.checkTierEligibility(userId, nextLevel);

      if (eligibility.eligible) {
        // LEVEL UP!
        await this.triggerLevelUp(userId, currentLevel, nextLevel);

        console.log(`[SPC Integration] 🎉 LEVEL UP! ${currentLevel} → ${nextLevel}`);

        return {
          success: true,
          leveledUp: true,
          newLevel: nextLevel
        };
      }

      // Check for defensive mode trigger
      const defensiveModeCheck = await spcCalculator.shouldActivateDefensiveMode(userId);

      if (defensiveModeCheck.shouldActivate) {
        await this.activateDefensiveMode(userId, defensiveModeCheck.reason);
      }

      console.log(`[SPC Integration] ✅ Session processed. Current SPC: ${spcResult.newCumulativeSPC?.toFixed(2)}`);

      return { success: true };
    } catch (error) {
      console.error('[SPC Integration] Error processing session end:', error);
      return { success: false };
    }
  }

  /**
   * Trigger skill level up
   */
  private async triggerLevelUp(
    userId: string,
    fromLevel: string,
    toLevel: string
  ): Promise<void> {
    try {
      // Get current stats
      const { data: progression } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!progression) return;

      // Update skill level
      const newLevelNumeric = this.getLevelNumeric(toLevel);
      const targetSPC = this.getSPCTargetForLevel(toLevel);

      await supabase
        .from('ai_skill_progression')
        .update({
          current_skill_level: toLevel,
          skill_level_numeric: newLevelNumeric,
          previous_skill_level: fromLevel,
          last_level_up_date: new Date().toISOString(),
          last_level_up_trade_count: progression.total_trades_analyzed,
          spc_tier_target: targetSPC,
          progress_to_next_level_percent: 0,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      // Create milestone
      await supabase
        .from('ai_learning_milestones')
        .insert({
          user_id: userId,
          milestone_type: 'skill_level_up',
          milestone_title: `Reached ${toLevel} Level`,
          milestone_description: `Advanced from ${fromLevel} to ${toLevel} through consistent performance and SPC accumulation`,
          skill_level_at_achievement: toLevel,
          total_trades_at_achievement: progression.total_trades_analyzed,
          win_rate_at_achievement: progression.current_win_rate
        });

      console.log(`[SPC Integration] ✅ Level up recorded: ${fromLevel} → ${toLevel}`);
    } catch (error) {
      console.error('[SPC Integration] Error triggering level up:', error);
    }
  }

  /**
   * Activate defensive mode
   */
  private async activateDefensiveMode(userId: string, reason?: string): Promise<void> {
    try {
      console.log(`[SPC Integration] 🛡️ Activating Defensive Mode: ${reason}`);

      // Update ai_risk_state table (from adaptive risk manager)
      const { error } = await supabase
        .from('ai_risk_state')
        .upsert({
          user_id: userId,
          defensive_mode_active: true,
          risk_adjustment_factor: 0.5,
          position_size_multiplier: 0.5,
          min_confidence_threshold: 80,
          activated_at: new Date().toISOString(),
          activation_reason: reason || 'Consecutive negative SPC sessions'
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('[SPC Integration] Error activating defensive mode:', error);
      }
    } catch (error) {
      console.error('[SPC Integration] Exception activating defensive mode:', error);
    }
  }

  /**
   * Get next skill level
   */
  private getNextLevel(currentLevel: string): string {
    const levels = ['Novice', 'Intermediate', 'Pro', 'Expert', 'Master', 'Exceptional'];
    const currentIndex = levels.indexOf(currentLevel);

    if (currentIndex === -1 || currentIndex === levels.length - 1) {
      return currentLevel;
    }

    return levels[currentIndex + 1];
  }

  /**
   * Get numeric level value
   */
  private getLevelNumeric(level: string): number {
    const map: Record<string, number> = {
      'Novice': 1,
      'Intermediate': 2,
      'Pro': 3,
      'Expert': 4,
      'Master': 5,
      'Exceptional': 6
    };
    return map[level] || 1;
  }

  /**
   * Get SPC target for level
   */
  private getSPCTargetForLevel(level: string): number {
    const targets: Record<string, number> = {
      'Novice': 0,
      'Intermediate': 10,
      'Pro': 25,
      'Expert': 50,
      'Master': 100,
      'Exceptional': 200
    };
    return targets[level] || 0;
  }

  /**
   * Get skill progression with SPC integration
   */
  async getIntegratedProgression(userId: string): Promise<any> {
    try {
      const { data: progression } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!progression) return null;

      // Calculate integrated score
      const integratedScore = await this.calculateIntegratedScore(userId);

      // Get SPC progress
      const spcProgress = await spcCalculator.getSPCProgress(userId);

      return {
        ...progression,
        integratedScore,
        spcProgress
      };
    } catch (error) {
      console.error('[SPC Integration] Error getting integrated progression:', error);
      return null;
    }
  }
}

export const spcSkillIntegration = new SPCSkillIntegration();
export type { IntegratedSkillScore };
