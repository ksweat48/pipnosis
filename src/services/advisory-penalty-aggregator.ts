/**
 * Advisory Signal Aggregator - Audit Logger
 *
 * GOVERNANCE ROLE (CCIP-2026-02-19):
 * Advisory signals are passed to Alpha as context in the briefing text.
 * Alpha self-prices all advisory signals into his stated trade_confidence.
 * No code arithmetic is applied to Alpha's confidence after he outputs it.
 *
 * This module creates structured advisory signal records for audit logging
 * and passes them as informational context. It does NOT reduce confidence.
 *
 * ALPHA AUTHORITY PRINCIPLE:
 * Advisory systems inform Alpha — they never modify his output.
 */

export interface AdvisoryPenalty {
  source: string;
  reason: string;
  penaltyPercent: number;
  category: 'risk' | 'timing' | 'environment' | 'quality';
}

export interface PenaltyResult {
  originalConfidence: number;
  totalPenaltyPercent: number;
  cappedPenaltyPercent: number;
  finalConfidence: number;
  penalties: AdvisoryPenalty[];
  wasCapped: boolean;
  capReason?: string;
}

class AdvisoryPenaltyAggregator {
  /**
   * Log advisory signals for audit — confidence is NOT modified.
   *
   * Alpha receives all advisory signals as context in his briefing.
   * finalConfidence always equals originalConfidence.
   */
  applyPenalties(
    originalConfidence: number,
    penalties: AdvisoryPenalty[]
  ): PenaltyResult {
    const totalPenalty = penalties.reduce((sum, p) => sum + p.penaltyPercent, 0);

    if (penalties.length > 0) {
      console.log(`[Advisory Signals] Audit log — confidence: ${originalConfidence}% (unchanged — signals passed to Alpha as context)`);
      penalties.forEach(p => {
        console.log(`  - ${p.source}: ${p.penaltyPercent.toFixed(1)}% signal (${p.reason}) [informational only]`);
      });
    }

    return {
      originalConfidence,
      totalPenaltyPercent: totalPenalty,
      cappedPenaltyPercent: totalPenalty,
      finalConfidence: originalConfidence,
      penalties,
      wasCapped: false,
    };
  }

  /**
   * Create an advisory signal record for audit logging.
   */
  createPenalty(
    source: string,
    reason: string,
    penaltyPercent: number,
    category: AdvisoryPenalty['category']
  ): AdvisoryPenalty {
    return {
      source,
      reason,
      penaltyPercent: Math.max(0, penaltyPercent),
      category,
    };
  }
}

export const advisoryPenaltyAggregator = new AdvisoryPenaltyAggregator();
