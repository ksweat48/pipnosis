import { supabase } from '@/lib/supabase';
import { cssCalculator, type TradeData } from './css-calculator';
import { aiSessionConsistencyTracker, type ConsistencyValidationResult } from './ai-session-consistency-tracker';

export type SkillLevel = 'Novice' | 'Intermediate' | 'Pro' | 'Expert' | 'Master' | 'Exceptional';

interface SkillLevelThresholds {
  level: SkillLevel;
  minTrades: number;
  minWinRate: number;
  minProfitFactor: number;
  minConsistency: number;
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
  totalBacktestsCompleted?: number;
  totalSyntheticBacktests?: number;
  totalRealBacktests?: number;
  totalTradesForPFCalc?: number; // Total trades (wins+losses) used for profit factor weighting
  last10SessionWRAvg?: number;
  last10SessionPFAvg?: number;
  last10SessionConsistencyPct?: number;
  totalLosingTrades?: number;
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
      minTrades: 500,
      minWinRate: 35,
      minProfitFactor: 1.0,
      minConsistency: 0,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Starting to learn basic patterns.'
    },
    {
      level: 'Intermediate',
      minTrades: 1000,
      minWinRate: 45,
      minProfitFactor: 1.2,
      minConsistency: 35,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Understanding market patterns.'
    },
    {
      level: 'Pro',
      minTrades: 5000,
      minWinRate: 55,
      minProfitFactor: 1.5,
      minConsistency: 45,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Consistently profitable trader.'
    },
    {
      level: 'Expert',
      minTrades: 10000,
      minWinRate: 65,
      minProfitFactor: 1.8,
      minConsistency: 55,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Mastering market dynamics.'
    },
    {
      level: 'Master',
      minTrades: 50000,
      minWinRate: 75,
      minProfitFactor: 2.0,
      minConsistency: 65,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Elite level performance.'
    },
    {
      level: 'Exceptional',
      minTrades: 100000,
      minWinRate: 85,
      minProfitFactor: 2.5,
      minConsistency: 75,
      minAvgRR: 0,
      minCSS: 0,
      description: 'Exceptional trading consistency.'
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
        consistencyFailureReason: data.consistency_failure_reason,
        totalBacktestsCompleted: data.total_backtests_completed || 0,
        totalSyntheticBacktests: data.total_synthetic_backtests || 0,
        totalRealBacktests: data.total_real_backtests || 0,
        totalTradesForPFCalc: data.total_trades_for_pf_calc || data.total_trades_analyzed,
        last10SessionWRAvg: data.last_10_session_wr_avg ? parseFloat(data.last_10_session_wr_avg.toString()) : undefined,
        last10SessionPFAvg: data.last_10_session_pf_avg ? parseFloat(data.last_10_session_pf_avg.toString()) : undefined,
        last10SessionConsistencyPct: data.last_10_session_consistency_pct ? parseFloat(data.last_10_session_consistency_pct.toString()) : undefined,
        totalLosingTrades: data.total_losing_trades || 0
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
      trades_needed_for_next_level: 500,
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
      tradesNeededForNextLevel: 500,
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
   *
   * @param userId - User ID
   * @param winningTradesCount - Number of winning trades in this session
   * @param winRate - Win rate percentage for this session
   * @param profitFactor - Profit factor for this session
   * @param patternsLearned - Number of patterns learned
   * @param sourceType - Type of backtest (backtest, synthetic, live)
   * @param exploratoryTradesCount - Number of exploratory trades
   * @param totalTradesInSession - Total number of trades in session (for confidence accuracy)
   * @param tradesWithConfidence - Trades with confidence scores (for accuracy calculation)
   * @param totalTradesInSession - TOTAL trades in session (wins + losses + breakeven) for proper profit factor weighting
   */
  async updateAfterBacktest(
    userId: string,
    winningTradesCount: number,
    winRate: number,
    profitFactor: number,
    patternsLearned: number,
    sourceType: 'backtest' | 'synthetic' | 'live' | 'event_based_backtest' = 'backtest',
    exploratoryTradesCount: number = 0,
    totalTradesInSession: number = 0,
    tradesWithConfidence: Array<{ confidence: number; outcome: 'win' | 'loss' | 'breakeven' }> = []
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

      // Handle exploratory trades separately with reduced weight
      let exploratoryWeightedTrades = 0;
      if (exploratoryTradesCount > 0) {
        // Exploratory trades get 0.25x weight (half of synthetic's 0.5x)
        const exploratoryWeight = 0.25;
        exploratoryWeightedTrades = Math.round(exploratoryTradesCount * performanceWeight * exploratoryWeight);
        console.log(`[AI Skill Tracker] 🔍 Exploratory trades: ${exploratoryTradesCount} × ${performanceWeight.toFixed(2)} perf × 0.25 = ${exploratoryWeightedTrades} weighted trades`);

        // Subtract exploratory from main count (they were included in winningTradesCount)
        adjustedWinningTrades = Math.round((winningTradesCount - exploratoryTradesCount) * performanceWeight);
      }

      if (sourceType === 'synthetic') {
        adjustedWinningTrades = Math.round(adjustedWinningTrades * 0.5);
        exploratoryWeightedTrades = Math.round(exploratoryWeightedTrades * 0.5);
        console.log(`[AI Skill Tracker] 🔬 Synthetic source: ${winningTradesCount - exploratoryTradesCount} standard trades × ${performanceWeight.toFixed(2)} perf × 0.5 = ${adjustedWinningTrades} weighted trades`);
      } else if (sourceType === 'live') {
        console.log(`[AI Skill Tracker] 🎯 Live trading source: ${winningTradesCount - exploratoryTradesCount} standard trades × ${performanceWeight.toFixed(2)} perf = ${adjustedWinningTrades} weighted trades (2.0x already applied)`);
      } else {
        console.log(`[AI Skill Tracker] 📊 Standard backtest: ${winningTradesCount - exploratoryTradesCount} standard trades × ${performanceWeight.toFixed(2)} performance weight = ${adjustedWinningTrades} weighted trades`);
      }

      // Add exploratory trades back with reduced weight
      adjustedWinningTrades += exploratoryWeightedTrades;
      console.log(`[AI Skill Tracker] 📈 Total weighted trades (standard + exploratory): ${adjustedWinningTrades}`);

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

      // CRITICAL FIX: Profit factor should be weighted by TOTAL trades (not just winning trades)
      // If totalTradesInSession is not provided, estimate from win rate
      const estimatedTotalTrades = totalTradesInSession > 0
        ? totalTradesInSession
        : winRate > 0 && winRate < 100
          ? Math.round(winningTradesCount / (winRate / 100))
          : winningTradesCount;

      const currentTotalTradesForPF = current.totalTradesForPFCalc || current.totalTradesAnalyzed;
      const newTotalTradesForPF = currentTotalTradesForPF + estimatedTotalTrades;

      console.log(`[AI Skill Tracker] Profit Factor Calculation:`);
      console.log(`[AI Skill Tracker]   Current PF: ${current.currentProfitFactor.toFixed(2)} (from ${currentTotalTradesForPF} total trades)`);
      console.log(`[AI Skill Tracker]   Session PF: ${profitFactor.toFixed(2)} (from ${estimatedTotalTrades} total trades)`);

      const newProfitFactor = this.calculateWeightedAverage(
        current.currentProfitFactor,
        currentTotalTradesForPF,
        profitFactor,
        estimatedTotalTrades
      );

      console.log(`[AI Skill Tracker]   New PF: ${newProfitFactor.toFixed(2)} (weighted across ${newTotalTradesForPF} total trades)`);

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

      // === STEP 4: DETERMINE SKILL LEVEL WITH 10-SESSION VALIDATION ===
      const oldLevel = current.currentSkillLevel;
      const skillLevelResult = await this.calculateSkillLevelWith10SessionValidation(
        userId,
        newSuccessfulTrades,
        newWinRate,
        newProfitFactor
      );
      let newLevel = skillLevelResult.level;
      let leveledUp = this.getSkillLevelNumeric(newLevel) > this.getSkillLevelNumeric(oldLevel);

      console.log(`[AI Skill Tracker] Skill level: ${oldLevel} → ${newLevel}${leveledUp ? ' 🎉 LEVEL UP!' : ''}`);
      if (skillLevelResult.blockingReasons.length > 0) {
        console.log(`[AI Skill Tracker] Blocking reasons:`);
        skillLevelResult.blockingReasons.forEach(reason => console.log(`[AI Skill Tracker]   - ${reason}`));
        validationWarnings.push(...skillLevelResult.blockingReasons);
      }

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

        console.log(`[AI Skill Tracker] Consistency check results:`);
        console.log(`[AI Skill Tracker]   - Session count: ${consistencyValidation.sessionCount}/10`);
        console.log(`[AI Skill Tracker]   - WR Spread: ${consistencyValidation.wrSpread.toFixed(1)}% (max: 10%)`);
        console.log(`[AI Skill Tracker]   - PF Average: ${consistencyValidation.pfAverage.toFixed(2)} (required: ${consistencyValidation.requiredPF || 'N/A'})`);
        console.log(`[AI Skill Tracker]   - Passed: ${consistencyValidation.passed}`);

        if (!consistencyValidation.passed && consistencyValidation.sessionCount >= 10) {
          consistencyBlocked = true;
          newLevel = oldLevel; // Block level up
          leveledUp = false;

          validationWarnings.push(`Level advancement blocked: ${consistencyValidation.failureReason}`);
          console.warn(`[AI Skill Tracker] ❌ LEVEL UP BLOCKED due to consistency validation failure`);
          console.warn(`[AI Skill Tracker]   Reason: ${consistencyValidation.failureReason}`);
          console.warn(`[AI Skill Tracker]   Details: WR Range ${consistencyValidation.details.minWR.toFixed(1)}%-${consistencyValidation.details.maxWR.toFixed(1)}%`);
        } else if (consistencyValidation.sessionCount < 10) {
          console.log(`[AI Skill Tracker] ⏳ Consistency validation skipped (only ${consistencyValidation.sessionCount}/10 sessions)`);
          console.log(`[AI Skill Tracker]   Level up ALLOWED - building consistency history`);
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

      // === STEP 5.5: CALCULATE CONFIDENCE ACCURACY ===
      let confidenceAccuracy = current.currentWinRate; // Default to current win rate

      if (tradesWithConfidence.length >= 5) {
        // Calculate confidence calibration: How accurate are our confidence predictions?
        confidenceAccuracy = this.calculateConfidenceAccuracy(tradesWithConfidence);
        console.log(`[AI Skill Tracker] 🎯 Confidence Accuracy: ${confidenceAccuracy.toFixed(1)}%`);
      } else {
        console.log(`[AI Skill Tracker] ⏭️  Skipping confidence accuracy (need 5+ trades, have ${tradesWithConfidence.length})`);
      }

      // === STEP 5.6: INCREMENT SESSION COUNTERS ===
      const sessionCounters = this.calculateSessionCounters(current, sourceType);
      console.log(`[AI Skill Tracker] 📊 Session counters: Total=${sessionCounters.total}, Synthetic=${sessionCounters.synthetic}, Real=${sessionCounters.real}`);

      // === STEP 5.7: CALCULATE 10-SESSION AVERAGES FOR STORAGE ===
      const tenSessionAverages = await this.calculate10SessionAverages(userId);
      console.log(`[AI Skill Tracker] 📈 10-Session Averages for storage: WR=${tenSessionAverages.avgWinRate.toFixed(1)}%, PF=${tenSessionAverages.avgProfitFactor.toFixed(2)}, Consistency=${tenSessionAverages.consistencyPct.toFixed(0)}%`);

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
          total_trades_for_pf_calc: newTotalTradesForPF, // Track total trades for proper PF weighting
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
          // NEW: 10-session averages for skill level validation
          last_10_session_wr_avg: tenSessionAverages.avgWinRate,
          last_10_session_pf_avg: tenSessionAverages.avgProfitFactor,
          last_10_session_consistency_pct: tenSessionAverages.consistencyPct,
          // NEW: Session counters
          total_backtests_completed: sessionCounters.total,
          total_synthetic_backtests: sessionCounters.synthetic,
          total_real_backtests: sessionCounters.real,
          // NEW: Confidence accuracy
          current_confidence_accuracy: confidenceAccuracy,
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
   * Calculate 10-session rolling averages for skill level validation
   * Returns averages for win rate, profit factor, and consistency percentage
   */
  private async calculate10SessionAverages(userId: string): Promise<{
    avgWinRate: number;
    avgProfitFactor: number;
    consistencyPct: number;
    sessionCount: number;
  }> {
    try {
      const { data: sessions, error } = await supabase
        .from('synthetic_backtest_sessions')
        .select('win_rate, profit_factor, total_trades, wins_count')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .not('win_rate', 'is', null)
        .not('profit_factor', 'is', null)
        .gt('total_trades', 0)
        .order('completed_at', { ascending: false })
        .limit(10);

      if (error || !sessions || sessions.length === 0) {
        console.log('[AI Skill Tracker] No sessions found for 10-session calculation');
        return { avgWinRate: 0, avgProfitFactor: 0, consistencyPct: 0, sessionCount: 0 };
      }

      const validSessions = sessions.filter(s => {
        const winRate = parseFloat(s.win_rate?.toString() || '0');
        const profitFactor = parseFloat(s.profit_factor?.toString() || '0');
        return winRate > 0 && profitFactor > 0;
      });

      if (validSessions.length === 0) {
        return { avgWinRate: 0, avgProfitFactor: 0, consistencyPct: 0, sessionCount: 0 };
      }

      const totalWinRate = validSessions.reduce((sum, s) => sum + parseFloat(s.win_rate?.toString() || '0'), 0);
      const totalProfitFactor = validSessions.reduce((sum, s) => sum + parseFloat(s.profit_factor?.toString() || '0'), 0);

      const avgWinRate = totalWinRate / validSessions.length;
      const avgProfitFactor = totalProfitFactor / validSessions.length;

      const consistentSessions = validSessions.filter(s => {
        const wr = parseFloat(s.win_rate?.toString() || '0');
        const pf = parseFloat(s.profit_factor?.toString() || '0');
        return wr >= 35 && pf >= 1.0;
      });

      const consistencyPct = (consistentSessions.length / validSessions.length) * 100;

      console.log(`[AI Skill Tracker] 10-Session Averages: WR=${avgWinRate.toFixed(1)}%, PF=${avgProfitFactor.toFixed(2)}, Consistency=${consistencyPct.toFixed(0)}% (${validSessions.length} sessions)`);

      return {
        avgWinRate,
        avgProfitFactor,
        consistencyPct,
        sessionCount: validSessions.length
      };
    } catch (error) {
      console.error('[AI Skill Tracker] Error calculating 10-session averages:', error);
      return { avgWinRate: 0, avgProfitFactor: 0, consistencyPct: 0, sessionCount: 0 };
    }
  }

  /**
   * Calculate skill level based on specification requirements
   * Must meet ALL FOUR criteria to advance: trades, 10-session win rate avg, 10-session PF avg, and consistency
   * IMPORTANT: Only winning trades count toward totalTrades
   */
  private async calculateSkillLevelWith10SessionValidation(
    userId: string,
    totalTrades: number,
    winRate: number,
    profitFactor: number
  ): Promise<{ level: SkillLevel; blockingReasons: string[] }> {
    const sessionAverages = await this.calculate10SessionAverages(userId);
    const blockingReasons: string[] = [];

    if (sessionAverages.sessionCount < 10) {
      console.log(`[AI Skill Tracker] Insufficient sessions (${sessionAverages.sessionCount}/10) - using instant metrics`);
      const level = this.calculateSkillLevel(totalTrades, winRate, profitFactor);
      return { level, blockingReasons: [] };
    }

    for (let i = this.SKILL_THRESHOLDS.length - 1; i >= 0; i--) {
      const threshold = this.SKILL_THRESHOLDS[i];
      const meetsTradeCount = totalTrades >= threshold.minTrades;
      const meetsWinRate = sessionAverages.avgWinRate >= threshold.minWinRate;
      const meetsProfitFactor = sessionAverages.avgProfitFactor >= threshold.minProfitFactor;
      const meetsConsistency = sessionAverages.consistencyPct >= threshold.minConsistency;

      if (meetsTradeCount && meetsWinRate && meetsProfitFactor && meetsConsistency) {
        return { level: threshold.level, blockingReasons: [] };
      }

      if (i === this.SKILL_THRESHOLDS.length - 1 || totalTrades >= threshold.minTrades) {
        if (!meetsWinRate) {
          blockingReasons.push(`10-session avg WR ${sessionAverages.avgWinRate.toFixed(1)}% < required ${threshold.minWinRate}%`);
        }
        if (!meetsProfitFactor) {
          blockingReasons.push(`10-session avg PF ${sessionAverages.avgProfitFactor.toFixed(2)} < required ${threshold.minProfitFactor.toFixed(2)}`);
        }
        if (!meetsConsistency) {
          blockingReasons.push(`10-session consistency ${sessionAverages.consistencyPct.toFixed(0)}% < required ${threshold.minConsistency}%`);
        }
      }
    }

    return { level: 'Novice', blockingReasons };
  }

  /**
   * Calculate skill level based on specification requirements (legacy - instant metrics)
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
   * Calculate confidence accuracy: How well do confidence predictions match actual outcomes?
   *
   * For example, if we predict 80% confidence, do we win 80% of those trades?
   *
   * @param trades - Array of trades with confidence scores and outcomes
   * @returns Confidence accuracy score (0-100)
   */
  private calculateConfidenceAccuracy(
    trades: Array<{ confidence: number; outcome: 'win' | 'loss' | 'breakeven' }>
  ): number {
    if (trades.length === 0) return 0;

    // Group trades by confidence bucket (70-75, 75-80, 80-85, 85-90, 90-95, 95-100)
    const buckets: Record<string, { total: number; wins: number }> = {
      '70-75': { total: 0, wins: 0 },
      '75-80': { total: 0, wins: 0 },
      '80-85': { total: 0, wins: 0 },
      '85-90': { total: 0, wins: 0 },
      '90-95': { total: 0, wins: 0 },
      '95-100': { total: 0, wins: 0 }
    };

    for (const trade of trades) {
      const bucket = this.getConfidenceBucket(trade.confidence);
      if (bucket) {
        buckets[bucket].total++;
        if (trade.outcome === 'win') {
          buckets[bucket].wins++;
        }
      }
    }

    // Calculate calibration error for each bucket
    let totalError = 0;
    let bucketsWithData = 0;

    for (const [bucketName, data] of Object.entries(buckets)) {
      if (data.total >= 2) { // Need at least 2 trades per bucket
        const bucketMidpoint = this.getBucketMidpoint(bucketName);
        const actualWinRate = (data.wins / data.total) * 100;
        const error = Math.abs(bucketMidpoint - actualWinRate);
        totalError += error;
        bucketsWithData++;
      }
    }

    if (bucketsWithData === 0) {
      // Fallback: Simple win rate
      const wins = trades.filter(t => t.outcome === 'win').length;
      return (wins / trades.length) * 100;
    }

    // Average calibration error
    const avgError = totalError / bucketsWithData;

    // Convert to accuracy: Lower error = higher accuracy
    // Perfect calibration = 0 error = 100% accuracy
    // 50% error = 50% accuracy
    const accuracy = Math.max(0, Math.min(100, 100 - avgError));

    return accuracy;
  }

  /**
   * Get confidence bucket for a given confidence score
   */
  private getConfidenceBucket(confidence: number): string | null {
    if (confidence >= 70 && confidence < 75) return '70-75';
    if (confidence >= 75 && confidence < 80) return '75-80';
    if (confidence >= 80 && confidence < 85) return '80-85';
    if (confidence >= 85 && confidence < 90) return '85-90';
    if (confidence >= 90 && confidence < 95) return '90-95';
    if (confidence >= 95 && confidence <= 100) return '95-100';
    return null;
  }

  /**
   * Get midpoint of confidence bucket
   */
  private getBucketMidpoint(bucket: string): number {
    const midpoints: Record<string, number> = {
      '70-75': 72.5,
      '75-80': 77.5,
      '80-85': 82.5,
      '85-90': 87.5,
      '90-95': 92.5,
      '95-100': 97.5
    };
    return midpoints[bucket] || 80;
  }

  /**
   * Calculate session counters based on source type
   *
   * @param current - Current skill progression data
   * @param sourceType - Type of session that just completed
   * @returns Updated session counters
   */
  private calculateSessionCounters(
    current: SkillProgressionData,
    sourceType: 'backtest' | 'synthetic' | 'live'
  ): { total: number; synthetic: number; real: number } {
    // Get current values from database (they may not exist in the interface yet)
    const currentTotal = (current as any).totalBacktestsCompleted || 0;
    const currentSynthetic = (current as any).totalSyntheticBacktests || 0;
    const currentReal = (current as any).totalRealBacktests || 0;

    let newTotal = currentTotal + 1;
    let newSynthetic = currentSynthetic;
    let newReal = currentReal;

    if (sourceType === 'synthetic') {
      newSynthetic++;
    } else if (sourceType === 'backtest') {
      newReal++;
    }
    // Note: 'live' trades don't count as backtests

    return {
      total: newTotal,
      synthetic: newSynthetic,
      real: newReal
    };
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
