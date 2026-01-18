/**
 * Alpha Thesis Parser Service
 *
 * SSOT: Separates Alpha's LLM response into:
 * - THESIS (cacheable market truth)
 * - EXECUTION (user-specific decisions)
 *
 * Validates:
 * - No price levels in thesis section
 * - Thesis rejection signals
 * - Content integrity for caching
 */

import { ParsedAlphaResponse, RegimeSignature } from '../types/alpha-thesis';
import { logger } from '../lib/logger';

const THESIS_SECTION_MARKERS = [
  'MARKET THESIS',
  'CACHED THESIS',
  'THESIS:',
  'Market Analysis:'
];

const EXECUTION_SECTION_MARKERS = [
  'EXECUTION PLAN',
  'EXECUTION:',
  'Trade Decision:',
  'Entry Plan:'
];

const REJECTION_MARKERS = [
  'REJECT_THESIS',
  'THESIS_REJECTED',
  'MARKET_CHANGED',
  'INVALIDATED'
];

/**
 * Parse structured Alpha response
 * Extracts thesis and execution sections
 */
export function parseStructuredAlphaResponse(
  rawResponse: string,
  symbol: string
): ParsedAlphaResponse | null {
  try {
    // Check for thesis rejection first
    const thesisRejected = detectThesisRejection(rawResponse);
    const rejectionReason = thesisRejected ? extractRejectionReason(rawResponse) : undefined;

    if (thesisRejected) {
      logger.info('[AlphaThesisParser] Thesis rejection detected', {
        symbol,
        reason: rejectionReason
      });

      // Return rejection without parsing (fresh generation needed)
      return {
        thesis: {
          directionBias: 'NEUTRAL',
          narrative: 'Thesis rejected - market changed',
          regime: 'unknown',
          confidenceBand: 'weak'
        },
        execution: {
          decision: 'WAIT',
          confidence: 0,
          reasoning: rejectionReason || 'Thesis rejected',
          style: 'unknown'
        },
        thesisRejected: true,
        rejectionReason
      };
    }

    // Extract thesis and execution sections
    const thesisSection = extractThesisSection(rawResponse);
    const executionSection = extractExecutionSection(rawResponse);

    if (!thesisSection || !executionSection) {
      logger.warn('[AlphaThesisParser] Failed to extract sections', {
        symbol,
        hasThesis: !!thesisSection,
        hasExecution: !!executionSection
      });
      return null;
    }

    // Validate no price levels in thesis
    if (containsPriceLevels(thesisSection)) {
      logger.warn('[AlphaThesisParser] Price levels detected in thesis section', {
        symbol
      });
      // This is a soft violation - we'll still parse but log it
    }

    // Parse thesis content
    const thesis = parseThesisContent(thesisSection, symbol);
    const execution = parseExecutionContent(executionSection, symbol);

    if (!thesis || !execution) {
      logger.warn('[AlphaThesisParser] Failed to parse content', {
        symbol,
        hasThesis: !!thesis,
        hasExecution: !!execution
      });
      return null;
    }

    return {
      thesis,
      execution,
      thesisRejected: false
    };
  } catch (error) {
    logger.error('[AlphaThesisParser] Parse error', {
      symbol,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

/**
 * Detect if Alpha rejected the cached thesis
 */
function detectThesisRejection(response: string): boolean {
  const upperResponse = response.toUpperCase();
  return REJECTION_MARKERS.some(marker => upperResponse.includes(marker));
}

/**
 * Extract rejection reason from response
 */
function extractRejectionReason(response: string): string {
  const rejectionMatch = response.match(/REJECT_THESIS[:\s]+([^\n]+)/i);
  if (rejectionMatch && rejectionMatch[1]) {
    return rejectionMatch[1].trim();
  }

  // Try to extract any reason after rejection marker
  for (const marker of REJECTION_MARKERS) {
    const markerIndex = response.toUpperCase().indexOf(marker);
    if (markerIndex !== -1) {
      const afterMarker = response.substring(markerIndex + marker.length, markerIndex + marker.length + 200);
      const lines = afterMarker.split('\n');
      if (lines[0]) {
        return lines[0].replace(/[:;-]/g, '').trim();
      }
    }
  }

  return 'Market conditions have changed';
}

/**
 * Extract thesis section from response
 */
function extractThesisSection(response: string): string | null {
  for (const marker of THESIS_SECTION_MARKERS) {
    const markerIndex = response.indexOf(marker);
    if (markerIndex !== -1) {
      const startIndex = markerIndex + marker.length;

      // Find end of thesis section (next section marker or end of response)
      let endIndex = response.length;
      for (const execMarker of EXECUTION_SECTION_MARKERS) {
        const execIndex = response.indexOf(execMarker, startIndex);
        if (execIndex !== -1 && execIndex < endIndex) {
          endIndex = execIndex;
        }
      }

      return response.substring(startIndex, endIndex).trim();
    }
  }

  return null;
}

/**
 * Extract execution section from response
 */
function extractExecutionSection(response: string): string | null {
  for (const marker of EXECUTION_SECTION_MARKERS) {
    const markerIndex = response.indexOf(marker);
    if (markerIndex !== -1) {
      const startIndex = markerIndex + marker.length;
      return response.substring(startIndex).trim();
    }
  }

  return null;
}

/**
 * Check if text contains price levels (entry, SL, TP)
 */
function containsPriceLevels(text: string): boolean {
  const priceLevelPatterns = [
    /entry[:\s]+[\d.]+/i,
    /stop[:\s]*loss[:\s]+[\d.]+/i,
    /take[:\s]*profit[:\s]+[\d.]+/i,
    /\$[\d,]+\.\d{2}/,
    /[\d]{1,5}\.\d{2,5}/
  ];

  return priceLevelPatterns.some(pattern => pattern.test(text));
}

/**
 * Parse thesis content into structured format
 */
function parseThesisContent(
  thesisText: string,
  symbol: string
): ParsedAlphaResponse['thesis'] | null {
  try {
    // Extract direction bias
    const directionBias = extractDirectionBias(thesisText);

    // Extract narrative (main body of thesis)
    const narrative = thesisText.substring(0, 500); // First 500 chars as narrative

    // Extract regime classification
    const regime = extractRegime(thesisText);

    // Extract liquidity context
    const liquidityContext = extractLiquidityContext(thesisText);

    // Extract invalidation logic
    const invalidationLogic = extractInvalidationLogic(thesisText);

    // Extract timeframe relevance
    const timeframeRelevance = extractTimeframeRelevance(thesisText);

    // Determine confidence band
    const confidenceBand = extractConfidenceBand(thesisText);

    return {
      directionBias,
      narrative,
      regime,
      liquidityContext,
      invalidationLogic,
      timeframeRelevance,
      confidenceBand
    };
  } catch (error) {
    logger.error('[AlphaThesisParser] Thesis parse error', {
      symbol,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

/**
 * Parse execution content into structured format
 */
function parseExecutionContent(
  executionText: string,
  symbol: string
): ParsedAlphaResponse['execution'] | null {
  try {
    // Extract decision (BUY/SELL/WAIT)
    const decision = extractDecision(executionText);

    // Extract entry price (if present)
    const entry = extractEntry(executionText);

    // Extract stop loss (if present)
    const stopLoss = extractStopLoss(executionText);

    // Extract take profit (if present)
    const takeProfit = extractTakeProfit(executionText);

    // Extract confidence score
    const confidence = extractConfidence(executionText);

    // Extract reasoning
    const reasoning = executionText.substring(0, 300); // First 300 chars as reasoning

    // Extract style
    const style = extractStyle(executionText);

    return {
      decision,
      entry,
      stopLoss,
      takeProfit,
      confidence,
      reasoning,
      style
    };
  } catch (error) {
    logger.error('[AlphaThesisParser] Execution parse error', {
      symbol,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

function extractDirectionBias(text: string): 'BUY' | 'SELL' | 'NEUTRAL' | 'MIXED' {
  const upperText = text.toUpperCase();

  if (upperText.includes('BULLISH') || upperText.includes('BUY BIAS')) {
    return 'BUY';
  }
  if (upperText.includes('BEARISH') || upperText.includes('SELL BIAS')) {
    return 'SELL';
  }
  if (upperText.includes('MIXED') || upperText.includes('CONFLICTING')) {
    return 'MIXED';
  }

  return 'NEUTRAL';
}

function extractRegime(text: string): string {
  const regimePatterns = [
    /regime[:\s]+([a-z\s]+)/i,
    /market[:\s]+([a-z\s]+)\s+regime/i
  ];

  for (const pattern of regimePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return 'unknown';
}

function extractLiquidityContext(text: string): string | undefined {
  const liquidityTerms = ['sweep', 'trap', 'continuation', 'reversal', 'breakout', 'fake'];
  const lowerText = text.toLowerCase();

  for (const term of liquidityTerms) {
    if (lowerText.includes(term)) {
      return term;
    }
  }

  return undefined;
}

function extractInvalidationLogic(text: string): string | undefined {
  const invalidationMatch = text.match(/invalidat[a-z]*[:\s]+([^\n]+)/i);
  if (invalidationMatch && invalidationMatch[1]) {
    return invalidationMatch[1].trim();
  }
  return undefined;
}

function extractTimeframeRelevance(text: string): string | undefined {
  const timeframeMatch = text.match(/(M\d+|H\d+|D)/gi);
  if (timeframeMatch && timeframeMatch.length > 0) {
    return timeframeMatch.join(', ');
  }
  return undefined;
}

function extractConfidenceBand(text: string): 'weak' | 'medium' | 'strong' {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('strong') || lowerText.includes('high confidence')) {
    return 'strong';
  }
  if (lowerText.includes('weak') || lowerText.includes('low confidence')) {
    return 'weak';
  }

  return 'medium';
}

function extractDecision(text: string): 'BUY' | 'SELL' | 'WAIT' {
  const upperText = text.toUpperCase();

  if (upperText.includes('BUY') || upperText.includes('LONG')) {
    return 'BUY';
  }
  if (upperText.includes('SELL') || upperText.includes('SHORT')) {
    return 'SELL';
  }

  return 'WAIT';
}

function extractEntry(text: string): number | undefined {
  const entryMatch = text.match(/entry[:\s]+([\d.]+)/i);
  if (entryMatch && entryMatch[1]) {
    return parseFloat(entryMatch[1]);
  }
  return undefined;
}

function extractStopLoss(text: string): number | undefined {
  const slMatch = text.match(/(?:stop\s*loss|sl)[:\s]+([\d.]+)/i);
  if (slMatch && slMatch[1]) {
    return parseFloat(slMatch[1]);
  }
  return undefined;
}

function extractTakeProfit(text: string): number | undefined {
  const tpMatch = text.match(/(?:take\s*profit|tp)[:\s]+([\d.]+)/i);
  if (tpMatch && tpMatch[1]) {
    return parseFloat(tpMatch[1]);
  }
  return undefined;
}

function extractConfidence(text: string): number {
  const confidenceMatch = text.match(/confidence[:\s]+([\d.]+)/i);
  if (confidenceMatch && confidenceMatch[1]) {
    const conf = parseFloat(confidenceMatch[1]);
    return conf > 1 ? conf / 100 : conf; // Normalize to 0-1
  }
  return 0.5; // Default medium confidence
}

function extractStyle(text: string): string {
  const styleTerms = ['scalp', 'micro', 'intraday', 'swing'];
  const lowerText = text.toLowerCase();

  for (const term of styleTerms) {
    if (lowerText.includes(term)) {
      return term;
    }
  }

  return 'intraday';
}

/**
 * Generate content hash for thesis immutability
 */
export function generateThesisHash(thesisContent: string): string {
  let hash = 0;
  for (let i = 0; i < thesisContent.length; i++) {
    const char = thesisContent.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
