/**
 * Style Context Builder (TIER 3 FIX)
 *
 * SSOT Authority: Builds style personality context for Alpha's decision-making
 *
 * Governance:
 * - Validates: Extracts and formats style-specific guidance
 * - Alpha Decides: Uses personality traits to inform trade planning
 * - Degrades Intelligently: Returns generic guidance if style unknown
 *
 * CCIP Compliance: Non-breaking enhancement to Alpha's context
 *
 * TIER 3 Enhancement: Injects style personality into Alpha prompt context
 * to provide style-aware guidance for entry timing, TP/SL sizing, and duration expectations.
 */

import { STYLE_PERSONALITIES, type StylePersonality } from '../config/style-personalities';
import { TRADE_STYLES, type StyleDisplayName } from '../config/trade-styles';
import { logger } from '../lib/logger';

export interface StyleContext {
  style: string;
  mindset: string;
  description: string;
  targetDurationHours: number;
  entryBias: string;
  typicalTPPips: { low: number; mid: number; high: number };
  typicalSLPips: { low: number; mid: number; high: number };
  guidance: string;
}

/**
 * TIER 3 FIX: Build style personality context for Alpha
 *
 * Provides style-specific guidance to help Alpha make decisions that align
 * with the intended trading style's personality and duration expectations.
 *
 * @param style Trading style name (SCALP, MICRO_INTRADAY, INTRADAY)
 * @returns StyleContext with personality traits and guidance
 */
export function buildStyleContext(style: string | undefined): StyleContext | null {
  if (!style) {
    return null; // No style specified = no guidance needed
  }

  try {
    // Normalize style name
    const normalizedStyle = style.toUpperCase() as StyleDisplayName;

    // Get personality data
    const personality = STYLE_PERSONALITIES[normalizedStyle];

    if (!personality) {
      logger.warn('Style context builder: Unknown style, using generic guidance', {
        style
      });
      return buildGenericStyleContext(style);
    }

    // Build comprehensive guidance
    const guidance = buildStyleGuidance(personality);

    const context: StyleContext = {
      style: personality.displayName,
      mindset: personality.mindset,
      description: personality.description,
      targetDurationHours: personality.durationBand.targetHours,
      entryBias: formatEntryBias(personality.entryBias),
      typicalTPPips: personality.referenceRanges?.typicalTPPips || { low: 20, mid: 40, high: 60 },
      typicalSLPips: personality.referenceRanges?.typicalSLPips || { low: 10, mid: 20, high: 30 },
      guidance
    };

    logger.info('Style context builder: Built style context', {
      style: normalizedStyle,
      targetDuration: context.targetDurationHours,
      entryBias: context.entryBias
    });

    return context;

  } catch (error) {
    logger.warn('Style context builder: Error building context, using generic', {
      style,
      error: error instanceof Error ? error.message : String(error)
    });
    return buildGenericStyleContext(style);
  }
}

/**
 * Build comprehensive style guidance for Alpha
 */
function buildStyleGuidance(personality: StylePersonality): string {
  const parts: string[] = [];

  // Mindset
  parts.push(`**${personality.displayName} Mindset**: ${personality.mindset}`);

  // Entry approach
  const entryApproach = formatEntryApproach(personality);
  parts.push(`**Entry Approach**: ${entryApproach}`);

  // Duration expectations
  const duration = personality.durationBand;
  parts.push(
    `**Duration Target**: ${duration.targetHours}h (acceptable: ${duration.minHours}h-${duration.maxHours}h)`
  );

  // TP/SL expectations
  if (personality.referenceRanges) {
    const tpRange = personality.referenceRanges.typicalTPPips;
    const slRange = personality.referenceRanges.typicalSLPips;
    parts.push(
      `**Typical Targets**: TP ${tpRange.low}-${tpRange.high} pips (optimal: ${tpRange.mid}), SL ${slRange.low}-${slRange.high} pips (optimal: ${slRange.mid})`
    );
  }

  // EQS interpretation
  parts.push(`**EQS Interpretation**: ${personality.eqsInterpretation.description}`);

  // Specific advice based on style
  const styleAdvice = getStyleSpecificAdvice(personality.displayName);
  if (styleAdvice) {
    parts.push(`**Style Note**: ${styleAdvice}`);
  }

  return parts.join('\n');
}

/**
 * Format entry bias into readable guidance
 */
