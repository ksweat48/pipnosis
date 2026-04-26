/**
 * Alpha Learning Tracker
 *
 * Tracks every decision Alpha makes and learns from the outcomes.
 * This enables Alpha to improve over time by understanding:
 * - When overrides work vs when they fail
 * - Which market conditions favor Alpha's judgment
 * - How Alpha's confidence correlates with actual outcomes
 *
 * CCIP-2026-04-01: Removed buy_votes, sell_votes from AlphaDecisionLog interface
 * and all computation logic that read OmegaVote.vote (undefined since CCIP-2026-02-24).
 * These fields were always written as 0, corrupting the alpha_decisions learning table.
 * Rows written with these false zeros are flagged via data_integrity_compromised column.
 */

import { supabase } from '../lib/supabase';
import type { AlphaDecision, OmegaCouncilVotes } from '../brains/coordinator-alpha';
import type { TraderScore } from './ai-identity';

export interface AlphaDecisionLog {
  id?: string;
  user_id: string;
  session_id?: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  confidence: number;
  omega_consensus: {
    direction: 'BUY' | 'SELL' | 'MIXED';
    confidence: number;
    agreement_count: number;
    total_votes: number;
  };
  omega_votes: OmegaCouncilVotes;
  omega_votes_count: number;
  omega_vote_details: Record<string, any>;
  vote_weights: Record<string, number>;
  trade_executed: boolean;
  alpha_override: boolean;
  override_reason?: string;
  conflict_detected: boolean;
  conflict_type: 'HARD' | 'SOFT' | 'NONE';
  reasoning: string;
  market_context: Record<string, any>;
  trader_personality: string;
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
  created_at?: Date;
}

export interface AlphaOutcomeLog {
  decision_id: string;
  user_id: string;
  trade_id?: string;
  executed: boolean;
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'NOT_EXECUTED';
  pnl?: number;
  pnl_pct?: number;
  duration_minutes?: number;
  exit_reason?: 'TP' | 'SL' | 'MANUAL' | 'TIMEOUT' | 'NOT_EXECUTED';
  alpha_was_right?: boolean;
  learning_notes?: string;
}

