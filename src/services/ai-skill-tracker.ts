import { supabase } from '@/lib/supabase';
import { cssCalculator, type TradeData } from './css-calculator';

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
      minWinRate: 50,
      minProfitFactor: 1.0,
      minAvgRR: 1.2,
      minCSS: 60,
      description: 'Understanding basic patterns.'
    },
    {
      level: 'Pro',
      minTrades: 500,
      minWinRate: 60,
      minProfitFactor: 1.3,
      minAvgRR: 1.5,
      minCSS: 70,
      description: 'Consistent performance with good risk management.'
    },
    {
      level: 'Expert',
      minTrades: 1500,
      minWinRate: 65,
      minProfitFactor: 1.6,
      minAvgRR: 1.8,
      minCSS: 80,
      description: 'Advanced pattern recognition across conditions.'
    },
    {
      level: 'Master',
      minTrades: 5000,
      minWinRate: 70,
      minProfitFactor: 1.8,
      minAvgRR: 2.0,
      minCSS: 85,
      description: 'Mastery with exceptional consistency.'
    },
    {
      level: 'Exceptional',
      minTrades: 10000,
      minWinRate: 75,
      minProfitFactor: 2.0,
      minAvgRR: 2.2,
      minCSS: 90,
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
        losingPatternsCount: data.losing_patterns_count
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
      estimated_trades_to_master: 5000,
      estimated_trades_to_exceptional: 10000,
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
      estimatedTradesToMaster: 5000,
      estimatedTradesToExceptional: 10000,
      learningVelocityScore: 0,
      totalPatternsLearned: 0,
      winningPatternsCount: 0,
      losingPatternsCount: 0
    };
  }

  /**
   * Update skill progression after live trading
   * Live trades have 1.5x impact on skill progression compared to backtests
   */
  async updateAfterLiveTrading(
    userId: string,
    tradesAnalyzed: number,
    winRate: number,
    profitFactor: number,
    patternsLearned: number
  ): Promise<{ leveledUp: boolean; newLevel?: SkillLevel; oldLevel?: SkillLevel }> {
    // Live trades count as 1.5x for skill progression
    const adjustedTradesAnalyzed = Math.round(tradesAnalyzed * 1.5);
    return this.updateAfterBacktest(
      userId,
      adjustedTradesAnalyzed,
      winRate,
      profitFactor,
      patternsLearned
    );
  }

  /**
   * Update skill progression after backtest
   */
  async updateAfterBacktest(
    userId: string,
    tradesAnalyzed: number,
    winRate: number,
    profitFactor: number,
    patternsLearned: number
  ): Promise<{ leveledUp: boolean; newLevel?: SkillLevel; oldLevel?: SkillLevel }> {
    try {
      // Get current progression
      const current = await this.getSkillProgression(userId);
      if (!current) {
        console.error('[AI Skill Tracker] Could not get current progression');
        return { leveledUp: false };
      }

      // Calculate new totals
      const newTotalTrades = current.totalTradesAnalyzed + tradesAnalyzed;
      const newWinRate = this.calculateWeightedAverage(
        current.currentWinRate,
        current.totalTradesAnalyzed,
        winRate,
        tradesAnalyzed
      );
      const newProfitFactor = this.calculateWeightedAverage(
        current.currentProfitFactor,
        current.totalTradesAnalyzed,
        profitFactor,
        tradesAnalyzed
      );
      const newPatternsLearned = current.totalTradesAnalyzed + patternsLearned;

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

      // Determine new skill level (requires CSS now)
      const oldLevel = current.currentSkillLevel;
      const newLevel = this.calculateSkillLevel(newTotalTrades, newWinRate, newProfitFactor, avgRR, cssValue);
      const leveledUp = this.getSkillLevelNumeric(newLevel) > this.getSkillLevelNumeric(oldLevel);

      // Calculate progress metrics
      const progressData = this.calculateProgressMetrics(newTotalTrades, newWinRate, newProfitFactor, avgRR, cssValue, newLevel);

      // Update database
      const { error } = await supabase
        .from('ai_skill_progression')
        .update({
          current_skill_level: newLevel,
          skill_level_numeric: this.getSkillLevelNumeric(newLevel),
          progress_to_next_level_percent: progressData.progressPercent,
          total_trades_analyzed: newTotalTrades,
          current_win_rate: newWinRate,
          gap_to_target: 80 - newWinRate,
          current_profit_factor: newProfitFactor,
          trades_needed_for_next_level: progressData.tradesNeeded,
          estimated_trades_to_master: Math.max(0, 5000 - newTotalTrades),
          estimated_trades_to_exceptional: Math.max(0, 10000 - newTotalTrades),
          total_patterns_learned: newPatternsLearned,
          learning_velocity_score: this.calculateLearningVelocity(current.totalTradesAnalyzed, newTotalTrades, current.currentWinRate, newWinRate),
          previous_skill_level: leveledUp ? oldLevel : current.currentSkillLevel,
          last_level_up_date: leveledUp ? new Date().toISOString() : undefined,
          last_level_up_trade_count: leveledUp ? newTotalTrades : undefined,
          last_trade_analyzed_date: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) {
        console.error('[AI Skill Tracker] Error updating skill progression:', error);
      }

      // Record milestone if leveled up
      if (leveledUp) {
        await this.recordMilestone(userId, {
          milestoneType: 'skill_level_up',
          milestoneTitle: `Reached ${newLevel} Level!`,
          milestoneDescription: `Advanced from ${oldLevel} to ${newLevel} after analyzing ${newTotalTrades} total trades with ${newWinRate.toFixed(1)}% win rate.`,
          skillLevelAtAchievement: newLevel,
          totalTradesAtAchievement: newTotalTrades,
          winRateAtAchievement: newWinRate
        });
      }

      // Check for other milestones
      await this.checkAndRecordMilestones(userId, newTotalTrades, newWinRate, newProfitFactor, newLevel);

      return { leveledUp, newLevel: leveledUp ? newLevel : undefined, oldLevel: leveledUp ? oldLevel : undefined };
    } catch (error) {
      console.error('[AI Skill Tracker] Exception in updateAfterBacktest:', error);
      return { leveledUp: false };
    }
  }

  /**
   * Calculate skill level based on balanced performance (CSS-based)
   * Must meet ALL criteria to advance
   */
  private calculateSkillLevel(
    totalTrades: number,
    winRate: number,
    profitFactor: number,
    avgRR: number,
    css: number
  ): SkillLevel {
    // Start from highest level and work down
    for (let i = this.SKILL_THRESHOLDS.length - 1; i >= 0; i--) {
      const threshold = this.SKILL_THRESHOLDS[i];
      // Must meet ALL criteria
      if (
        totalTrades >= threshold.minTrades &&
        winRate >= threshold.minWinRate &&
        profitFactor >= threshold.minProfitFactor &&
        avgRR >= threshold.minAvgRR &&
        css >= threshold.minCSS
      ) {
        return threshold.level;
      }
    }
    return 'Novice';
  }

  /**
   * Calculate progress metrics for current level
   */
  private calculateProgressMetrics(
    totalTrades: number,
    winRate: number,
    profitFactor: number,
    avgRR: number,
    css: number,
    currentLevel: SkillLevel
  ): { progressPercent: number; tradesNeeded: number } {
    const currentLevelIndex = this.SKILL_THRESHOLDS.findIndex(t => t.level === currentLevel);
    if (currentLevelIndex === this.SKILL_THRESHOLDS.length - 1) {
      // Already at max level
      return { progressPercent: 100, tradesNeeded: 0 };
    }

    const currentThreshold = this.SKILL_THRESHOLDS[currentLevelIndex];
    const nextThreshold = this.SKILL_THRESHOLDS[currentLevelIndex + 1];

    // Calculate progress based on trades (primary metric)
    const tradesProgress = ((totalTrades - currentThreshold.minTrades) /
      (nextThreshold.minTrades - currentThreshold.minTrades)) * 100;

    // Calculate progress based on win rate
    const winRateProgress = ((winRate - currentThreshold.minWinRate) /
      (nextThreshold.minWinRate - currentThreshold.minWinRate)) * 100;

    // Calculate progress based on profit factor
    const profitFactorProgress = ((profitFactor - currentThreshold.minProfitFactor) /
      (nextThreshold.minProfitFactor - currentThreshold.minProfitFactor)) * 100;

    // Overall progress is weighted average (trades count most)
    const progressPercent = Math.min(100, Math.max(0,
      (tradesProgress * 0.5) + (winRateProgress * 0.3) + (profitFactorProgress * 0.2)
    ));

    const tradesNeeded = Math.max(0, nextThreshold.minTrades - totalTrades);

    return { progressPercent, tradesNeeded };
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
