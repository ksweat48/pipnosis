import { supabase } from '@/lib/supabase';
import { cssCalculator, type TradeData } from './css-calculator';
import { aiSessionConsistencyTracker, type ConsistencyValidationResult } from './ai-session-consistency-tracker';

export type SkillLevel = 'Novice' | 'Intermediate' | 'Pro' | 'Expert' | 'Master' | 'Exceptional';

interface SkillLevelThresholds {
  level: SkillLevel;
  minTrades: number;
  minWinRate: number;
  minProfitFactor: number;
  minAvgRR: number;
  minCSS: number;
  description: string;
}

interface SkillProgressionData {
  currentSkillLevel: SkillLevel;
  skillLevelNumeric: number;
  progressToNextLevelPercent: number;
  totalTradesAnalyzed: number;
  currentWinRate: number;
  targetWinRate: number;
  gapToTarget: number;
  currentProfitFactor: number;
  tradesNeededForNextLevel: number;
  estimatedTradesToMaster: number;
  estimatedTradesToExceptional: number;
  learningVelocityScore: number;
  totalPatternsLearned: number;
  winningPatternsCount: number;
  losingPatternsCount: number;
  currentCyclePosition?: number;
  totalCyclesCompleted?: number;
  last10SessionWRSpread?: number;
  last10SessionPFAverage?: number;
  consistencyValidationPassed?: boolean;
  consistencyFailureReason?: string;
}

interface MilestoneData {
  milestoneType: string;
  milestoneTitle: string;
  milestoneDescription: string;
  achievedAt: string;
  skillLevelAtAchievement: string;
  totalTradesAtAchievement: number;
  winRateAtAchievement: number;
}

class AISkillTracker {
  private readonly SKILL_THRESHOLDS: SkillLevelThresholds[] = [
    {
      level: 'Novice',
      minTrades: 0,
      minWinRate: 0,
      minProfitFactor: 0,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Just starting to learn trading patterns.'
    },
    {
      level: 'Intermediate',
      minTrades: 100,
      minWinRate: 45,
      minProfitFactor: 1.0,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Understanding basic patterns.'
    },
    {
      level: 'Pro',
      minTrades: 1000,
      minWinRate: 55,
      minProfitFactor: 1.5,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Consistent performance with good risk management.'
    },
    {
      level: 'Expert',
      minTrades: 10000,
      minWinRate: 65,
      minProfitFactor: 1.8,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Advanced pattern recognition across conditions.'
    },
    {
      level: 'Master',
      minTrades: 50000,
      minWinRate: 70,
      minProfitFactor: 2.0,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Mastery with exceptional consistency.'
    },
    {
      level: 'Exceptional',
      minTrades: 100000,
      minWinRate: 80,
      minProfitFactor: 2.2,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Peak performance. Elite-level trading.'
    }
  ];

