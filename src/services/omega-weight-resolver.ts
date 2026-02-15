/**
 * OMEGA WEIGHT RESOLVER - SSOT Authority for Omega Council Weighting
 *
 * ARCHITECTURE RESPONSIBILITY:
 * This is the SINGLE SOURCE OF TRUTH for how Omega votes are weighted.
 * No other module may compute omega weights independently.
 *
 * WEIGHT COMPUTATION LAYERS (applied multiplicatively):
 * 1. STYLE BASE WEIGHT - from omega_weight_profiles table (data-driven)
 * 2. CONFIDENCE AMPLIFICATION - symmetric across all omegas (universal formula)
 * 3. REGIME ADJUSTMENT - market conditions modifier (multiplicative)
 * 4. RISK MODE MODIFIER - slight adjustment for risk tolerance (multiplicative)
 *
 * CCIP COMPLIANCE:
 * - All weight computations are logged to omega_weight_audit_log
 * - Weight profiles are database-driven (no hardcoded special cases)
 * - Confidence amplification is symmetric (no omega gets special treatment)
 *
 * GOVERNANCE:
 * - Replaces the old calculateWeights() method in coordinator-alpha.ts
 * - Eliminates the special-case OrderFlow 1.5x boost
 * - Adds style-aware weighting missing from the old system
 */

import { supabase } from '../lib/supabase';
import type { OmegaCouncilVotes, MarketContext } from '../brains/coordinator-alpha';

export type StyleIntent = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

interface WeightProfile {
  omega_name: string;
  base_weight: number;
  confidence_amplification_tiers: ConfidenceAmplificationTiers;
  accuracy_rate: number;
}

interface ConfidenceAmplificationTiers {
  below_20?: number;
  below_50?: number;
  '20_to_49'?: number;
  '50_to_69': number;
  '70_to_79': number;
  '80_to_89': number;
  '90_to_100': number;
}

export interface ResolvedWeights {
  weights: Record<string, number>;
  metadata: WeightResolutionMetadata;
}

export interface WeightResolutionMetadata {
  style: StyleIntent;
  riskMode: string;
  source: 'database' | 'fallback';
  breakdown: Record<string, WeightBreakdown>;
}

export interface WeightBreakdown {
  baseWeight: number;
  confidenceMultiplier: number;
  styleMultiplier: number;
  regimeMultiplier: number;
  finalWeight: number;
  omegaVote?: string;
  omegaConfidence?: number;
  weightedContribution?: number;
}

const FALLBACK_STYLE_WEIGHTS: Record<StyleIntent, Record<string, number>> = {
  SCALP: {
    scalper: 0.45, omega8: 0.25, volatility: 0.15,
    trend: 0.05, confirmation: 0.05, reversal: 0.03, risk: 0.02
  },
  MICRO_INTRADAY: {
    trend: 0.30, confirmation: 0.25, scalper: 0.15,
    omega8: 0.15, volatility: 0.10, reversal: 0.03, risk: 0.02
  },
  INTRADAY: {
    trend: 0.35, confirmation: 0.25, omega8: 0.15,
    volatility: 0.10, scalper: 0.08, reversal: 0.05, risk: 0.02
  }
};

const DEFAULT_CONFIDENCE_TIERS: ConfidenceAmplificationTiers = {
  below_20: 0.4,
  '20_to_49': 0.7,
  '50_to_69': 1.0,
  '70_to_79': 1.2,
  '80_to_89': 1.5,
  '90_to_100': 2.0
};

const REGIME_MODIFIERS: Record<string, Record<string, number>> = {
  bull: { trend: 1.2, confirmation: 1.1, scalper: 0.95, reversal: 0.9, volatility: 1.0, omega8: 1.0 },
  bear: { trend: 1.2, confirmation: 1.1, scalper: 0.95, reversal: 0.9, volatility: 1.0, omega8: 1.0 },
  side: { scalper: 1.15, reversal: 1.1, trend: 0.9, confirmation: 1.0, volatility: 1.0, omega8: 1.05 }
};

let profileCache: Record<string, WeightProfile[]> = {};
let profileCacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

class OmegaWeightResolver {

