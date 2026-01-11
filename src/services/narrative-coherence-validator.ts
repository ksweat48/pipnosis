/**
 * Narrative Coherence Validator - SSOT for market narrative quality assessment
 *
 * Enforces single-sentence cause-effect market thesis for every trade.
 * Eliminates "technical coincidence" setups without fundamental directional logic.
 *
 * Validation Criteria:
 * 1. Cause-effect relationship present
 * 2. Specific price destination named
 * 3. Participant behavior identified
 * 4. Liquidity or structure intent referenced
 * 5. Concise and actionable (under 200 chars ideal)
 *
 * Confidence Penalties:
 * - No narrative: -30% (capped at 69%)
 * - Weak narrative: -15%
 * - Acceptable narrative: -5%
 * - Strong narrative: 0%
 */

export interface NarrativeValidation {
  narrative: string;
  strengthScore: number; // 0-100
  confidencePenalty: number; // 0 to -30
  passesGate: boolean; // false if too weak
  validationDetails: {
    hasCauseEffect: boolean;
    hasDestination: boolean;
    hasParticipantBehavior: boolean;
    hasLiquidityIntent: boolean;
    isConcise: boolean;
  };
  feedback: string;
  qualityTier: 'none' | 'weak' | 'acceptable' | 'strong' | 'excellent';
}

export class NarrativeCoherenceValidator {
  private readonly MAX_PENALTY = -30;
  private readonly WEAK_PENALTY = -15;
  private readonly ACCEPTABLE_PENALTY = -5;
  private readonly NO_PENALTY = 0;

  /**
   * Validate narrative quality
   * SSOT for narrative assessment - always returns structured feedback
   */
  validate(narrative: string | undefined): NarrativeValidation {
    // No narrative provided
    if (!narrative || narrative.trim().length === 0) {
      return this.noNarrativeResult();
    }

    const trimmed = narrative.trim();

    // Check validation criteria
    const hasCauseEffect = this.checkCauseEffect(trimmed);
    const hasDestination = this.checkDestination(trimmed);
    const hasParticipantBehavior = this.checkParticipantBehavior(trimmed);
    const hasLiquidityIntent = this.checkLiquidityIntent(trimmed);
    const isConcise = trimmed.length <= 250;

    const validationDetails = {
      hasCauseEffect,
      hasDestination,
      hasParticipantBehavior,
      hasLiquidityIntent,
      isConcise
    };

    // Calculate strength score
    const strengthScore = this.calculateStrengthScore(validationDetails);

    // Determine quality tier
    const qualityTier = this.determineQualityTier(strengthScore, validationDetails);

    // Calculate confidence penalty
    const confidencePenalty = this.calculatePenalty(qualityTier);

    // Check if passes gate (must be at least "acceptable")
    const passesGate = qualityTier !== 'none' && qualityTier !== 'weak';

    // Generate feedback
    const feedback = this.generateFeedback(qualityTier, validationDetails);

    return {
      narrative: trimmed,
      strengthScore,
      confidencePenalty,
      passesGate,
      validationDetails,
      feedback,
      qualityTier
    };
  }