class AlphaLearningTracker {
  /**
   * Log Alpha's decision
   */
  async logDecision(
    userId: string,
    decision: AlphaDecision,
    omegaVotes: OmegaCouncilVotes,
    omegaConsensus: {
      direction: 'BUY' | 'SELL' | 'MIXED';
      confidence: number;
      agreement_count: number;
      total_votes: number;
    },
    conflictInfo: {
      detected: boolean;
      type: 'HARD' | 'SOFT' | 'NONE';
    },
    marketContext: Record<string, any>,
    traderScore: TraderScore,
    sessionId?: string
  ): Promise<string | null> {
    try {
      const alpha_override = this.determineOverride(decision, omegaConsensus);
      const override_reason = alpha_override ? this.explainOverride(decision, omegaConsensus, omegaVotes) : undefined;

      const votesList = [
        omegaVotes.trend,
        omegaVotes.scalper,
        omegaVotes.confirmation,
        omegaVotes.reversal,
        omegaVotes.volatility,
        omegaVotes.risk,
        omegaVotes.omega8
      ].filter(Boolean);

      // CCIP-2026-04-01: OmegaVote.vote and OmegaVote.confidence removed in CCIP-2026-02-24.
      // buy_votes / sell_votes are not computable — omitted from insert to prevent false-zero
      // corruption. omega_vote_details logs reasoning+keyFactors only (actual available data).
      const voteDetails: Record<string, any> = {};
      const voteWeights: Record<string, number> = {};
      const specialists = ['trend', 'scalper', 'confirmation', 'reversal', 'volatility', 'risk', 'omega8'] as const;
      for (const name of specialists) {
        const v = omegaVotes[name];
        if (v) {
          voteDetails[name] = { reasoning: v.reasoning, keyFactors: v.keyFactors };
          voteWeights[name] = 1.0;
        }
      }

      const log: Record<string, any> = {
        user_id: userId,
        session_id: sessionId,
        symbol: decision.symbol || marketContext.symbol,
        action: decision.action,
        confidence: decision.confidence,
        omega_consensus: omegaConsensus,
        omega_votes: omegaVotes,
        omega_votes_count: votesList.length,
        omega_vote_details: voteDetails,
        vote_weights: voteWeights,
        trade_executed: decision.action !== 'NO_TRADE',
        alpha_override,
        override_reason,
        conflict_detected: conflictInfo.detected,
        conflict_type: conflictInfo.type,
        reasoning: decision.reasoning,
        market_context: marketContext,
        trader_personality: traderScore.personality,
        entry_price: decision.entry,
        stop_loss: decision.stopLoss,
        take_profit: decision.takeProfit,
        alpha_entry_mode: (decision as any).entry_mode ?? null,
        alpha_wait_condition: (decision as any).wait_condition ?? null,
        trade_style: (decision as any).tradeStyle ?? null,
        // CCIP-2026-0332A: Persist NO_TRADE audit fields. no_trade_statement is included in
        // the decision object for NO_TRADE actions (added to parseDecision return path).
        // For BUY/SELL decisions this will be undefined/null and is safely ignored.
        no_trade_statement: (decision as any).no_trade_statement ?? null,
        // CCIP-2026-0415: Decision origin classification — makes every NO_TRADE self-documenting.
        decision_origin: (decision as any).decision_origin ?? null,
        execution_status: (decision as any).execution_status ?? null,
        block_reason: (decision as any).block_reason ?? null,
        response_fingerprint: (decision as any).response_fingerprint ?? null,
        alpha_original_action: (decision as any).alpha_original_decision?.action ?? null,
      };

      if (decision.directionalStrengthResult) {
        log.directional_strength_net = decision.directionalStrengthResult.netStrength;
        log.directional_strength_buy = decision.directionalStrengthResult.buyScore;
        log.directional_strength_sell = decision.directionalStrengthResult.sellScore;
        log.directional_strength_threshold = decision.directionalStrengthResult.threshold;
        log.directional_strength_meets = decision.directionalStrengthResult.meetsThreshold;
        log.directional_strength_style = decision.directionalStrengthResult.style;
      }

      // CCIP-2026-0420A: Persist multi-timeframe pattern intelligence to alpha_decisions.
      // patternIntelligence was computed and attached to the decision object but never
      // written to the DB insert in this tracker (omega-alpha-logger.ts::logAlphaDecision
      // mapped these fields but that method is never called — logging goes through here).
      if (decision.patternIntelligence) {
        log.htf_pattern = decision.patternIntelligence.htfPattern;
        log.mtf_pattern = decision.patternIntelligence.mtfPattern;
        log.ltf_pattern = decision.patternIntelligence.ltfPattern;
        log.htf_intent = decision.patternIntelligence.htfIntent;
        log.mtf_intent = decision.patternIntelligence.mtfIntent;
        log.ltf_intent = decision.patternIntelligence.ltfIntent;
        log.pattern_alignment_score = decision.patternIntelligence.alignmentScore;
        log.pattern_overall_intent = decision.patternIntelligence.overallIntent;
        log.pattern_direction_bias = decision.patternIntelligence.directionBias;
        if (decision.patternIntelligence.warnings?.length > 0) {
          log.pattern_warnings = decision.patternIntelligence.warnings;
        }
        if (decision.patternIntelligence.liquidityTargets?.length > 0) {
          log.pattern_liquidity_targets = decision.patternIntelligence.liquidityTargets;
        }
        if (decision.patternIntelligence.invalidationPoint) {
          log.pattern_invalidation_price = decision.patternIntelligence.invalidationPoint.price;
          log.pattern_invalidation_reasoning = decision.patternIntelligence.invalidationPoint.reasoning;
        }
      }

      // CCIP-2026-0420A: Persist micro-regime classification.
      if (decision.microRegime) {
        log.micro_regime = decision.microRegime.regime;
        log.regime_confidence = decision.microRegime.confidence;
        log.regime_confidence_modifier = decision.microRegime.confidenceModifier;
        log.regime_direction = decision.microRegime.direction;
      }

      // CCIP-2026-0420A: Persist narrative coherence validation.
      if (decision.narrativeValidation) {
        log.market_narrative = decision.narrativeValidation.narrative;
        log.narrative_strength_score = decision.narrativeValidation.strengthScore;
        log.narrative_confidence_penalty = decision.narrativeValidation.confidencePenalty;
        log.narrative_quality_tier = decision.narrativeValidation.qualityTier;
      }

      // CCIP-2026-0420A: Persist tp_structural_reference, sl_structural_reference,
      // trader_statement, confidence_tier, and answer_sheet for full audit trail.
      if (decision.tp_structural_reference) {
        log.tp_structural_reference = decision.tp_structural_reference;
      }
      if (decision.sl_structural_reference) {
        log.sl_structural_reference = decision.sl_structural_reference;
      }
      if (decision.trader_statement) {
        log.trader_statement = decision.trader_statement;
      }
      if (decision.confidence_tier) {
        log.confidence_tier = decision.confidence_tier;
      }
      if (decision.answer_sheet) {
        log.answer_sheet = decision.answer_sheet;
      }
      if (decision.tp1Price != null) {
        log.tp1_price = decision.tp1Price;
      }
      if (decision.tp2Price != null) {
        log.tp2_price = decision.tp2Price;
      }
      if (decision.resolvedStyle) {
        log.trade_style = decision.resolvedStyle;
      }

      // CCIP-2026-0427-A: WAIT_INTENT_AVAILABLE_MONITOR_OFF subclass tagging.
      // Persisted so alpha_profitability_dashboard can count NO_TRADE rows that were
      // structurally valid wait setups suppressed only by the user's monitor-off state.
      if ((decision as any).wait_intent_available_for_monitor_off === true) {
        log.wait_intent_available_for_monitor_off = true;
        if ((decision as any).wait_intent_metadata) {
          log.wait_intent_metadata = (decision as any).wait_intent_metadata;
        }
      }

      const { data, error } = await supabase
        .from('alpha_decisions')
        .insert(log)
        .select('id')
        .single();

      if (error) {
        console.error('[Alpha Learning] Failed to log decision:', error);
        return null;
      }

      console.log(`[Alpha Learning] Decision logged: ${decision.action} | OmegaSignals: ${votesList.length} active (Override: ${alpha_override})`);
      return data.id;
    } catch (error) {
      console.error('[Alpha Learning] Exception logging decision:', error);
      return null;
    }
  }