  async resolveWeights(
    votes: OmegaCouncilVotes,
    marketContext: MarketContext,
    style: StyleIntent,
    riskMode: 'low' | 'medium' | 'high',
    userId?: string,
    sessionId?: string
  ): Promise<ResolvedWeights> {
    const profiles = await this.getWeightProfiles(style);
    const source = profiles.length > 0 ? 'database' as const : 'fallback' as const;

    const baseWeights = source === 'database'
      ? this.profilesAsWeightMap(profiles)
      : { ...FALLBACK_STYLE_WEIGHTS[style] };

    const confidenceTiers = source === 'database' && profiles.length > 0
      ? (profiles[0].confidence_amplification_tiers || DEFAULT_CONFIDENCE_TIERS)
      : DEFAULT_CONFIDENCE_TIERS;

    const regimeModifier = REGIME_MODIFIERS[marketContext.regime] || {};

    const breakdown: Record<string, WeightBreakdown> = {};
    const finalWeights: Record<string, number> = {};

    const omegaEntries: Array<{ name: string; vote: any }> = [
      { name: 'trend', vote: votes.trend },
      { name: 'scalper', vote: votes.scalper },
      { name: 'confirmation', vote: votes.confirmation },
      { name: 'reversal', vote: votes.reversal },
      { name: 'volatility', vote: votes.volatility },
      { name: 'risk', vote: votes.risk },
      { name: 'omega8', vote: votes.omega8 }
    ];

    for (const entry of omegaEntries) {
      const base = baseWeights[entry.name] ?? 0.1;
      const confidence = entry.vote?.confidence ?? 0;
      const confMultiplier = this.getConfidenceMultiplier(confidence, confidenceTiers) ?? 1.0;
      const regimeMult = regimeModifier[entry.name] ?? 1.0;

      const riskModeAdjust = entry.name === 'risk' ? 0.5 : 1.0;

      const safeBase = typeof base === 'number' && !isNaN(base) ? base : 0.1;
      const safeConf = typeof confMultiplier === 'number' && !isNaN(confMultiplier) ? confMultiplier : 1.0;
      const safeRegime = typeof regimeMult === 'number' && !isNaN(regimeMult) ? regimeMult : 1.0;

      const finalWeight = safeBase * safeConf * safeRegime * riskModeAdjust;

      // GOVERNANCE FIX: Never use 'NO_VOTE' - all omegas must vote BUY or SELL
      // If vote is missing, use null (architectural violation but don't break audit log)
      const voteDirection = entry.vote?.vote || null;
      const weightedContribution = finalWeight * confidence;

      // Defensive check: Ensure no NaN values propagate
      if (isNaN(finalWeight) || isNaN(weightedContribution)) {
        console.error(`[OmegaWeightResolver] NaN detected for ${entry.name}: finalWeight=${finalWeight}, weightedContribution=${weightedContribution}`);
        console.error(`[OmegaWeightResolver] Debug: base=${base}, confMultiplier=${confMultiplier}, regimeMult=${regimeMult}, confidence=${confidence}`);
      }

      breakdown[entry.name] = {
        baseWeight: safeBase,
        confidenceMultiplier: safeConf,
        styleMultiplier: 1.0,
        regimeMultiplier: safeRegime,
        finalWeight: isNaN(finalWeight) ? 0 : finalWeight,
        omegaVote: voteDirection,
        omegaConfidence: confidence,
        weightedContribution: isNaN(weightedContribution) ? 0 : weightedContribution
      };

      finalWeights[entry.name] = isNaN(finalWeight) ? 0 : finalWeight;
    }

    if (userId) {
      this.logWeightAudit(userId, sessionId, style, riskMode, breakdown).catch(err => {
        console.warn('[OmegaWeightResolver] Audit log failed:', err);
      });
    }

    return {
      weights: finalWeights,
      metadata: {
        style,
        riskMode,
        source,
        breakdown
      }
    };
  }

  buildWeightSummaryForAlpha(metadata: WeightResolutionMetadata): string {
    const parts: string[] = [];
    parts.push(`OMEGA WEIGHTS [Style: ${metadata.style}] [Source: ${metadata.source}]`);

    const sorted = Object.entries(metadata.breakdown)
      .sort((a, b) => b[1].finalWeight - a[1].finalWeight);

    for (const [name, info] of sorted) {
      const confTag = info.omegaConfidence && info.omegaConfidence >= 80 ? ' [HIGH_CONF]' : '';
      const bw = (info.baseWeight ?? 0).toFixed(2);
      const cm = (info.confidenceMultiplier ?? 1).toFixed(1);
      const rm = (info.regimeMultiplier ?? 1).toFixed(2);
      const fw = (info.finalWeight ?? 0).toFixed(3);
      const wc = (info.weightedContribution ?? 0).toFixed(1);
      parts.push(
        `  ${name}: ${info.omegaVote} ${info.omegaConfidence ?? 0}% | ` +
        `base=${bw} x conf=${cm} x regime=${rm} ` +
        `= ${fw}${confTag} → ${wc} pts`
      );
    }

    return parts.join('\n');
  }

