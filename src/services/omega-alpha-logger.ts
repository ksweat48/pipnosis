/**
 * Omega + Alpha Decision Logger
 *
 * Logs all Omega votes, Alpha decisions, and mid-trade interventions
 * to the database for performance tracking and learning.
 */

import { supabase } from '../lib/supabase';
import type { OmegaVote } from '../types/omega-vote';
import type { AlphaDecision, OmegaCouncilVotes } from '../brains/coordinator-alpha';
import type { MidTradeDecision } from '../brains/midtrade-monitor';

export interface VoteContext {
  symbol: string;
  price: number;
  marketRegime: string;
  volatilityState: string;
  sessionId?: string;
  tradeId?: string;
}

export interface MidTradeContext {
  tradeId: string;
  symbol: string;
  price: number;
  entryPrice: number;
  marketRegime: string;
  volatilityState: string;
  sessionId?: string;
}

class OmegaAlphaLogger {
  private userId: string | null = null;

  /**
   * Initialize logger with user ID
   */
  initialize(userId: string): void {
    this.userId = userId;
  }

  /**
   * Log all Omega votes
   */
  async logOmegaVotes(
    votes: OmegaCouncilVotes,
    weights: Record<string, number>,
    context: VoteContext
  ): Promise<void> {
    if (!this.userId) {
      console.warn('[Omega Logger] No user ID - skipping vote logging');
      return;
    }

    const voteRecords = [];

    // Log each Omega vote
    const specialists = [
      { key: 'trend', name: 'trend', vote: votes.trend, weight: weights.trend },
      { key: 'scalper', name: 'scalper', vote: votes.scalper, weight: weights.scalper },
      { key: 'reversal', name: 'reversal', vote: votes.reversal, weight: weights.reversal },
      { key: 'volatility', name: 'volatility', vote: votes.volatility, weight: weights.volatility },
      { key: 'risk', name: 'risk', vote: votes.risk, weight: weights.risk }
    ];

    for (const specialist of specialists) {
      if (specialist.vote) {
        voteRecords.push({
          user_id: this.userId,
          session_id: context.sessionId || null,
          trade_id: context.tradeId || null,
          omega_specialist: specialist.name,
          vote: specialist.vote.vote,
          confidence: specialist.vote.confidence,
          reasoning: specialist.vote.reasoning,
          symbol: context.symbol,
          price: context.price,
          market_regime: context.marketRegime,
          volatility_state: context.volatilityState,
          applied_weight: specialist.weight,
          trade_executed: false
        });
      }
    }

    if (voteRecords.length > 0) {
      const { error } = await supabase
        .from('omega_votes')
        .insert(voteRecords);

      if (error) {
        console.error('[Omega Logger] Error logging votes:', error);
      } else {
        console.log(`[Omega Logger] ✅ Logged ${voteRecords.length} Omega votes`);
      }
    }
  }

