/**
 * Adaptive Learning Coordinator
 *
 * Central engine for Layer 3 adaptive adjustments:
 * - Reads pattern similarity from historical performance
 * - Applies graduated adaptation (not binary blocks)
 * - Applies age decay (recent patterns matter more)
 * - Merges adjustments from all layers
 * - Ensures safety clamps (risk/SL/TP/confidence limits)
 * - Stores adjustments in database for transparency
 *
 * CRITICAL: This system LEARNS and ADJUSTS, it does NOT BLOCK.
 * Poor patterns get reduced confidence, not rejected.
 */

import { supabase } from '../lib/supabase';

export interface PatternPerformance {
  patternId: string;
  patternName: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  avgRR: number;
  lastSeenDaysAgo: number;
  confidenceScore: number;
}

export interface AdaptiveAdjustments {
  // Adjustments
  confidenceAdjustment: number; // -30 to +30
  riskAdjustment: number; // -50% to +50%
  slAdjustment: number; // -50% to +50%
  tpAdjustment: number; // -50% to +100%

  // Final values (after clamping)
  adjustedConfidence: number;
  adjustedRiskPct: number;
  adjustedSLDistance: number;
  adjustedTPDistance: number;

  // Reasoning
  reasoning: string[];
  similarPatterns: PatternPerformance[];
  ageDecayApplied: boolean;
  graduatedResponse: string;
}

export interface SafetyClamps {
  minConfidence: number;
  maxConfidence: number;
  minRiskPct: number;
  maxRiskPct: number;
  minSLDistance: number;
  maxSLDistance: number;
  minTPDistance: number;
  maxTPDistance: number;
}

class AdaptiveLearningCoordinator {
  private readonly DEFAULT_CLAMPS: SafetyClamps = {
    minConfidence: 30,
    maxConfidence: 95,
    minRiskPct: 0.25,
    maxRiskPct: 2.0,
    minSLDistance: 10,
    maxSLDistance: 100,
    minTPDistance: 15,
    maxTPDistance: 300,
  };

  private readonly AGE_DECAY_DAYS = 30;
  private readonly RECENT_PATTERN_BOOST = 1.2;

  /**
   * Calculate adaptive adjustments based on pattern performance
   */
  async calculateAdjustments(
    userId: string,
    symbol: string,
    setupType: string,
    baseConfidence: number,
    baseRiskPct: number,
    baseSLDistance: number,
    baseTPDistance: number,
    marketConditions?: any
  ): Promise<AdaptiveAdjustments> {
    console.log(`[Adaptive Learning] Calculating adjustments for ${symbol} ${setupType}...`);

    // Fetch similar patterns from history
    const similarPatterns = await this.fetchSimilarPatterns(
      userId,
      symbol,
      setupType,
      marketConditions
    );

    if (similarPatterns.length === 0) {
      console.log('[Adaptive Learning] No historical patterns found - using base values');
      return this.createNeutralAdjustments(baseConfidence, baseRiskPct, baseSLDistance, baseTPDistance);
    }

    // Apply age decay to pattern weights
    const weightedPatterns = this.applyAgeDecay(similarPatterns);

    // Calculate graduated adjustments
    const adjustments = this.calculateGraduatedAdjustments(
      weightedPatterns,
      baseConfidence,
      baseRiskPct,
      baseSLDistance,
      baseTPDistance
    );

    console.log(`[Adaptive Learning] Adjustments calculated:`);
    console.log(`  Confidence: ${baseConfidence} → ${adjustments.adjustedConfidence} (${adjustments.confidenceAdjustment >= 0 ? '+' : ''}${adjustments.confidenceAdjustment.toFixed(1)})`);
    console.log(`  Risk: ${baseRiskPct.toFixed(2)}% → ${adjustments.adjustedRiskPct.toFixed(2)}% (${adjustments.riskAdjustment >= 0 ? '+' : ''}${adjustments.riskAdjustment.toFixed(1)}%)`);
    console.log(`  Reasoning: ${adjustments.reasoning.join(', ')}`);

    return adjustments;
  }

