/**
 * Entry Validation Helpers - SINGLE SOURCE OF TRUTH
 *
 * Centralizes all entry validation logic to prevent duplication across
 * entry-planner, entry-execution-coordinator, and other validation services.
 *
 * SSOT Responsibilities:
 * 1. Chase threshold calculations (confidence-aware)
 * 2. Timeout progress calculations
 * 3. Distance-to-zone calculations
 * 4. Entry zone validation
 */

import { isIndex, calculatePipDistance } from './currencyHelpers';
import type { EntryIntent } from '../types/entry';

/**
 * SSOT: Calculate confidence-aware chase threshold
 *
 * High confidence = larger threshold (don't miss the trade)
 * Low confidence = smaller threshold (quick cancel if price runs)
 *
 * @param confidence - Trade confidence (0-100)
 * @param symbol - Currency pair/instrument
 * @returns Chase threshold in pips
 */
export function calculateConfidenceAwareChaseThreshold(
  confidence: number,
  symbol: string
): number {
  // Base threshold for symbol type
  const FOREX_BASE_THRESHOLD = 30;
  const INDEX_BASE_THRESHOLD = 100;
  const baseThreshold = isIndex(symbol) ? INDEX_BASE_THRESHOLD : FOREX_BASE_THRESHOLD;

  // High confidence (70%+): Allow more chase room
  if (confidence >= 70) {
    return baseThreshold * 1.5; // 45 pips for forex, 150 for indices
  }

  // Medium confidence (60-69%): Standard threshold
  if (confidence >= 60) {
    return baseThreshold; // 30 pips for forex, 100 for indices
  }

  // Low confidence (50-59%): Tight threshold
  return baseThreshold * 0.5; // 15 pips for forex, 50 for indices
}

/**
 * SSOT: Calculate timeout progress (0.0 to 1.0)
 *
 * Used for progressive relaxation of entry conditions
 *
 * @param createdAt - When the intent was created
 * @param maxWaitSeconds - Maximum wait time in seconds
 * @returns Progress from 0.0 (just started) to 1.0 (timed out)
 */
export function calculateTimeoutProgress(
  createdAt: Date | string,
  maxWaitSeconds: number
): number {
  const createdTime = typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt.getTime();
  const elapsedSeconds = Math.floor((Date.now() - createdTime) / 1000);
  return Math.min(1.0, elapsedSeconds / maxWaitSeconds);
}

/**
 * SSOT: Calculate distance to entry zone in pips
 *
 * Returns:
 * - 0 if price is inside the zone
 * - Positive if price is above the zone
 * - Negative if price is below the zone
 *
 * @param currentPrice - Current market price
 * @param zoneMin - Minimum zone price
 * @param zoneMax - Maximum zone price
 * @param symbol - Currency pair/instrument
 * @returns Distance in pips (0 if in zone)
 */
export function calculateDistanceToZone(
  currentPrice: number,
  zoneMin: number,
  zoneMax: number,
  symbol: string
): number {
  // Check if price is in zone
  if (currentPrice >= zoneMin && currentPrice <= zoneMax) {
    return 0;
  }

  // Calculate distance to closest edge
  const distanceToMin = calculatePipDistance(symbol, currentPrice, zoneMin);
  const distanceToMax = calculatePipDistance(symbol, currentPrice, zoneMax);

  // Return the closest distance with proper sign (+ if above zone, - if below)
  if (Math.abs(distanceToMin) < Math.abs(distanceToMax)) {
    return currentPrice > zoneMin ? distanceToMin : -distanceToMin;
  } else {
    return currentPrice > zoneMax ? distanceToMax : -distanceToMax;
  }
}

/**
 * SSOT: Check if price is within entry zone
 *
 * @param price - Current price
 * @param zoneMin - Minimum zone price
 * @param zoneMax - Maximum zone price
 * @returns True if price is in zone
 */
export function isPriceInZone(
  price: number,
  zoneMin: number,
  zoneMax: number
): boolean {
  return price >= zoneMin && price <= zoneMax;
}

/**
 * Helper: Extract confidence from entry intent's market context
 *
 * @param intent - Entry intent
 * @returns Confidence value (default 60 if not found)
 */
export function extractConfidenceFromIntent(intent: EntryIntent): number {
  const marketContext = intent.market_context as any;
  return marketContext?.confidence || 60;
}

/**
 * Helper: Get max wait seconds from intent (handles both formats)
 *
 * @param intent - Entry intent
 * @returns Max wait seconds
 */
export function getMaxWaitSeconds(intent: EntryIntent): number {
  return (intent as any).max_wait_seconds || intent.timeout_minutes * 60;
}

/**
 * Helper: Calculate monitoring duration in seconds
 *
 * @param createdAt - When monitoring started
 * @returns Duration in seconds
 */
export function calculateMonitoringDuration(createdAt: Date | string): number {
  const createdTime = typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt.getTime();
  return Math.floor((Date.now() - createdTime) / 1000);
}

/**
 * Confidence-aware progressive relaxation thresholds
 *
 * Returns the timeout progress thresholds for different confidence levels
 */
export interface RelaxationThresholds {
  earlyConfirmationThreshold: number;  // When to accept partial confirmation
  standardConfirmationThreshold: number; // When to require full confirmation
  urgencyThreshold: number; // When to relax requirements due to urgency
}

/**
 * SSOT: Get confidence-aware relaxation thresholds
 *
 * High confidence: Relax faster (don't miss the trade)
 * Medium confidence: Standard relaxation
 * Low confidence: Relax slower (require more confirmation)
 *
 * @param confidence - Trade confidence (0-100)
 * @returns Threshold configuration
 */
export function getRelaxationThresholds(confidence: number): RelaxationThresholds {
  if (confidence >= 70) {
    // HIGH CONFIDENCE: Execute with partial confirmation early
    return {
      earlyConfirmationThreshold: 0.4,      // First 40%: partial confirmation OK
      standardConfirmationThreshold: 0.4,   // Not used (relax early)
      urgencyThreshold: 0.4                 // After 40%: execute if in zone
    };
  } else if (confidence >= 60) {
    // MEDIUM CONFIDENCE: Standard relaxation
    return {
      earlyConfirmationThreshold: 0.25,     // First 25%: full confirmation
      standardConfirmationThreshold: 0.6,   // 25-60%: partial confirmation
      urgencyThreshold: 0.6                 // After 60%: execute if in zone
    };
  } else {
    // LOW CONFIDENCE: Strict requirements
    return {
      earlyConfirmationThreshold: 0.7,      // First 70%: full confirmation
      standardConfirmationThreshold: 0.7,   // Not really used
      urgencyThreshold: 0.7                 // After 70%: partial + in zone
    };
  }
}