  /**
   * Log Alpha decision
   */
  async logAlphaDecision(
    decision: AlphaDecision,
    votes: OmegaCouncilVotes,
    weights: Record<string, number>,
    context: VoteContext,
    safetyBlocked: boolean = false
  ): Promise<string | null> {
    if (!this.userId) {
      console.warn('[Alpha Logger] No user ID - skipping decision logging');
      return null;
    }

    const votesList = [
      votes.trend,
      votes.scalper,
      votes.confirmation,
      votes.reversal,
      votes.volatility,
      votes.risk,
      votes.omega8
    ].filter(v => v !== null) as OmegaVote[];

    const buyVotes = votesList.filter(v => v.vote === 'BUY').length;
    const sellVotes = votesList.filter(v => v.vote === 'SELL').length;

    const voteDetails = {
      trend: votes.trend ? { vote: votes.trend.vote, confidence: votes.trend.confidence, reasoning: votes.trend.reasoning } : null,
      scalper: votes.scalper ? { vote: votes.scalper.vote, confidence: votes.scalper.confidence, reasoning: votes.scalper.reasoning } : null,
      confirmation: votes.confirmation ? { vote: votes.confirmation.vote, confidence: votes.confirmation.confidence, reasoning: votes.confirmation.reasoning } : null,
      reversal: votes.reversal ? { vote: votes.reversal.vote, confidence: votes.reversal.confidence, reasoning: votes.reversal.reasoning } : null,
      volatility: votes.volatility ? { vote: votes.volatility.vote, confidence: votes.volatility.confidence, reasoning: votes.volatility.reasoning } : null,
      risk: votes.risk ? { vote: votes.risk.vote, confidence: votes.risk.confidence, reasoning: votes.risk.reasoning } : null,
      omega8: votes.omega8 ? { vote: votes.omega8.vote, confidence: votes.omega8.confidence, reasoning: votes.omega8.reasoning } : null
    };

    // Prepare Phase 1-4 upgrade fields
    const insertData: any = {
      user_id: this.userId,
      session_id: context.sessionId || null,
      trade_id: context.tradeId || null,
      action: decision.action,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      entry_price: decision.entry,
      stop_loss: decision.stopLoss,
      take_profit: decision.takeProfit,
      symbol: context.symbol,
      market_regime: context.marketRegime,
      volatility_state: context.volatilityState,
      omega_votes_count: votesList.length,
      buy_votes: buyVotes,
      sell_votes: sellVotes,
      omega_vote_details: voteDetails,
      vote_weights: weights,
      trade_executed: decision.action !== 'NO_TRADE' && !safetyBlocked,
      safety_blocked: safetyBlocked
    };

    // Add micro-regime classification fields
    if (decision.microRegime) {
      insertData.micro_regime = decision.microRegime.regime;
      insertData.regime_confidence = decision.microRegime.confidence;
      insertData.regime_confidence_modifier = decision.microRegime.confidenceModifier;
      insertData.regime_direction = decision.microRegime.direction;
    }

    // Add liquidity intent fields
    if (decision.liquidityIntent) {
      insertData.trapped_side = decision.liquidityIntent.trapped;
      insertData.vulnerability_type = decision.liquidityIntent.vulnerability;
      insertData.hunt_zone_active = decision.liquidityIntent.huntZoneStatus === 'active';
      insertData.predator_direction = decision.liquidityIntent.predatorDirection;
      insertData.cascade_distance = decision.liquidityIntent.expectedCascadeDistance;
      insertData.liquidity_conviction = decision.liquidityIntent.overallConviction;
    }

    if (decision.narrativeValidation) {
      insertData.market_narrative = decision.narrativeValidation.narrative;
      insertData.narrative_strength_score = decision.narrativeValidation.strengthScore;
      insertData.narrative_confidence_penalty = decision.narrativeValidation.confidencePenalty;
      insertData.narrative_quality_tier = decision.narrativeValidation.qualityTier;
    }

    if (decision.directionalStrengthResult) {
      insertData.directional_strength_net = decision.directionalStrengthResult.netStrength;
      insertData.directional_strength_buy = decision.directionalStrengthResult.buyScore;
      insertData.directional_strength_sell = decision.directionalStrengthResult.sellScore;
      insertData.directional_strength_threshold = decision.directionalStrengthResult.threshold;
      insertData.directional_strength_meets = decision.directionalStrengthResult.meetsThreshold;
      insertData.directional_strength_style = decision.directionalStrengthResult.style;
    }

    if (decision.patternIntelligence) {
      insertData.htf_intent = decision.patternIntelligence.htfIntent;
      insertData.mtf_intent = decision.patternIntelligence.mtfIntent;
      insertData.ltf_intent = decision.patternIntelligence.ltfIntent;
      insertData.htf_pattern = decision.patternIntelligence.htfPattern;
      insertData.mtf_pattern = decision.patternIntelligence.mtfPattern;
      insertData.ltf_pattern = decision.patternIntelligence.ltfPattern;
      insertData.pattern_alignment_score = decision.patternIntelligence.alignmentScore;
      insertData.pattern_overall_intent = decision.patternIntelligence.overallIntent;
      insertData.pattern_direction_bias = decision.patternIntelligence.directionBias;
      if (decision.patternIntelligence.warnings && decision.patternIntelligence.warnings.length > 0) {
        insertData.pattern_warnings = decision.patternIntelligence.warnings;
      }
      if (decision.patternIntelligence.liquidityTargets && decision.patternIntelligence.liquidityTargets.length > 0) {
        insertData.pattern_liquidity_targets = decision.patternIntelligence.liquidityTargets;
      }
      if (decision.patternIntelligence.confidenceBoosts && decision.patternIntelligence.confidenceBoosts.length > 0) {
        insertData.pattern_confidence_boosts = decision.patternIntelligence.confidenceBoosts;
      }
      if (decision.patternIntelligence.confidencePenalties && decision.patternIntelligence.confidencePenalties.length > 0) {
        insertData.pattern_confidence_penalties = decision.patternIntelligence.confidencePenalties;
      }
      if (decision.patternIntelligence.invalidationPoint) {
        insertData.pattern_invalidation_price = decision.patternIntelligence.invalidationPoint.price;
        insertData.pattern_invalidation_reasoning = decision.patternIntelligence.invalidationPoint.reasoning;
      }
    }

    const { data, error } = await supabase
      .from('alpha_decisions')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[Alpha Logger] Error logging decision:', error);
      return null;
    } else {
      console.log(`[Alpha Logger] ✅ Logged Alpha decision: ${decision.action}`);
      return data.id;
    }
  }

  /**
   * Log mid-trade intervention
   */
  async logMidTradeIntervention(
    decision: MidTradeDecision,
    drawdownPct: number,
    minutesInTrade: number,
    originalSL: number,
    context: MidTradeContext,
    emergencyVotes?: any
  ): Promise<void> {
    if (!this.userId) {
      console.warn('[MidTrade Logger] No user ID - skipping intervention logging');
      return;
    }

    const { error } = await supabase
      .from('midtrade_interventions')
      .insert({
        user_id: this.userId,
        session_id: context.sessionId || null,
        trade_id: context.tradeId,
        trigger_level: decision.trigger_level,
        drawdown_pct: drawdownPct,
        minutes_in_trade: minutesInTrade,
        action: decision.action,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        original_sl: originalSL,
        adjusted_sl: decision.adjustedSL || null,
        symbol: context.symbol,
        price: context.price,
        entry_price: context.entryPrice,
        market_regime: context.marketRegime,
        volatility_state: context.volatilityState,
        omega_emergency_votes: emergencyVotes || null
      });

    if (error) {
      console.error('[MidTrade Logger] Error logging intervention:', error);
    } else {
      console.log(`[MidTrade Logger] ✅ Logged ${decision.trigger_level} intervention: ${decision.action}`);
    }
  }

  /**
   * Update Omega votes with trade outcome
   */
  async updateVotesWithOutcome(
    tradeId: string,
    outcome: 'win' | 'loss' | 'breakeven',
    pnl: number,
    tradeDirection: 'buy' | 'sell'
  ): Promise<void> {
    if (!this.userId) return;

    // Update all votes for this trade
    const { error: updateError } = await supabase
      .from('omega_votes')
      .update({
        trade_executed: true,
        trade_direction: tradeDirection,
        trade_outcome: outcome,
        trade_pnl: pnl,
        updated_at: new Date().toISOString()
      })
      .eq('trade_id', tradeId)
      .eq('user_id', this.userId);

    if (updateError) {
      console.error('[Omega Logger] Error updating votes:', updateError);
      return;
    }

    // Calculate if each vote was correct
    // A vote is correct if it voted in the direction of trade AND trade won
    const { data: votes } = await supabase
      .from('omega_votes')
      .select('*')
      .eq('trade_id', tradeId)
      .eq('user_id', this.userId);

    if (votes) {
      for (const vote of votes) {
        let voteCorrect = false;

        if (outcome === 'win') {
          voteCorrect = vote.vote.toUpperCase() === tradeDirection.toUpperCase();
        } else if (outcome === 'loss') {
          voteCorrect = vote.vote.toUpperCase() !== tradeDirection.toUpperCase();
        } else {
          voteCorrect = false;
        }

        await supabase
          .from('omega_votes')
          .update({ vote_correct: voteCorrect })
          .eq('id', vote.id);
      }
    }

    console.log(`[Omega Logger] ✅ Updated votes with outcome: ${outcome}`);

    // Update Alpha decision
    const { error: alphaError } = await supabase
      .from('alpha_decisions')
      .update({
        trade_outcome: outcome,
        trade_pnl: pnl,
        decision_correct: outcome === 'win',
        updated_at: new Date().toISOString()
      })
      .eq('trade_id', tradeId)
      .eq('user_id', this.userId);

    if (alphaError) {
      console.error('[Alpha Logger] Error updating decision:', alphaError);
    }

    // Update performance metrics for each specialist
    const specialists = ['trend', 'scalper', 'reversal', 'volatility', 'risk'];
    for (const specialist of specialists) {
      try {
        await supabase.rpc('update_omega_performance_metrics', {
          p_user_id: this.userId,
          p_omega_specialist: specialist,
          p_period_days: 7
        });
      } catch (error) {
        console.warn(`[Omega Logger] Could not update metrics for ${specialist}:`, error);
      }
    }
  }

  /**
   * Update mid-trade intervention with result
   */
  async updateInterventionResult(
    tradeId: string,
    result: 'saved_loss' | 'locked_profit' | 'false_exit' | 'neutral',
    pnlImpact: number
  ): Promise<void> {
    if (!this.userId) return;

    const { error } = await supabase
      .from('midtrade_interventions')
      .update({
        intervention_result: result,
        pnl_impact: pnlImpact
      })
      .eq('trade_id', tradeId)
      .eq('user_id', this.userId);

    if (error) {
      console.error('[MidTrade Logger] Error updating intervention result:', error);
    } else {
      console.log(`[MidTrade Logger] ✅ Updated intervention result: ${result} (${pnlImpact >= 0 ? '+' : ''}${pnlImpact.toFixed(2)})`);
    }
  }

  /**
   * Get Omega performance metrics
   */
  async getOmegaPerformance(specialist?: string): Promise<any[]> {
    if (!this.userId) return [];

    let query = supabase
      .from('omega_performance_metrics')
      .select('*')
      .eq('user_id', this.userId)
      .order('period_start', { ascending: false })
      .limit(10);

    if (specialist) {
      query = query.eq('omega_specialist', specialist);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Omega Logger] Error fetching performance:', error);
      return [];
    }

    return data || [];
  }
}

export const omegaAlphaLogger = new OmegaAlphaLogger();
