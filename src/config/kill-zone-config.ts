/**
 * Kill Zone Engine Configuration
 *
 * SSOT: This file is the single authoritative source for all kill zone
 * definitions and card suppression rules.
 *
 * CCIP ID: 20260220_rti_professional_intelligence_fields
 *
 * Kill zones are the institutional trading windows that professional
 * intraday traders use to time entries. Cards surface ONLY when the
 * market structure aligns with an active kill zone or the approach to one.
 *
 * All times are UTC.
 */

export type KillZoneName =
  | 'tokyo_active'
  | 'london_open'
  | 'london_active'
  | 'london_ny_overlap'
  | 'ny_open'
  | 'ny_afternoon'
  | 'asia_range_building'
  | 'dead_zone';

export type CardSuppression = 'none' | 'trade_cards' | 'all';

export interface KillZone {
  name: KillZoneName;
  label: string;
  startUtc: number;
  endUtc: number;
  quality: 'prime' | 'good' | 'slow' | 'informational';
  description: string;
  cardSuppression: CardSuppression;
  allowedStyles: ('scalper' | 'micro' | 'intraday')[];
  confidenceBonus: number;
  color: string;
  badgeColor: string;
}

/**
 * Kill zone windows in UTC hours.
 * Priority order: if current time falls in multiple zones, first match wins.
 * Zones are ordered from highest to lowest institutional significance.
 */
export const KILL_ZONES: KillZone[] = [
  {
    name: 'london_ny_overlap',
    label: 'London / NY Overlap',
    startUtc: 13,
    endUtc: 16,
    quality: 'prime',
    description: 'Highest volume window of the day. All styles welcome.',
    cardSuppression: 'none',
    allowedStyles: ['scalper', 'micro', 'intraday'],
    confidenceBonus: 10,
    color: 'text-green-400',
    badgeColor: 'bg-green-500/20 border-green-500/40 text-green-300',
  },
  {
    name: 'ny_open',
    label: 'NY Open',
    startUtc: 13,
    endUtc: 14,
    quality: 'prime',
    description: 'NY open momentum window. Continuation and reversal plays.',
    cardSuppression: 'none',
    allowedStyles: ['scalper', 'micro', 'intraday'],
    confidenceBonus: 8,
    color: 'text-green-400',
    badgeColor: 'bg-green-500/20 border-green-500/40 text-green-300',
  },
  {
    name: 'london_open',
    label: 'London Open',
    startUtc: 8,
    endUtc: 9,
    quality: 'prime',
    description: 'London open — highest probability window for Asia range sweeps and BOS.',
    cardSuppression: 'none',
    allowedStyles: ['scalper', 'micro', 'intraday'],
    confidenceBonus: 12,
    color: 'text-green-400',
    badgeColor: 'bg-green-500/20 border-green-500/40 text-green-300',
  },
  {
    name: 'london_active',
    label: 'London Active',
    startUtc: 9,
    endUtc: 13,
    quality: 'good',
    description: 'Institutional flow visible. Structure trades active.',
    cardSuppression: 'none',
    allowedStyles: ['scalper', 'micro', 'intraday'],
    confidenceBonus: 5,
    color: 'text-yellow-400',
    badgeColor: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300',
  },
  {
    name: 'ny_afternoon',
    label: 'NY Afternoon',
    startUtc: 16,
    endUtc: 20,
    quality: 'good',
    description: 'Reversal potential from London overextension. Scalp favored.',
    cardSuppression: 'none',
    allowedStyles: ['scalper', 'micro'],
    confidenceBonus: 0,
    color: 'text-yellow-400',
    badgeColor: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300',
  },
  {
    name: 'tokyo_active',
    label: 'Tokyo Active',
    startUtc: 2,
    endUtc: 4,
    quality: 'good',
    description: 'Tokyo session. JPY pairs most active. Range setups form.',
    cardSuppression: 'none',
    allowedStyles: ['scalper', 'micro'],
    confidenceBonus: 0,
    color: 'text-yellow-400',
    badgeColor: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300',
  },
  {
    name: 'asia_range_building',
    label: 'Asia Range Building',
    startUtc: 0,
    endUtc: 8,
    quality: 'informational',
    description: 'Asia session. Range forming — London will target these levels.',
    cardSuppression: 'trade_cards',
    allowedStyles: [],
    confidenceBonus: 0,
    color: 'text-blue-400',
    badgeColor: 'bg-blue-500/20 border-blue-500/40 text-blue-300',
  },
  {
    name: 'dead_zone',
    label: 'Dead Zone',
    startUtc: 20,
    endUtc: 24,
    quality: 'slow',
    description: 'Low volume. High spread risk. No trade cards generated.',
    cardSuppression: 'all',
    allowedStyles: [],
    confidenceBonus: 0,
    color: 'text-red-400',
    badgeColor: 'bg-red-500/20 border-red-500/40 text-red-300',
  },
];

