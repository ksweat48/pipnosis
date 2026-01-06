/**
 * Omega-6 Confluence Aggregator - DETERMINISTIC Vote Synthesis
 *
 * Synthesizes votes from Omega-1 through Omega-5 into a single
 * weighted consensus for Alpha consumption.
 *
 * RESPONSIBILITIES:
 * - Aggregate deterministic Omega votes
 * - Apply weighted confidence calculation
 * - Detect vote conflicts and consensus strength
 * - Generate structured evidence string for Alpha
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import { CONFLUENCE_THRESHOLDS } from '../../config/omega-thresholds';

export interface ConfluenceInput {
  trend: OmegaVote | null;
  scalper: OmegaVote | null;
  confirmation: OmegaVote | null;
  reversal: OmegaVote | null;
  volatility: OmegaVote | null;
}

export interface ConfluenceResult {
  consensusVote: 'BUY' | 'SELL' | 'NO_TRADE';
  consensusConfidence: number;
  consensusStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'CONFLICTED';
  voteBreakdown: VoteBreakdown;
  conflicts: ConflictDetail[];
  evidence: string;
  reasoning: string;
}

export interface VoteBreakdown {
  buyVotes: number;
  sellVotes: number;
  noTradeVotes: number;
  totalVotes: number;
  buyWeightedScore: number;
  sellWeightedScore: number;
}

export interface ConflictDetail {
  brain1: string;
  brain2: string;
  vote1: string;
  vote2: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

const OMEGA_WEIGHTS: Record<string, number> = {
  trend: CONFLUENCE_THRESHOLDS.WEIGHT_TREND,
  scalper: CONFLUENCE_THRESHOLDS.WEIGHT_SCALPER,
  confirmation: CONFLUENCE_THRESHOLDS.WEIGHT_CONFIRMATION,
  reversal: CONFLUENCE_THRESHOLDS.WEIGHT_REVERSAL,
  volatility: CONFLUENCE_THRESHOLDS.WEIGHT_VOLATILITY
};

class OmegaConfluenceAggregator {
  aggregate(input: ConfluenceInput): ConfluenceResult {
    const votes = this.collectVotes(input);
    const breakdown = this.calculateBreakdown(votes);
    const conflicts = this.detectConflicts(votes);
    const { consensusVote, consensusConfidence } = this.calculateConsensus(breakdown, conflicts);
    const consensusStrength = this.assessStrength(breakdown, conflicts, consensusConfidence);
    const evidence = this.buildEvidence(votes, breakdown, conflicts);
    const reasoning = this.buildReasoning(consensusVote, consensusConfidence, consensusStrength, breakdown);

    console.log(`[Omega-6 Confluence] [DET] Consensus: ${consensusVote} @ ${consensusConfidence}% | Strength: ${consensusStrength}`);
    console.log(`[Omega-6 Confluence] Breakdown: BUY=${breakdown.buyVotes}(${breakdown.buyWeightedScore.toFixed(1)}) SELL=${breakdown.sellVotes}(${breakdown.sellWeightedScore.toFixed(1)}) NO_TRADE=${breakdown.noTradeVotes}`);

    return {
      consensusVote,
      consensusConfidence,
      consensusStrength,
      voteBreakdown: breakdown,
      conflicts,
      evidence,
      reasoning
    };
  }

  private collectVotes(input: ConfluenceInput): Array<{ brain: string; vote: OmegaVote }> {
    const votes: Array<{ brain: string; vote: OmegaVote }> = [];

    if (input.trend) votes.push({ brain: 'trend', vote: input.trend });
    if (input.scalper) votes.push({ brain: 'scalper', vote: input.scalper });
    if (input.confirmation) votes.push({ brain: 'confirmation', vote: input.confirmation });
    if (input.reversal) votes.push({ brain: 'reversal', vote: input.reversal });
    if (input.volatility) votes.push({ brain: 'volatility', vote: input.volatility });

    return votes;
  }

  private calculateBreakdown(votes: Array<{ brain: string; vote: OmegaVote }>): VoteBreakdown {
    let buyVotes = 0;
    let sellVotes = 0;
    let noTradeVotes = 0;
    let buyWeightedScore = 0;
    let sellWeightedScore = 0;

    for (const { brain, vote } of votes) {
      const weight = OMEGA_WEIGHTS[brain] || 1;
      const weightedConfidence = vote.confidence * weight;

      if (vote.vote === 'BUY') {
        buyVotes++;
        buyWeightedScore += weightedConfidence;
      } else if (vote.vote === 'SELL') {
        sellVotes++;
        sellWeightedScore += weightedConfidence;
      } else {
        noTradeVotes++;
      }
    }

    return {
      buyVotes,
      sellVotes,
      noTradeVotes,
      totalVotes: votes.length,
      buyWeightedScore,
      sellWeightedScore
    };
  }

  private detectConflicts(votes: Array<{ brain: string; vote: OmegaVote }>): ConflictDetail[] {
    const conflicts: ConflictDetail[] = [];

    const directionalVotes = votes.filter(v => v.vote.vote !== 'NO_TRADE');

    for (let i = 0; i < directionalVotes.length; i++) {
      for (let j = i + 1; j < directionalVotes.length; j++) {
        const v1 = directionalVotes[i];
        const v2 = directionalVotes[j];

        if (v1.vote.vote !== v2.vote.vote) {
          const avgConfidence = (v1.vote.confidence + v2.vote.confidence) / 2;
          let severity: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

          if (avgConfidence >= 70) {
            severity = 'HIGH';
          } else if (avgConfidence >= 50) {
            severity = 'MEDIUM';
          }

          const criticalPair =
            (v1.brain === 'trend' && v2.brain === 'reversal') ||
            (v1.brain === 'reversal' && v2.brain === 'trend');

          if (criticalPair) {
            severity = 'HIGH';
          }

          conflicts.push({
            brain1: v1.brain,
            brain2: v2.brain,
            vote1: v1.vote.vote,
            vote2: v2.vote.vote,
            severity
          });
        }
      }
    }

    return conflicts;
  }

  private calculateConsensus(
    breakdown: VoteBreakdown,
    conflicts: ConflictDetail[]
  ): { consensusVote: 'BUY' | 'SELL' | 'NO_TRADE'; consensusConfidence: number } {
    const highConflicts = conflicts.filter(c => c.severity === 'HIGH').length;

    if (highConflicts >= 2) {
      return { consensusVote: 'NO_TRADE', consensusConfidence: 30 };
    }

    const scoreDiff = Math.abs(breakdown.buyWeightedScore - breakdown.sellWeightedScore);
    const totalDirectionalScore = breakdown.buyWeightedScore + breakdown.sellWeightedScore;

    if (totalDirectionalScore === 0) {
      return { consensusVote: 'NO_TRADE', consensusConfidence: 40 };
    }

    const dominanceRatio = scoreDiff / totalDirectionalScore;

    if (dominanceRatio < CONFLUENCE_THRESHOLDS.MIN_DOMINANCE_RATIO) {
      return { consensusVote: 'NO_TRADE', consensusConfidence: 35 };
    }

    let consensusVote: 'BUY' | 'SELL' | 'NO_TRADE';
    let rawConfidence: number;

    if (breakdown.buyWeightedScore > breakdown.sellWeightedScore) {
      consensusVote = 'BUY';
      rawConfidence = (breakdown.buyWeightedScore / (totalDirectionalScore / 2)) * 50;
    } else {
      consensusVote = 'SELL';
      rawConfidence = (breakdown.sellWeightedScore / (totalDirectionalScore / 2)) * 50;
    }

    let conflictPenalty = 0;
    for (const conflict of conflicts) {
      if (conflict.severity === 'HIGH') conflictPenalty += 15;
      else if (conflict.severity === 'MEDIUM') conflictPenalty += 8;
      else conflictPenalty += 3;
    }

    const consensusBonus = dominanceRatio > 0.6 ? 10 : 0;
    const voteCountBonus = breakdown.totalVotes >= 4 ? 5 : 0;

    const consensusConfidence = Math.max(
      CONFLUENCE_THRESHOLDS.MIN_CONSENSUS_CONFIDENCE,
      Math.min(95, rawConfidence + consensusBonus + voteCountBonus - conflictPenalty)
    );

    if (consensusConfidence < CONFLUENCE_THRESHOLDS.MIN_CONSENSUS_CONFIDENCE) {
      return { consensusVote: 'NO_TRADE', consensusConfidence };
    }

    return { consensusVote, consensusConfidence: Math.round(consensusConfidence) };
  }

  private assessStrength(
    breakdown: VoteBreakdown,
    conflicts: ConflictDetail[],
    confidence: number
  ): 'STRONG' | 'MODERATE' | 'WEAK' | 'CONFLICTED' {
    const highConflicts = conflicts.filter(c => c.severity === 'HIGH').length;

    if (highConflicts >= 2) {
      return 'CONFLICTED';
    }

    const directionalVotes = breakdown.buyVotes + breakdown.sellVotes;
    const unanimousDirection =
      (breakdown.buyVotes === directionalVotes && directionalVotes >= 3) ||
      (breakdown.sellVotes === directionalVotes && directionalVotes >= 3);

    if (unanimousDirection && confidence >= 70 && conflicts.length === 0) {
      return 'STRONG';
    }

    if (confidence >= 60 && conflicts.length <= 1) {
      return 'MODERATE';
    }

    return 'WEAK';
  }

  private buildEvidence(
    votes: Array<{ brain: string; vote: OmegaVote }>,
    breakdown: VoteBreakdown,
    conflicts: ConflictDetail[]
  ): string {
    const voteStrings = votes.map(v => {
      const abbr = v.brain.substring(0, 3).toUpperCase();
      return `${abbr}=${v.vote.vote[0]}@${v.vote.confidence}`;
    });

    const parts = [
      voteStrings.join(','),
      `B=${breakdown.buyWeightedScore.toFixed(0)}`,
      `S=${breakdown.sellWeightedScore.toFixed(0)}`,
      `CONF=${conflicts.length}`
    ];

    return parts.join('|');
  }

  private buildReasoning(
    vote: 'BUY' | 'SELL' | 'NO_TRADE',
    confidence: number,
    strength: string,
    breakdown: VoteBreakdown
  ): string {
    const winningScore = vote === 'BUY' ? breakdown.buyWeightedScore : breakdown.sellWeightedScore;
    const losingScore = vote === 'BUY' ? breakdown.sellWeightedScore : breakdown.buyWeightedScore;

    return `[DET] ${vote} @ ${confidence}% | Strength: ${strength} | Score: ${winningScore.toFixed(0)} vs ${losingScore.toFixed(0)}`;
  }
}

export const omegaConfluenceAggregator = new OmegaConfluenceAggregator();