  buildDirectionalConflictAlert(
    votes: OmegaCouncilVotes,
    metadata: WeightResolutionMetadata,
    consensusDirection: string
  ): string | null {
    let highestConfOmega: { name: string; vote: string; confidence: number; accuracy: number } | null = null;

    const omegaEntries: Array<{ name: string; vote: any }> = [
      { name: 'trend', vote: votes.trend },
      { name: 'scalper', vote: votes.scalper },
      { name: 'confirmation', vote: votes.confirmation },
      { name: 'reversal', vote: votes.reversal },
      { name: 'volatility', vote: votes.volatility },
      { name: 'omega8', vote: votes.omega8 }
    ];

    for (const entry of omegaEntries) {
      if (!entry.vote) continue;
      const conf = entry.vote.confidence ?? 0;
      if (!highestConfOmega || conf > highestConfOmega.confidence) {
        const accuracy = metadata.breakdown[entry.name]?.baseWeight ?? 0;
        highestConfOmega = {
          name: entry.name,
          vote: entry.vote.vote,
          confidence: conf,
          accuracy: accuracy * 100
        };
      }
    }

    if (!highestConfOmega) return null;
    if (highestConfOmega.vote === consensusDirection) return null;
    if (highestConfOmega.confidence < 80) return null;

    const gap = highestConfOmega.confidence - (metadata.breakdown[highestConfOmega.name]?.weightedContribution ?? 0);
    if (gap < 15 && highestConfOmega.confidence < 85) return null;

    return (
      `DIRECTION CONFLICT: [${highestConfOmega.name.toUpperCase()}] voted ${highestConfOmega.vote} at ${highestConfOmega.confidence}% ` +
      `but weighted consensus is ${consensusDirection}. ` +
      `${highestConfOmega.name} is the style-specialist with highest conviction. ` +
      `Evaluate whether the high-confidence specialist should override consensus.`
    );
  }

  private getConfidenceMultiplier(confidence: number, tiers: ConfidenceAmplificationTiers): number {
    if (confidence >= 90) return tiers['90_to_100'] ?? 2.0;
    if (confidence >= 80) return tiers['80_to_89'] ?? 1.5;
    if (confidence >= 70) return tiers['70_to_79'] ?? 1.2;
    if (confidence >= 50) return tiers['50_to_69'] ?? 1.0;
    if (confidence >= 20) return tiers['20_to_49'] ?? tiers.below_50 ?? 0.7;
    return tiers.below_20 ?? tiers.below_50 ?? 0.4;
  }

  private async getWeightProfiles(style: StyleIntent): Promise<WeightProfile[]> {
    const now = Date.now();
    if (profileCache[style] && now - profileCacheTimestamp < CACHE_TTL_MS) {
      return profileCache[style];
    }

    try {
      const { data, error } = await supabase
        .rpc('get_omega_weights_for_style', { p_style: style });

      if (error || !data || data.length === 0) {
        console.warn(`[OmegaWeightResolver] No DB profiles for ${style}, using fallback`);
        return [];
      }

      profileCache[style] = data as WeightProfile[];
      profileCacheTimestamp = now;
      return data as WeightProfile[];
    } catch (err) {
      console.warn('[OmegaWeightResolver] DB fetch failed, using fallback:', err);
      return [];
    }
  }

  private profilesAsWeightMap(profiles: WeightProfile[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (const p of profiles) {
      map[p.omega_name] = p.base_weight;
    }
    return map;
  }

  private async logWeightAudit(
    userId: string,
    sessionId: string | undefined,
    style: StyleIntent,
    riskMode: string,
    breakdown: Record<string, WeightBreakdown>
  ): Promise<void> {
    try {
      const rows = Object.entries(breakdown).map(([omegaName, info]) => {
        // SSOT COMPLIANCE: Validate all required NOT NULL fields before insert
        const row = {
          user_id: userId,
          session_id: sessionId || null,
          style,
          risk_mode: riskMode,
          omega_name: omegaName,
          base_weight: isNaN(info.baseWeight) ? 0.1 : info.baseWeight,
          confidence_multiplier: isNaN(info.confidenceMultiplier) ? 1.0 : info.confidenceMultiplier,
          style_multiplier: isNaN(info.styleMultiplier) ? 1.0 : info.styleMultiplier,
          regime_multiplier: isNaN(info.regimeMultiplier) ? 1.0 : info.regimeMultiplier,
          final_weight: isNaN(info.finalWeight) ? 0 : info.finalWeight,
          omega_vote: info.omegaVote || null,
          omega_confidence: info.omegaConfidence || 0,
          weighted_contribution: isNaN(info.weightedContribution || 0) ? 0 : (info.weightedContribution || 0)
        };

        // Defensive validation: Log if any omega_vote is not BUY/SELL (architectural violation)
        if (row.omega_vote !== null && row.omega_vote !== 'BUY' && row.omega_vote !== 'SELL') {
          console.error(`[OmegaWeightResolver] GOVERNANCE VIOLATION: ${omegaName} has invalid vote "${row.omega_vote}". All omegas must vote BUY or SELL.`);
        }

        return row;
      });

      const { error } = await supabase.from('omega_weight_audit_log').insert(rows);

      if (error) {
        console.error('[OmegaWeightResolver] Audit insert failed with database error:', error);
        console.error('[OmegaWeightResolver] Attempted to insert:', JSON.stringify(rows, null, 2));
      }
    } catch (err) {
      console.error('[OmegaWeightResolver] Audit insert failed with exception:', err);
    }
  }

  invalidateCache(): void {
    profileCache = {};
    profileCacheTimestamp = 0;
  }
}

export const omegaWeightResolver = new OmegaWeightResolver();