  /**
   * Get or create skill progression record for user
   */
  async getSkillProgression(userId: string): Promise<SkillProgressionData | null> {
    try {
      const { data, error } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('[AI Skill Tracker] Error fetching skill progression:', error);
        return null;
      }

      if (!data) {
        // Create initial record
        return await this.initializeSkillProgression(userId);
      }

      return {
        currentSkillLevel: data.current_skill_level as SkillLevel,
        skillLevelNumeric: data.skill_level_numeric,
        progressToNextLevelPercent: parseFloat(data.progress_to_next_level_percent),
        totalTradesAnalyzed: data.total_trades_analyzed,
        currentWinRate: parseFloat(data.current_win_rate),
        targetWinRate: parseFloat(data.target_win_rate),
        gapToTarget: parseFloat(data.gap_to_target),
        currentProfitFactor: parseFloat(data.current_profit_factor),
        tradesNeededForNextLevel: data.trades_needed_for_next_level,
        estimatedTradesToMaster: data.estimated_trades_to_master,
        estimatedTradesToExceptional: data.estimated_trades_to_exceptional,
        learningVelocityScore: parseFloat(data.learning_velocity_score),
        totalPatternsLearned: data.total_patterns_learned,
        winningPatternsCount: data.winning_patterns_count,
        losingPatternsCount: data.losing_patterns_count,
        currentCyclePosition: data.current_cycle_position,
        totalCyclesCompleted: data.total_cycles_completed,
        last10SessionWRSpread: data.last_10_session_wr_spread ? parseFloat(data.last_10_session_wr_spread.toString()) : undefined,
        last10SessionPFAverage: data.last_10_session_pf_average ? parseFloat(data.last_10_session_pf_average.toString()) : undefined,
        consistencyValidationPassed: data.consistency_validation_passed,
        consistencyFailureReason: data.consistency_failure_reason
      };
    } catch (error) {
      console.error('[AI Skill Tracker] Exception in getSkillProgression:', error);
      return null;
    }
  }

  /**
   * Initialize skill progression for new user
   */
  private async initializeSkillProgression(userId: string): Promise<SkillProgressionData> {
    const initialData = {
      user_id: userId,
      current_skill_level: 'Novice',
      skill_level_numeric: 1,
      progress_to_next_level_percent: 0,
      total_trades_analyzed: 0,
      current_win_rate: 0,
      target_win_rate: 80,
      gap_to_target: 80,
      current_profit_factor: 0,
      trades_needed_for_next_level: 100,
      estimated_trades_to_master: 50000,
      estimated_trades_to_exceptional: 100000,
      learning_velocity_score: 0,
      total_patterns_learned: 0,
      winning_patterns_count: 0,
      losing_patterns_count: 0
    };

    const { error } = await supabase
      .from('ai_skill_progression')
      .insert(initialData);

    if (error) {
      console.error('[AI Skill Tracker] Error initializing skill progression:', error);
    }

    return {
      currentSkillLevel: 'Novice',
      skillLevelNumeric: 1,
      progressToNextLevelPercent: 0,
      totalTradesAnalyzed: 0,
      currentWinRate: 0,
      targetWinRate: 80,
      gapToTarget: 80,
      currentProfitFactor: 0,
      tradesNeededForNextLevel: 100,
      estimatedTradesToMaster: 50000,
      estimatedTradesToExceptional: 100000,
      learningVelocityScore: 0,
      totalPatternsLearned: 0,
      winningPatternsCount: 0,
      losingPatternsCount: 0
    };
  }

  /**
   * Update skill progression after live trading
   * Live trades have 2.0x impact on skill progression compared to backtests
   * IMPORTANT: Only winning trades count toward skill progression
   */
  async updateAfterLiveTrading(
    userId: string,
    winningTradesCount: number,
    winRate: number,
    profitFactor: number,
    patternsLearned: number
  ): Promise<{ leveledUp: boolean; newLevel?: SkillLevel; oldLevel?: SkillLevel; validationWarnings?: string[] }> {
    // Live winning trades count as 2.0x for skill progression (corrected from 1.5x)
    const adjustedWinningTrades = Math.round(winningTradesCount * 2.0);
    return this.updateAfterBacktest(
      userId,
      adjustedWinningTrades,
      winRate,
      profitFactor,
      patternsLearned,
      'live' // Source type for proper weighting
    );
  }

  /**
   * Update skill progression after backtest
   * REVISED: Count ALL trades for progression, but with performance weighting
   * This prevents plateau where AI gets stuck due to only counting wins
   */
  async updateAfterBacktest(
    userId: string,
    winningTradesCount: number,
    winRate: number,
    profitFactor: number,
    patternsLearned: number,
    sourceType: 'backtest' | 'synthetic' | 'live' = 'backtest'
  ): Promise<{ leveledUp: boolean; newLevel?: SkillLevel; oldLevel?: SkillLevel; validationWarnings?: string[] }> {
    const validationWarnings: string[] = [];

    try {
      // === STEP 1: VALIDATE INPUT DATA ===
      console.log(`[AI Skill Tracker] ===== SKILL PROGRESSION UPDATE (${sourceType.toUpperCase()}) =====`);
      console.log(`[AI Skill Tracker] Input - Winning Trades: ${winningTradesCount}, Win Rate: ${winRate.toFixed(1)}%, PF: ${profitFactor.toFixed(2)}`);

      // Validate winning trades count
      if (winningTradesCount < 0) {
        console.error('[AI Skill Tracker] Invalid winningTradesCount: cannot be negative');
        return { leveledUp: false, validationWarnings: ['Invalid winning trades count'] };
      }

      if (winningTradesCount === 0) {
        console.log('[AI Skill Tracker] No winning trades to add. Skipping progression update.');
        return { leveledUp: false, validationWarnings: ['No winning trades to process'] };
      }

      // Validate win rate
      if (winRate < 0 || winRate > 100) {
        console.error(`[AI Skill Tracker] Invalid win rate: ${winRate}%. Must be between 0-100.`);
        validationWarnings.push(`Invalid win rate: ${winRate}%`);
      }

      // Validate profit factor
      if (profitFactor < 0) {
        console.error(`[AI Skill Tracker] Invalid profit factor: ${profitFactor}. Cannot be negative.`);
        validationWarnings.push(`Invalid profit factor: ${profitFactor}`);
      }

      // Warn on poor performance
      if (winRate < 35) {
        validationWarnings.push(`Low win rate (${winRate.toFixed(1)}%). Progression will be minimal.`);
        console.warn(`[AI Skill Tracker] ⚠️  Low win rate detected: ${winRate.toFixed(1)}%`);
      }

      if (profitFactor < 0.5) {
        validationWarnings.push(`Poor profit factor (${profitFactor.toFixed(2)}). Quality threshold not met.`);
        console.warn(`[AI Skill Tracker] ⚠️  Poor profit factor: ${profitFactor.toFixed(2)}`);
      }

      // Get current progression
      const current = await this.getSkillProgression(userId);
      if (!current) {
        console.error('[AI Skill Tracker] Could not get current progression');
        return { leveledUp: false, validationWarnings };
      }

      console.log(`[AI Skill Tracker] Current state - Level: ${current.currentSkillLevel}, Trades: ${current.totalTradesAnalyzed}, WR: ${current.currentWinRate.toFixed(1)}%, PF: ${current.currentProfitFactor.toFixed(2)}`);

      // === STEP 2: APPLY PERFORMANCE-WEIGHTED PROGRESSION ===
      // Key change: We count EXPERIENCE (trades analyzed) but WEIGHT by performance
      // This prevents plateaus while still rewarding quality

      const performanceWeight = Math.min(1.5, Math.max(0.3, (winRate / 100) * (profitFactor / 1.5)));
      let adjustedWinningTrades = Math.round(winningTradesCount * performanceWeight);

      if (sourceType === 'synthetic') {
        adjustedWinningTrades = Math.round(adjustedWinningTrades * 0.5);
        console.log(`[AI Skill Tracker] 🔬 Synthetic source: ${winningTradesCount} trades × ${performanceWeight.toFixed(2)} perf × 0.5 = ${adjustedWinningTrades} weighted trades`);
      } else if (sourceType === 'live') {
        console.log(`[AI Skill Tracker] 🎯 Live trading source: ${winningTradesCount} trades × ${performanceWeight.toFixed(2)} perf = ${adjustedWinningTrades} weighted trades (2.0x already applied)`);
      } else {
        console.log(`[AI Skill Tracker] 📊 Standard backtest: ${winningTradesCount} trades × ${performanceWeight.toFixed(2)} performance weight = ${adjustedWinningTrades} weighted trades`);
      }

      console.log(`[AI Skill Tracker]   Performance Weight: ${performanceWeight.toFixed(2)}x (based on WR: ${winRate.toFixed(1)}%, PF: ${profitFactor.toFixed(2)})`);

      if (performanceWeight < 0.7) {
        validationWarnings.push(`Low performance weight (${(performanceWeight * 100).toFixed(0)}%) - improve win rate or profit factor for faster progression`);
      }

      // === STEP 3: CALCULATE NEW METRICS ===
      const newSuccessfulTrades = current.totalTradesAnalyzed + adjustedWinningTrades;
      const newWinRate = this.calculateWeightedAverage(
        current.currentWinRate,
        current.totalTradesAnalyzed,
        winRate,
        winningTradesCount
      );
      const newProfitFactor = this.calculateWeightedAverage(
        current.currentProfitFactor,
        current.totalTradesAnalyzed,
        profitFactor,
        winningTradesCount
      );
      const newPatternsLearned = current.totalPatternsLearned + patternsLearned;

      // Calculate CSS and avgRR from recent trades
      const recentTrades = await this.getRecentTrades(userId, 100);
      let cssValue = 0;
      let avgRR = 0;

      if (recentTrades.length >= 20) {
        const cssResult = cssCalculator.calculateCSSFromTrades(recentTrades);
        cssValue = cssResult.compositeSuccessScore;
        avgRR = cssResult.rawMetrics.avgRR;
        console.log(`[AI Skill Tracker] Recent performance: CSS=${cssValue.toFixed(2)}, Avg R:R=${avgRR.toFixed(2)}`);
      }

      // === STEP 4: DETERMINE SKILL LEVEL WITH GATING ===
      const oldLevel = current.currentSkillLevel;
      let newLevel = this.calculateSkillLevel(newSuccessfulTrades, newWinRate, newProfitFactor);
      let leveledUp = this.getSkillLevelNumeric(newLevel) > this.getSkillLevelNumeric(oldLevel);

      console.log(`[AI Skill Tracker] Skill level: ${oldLevel} → ${newLevel}${leveledUp ? ' 🎉 LEVEL UP!' : ''}`);

      // === STEP 4.5: CONSISTENCY VALIDATION ===
      let consistencyValidation: ConsistencyValidationResult | null = null;
      let consistencyBlocked = false;

      if (leveledUp) {
        const targetLevelNumeric = this.getSkillLevelNumeric(newLevel);
        const currentLevelNumeric = this.getSkillLevelNumeric(oldLevel);

        console.log(`[AI Skill Tracker] 🔍 Checking consistency requirements for level ${currentLevelNumeric} -> ${targetLevelNumeric}...`);

        consistencyValidation = await aiSessionConsistencyTracker.validateConsistency(
          userId,
          targetLevelNumeric,
          currentLevelNumeric
        );

        if (!consistencyValidation.passed && consistencyValidation.sessionCount >= 10) {
          consistencyBlocked = true;
          newLevel = oldLevel; // Block level up
          leveledUp = false;

          validationWarnings.push(`Level advancement blocked: ${consistencyValidation.failureReason}`);
          console.warn(`[AI Skill Tracker] ❌ LEVEL UP BLOCKED due to consistency validation failure`);
          console.warn(`[AI Skill Tracker]   Reason: ${consistencyValidation.failureReason}`);
        } else if (consistencyValidation.sessionCount < 10) {
          console.log(`[AI Skill Tracker] ⏳ Consistency validation skipped (only ${consistencyValidation.sessionCount}/10 sessions)`);
        } else {
          console.log(`[AI Skill Tracker] ✅ Consistency validation passed!`);
        }
      }

      // === STEP 5: CALCULATE PROGRESS WITH PERFORMANCE GATING ===
      const progressData = this.calculateProgressMetrics(
        newSuccessfulTrades,
        newWinRate,
        newProfitFactor,
        newLevel
      );

      console.log(`[AI Skill Tracker] Progress calculation:`);
      console.log(`[AI Skill Tracker]   - Progress to next: ${progressData.progressPercent.toFixed(1)}%`);
      console.log(`[AI Skill Tracker]   - Trades needed: ${progressData.tradesNeeded}`);
      console.log(`[AI Skill Tracker]   - Performance multiplier: ${progressData.performanceMultiplier?.toFixed(2) || 'N/A'}`);

      // Apply performance gating to prevent false progression
      let gatedProgress = progressData.progressPercent;
      let gatedTradesNeeded = progressData.tradesNeeded;

      // Performance gate: If metrics are poor, cap progression
      if (newWinRate < 35 || newProfitFactor < 0.5) {
        const performancePenalty = Math.max(0.1, Math.min(1.0, (newWinRate / 45) * (newProfitFactor / 1.0)));
        gatedProgress = progressData.progressPercent * performancePenalty;
        validationWarnings.push(`Progression reduced due to performance (${(performancePenalty * 100).toFixed(0)}% of normal)`);
        console.warn(`[AI Skill Tracker] ⚠️  Performance gating applied: ${(performancePenalty * 100).toFixed(0)}% multiplier`);
      }

      // Regression detection: If recent performance is significantly worse than historical
      const performanceDelta = newWinRate - current.currentWinRate;
      if (current.totalTradesAnalyzed > 50 && performanceDelta < -10) {
        const regressionPenalty = 0.5;
        gatedProgress = gatedProgress * regressionPenalty;
        validationWarnings.push(`Performance regression detected (${performanceDelta.toFixed(1)}% WR drop). Progression slowed.`);
        console.warn(`[AI Skill Tracker] ⚠️  Regression detected: Win rate dropped ${Math.abs(performanceDelta).toFixed(1)}%. Applying 50% penalty.`);
      }

      // PLATEAU BONUS: Reward consistent high performance
      if (newWinRate >= 75 && Math.abs(performanceDelta) <= 2 && current.totalTradesAnalyzed >= 100) {
        const consistencyBonus = 1.15;
        gatedProgress = Math.min(100, gatedProgress * consistencyBonus);
        console.log(`[AI Skill Tracker] 🎯 Consistency bonus applied! Stable ${newWinRate.toFixed(1)}% performance (+15%)`);
      }

      // BREAKTHROUGH BONUS: Reward significant improvements
      if (performanceDelta >= 5) {
        const breakthroughBonus = 1.25;
        gatedProgress = Math.min(100, gatedProgress * breakthroughBonus);
        console.log(`[AI Skill Tracker] 🚀 Breakthrough bonus! Win rate improved by ${performanceDelta.toFixed(1)}% (+25%)`);
      }

      console.log(`[AI Skill Tracker] Final gated progress: ${gatedProgress.toFixed(1)}%`);

      // === STEP 6: UPDATE DATABASE ===
      const { error } = await supabase
        .from('ai_skill_progression')
        .update({
          current_skill_level: newLevel,
          skill_level_numeric: this.getSkillLevelNumeric(newLevel),
          progress_to_next_level_percent: gatedProgress, // Use gated progress
          total_trades_analyzed: newSuccessfulTrades,
          current_win_rate: newWinRate,
          gap_to_target: 80 - newWinRate,
          current_profit_factor: newProfitFactor,
          trades_needed_for_next_level: gatedTradesNeeded,
          estimated_trades_to_master: Math.max(0, 50000 - newSuccessfulTrades),
          estimated_trades_to_exceptional: Math.max(0, 100000 - newSuccessfulTrades),
          total_patterns_learned: newPatternsLearned,
          learning_velocity_score: this.calculateLearningVelocity(current.totalTradesAnalyzed, newSuccessfulTrades, current.currentWinRate, newWinRate),
          previous_skill_level: leveledUp ? oldLevel : current.currentSkillLevel,
          last_level_up_date: leveledUp ? new Date().toISOString() : undefined,
          last_level_up_trade_count: leveledUp ? newSuccessfulTrades : undefined,
          last_trade_analyzed_date: new Date().toISOString(),
          last_10_session_wr_spread: consistencyValidation?.wrSpread || 0,
          last_10_session_pf_average: consistencyValidation?.pfAverage || 0,
          consistency_validation_passed: !consistencyBlocked,
          consistency_failure_reason: consistencyBlocked ? consistencyValidation?.failureReason : null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) {
        console.error('[AI Skill Tracker] ❌ Error updating skill progression:', error);
        validationWarnings.push('Database update failed');
      } else {
        console.log('[AI Skill Tracker] ✅ Database updated successfully');
      }

      // === STEP 7: RECORD MILESTONES ===
      if (leveledUp) {
        await this.recordMilestone(userId, {
          milestoneType: 'skill_level_up',
          milestoneTitle: `Reached ${newLevel} Level!`,
          milestoneDescription: `Advanced from ${oldLevel} to ${newLevel} after ${newSuccessfulTrades} successful winning trades with ${newWinRate.toFixed(1)}% win rate.`,
          skillLevelAtAchievement: newLevel,
          totalTradesAtAchievement: newSuccessfulTrades,
          winRateAtAchievement: newWinRate
        });
      }

      // Check for other milestones
      await this.checkAndRecordMilestones(userId, newSuccessfulTrades, newWinRate, newProfitFactor, newLevel);

      console.log(`[AI Skill Tracker] ===== UPDATE COMPLETE =====\n`);

      return {
        leveledUp,
        newLevel: leveledUp ? newLevel : undefined,
        oldLevel: leveledUp ? oldLevel : undefined,
        validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined
      };
    } catch (error) {
      console.error('[AI Skill Tracker] ❌ Exception in updateAfterBacktest:', error);
      return { leveledUp: false, validationWarnings: [`Exception: ${error instanceof Error ? error.message : 'Unknown error'}`] };
    }
  }

  /**
   * Calculate skill level based on specification requirements
   * Must meet ALL three criteria to advance: trades, win rate, and profit factor
   * IMPORTANT: Only winning trades count toward totalTrades
   */
  private calculateSkillLevel(
    totalTrades: number,
    winRate: number,
    profitFactor: number
  ): SkillLevel {
    // Start from highest level and work down
    for (let i = this.SKILL_THRESHOLDS.length - 1; i >= 0; i--) {
      const threshold = this.SKILL_THRESHOLDS[i];
      // Must meet ALL three core criteria (as per specification)
      if (
        totalTrades >= threshold.minTrades &&
        winRate >= threshold.minWinRate &&
        profitFactor >= threshold.minProfitFactor
      ) {
        return threshold.level;
      }
    }
    return 'Novice';
  }

  /**
   * Calculate progress metrics for current level
   * Enhanced with performance multipliers and detailed breakdown
   */
  private calculateProgressMetrics(
    totalTrades: number,
    winRate: number,
    profitFactor: number,
    currentLevel: SkillLevel
  ): {
    progressPercent: number;
    tradesNeeded: number;
    performanceMultiplier?: number;
    breakdown?: {
      tradesProgress: number;
      winRateProgress: number;
      profitFactorProgress: number;
    };
  } {
    const currentLevelIndex = this.SKILL_THRESHOLDS.findIndex(t => t.level === currentLevel);
    if (currentLevelIndex === this.SKILL_THRESHOLDS.length - 1) {
      // Already at max level
      return { progressPercent: 100, tradesNeeded: 0 };
    }

    const currentThreshold = this.SKILL_THRESHOLDS[currentLevelIndex];
    const nextThreshold = this.SKILL_THRESHOLDS[currentLevelIndex + 1];

    // Calculate progress based on trades (primary metric)
    const tradesProgress = Math.min(100, Math.max(0,
      ((totalTrades - currentThreshold.minTrades) /
        (nextThreshold.minTrades - currentThreshold.minTrades)) * 100
    ));

    // Calculate progress based on win rate
    // If win rate is below current threshold, progress is negative (capped at 0)
    const winRateProgress = Math.min(100, Math.max(0,
      ((winRate - currentThreshold.minWinRate) /
        (nextThreshold.minWinRate - currentThreshold.minWinRate)) * 100
    ));

    // Calculate progress based on profit factor
    const profitFactorProgress = Math.min(100, Math.max(0,
      ((profitFactor - currentThreshold.minProfitFactor) /
        (nextThreshold.minProfitFactor - currentThreshold.minProfitFactor)) * 100
    ));

    // Calculate performance multiplier based on how close metrics are to next level requirements
    // This penalizes progression when performance metrics are weak
    let performanceMultiplier = 1.0;

    // If win rate is significantly below next level requirement, reduce progression
    const winRateGap = nextThreshold.minWinRate - winRate;
    if (winRateGap > 10) {
      performanceMultiplier *= Math.max(0.5, 1 - (winRateGap / 100));
    }

    // If profit factor is below next level requirement, reduce progression
    const pfGap = nextThreshold.minProfitFactor - profitFactor;
    if (pfGap > 0.3) {
      performanceMultiplier *= Math.max(0.5, 1 - (pfGap / 2));
    }

    // Overall progress is weighted average (trades count most)
    // But ALL metrics must show positive progress to advance meaningfully
    let rawProgress = (tradesProgress * 0.5) + (winRateProgress * 0.3) + (profitFactorProgress * 0.2);

    // Apply performance multiplier
    rawProgress = rawProgress * performanceMultiplier;

    const progressPercent = Math.min(100, Math.max(0, rawProgress));

    const tradesNeeded = Math.max(0, nextThreshold.minTrades - totalTrades);

    return {
      progressPercent,
      tradesNeeded,
      performanceMultiplier,
      breakdown: {
        tradesProgress,
        winRateProgress,
        profitFactorProgress
      }
    };
  }

  /**
   * Get skill level numeric value
   */
  private getSkillLevelNumeric(level: SkillLevel): number {
    const index = this.SKILL_THRESHOLDS.findIndex(t => t.level === level);
    return index + 1;
  }

  /**
   * Calculate weighted average for metrics
   */
  private calculateWeightedAverage(
    oldValue: number,
    oldCount: number,
    newValue: number,
    newCount: number
  ): number {
    if (oldCount + newCount === 0) return 0;
    return ((oldValue * oldCount) + (newValue * newCount)) / (oldCount + newCount);
  }

  /**
   * Calculate learning velocity (how fast AI is improving)
   */
  private calculateLearningVelocity(
    oldTrades: number,
    newTrades: number,
    oldWinRate: number,
    newWinRate: number
  ): number {
    if (oldTrades === 0 || newTrades - oldTrades === 0) return 0;
    const winRateImprovement = newWinRate - oldWinRate;
    const tradesAdded = newTrades - oldTrades;
    // Velocity = win rate improvement per 100 trades
    return (winRateImprovement / tradesAdded) * 100;
  }

  /**
   * Record a milestone achievement
   */
  async recordMilestone(userId: string, milestone: Omit<MilestoneData, 'achievedAt'>): Promise<void> {
    try {
      const { error } = await supabase
        .from('ai_learning_milestones')
        .insert({
          user_id: userId,
          milestone_type: milestone.milestoneType,
          milestone_title: milestone.milestoneTitle,
          milestone_description: milestone.milestoneDescription,
          skill_level_at_achievement: milestone.skillLevelAtAchievement,
          total_trades_at_achievement: milestone.totalTradesAtAchievement,
          win_rate_at_achievement: milestone.winRateAtAchievement
        });

      if (error) {
        console.error('[AI Skill Tracker] Error recording milestone:', error);
      } else {
        console.log(`[AI Skill Tracker] 🏆 Milestone achieved: ${milestone.milestoneTitle}`);
      }
    } catch (error) {
      console.error('[AI Skill Tracker] Exception recording milestone:', error);
    }
  }

  /**
   * Check and record various milestone achievements
   */
  private async checkAndRecordMilestones(
    userId: string,
    totalTrades: number,
    winRate: number,
    profitFactor: number,
    skillLevel: SkillLevel
  ): Promise<void> {
    // Trade count milestones
    const tradeCountMilestones = [100, 500, 1000, 2500, 5000, 10000];
    for (const milestone of tradeCountMilestones) {
      if (totalTrades === milestone) {
        await this.recordMilestone(userId, {
          milestoneType: 'trade_count',
          milestoneTitle: `${milestone} Trades Analyzed!`,
          milestoneDescription: `Reached ${milestone} total trades analyzed. Keep learning!`,
          skillLevelAtAchievement: skillLevel,
          totalTradesAtAchievement: totalTrades,
          winRateAtAchievement: winRate
        });
      }
    }

    // Win rate milestones
    if (winRate >= 60 && winRate < 61) {
      await this.recordMilestone(userId, {
        milestoneType: 'win_rate_target',
        milestoneTitle: '60% Win Rate Achieved!',
        milestoneDescription: 'Consistently profitable trading achieved.',
        skillLevelAtAchievement: skillLevel,
        totalTradesAtAchievement: totalTrades,
        winRateAtAchievement: winRate
      });
    }

    if (winRate >= 70 && winRate < 71) {
      await this.recordMilestone(userId, {
        milestoneType: 'win_rate_target',
        milestoneTitle: '70% Win Rate Achieved!',
        milestoneDescription: 'Excellent trading performance!',
        skillLevelAtAchievement: skillLevel,
        totalTradesAtAchievement: totalTrades,
        winRateAtAchievement: winRate
      });
    }

    if (winRate >= 80) {
      await this.recordMilestone(userId, {
        milestoneType: 'win_rate_target',
        milestoneTitle: '80% Win Rate Target Reached!',
        milestoneDescription: 'Elite-level trading performance achieved!',
        skillLevelAtAchievement: skillLevel,
        totalTradesAtAchievement: totalTrades,
        winRateAtAchievement: winRate
      });
    }
  }

  /**
   * Get recent milestones
   */
  async getRecentMilestones(userId: string, limit: number = 10): Promise<MilestoneData[]> {
    try {
      const { data, error } = await supabase
        .from('ai_learning_milestones')
        .select('*')
        .eq('user_id', userId)
        .order('achieved_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[AI Skill Tracker] Error fetching milestones:', error);
        return [];
      }

      return (data || []).map(m => ({
        milestoneType: m.milestone_type,
        milestoneTitle: m.milestone_title,
        milestoneDescription: m.milestone_description,
        achievedAt: m.achieved_at,
        skillLevelAtAchievement: m.skill_level_at_achievement,
        totalTradesAtAchievement: m.total_trades_at_achievement,
        winRateAtAchievement: parseFloat(m.win_rate_at_achievement)
      }));
    } catch (error) {
      console.error('[AI Skill Tracker] Exception fetching milestones:', error);
      return [];
    }
  }

  /**
   * Get skill level thresholds for display
   */
  getSkillLevelThresholds(): SkillLevelThresholds[] {
    return this.SKILL_THRESHOLDS;
  }

  /**
   * Get description for a skill level
   */
  getSkillLevelDescription(level: SkillLevel): string {
    const threshold = this.SKILL_THRESHOLDS.find(t => t.level === level);
    return threshold?.description || '';
  }

  /**
   * Get recent trades for CSS calculation
   */
  private async getRecentTrades(userId: string, limit: number): Promise<TradeData[]> {
    try {
      const { data: trades, error } = await supabase
        .from('trade_history')
        .select('*')
        .eq('user_id', userId)
        .order('closed_at', { ascending: false })
        .limit(limit);

      if (error || !trades) {
        console.error('[AI Skill Tracker] Error fetching recent trades:', error);
        return [];
      }

      return trades.map(t => ({
        outcome: parseFloat(t.profit_loss.toString()) > 0 ? 'win' : (parseFloat(t.profit_loss.toString()) < 0 ? 'loss' : 'breakeven'),
        pnl: parseFloat(t.profit_loss.toString()),
        entryPrice: parseFloat(t.entry_price.toString()),
        exitPrice: parseFloat(t.exit_price.toString()),
        stopLoss: parseFloat(t.stop_loss.toString()),
        takeProfit: parseFloat(t.take_profit.toString())
      })) as TradeData[];
    } catch (error) {
      console.error('[AI Skill Tracker] Exception fetching recent trades:', error);
      return [];
    }
  }
}

export const aiSkillTracker = new AISkillTracker();
export type { SkillProgressionData, MilestoneData, SkillLevelThresholds };
