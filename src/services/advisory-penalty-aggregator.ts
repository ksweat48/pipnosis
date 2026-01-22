/**
 * Advisory Penalty Aggregator - SSOT for Confidence Penalty Management
 *
 * GOVERNANCE GUARDRAIL:
 * Ensures that no combination of advisory penalties can reduce Alpha's
 * confidence by more than MAX_TOTAL_PENALTY_PERCENT (25%).
 *
 * This prevents "death by a thousand cuts" where multiple advisory systems
 * stack penalties until confidence always drops below execution threshold.
 *
 * ALPHA AUTHORITY PRINCIPLE:
 * Advisory systems inform Alpha, they don't veto Alpha.
 * Strong conviction must still be actionable after penalties.
 */

export interface AdvisoryPenalty {
  source: string;        // e.g., "Safety:SL_Too_Wide", "Adversarial:Mild"
  reason: string;        // Human-readable explanation
  penaltyPercent: number; // Absolute penalty (e.g., 10 = -10%)
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
  // Governance guardrail: No more than 25% total penalty
  private readonly MAX_TOTAL_PENALTY_PERCENT = 25;

  // Individual penalty caps by category
  private readonly CATEGORY_CAPS = {
    risk: 15,          // Risk-related penalties (SL distance, R:R, exposure)
    timing: 10,        // Time-related penalties (urgency, decay, staleness)
    environment: 15,   // Market environment (adversarial, regime, volatility)
    quality: 10,       // Quality metrics (EQS, pattern confidence)
  };

  /**
   * Apply advisory penalties with governance cap
   *
   * Returns adjusted confidence that:
   * 1. Applies all penalties transparently
   * 2. Caps total penalty at MAX_TOTAL_PENALTY_PERCENT
   * 3. Preserves Alpha's ability to act on strong conviction
   */
  applyPenalties(
    originalConfidence: number,
    penalties: AdvisoryPenalty[]
  ): PenaltyResult {
    if (penalties.length === 0) {
      return {
        originalConfidence,
        totalPenaltyPercent: 0,
        cappedPenaltyPercent: 0,
        finalConfidence: originalConfidence,
        penalties: [],
        wasCapped: false,
      };
    }

    // Apply category caps first
    const cappedPenalties = this.applyCategoryCaps(penalties);

    // Calculate total uncapped penalty
    const totalPenalty = cappedPenalties.reduce(
      (sum, p) => sum + p.penaltyPercent,
      0
    );

    // Apply governance cap
    const cappedPenalty = Math.min(totalPenalty, this.MAX_TOTAL_PENALTY_PERCENT);
    const wasCapped = totalPenalty > this.MAX_TOTAL_PENALTY_PERCENT;

    // Calculate final confidence (never below 0)
    const finalConfidence = Math.max(0, originalConfidence - cappedPenalty);

    const result: PenaltyResult = {
      originalConfidence,
      totalPenaltyPercent: totalPenalty,
      cappedPenaltyPercent: cappedPenalty,
      finalConfidence,
      penalties: cappedPenalties,
      wasCapped,
    };

    if (wasCapped) {
      result.capReason = `Total penalty ${totalPenalty.toFixed(1)}% exceeds governance cap of ${this.MAX_TOTAL_PENALTY_PERCENT}%. Alpha authority preserved.`;
    }

    // Log penalty application
    console.log(`[Advisory Penalties] Original: ${originalConfidence}%`);
    cappedPenalties.forEach(p => {
      console.log(`  - ${p.source}: -${p.penaltyPercent}% (${p.reason})`);
    });
    if (wasCapped) {
      console.log(`  ⚠️ CAPPED: ${totalPenalty.toFixed(1)}% → ${cappedPenalty.toFixed(1)}%`);
      console.log(`  🛡️ Governance guardrail active: Alpha authority preserved`);
    }
    console.log(`[Advisory Penalties] Final: ${finalConfidence.toFixed(1)}%`);

    return result;
  }

  /**
   * Apply per-category caps before total cap
   *
   * Prevents single category from dominating penalties
   */
  private applyCategoryCaps(penalties: AdvisoryPenalty[]): AdvisoryPenalty[] {
    const byCategory = new Map<string, AdvisoryPenalty[]>();

    // Group by category
    for (const penalty of penalties) {
      const existing = byCategory.get(penalty.category) || [];
      existing.push(penalty);
      byCategory.set(penalty.category, existing);
    }

    // Apply category caps
    const cappedPenalties: AdvisoryPenalty[] = [];

    for (const [category, categoryPenalties] of byCategory.entries()) {
      const categoryTotal = categoryPenalties.reduce(
        (sum, p) => sum + p.penaltyPercent,
        0
      );

      const categoryCap = this.CATEGORY_CAPS[category as keyof typeof this.CATEGORY_CAPS] || 10;

      if (categoryTotal > categoryCap) {
        // Scale down all penalties in this category proportionally
        const scaleFactor = categoryCap / categoryTotal;
        const scaled = categoryPenalties.map(p => ({
          ...p,
          penaltyPercent: p.penaltyPercent * scaleFactor,
        }));
        cappedPenalties.push(...scaled);

        console.log(
          `[Advisory Penalties] Category '${category}' capped: ${categoryTotal.toFixed(1)}% → ${categoryCap}%`
        );
      } else {
        cappedPenalties.push(...categoryPenalties);
      }
    }

    return cappedPenalties;
  }

  /**
   * Create advisory penalty
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
      penaltyPercent: Math.max(0, penaltyPercent), // Never negative
      category,
    };
  }

  /**
   * Get governance limits
   */
  getLimits() {
    return {
      maxTotalPenaltyPercent: this.MAX_TOTAL_PENALTY_PERCENT,
      categoryCaps: this.CATEGORY_CAPS,
    };
  }

  /**
   * Check if confidence after penalties would still be actionable
   *
   * Returns warning if final confidence would be critically low
   */
  checkActionability(
    originalConfidence: number,
    penalties: AdvisoryPenalty[],
    minActionableConfidence: number = 40
  ): { actionable: boolean; warning?: string } {
    const result = this.applyPenalties(originalConfidence, penalties);

    if (result.finalConfidence < minActionableConfidence) {
      return {
        actionable: false,
        warning: `Confidence ${result.finalConfidence.toFixed(1)}% below actionable threshold ${minActionableConfidence}%. Consider waiting for better setup.`,
      };
    }

    return { actionable: true };
  }
}

export const advisoryPenaltyAggregator = new AdvisoryPenaltyAggregator();