export interface KillZoneContext {
  killZoneActive: boolean;
  killZoneName: KillZoneName | null;
  killZoneLabel: string | null;
  killZoneQuality: KillZone['quality'] | null;
  minutesRemaining: number;
  minutesUntilNext: number;
  nextKillZoneName: KillZoneName | null;
  nextKillZoneLabel: string | null;
  cardSuppression: CardSuppression;
  allowedStyles: ('scalper' | 'micro' | 'intraday')[];
  confidenceBonus: number;
  badgeColor: string;
}

/**
 * Get the current kill zone context based on UTC time.
 * SSOT: all time calculations here — no duplication in components.
 */
export function getKillZoneContext(): KillZoneContext {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const totalUtcMinutes = utcHour * 60 + utcMinute;

  // Find the current kill zone (skip asia_range_building and dead_zone for "active" detection —
  // those are fallback states, not institutional windows)
  const institutionalZones = KILL_ZONES.filter(
    (z) => z.name !== 'asia_range_building' && z.name !== 'dead_zone'
  );

  const activeZone = institutionalZones.find(
    (z) => utcHour >= z.startUtc && utcHour < z.endUtc
  );

  if (activeZone) {
    const endMinutes = activeZone.endUtc * 60;
    const remaining = Math.max(0, endMinutes - totalUtcMinutes);

    // Find next institutional window after this one
    const nextZone = institutionalZones.find(
      (z) => z.startUtc > activeZone.endUtc
    ) ?? institutionalZones[0];

    return {
      killZoneActive: true,
      killZoneName: activeZone.name,
      killZoneLabel: activeZone.label,
      killZoneQuality: activeZone.quality,
      minutesRemaining: remaining,
      minutesUntilNext: 0,
      nextKillZoneName: null,
      nextKillZoneLabel: null,
      cardSuppression: activeZone.cardSuppression,
      allowedStyles: activeZone.allowedStyles,
      confidenceBonus: activeZone.confidenceBonus,
      badgeColor: activeZone.badgeColor,
    };
  }

  // Not in an institutional window — find state (asia or dead zone)
  const stateZone = KILL_ZONES.find(
    (z) =>
      (z.name === 'asia_range_building' || z.name === 'dead_zone') &&
      utcHour >= z.startUtc &&
      utcHour < z.endUtc
  );

  // Find time until next institutional window
  const sortedInstitutional = [...institutionalZones].sort(
    (a, b) => a.startUtc - b.startUtc
  );
  const nextZone =
    sortedInstitutional.find((z) => z.startUtc > utcHour) ??
    sortedInstitutional[0];
  const nextStartMinutes =
    nextZone.startUtc > utcHour
      ? nextZone.startUtc * 60
      : nextZone.startUtc * 60 + 24 * 60;
  const minutesUntilNext = Math.max(0, nextStartMinutes - totalUtcMinutes);

  return {
    killZoneActive: false,
    killZoneName: stateZone?.name ?? null,
    killZoneLabel: stateZone?.label ?? null,
    killZoneQuality: stateZone?.quality ?? null,
    minutesRemaining: 0,
    minutesUntilNext,
    nextKillZoneName: nextZone.name,
    nextKillZoneLabel: nextZone.label,
    cardSuppression: stateZone?.cardSuppression ?? 'none',
    allowedStyles: stateZone?.allowedStyles ?? ['scalper', 'micro', 'intraday'],
    confidenceBonus: stateZone?.confidenceBonus ?? 0,
    badgeColor: stateZone?.badgeColor ?? 'bg-gray-500/20 border-gray-500/40 text-gray-300',
  };
}

/**
 * Apply session-weighted confidence adjustment.
 * Pure math — no side effects.
 */
export function applyKillZoneConfidenceBonus(
  baseConfidence: number,
  context: KillZoneContext
): number {
  const adjusted = baseConfidence + context.confidenceBonus;
  return Math.min(100, Math.max(0, adjusted));
}

/**
 * Check if a given trade style is allowed to generate trade cards right now.
 */
export function isStyleAllowedInCurrentWindow(
  style: 'scalper' | 'micro' | 'intraday'
): boolean {
  const context = getKillZoneContext();
  if (context.cardSuppression === 'all') return false;
  if (context.cardSuppression === 'trade_cards') return false;
  if (!context.killZoneActive) return style === 'scalper'; // scalp survives outside windows
  return context.allowedStyles.includes(style);
}