  /**
   * Fetch similar patterns from trading history
   */
  private async fetchSimilarPatterns(
    userId: string,
    symbol: string,
    setupType: string,
    marketConditions?: any
  ): Promise<PatternPerformance[]> {
    const { data: trades, error } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('entry_time', { ascending: false })
      .limit(50);

    if (error || !trades || trades.length === 0) {
      return [];
    }

    // Group by pattern similarity
    const patternGroups = new Map<string, any[]>();

    for (const trade of trades) {
      const patterns = trade.matching_historical_patterns || [];
      for (const pattern of patterns) {
        if (!patternGroups.has(pattern)) {
          patternGroups.set(pattern, []);
        }
        patternGroups.get(pattern)!.push(trade);
      }
    }

    // Calculate performance for each pattern
    const performances: PatternPerformance[] = [];

    for (const [patternName, patternTrades] of patternGroups.entries()) {
      if (patternTrades.length < 3) continue; // Need minimum sample size

      const wins = patternTrades.filter(t => t.outcome === 'win').length;
      const losses = patternTrades.filter(t => t.outcome === 'loss').length;
      const winRate = (wins / patternTrades.length) * 100;

      const totalWins = patternTrades
        .filter(t => t.outcome === 'win')
        .reduce((sum, t) => sum + (t.pnl || 0), 0);
      const totalLosses = Math.abs(
        patternTrades
          .filter(t => t.outcome === 'loss')
          .reduce((sum, t) => sum + (t.pnl || 0), 0)
      );
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

      const avgRR = patternTrades.reduce((sum, t) => sum + (t.risk_reward_at_entry || 0), 0) / patternTrades.length;

      const lastTrade = patternTrades[0];
      const lastSeenDaysAgo = Math.floor(
        (Date.now() - new Date(lastTrade.entry_time).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Calculate confidence score based on win rate and profit factor
      const confidenceScore = (winRate * 0.6 + Math.min(profitFactor * 20, 40)) / 100;

      performances.push({
        patternId: patternName,
        patternName,
        totalTrades: patternTrades.length,
        winRate,
        profitFactor,
        avgRR,
        lastSeenDaysAgo,
        confidenceScore,
      });
    }

    return performances.sort((a, b) => b.totalTrades - a.totalTrades).slice(0, 5);
  }

  /**
   * Apply age decay to pattern weights
   */
  private applyAgeDecay(patterns: PatternPerformance[]): PatternPerformance[] {
    return patterns.map(pattern => {
      const ageDecayFactor = Math.max(
        0.5,
        1 - (pattern.lastSeenDaysAgo / this.AGE_DECAY_DAYS)
      );

      const recentBoost = pattern.lastSeenDaysAgo < 7 ? this.RECENT_PATTERN_BOOST : 1.0;

      return {
        ...pattern,
        confidenceScore: pattern.confidenceScore * ageDecayFactor * recentBoost,
      };
    });
  }

  /**
   * Calculate graduated adjustments (NOT binary blocks)
   */
  private calculateGraduatedAdjustments(
    patterns: PatternPerformance[],
    baseConfidence: number,
    baseRiskPct: number,
    baseSLDistance: number,
    baseTPDistance: number
  ): AdaptiveAdjustments {
    const reasoning: string[] = [];
    const avgWinRate = patterns.reduce((sum, p) => sum + p.winRate, 0) / patterns.length;
    const avgPF = patterns.reduce((sum, p) => sum + p.profitFactor, 0) / patterns.length;
    const totalTrades = patterns.reduce((sum, p) => sum + p.totalTrades, 0);

    let confidenceAdjustment = 0;
    let riskAdjustment = 0;
    let slAdjustment = 0;
    let tpAdjustment = 0;

    // GRADUATED CONFIDENCE ADJUSTMENT
    if (avgWinRate >= 70 && avgPF >= 2.0) {
      confidenceAdjustment = +20;
      reasoning.push(`Strong pattern (${avgWinRate.toFixed(0)}% WR, ${avgPF.toFixed(1)} PF) - boosting confidence`);
    } else if (avgWinRate >= 60 && avgPF >= 1.5) {
      confidenceAdjustment = +10;
      reasoning.push(`Good pattern performance - modest confidence boost`);
    } else if (avgWinRate >= 50) {
      confidenceAdjustment = 0;
      reasoning.push(`Neutral pattern performance - no adjustment`);
    } else if (avgWinRate >= 40) {
      confidenceAdjustment = -10;
      reasoning.push(`Below-average pattern - reducing confidence`);
    } else {
      confidenceAdjustment = -20;
      reasoning.push(`Poor pattern (${avgWinRate.toFixed(0)}% WR) - significant confidence reduction`);
    }

    // GRADUATED RISK ADJUSTMENT
    if (avgPF >= 2.5) {
      riskAdjustment = +25;
      reasoning.push(`Exceptional profit factor - increasing position size`);
    } else if (avgPF >= 2.0) {
      riskAdjustment = +15;
      reasoning.push(`Strong profit factor - modest size increase`);
    } else if (avgPF < 1.0) {
      riskAdjustment = -30;
      reasoning.push(`Low profit factor - reducing position size`);
    } else if (avgPF < 1.5) {
      riskAdjustment = -15;
      reasoning.push(`Below-average profit factor - modest size reduction`);
    }

    // GRADUATED SL ADJUSTMENT
    if (avgWinRate < 45) {
      slAdjustment = +20;
      reasoning.push(`Low win rate suggests SL too tight - widening stop`);
    } else if (avgWinRate > 70) {
      slAdjustment = -10;
      reasoning.push(`High win rate allows tighter stop - optimizing risk`);
    }

    // GRADUATED TP ADJUSTMENT
    if (avgPF > 2.0 && avgWinRate > 60) {
      tpAdjustment = +30;
      reasoning.push(`Strong performance - letting winners run longer`);
    } else if (avgPF < 1.2) {
      tpAdjustment = -20;
      reasoning.push(`Low profit factor - taking profits earlier`);
    }

    // Apply adjustments with safety clamps
    const adjustedConfidence = this.clamp(
      baseConfidence + confidenceAdjustment,
      this.DEFAULT_CLAMPS.minConfidence,
      this.DEFAULT_CLAMPS.maxConfidence
    );

    const adjustedRiskPct = this.clamp(
      baseRiskPct * (1 + riskAdjustment / 100),
      this.DEFAULT_CLAMPS.minRiskPct,
      this.DEFAULT_CLAMPS.maxRiskPct
    );

    const adjustedSLDistance = this.clamp(
      baseSLDistance * (1 + slAdjustment / 100),
      this.DEFAULT_CLAMPS.minSLDistance,
      this.DEFAULT_CLAMPS.maxSLDistance
    );

    const adjustedTPDistance = this.clamp(
      baseTPDistance * (1 + tpAdjustment / 100),
      this.DEFAULT_CLAMPS.minTPDistance,
      this.DEFAULT_CLAMPS.maxTPDistance
    );

    const graduatedResponse = this.describeGraduation(avgWinRate, avgPF, totalTrades);

    return {
      confidenceAdjustment,
      riskAdjustment,
      slAdjustment,
      tpAdjustment,
      adjustedConfidence,
      adjustedRiskPct,
      adjustedSLDistance,
      adjustedTPDistance,
      reasoning,
      similarPatterns: patterns,
      ageDecayApplied: true,
      graduatedResponse,
    };
  }

  /**
   * Create neutral adjustments (no historical data)
   */
  private createNeutralAdjustments(
    baseConfidence: number,
    baseRiskPct: number,
    baseSLDistance: number,
    baseTPDistance: number
  ): AdaptiveAdjustments {
    return {
      confidenceAdjustment: 0,
      riskAdjustment: 0,
      slAdjustment: 0,
      tpAdjustment: 0,
      adjustedConfidence: baseConfidence,
      adjustedRiskPct: baseRiskPct,
      adjustedSLDistance: baseSLDistance,
      adjustedTPDistance: baseTPDistance,
      reasoning: ['No historical data - using base values'],
      similarPatterns: [],
      ageDecayApplied: false,
      graduatedResponse: 'neutral',
    };
  }

  /**
   * Describe the graduated response
   */
  private describeGraduation(winRate: number, profitFactor: number, totalTrades: number): string {
    if (winRate >= 70 && profitFactor >= 2.0) {
      return 'strong_boost';
    } else if (winRate >= 60 && profitFactor >= 1.5) {
      return 'modest_boost';
    } else if (winRate >= 50) {
      return 'neutral';
    } else if (winRate >= 40) {
      return 'modest_reduction';
    } else {
      return 'significant_reduction';
    }
  }

  /**
   * Clamp value between min and max
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Store adjustments in database for transparency
   */
  async storeAdjustments(
    userId: string,
    tradeAnalysisId: string,
    adjustments: AdaptiveAdjustments
  ): Promise<void> {
    const { error } = await supabase
      .from('ai_trade_analysis')
      .update({
        layer_3_decision: {
          decision: 'adjusted',
          adjustments: {
            confidence: adjustments.confidenceAdjustment,
            risk: adjustments.riskAdjustment,
            sl: adjustments.slAdjustment,
            tp: adjustments.tpAdjustment,
          },
          similarPatterns: adjustments.similarPatterns.length,
          graduation: adjustments.graduatedResponse,
          reasoning: adjustments.reasoning,
          timestamp: new Date().toISOString(),
        },
        adjusted_confidence: adjustments.adjustedConfidence,
        adjusted_risk_pct: adjustments.adjustedRiskPct,
        adjusted_sl_distance: adjustments.adjustedSLDistance,
        adjusted_tp_distance: adjustments.adjustedTPDistance,
      })
      .eq('id', tradeAnalysisId)
      .eq('user_id', userId);

    if (error) {
      console.error('[Adaptive Learning] Error storing adjustments:', error);
    } else {
      console.log('[Adaptive Learning] Adjustments stored successfully');
    }
  }

  /**
   * Get custom safety clamps for a user (override defaults)
   */
  async getSafetyClamps(userId: string): Promise<SafetyClamps> {
    // For now, return defaults
    // In future, could allow user customization
    return this.DEFAULT_CLAMPS;
  }
}

export const adaptiveLearningCoordinator = new AdaptiveLearningCoordinator();