function formatEntryBias(entryBias: StylePersonality['entryBias']): string {
  const { preferredEntryType, aggressionLevel, waitTolerance } = entryBias;

  const parts: string[] = [];

  // Preferred entry type
  switch (preferredEntryType) {
    case 'immediate':
      parts.push('Prefers immediate execution when conditions align');
      break;
    case 'pullback':
      parts.push('Prefers waiting for pullback entries');
      break;
    case 'confirmation':
      parts.push('Prefers confirmation before entry');
      break;
  }

  // Aggression level
  if (aggressionLevel === 'high') {
    parts.push('aggressive positioning');
  } else if (aggressionLevel === 'low') {
    parts.push('conservative positioning');
  }

  // Wait tolerance
  if (waitTolerance === 'low') {
    parts.push('minimal patience for setup development');
  } else if (waitTolerance === 'high') {
    parts.push('high patience for optimal setup');
  }

  return parts.join(', ');
}

/**
 * Format full entry approach description
 */
function formatEntryApproach(personality: StylePersonality): string {
  const { preferredEntryType, aggressionLevel, waitTolerance } = personality.entryBias;

  if (preferredEntryType === 'immediate' && aggressionLevel === 'high') {
    return 'Strike quickly when setup appears - speed over perfection';
  }

  if (preferredEntryType === 'pullback' && waitTolerance === 'high') {
    return 'Patient approach - wait for ideal pullback entry zones';
  }

  if (preferredEntryType === 'confirmation' && waitTolerance === 'medium') {
    return 'Balanced - seek confirmation but don\'t over-wait';
  }

  return `${preferredEntryType} entries with ${aggressionLevel} aggression`;
}

/**
 * Get style-specific advice
 */
function getStyleSpecificAdvice(style: StyleDisplayName): string {
  const advice: Record<StyleDisplayName, string> = {
    SCALP: 'Prioritize execution speed and tight stops. Exit on target or time decay.',
    MICRO_INTRADAY: 'Balance speed with structure. Look for clean entry zones with room to breathe.',
    INTRADAY: 'Focus on structural moves. Allow setup time to develop fully before entry.',
  };

  return advice[style] || '';
}

/**
 * Build generic style context when specific personality unavailable
 */
function buildGenericStyleContext(style: string): StyleContext {
  return {
    style: style.toUpperCase(),
    mindset: 'Balanced trader - adapt to market conditions',
    description: 'Generic trading style with balanced risk and reward expectations',
    targetDurationHours: 4,
    entryBias: 'Balanced entry approach with medium aggression',
    typicalTPPips: { low: 30, mid: 50, high: 80 },
    typicalSLPips: { low: 15, mid: 25, high: 40 },
    guidance: 'Standard trading approach - adapt to market structure and volatility'
  };
}

/**
 * Get style-specific TP/SL range validation
 * Returns true if proposed levels are within typical range for style
 */
export function validateTPSLForStyle(
  style: string | undefined,
  tpPips: number,
  slPips: number
): {
  valid: boolean;
  warnings: string[];
  adjustments: string[];
} {
  if (!style) {
    return { valid: true, warnings: [], adjustments: [] };
  }

  const normalizedStyle = style.toUpperCase() as StyleDisplayName;
  const personality = STYLE_PERSONALITIES[normalizedStyle];

  if (!personality?.referenceRanges) {
    return { valid: true, warnings: [], adjustments: [] };
  }

  const warnings: string[] = [];
  const adjustments: string[] = [];
  const { typicalTPPips, typicalSLPips } = personality.referenceRanges;

  // Check TP
  if (tpPips < typicalTPPips.low) {
    warnings.push(`TP (${tpPips} pips) is below typical range for ${normalizedStyle} (${typicalTPPips.low}-${typicalTPPips.high})`);
    adjustments.push(`Consider increasing TP to at least ${typicalTPPips.mid} pips`);
  } else if (tpPips > typicalTPPips.high) {
    warnings.push(`TP (${tpPips} pips) exceeds typical range for ${normalizedStyle} (${typicalTPPips.low}-${typicalTPPips.high})`);
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — style is immutable.
    void normalizedStyle;
    adjustments.push(`Consider confirming structural justification or selecting a closer in-band target`);
  }

  // Check SL
  if (slPips < typicalSLPips.low) {
    warnings.push(`SL (${slPips} pips) is below typical range for ${normalizedStyle} (${typicalSLPips.low}-${typicalSLPips.high})`);
    adjustments.push(`Tight SL increases stop-out risk - consider ${typicalSLPips.mid} pips`);
  } else if (slPips > typicalSLPips.high) {
    warnings.push(`SL (${slPips} pips) exceeds typical range for ${normalizedStyle} (${typicalSLPips.low}-${typicalSLPips.high})`);
    adjustments.push(`Wide SL reduces position size - ensure structural justification`);
  }

  return {
    valid: warnings.length === 0,
    warnings,
    adjustments
  };
}
