/**
 * Regime-Aware Zone Language Generator
 *
 * SSOT Authority: Translates zone_type from database into human-readable UI messages
 *
 * This utility maps the adaptive zone type calculated by EntryIntentClassifier
 * into regime-appropriate language for the UI.
 *
 * Zone Types:
 * - momentum: Tight chase entries in trending/acceleration conditions
 * - limit: Pullback/rally entries to support/resistance in mean-reversion
 * - hybrid: Structured retest entries after breaks
 */

export type ZoneType = 'momentum' | 'limit' | 'hybrid';

export interface ZoneLanguage {
  waitingStatus: string;           // "WAITING FOR PRICE ZONE" / "WAITING FOR MOMENTUM ENTRY"
  priceActionVerb: string;          // "pull back" / "rally" / "chase" / "retest"
  distanceMessage: string;          // Full sentence describing what needs to happen
  shortLabel: string;               // Compact label for UI badges
}

/**
 * Get regime-aware language for entry zone UI
 *
 * @param zoneType - The zone type from database (momentum/limit/hybrid)
 * @param direction - Trade direction (long/short)
 * @param distancePips - Distance from current price to entry zone
 * @param microRegime - Optional micro regime for enhanced context
 * @returns ZoneLanguage object with UI strings
 */
export function getZoneLanguage(
  zoneType: string | null | undefined,
  direction: 'long' | 'short',
  distancePips: number,
  microRegime?: string | null
): ZoneLanguage {
  // Fallback to generic language if zone_type is not available
  if (!zoneType) {
    return getGenericZoneLanguage(direction, distancePips);
  }

  switch (zoneType.toLowerCase()) {
    case 'momentum':
      return getMomentumZoneLanguage(direction, distancePips, microRegime);

    case 'limit':
      return getLimitZoneLanguage(direction, distancePips);

    case 'hybrid':
      return getHybridZoneLanguage(direction, distancePips);

    default:
      return getGenericZoneLanguage(direction, distancePips);
  }
}

/**
 * Momentum Zone Language
 * Used during strong trends, acceleration, or stop hunt expansions
 * Emphasizes tight entry timing and minimal wait
 */
function getMomentumZoneLanguage(
  direction: 'long' | 'short',
  distancePips: number,
  microRegime?: string | null
): ZoneLanguage {
  const isTrending = microRegime?.includes('trend') || microRegime?.includes('acceleration');
  const isStopHunt = microRegime?.includes('stop_hunt');

  let contextVerb = 'momentum';
  if (isTrending) contextVerb = 'trend momentum';
  if (isStopHunt) contextVerb = 'expansion';

  return {
    waitingStatus: `WAITING FOR ${contextVerb.toUpperCase()} ENTRY`,
    priceActionVerb: 'chase',
    distanceMessage: `Chase tight ${contextVerb} entry — ${distancePips.toFixed(2)} pips to execution zone`,
    shortLabel: direction === 'long' ? 'Chase long' : 'Chase short'
  };
}

/**
 * Limit Zone Language
 * Used during mean-reversion, exhaustion, or consolidation
 * Emphasizes patience and waiting for price to reach zone
 */
function getLimitZoneLanguage(
  direction: 'long' | 'short',
  distancePips: number
): ZoneLanguage {
  const verb = direction === 'long' ? 'pull back' : 'rally';
  const preposition = direction === 'long' ? 'into' : 'into';

  return {
    waitingStatus: 'WAITING FOR PRICE ZONE',
    priceActionVerb: verb,
    distanceMessage: `Price must ${verb} ${distancePips.toFixed(2)} pips ${preposition} entry zone`,
    shortLabel: direction === 'long' ? 'Need pullback' : 'Need rally'
  };
}

/**
 * Hybrid Zone Language
 * Used during structural breaks, retests, or range extremes
 * Emphasizes structure and confirmation
 */
function getHybridZoneLanguage(
  direction: 'long' | 'short',
  distancePips: number
): ZoneLanguage {
  return {
    waitingStatus: 'WAITING FOR STRUCTURED ENTRY',
    priceActionVerb: 'retest',
    distanceMessage: `Wait for structured retest — ${distancePips.toFixed(2)} pips to confirmation zone`,
    shortLabel: direction === 'long' ? 'Await retest' : 'Await retest'
  };
}

/**
 * Generic Zone Language (Fallback)
 * Used when zone_type is null or unrecognized
 * Maintains backward compatibility with legacy entries
 */
function getGenericZoneLanguage(
  direction: 'long' | 'short',
  distancePips: number
): ZoneLanguage {
  const verb = direction === 'long' ? 'pull back' : 'rally';

  return {
    waitingStatus: 'WAITING FOR PRICE ZONE',
    priceActionVerb: verb,
    distanceMessage: `Price must ${verb} ${distancePips.toFixed(2)} pips into entry zone`,
    shortLabel: direction === 'long' ? 'Need pullback' : 'Need rally'
  };
}

/**
 * Get concise zone type badge for UI
 */
export function getZoneTypeBadge(zoneType: string | null | undefined): string {
  if (!zoneType) return 'ZONE';

  switch (zoneType.toLowerCase()) {
    case 'momentum':
      return 'MOMENTUM';
    case 'limit':
      return 'LIMIT';
    case 'hybrid':
      return 'HYBRID';
    default:
      return 'ZONE';
  }
}

/**
 * Get zone type color for UI badges
 */
export function getZoneTypeColor(zoneType: string | null | undefined): string {
  if (!zoneType) return 'gray';

  switch (zoneType.toLowerCase()) {
    case 'momentum':
      return 'purple'; // Fast, aggressive
    case 'limit':
      return 'blue';   // Patient, structured
    case 'hybrid':
      return 'green';  // Balanced, confirmation-based
    default:
      return 'gray';
  }
}