  /**
   * Log trade outcome
   */
  async logOutcome(
    decisionId: string,
    userId: string,
    outcome: AlphaOutcomeLog
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('alpha_decision_outcomes')
        .insert({
          decision_id: decisionId,
          user_id: userId,
          ...outcome,
          completed_at: new Date().toISOString()
        });

      if (error) {
        console.error('[Alpha Learning] Failed to log outcome:', error);
        return;
      }

      console.log(`[Alpha Learning] Outcome logged: ${outcome.outcome} (${outcome.pnl})`);

      // Update learning metrics
      await this.updateLearningMetrics(userId);
    } catch (error) {
      console.error('[Alpha Learning] Exception logging outcome:', error);
    }
  }

  /**
   * Get Alpha's learning stats
   */
  async getLearningStats(userId: string, period: 'daily' | 'weekly' | 'monthly' = 'daily'): Promise<any> {
    try {
      const periodStart = this.getPeriodStart(period);

      const { data, error } = await supabase
        .from('alpha_learning_metrics')
        .select('*')
        .eq('user_id', userId)
        .eq('period', period)
        .eq('period_start', periodStart)
        .maybeSingle();

      if (error) {
        console.error('[Alpha Learning] Failed to get stats:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Alpha Learning] Exception getting stats:', error);
      return null;
    }
  }

  /**
   * Determine if Alpha overrode Omega consensus
   */
  private determineOverride(
    decision: AlphaDecision,
    consensus: { direction: string; confidence: number; agreement_count: number }
  ): boolean {
    if (consensus.direction === 'BUY' && decision.action !== 'BUY' && consensus.confidence > 65) {
      return true;
    }

    if (consensus.direction === 'SELL' && decision.action !== 'SELL' && consensus.confidence > 65) {
      return true;
    }

    return false;
  }

  /**
   * Explain why Alpha overrode
   */
  private explainOverride(
    decision: AlphaDecision,
    consensus: { direction: string; confidence: number; agreement_count: number; total_votes: number },
    votes: OmegaCouncilVotes
  ): string {
    const reasons: string[] = [];

    if (consensus.direction === 'BUY' && decision.action === 'SELL') {
      reasons.push(`Alpha reversed BUY consensus to SELL`);
    }

    if (consensus.direction === 'SELL' && decision.action === 'BUY') {
      reasons.push(`Alpha reversed SELL consensus to BUY`);
    }

    if (consensus.direction === 'BUY' && decision.action === 'NO_TRADE') {
      reasons.push(`Alpha declared NO_TRADE despite BUY consensus (insufficient directional strength)`);
    }

    if (consensus.direction === 'SELL' && decision.action === 'NO_TRADE') {
      reasons.push(`Alpha declared NO_TRADE despite SELL consensus (insufficient directional strength)`);
    }

    if (decision.confidence > consensus.confidence + 15) {
      reasons.push(`Alpha more confident (${decision.confidence}%) than consensus (${consensus.confidence}%)`);
    }

    return reasons.join('; ');
  }

  /**
   * Update learning metrics
   */
  private async updateLearningMetrics(userId: string): Promise<void> {
    try {
      // Calculate daily metrics
      const dailyStart = this.getPeriodStart('daily');

      // Get decisions for today
      const { data: decisions, error: decisionsError } = await supabase
        .from('alpha_decisions')
        .select('id, alpha_override, confidence')
        .eq('user_id', userId)
        .gte('created_at', dailyStart);

      if (decisionsError || !decisions) {
        console.error('[Alpha Learning] Failed to get decisions for metrics:', decisionsError);
        return;
      }

      const totalDecisions = decisions.length;
      const overrideCount = decisions.filter(d => d.alpha_override).length;

      // Get outcomes
      const decisionIds = decisions.map(d => d.id);
      const { data: outcomes, error: outcomesError } = await supabase
        .from('alpha_decision_outcomes')
        .select('*')
        .in('decision_id', decisionIds)
        .not('outcome', 'is', null);

      if (outcomesError) {
        console.error('[Alpha Learning] Failed to get outcomes for metrics:', outcomesError);
        return;
      }

      const overrideOutcomes = outcomes?.filter(o => {
        const decision = decisions.find(d => d.id === o.decision_id);
        return decision?.alpha_override;
      }) || [];

      const consensusOutcomes = outcomes?.filter(o => {
        const decision = decisions.find(d => d.id === o.decision_id);
        return !decision?.alpha_override;
      }) || [];

      const overrideWins = overrideOutcomes.filter(o => o.outcome === 'WIN').length;
      const consensusWins = consensusOutcomes.filter(o => o.outcome === 'WIN').length;

      const overrideSuccessRate = overrideOutcomes.length > 0 ? (overrideWins / overrideOutcomes.length) * 100 : 0;
      const consensusSuccessRate = consensusOutcomes.length > 0 ? (consensusWins / consensusOutcomes.length) * 100 : 0;

      const avgConfidence = totalDecisions > 0
        ? decisions.reduce((sum, d) => sum + d.confidence, 0) / totalDecisions
        : 0;

      const winRate = outcomes && outcomes.length > 0
        ? (outcomes.filter(o => o.outcome === 'WIN').length / outcomes.length) * 100
        : 0;

      // Insert or update metrics
      await supabase
        .from('alpha_learning_metrics')
        .upsert({
          user_id: userId,
          period: 'daily',
          period_start: dailyStart,
          total_decisions: totalDecisions,
          override_count: overrideCount,
          override_success_rate: overrideSuccessRate,
          consensus_follow_count: totalDecisions - overrideCount,
          consensus_success_rate: consensusSuccessRate,
          avg_confidence: avgConfidence,
          win_rate: winRate,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,period,period_start'
        });

      console.log(`[Alpha Learning] Metrics updated: ${totalDecisions} decisions, ${overrideCount} overrides`);
    } catch (error) {
      console.error('[Alpha Learning] Exception updating metrics:', error);
    }
  }

  /**
   * Get period start date
   */
  private getPeriodStart(period: 'daily' | 'weekly' | 'monthly'): string {
    const now = new Date();
    let start: Date;

    switch (period) {
      case 'daily':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'weekly':
        const dayOfWeek = now.getDay();
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        break;
      case 'monthly':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    return start.toISOString().split('T')[0];
  }
}

export const alphaLearningTracker = new AlphaLearningTracker();