  /**
   * Check for cause-effect relationship
   */
  private checkCauseEffect(narrative: string): boolean {
    const causeEffectIndicators = [
      'because',
      'due to',
      'after',
      'following',
      'triggered',
      'led to',
      'caused',
      'resulting in',
      'swept',
      'broke',
      'rejected',
      'failed',
      'confirming',
      'suggesting'
    ];

    const lower = narrative.toLowerCase();
    return causeEffectIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Check for specific price destination
   */
  private checkDestination(narrative: string): boolean {
    const destinationIndicators = [
      'target',
      'headed',
      'toward',
      'to ',
      'reach',
      'test',
      'fill gap',
      'retest',
      'return to',
      'back to',
      'into',
      'above',
      'below',
      'level',
      'zone',
      'support',
      'resistance'
    ];

    // Also check for numeric price levels (e.g., "1.0850", "104.50")
    const hasNumericLevel = /\d+\.\d+/.test(narrative);

    const lower = narrative.toLowerCase();
    const hasDestinationWord = destinationIndicators.some(indicator => lower.includes(indicator));

    return hasDestinationWord || hasNumericLevel;
  }

  /**
   * Check for participant behavior identification
   */
  private checkParticipantBehavior(narrative: string): boolean {
    const participantIndicators = [
      'retail',
      'institutional',
      'smart money',
      'sellers',
      'buyers',
      'longs',
      'shorts',
      'trapped',
      'chasing',
      'taking profit',
      'accumulating',
      'distributing',
      'absorption',
      'capitulation',
      'participants',
      'traders',
      'breakout chasers',
      'stop hunters'
    ];

    const lower = narrative.toLowerCase();
    return participantIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Check for liquidity or structure intent
   */
  private checkLiquidityIntent(narrative: string): boolean {
    const liquidityIndicators = [
      'liquidity',
      'sweep',
      'hunt',
      'stops',
      'stop loss',
      'breakout',
      'fakeout',
      'structure',
      'high',
      'low',
      'demand',
      'supply',
      'imbalance',
      'gap',
      'cascade',
      'run on stops',
      'flush',
      'absorption'
    ];

    const lower = narrative.toLowerCase();
    return liquidityIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Calculate strength score from validation criteria
   */
  private calculateStrengthScore(details: NarrativeValidation['validationDetails']): number {
    let score = 0;

    if (details.hasCauseEffect) score += 30;
    if (details.hasDestination) score += 25;
    if (details.hasParticipantBehavior) score += 20;
    if (details.hasLiquidityIntent) score += 20;
    if (details.isConcise) score += 5;

    return Math.min(score, 100);
  }

  /**
   * Determine quality tier
   */
  private determineQualityTier(
    strengthScore: number,
    details: NarrativeValidation['validationDetails']
  ): NarrativeValidation['qualityTier'] {
    // Excellent: All criteria met
    if (strengthScore >= 90 && details.hasCauseEffect && details.hasDestination) {
      return 'excellent';
    }

    // Strong: Most criteria met, including cause-effect
    if (strengthScore >= 70 && details.hasCauseEffect) {
      return 'strong';
    }

    // Acceptable: Has cause-effect OR (destination + one other)
    if (details.hasCauseEffect || (details.hasDestination && (details.hasParticipantBehavior || details.hasLiquidityIntent))) {
      return 'acceptable';
    }

    // Weak: Some elements but missing key components
    if (strengthScore >= 25) {
      return 'weak';
    }

    // None: Effectively no narrative
    return 'none';
  }

  /**
   * Calculate confidence penalty based on quality tier
   */
  private calculatePenalty(qualityTier: NarrativeValidation['qualityTier']): number {
    switch (qualityTier) {
      case 'excellent':
      case 'strong':
        return this.NO_PENALTY;
      case 'acceptable':
        return this.ACCEPTABLE_PENALTY;
      case 'weak':
        return this.WEAK_PENALTY;
      case 'none':
        return this.MAX_PENALTY;
      default:
        return this.MAX_PENALTY;
    }
  }

  /**
   * Generate feedback for narrative improvement
   */
  private generateFeedback(
    qualityTier: NarrativeValidation['qualityTier'],
    details: NarrativeValidation['validationDetails']
  ): string {
    const missing: string[] = [];

    if (!details.hasCauseEffect) missing.push('cause-effect relationship');
    if (!details.hasDestination) missing.push('price destination');
    if (!details.hasParticipantBehavior) missing.push('participant behavior');
    if (!details.hasLiquidityIntent) missing.push('liquidity/structure intent');
    if (!details.isConcise) missing.push('conciseness (keep under 250 chars)');

    if (qualityTier === 'excellent') {
      return 'Excellent narrative - clear institutional reasoning.';
    }

    if (qualityTier === 'strong') {
      return `Strong narrative. ${missing.length > 0 ? 'Consider adding: ' + missing.join(', ') : ''}`;
    }

    if (qualityTier === 'acceptable') {
      return `Acceptable narrative. Missing: ${missing.join(', ')}`;
    }

    if (qualityTier === 'weak') {
      return `Weak narrative. Must include: ${missing.join(', ')}. Example: "Swept Asian lows, trapped retail shorts, targeting 1.0850 retest."`;
    }

    return 'No narrative provided. Must include cause-effect thesis. Example: "Failed breakout above 104.50, sellers in control, targeting 103.80 support."';
  }

  /**
   * Result when no narrative provided
   */
  private noNarrativeResult(): NarrativeValidation {
    return {
      narrative: '',
      strengthScore: 0,
      confidencePenalty: this.MAX_PENALTY,
      passesGate: false,
      validationDetails: {
        hasCauseEffect: false,
        hasDestination: false,
        hasParticipantBehavior: false,
        hasLiquidityIntent: false,
        isConcise: false
      },
      feedback: 'No narrative provided. Confidence capped at 69%. Must provide clear cause-effect thesis.',
      qualityTier: 'none'
    };
  }

  /**
   * Get example narratives for guidance
   */
  getExampleNarratives(): {
    excellent: string[];
    acceptable: string[];
    poor: string[];
  } {
    return {
      excellent: [
        'Swept Asian lows, trapped retail shorts, BOS confirms predators long - targeting 1.0850 previous resistance.',
        'Failed breakout at 104.50, institutional distribution evident, sellers targeting 103.20 liquidity zone.',
        'Double bottom retest at 1.2680 after stop-hunt, buyers defending structure - targeting 1.2750 gap fill.'
      ],
      acceptable: [
        'Price rejected resistance at 1.0900, heading back to support at 1.0850.',
        'Liquidity sweep detected, expecting reversal toward previous high.',
        'Breakout above 103.50 with volume, targeting 104.00 resistance.'
      ],
      poor: [
        'Good setup here.',
        'Technical levels look favorable.',
        'Multiple indicators aligning.',
        'Price action suggests potential move.'
      ]
    };
  }
}

export const narrativeCoherenceValidator = new NarrativeCoherenceValidator();
