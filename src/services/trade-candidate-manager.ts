/**
 * Trade Candidate Manager
 *
 * SSOT for managing trading opportunity candidates and converting Alpha decisions to TPS candidates.
 * Tracks active monitoring intents and coordinates TPS evaluation.
 *
 * Responsibilities:
 * - Convert Alpha decisions to TPSCandidate format
 * - Calculate momentum state from market data
 * - Calculate distance to entry zone in ATR
 * - Track minutes since signal generation
 * - Store and retrieve active monitoring intents
 * - Coordinate multi-candidate TPS evaluation
 */

import { supabase } from '../lib/supabase';
import type { TPSCandidate, MomentumState, EntryMode, TradeStyle, AlphaEntryPlan } from '../types/tps';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import { logger } from '../lib/logger';

interface ActiveIntent {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  style: string;
  entry_mode: string;
  tps_score: number | null;
  trade_slot: number | null;
  created_at: string;
  alpha_confidence: number | null;
  eqs_score: number | null;
  eqs_required: number | null;
  momentum_state: string | null;
  atr_at_creation: number | null;
  signal_price: number | null;
  entry_zone_min: number | null;
  entry_zone_max: number | null;
}

/**
 * Calculate momentum state from price action and volatility.
 *
 * Logic:
 * - IMPULSE: Strong directional move (> 1.5 ATR from entry zone in favorable direction)
 * - STALLED: Price stuck or reversing (< 0.3 ATR movement in last check)
 * - NORMAL: Default state
 *
 * @param currentPrice - Current market price
 * @param signalPrice - Price when signal was generated
 * @param direction - Trade direction
 * @param atr - Current ATR value
 * @returns Momentum state
 */
export function calculateMomentumState(
  currentPrice: number,
  signalPrice: number,
  direction: 'LONG' | 'SHORT',
  atr: number
): MomentumState {
  const priceMove = currentPrice - signalPrice;
  const movePips = Math.abs(priceMove);
  const atrMove = movePips / atr;

  if (direction === 'LONG') {
    if (priceMove > 0 && atrMove > 1.5) {
      return 'IMPULSE';
    }
    if (priceMove < 0 && atrMove > 0.5) {
      return 'STALLED';
    }
  } else {
    if (priceMove < 0 && atrMove > 1.5) {
      return 'IMPULSE';
    }
    if (priceMove > 0 && atrMove > 0.5) {
      return 'STALLED';
    }
  }

  return 'NORMAL';
}

/**
 * Calculate distance to entry zone in ATR units.
 *
 * @param currentPrice - Current market price
 * @param entryZoneMin - Entry zone minimum
 * @param entryZoneMax - Entry zone maximum
 * @param atr - Current ATR value
 * @returns Distance in ATR units (0 if inside zone)
 */
export function calculateDistanceToEntryZone(
  currentPrice: number,
  entryZoneMin: number,
  entryZoneMax: number,
  atr: number
): number {
  if (currentPrice >= entryZoneMin && currentPrice <= entryZoneMax) {
    return 0;
  }

  const distanceToZone = currentPrice < entryZoneMin
    ? entryZoneMin - currentPrice
    : currentPrice - entryZoneMax;

  return distanceToZone / atr;
}

/**
 * Extract AlphaEntryPlan from AlphaDecision.
 *
 * @param decision - Alpha decision
 * @returns Entry plan or null if not available
 */
function extractEntryPlan(decision: AlphaDecision): AlphaEntryPlan | null {
  // Check if entry_spec has the new TPS fields
  const entrySpec = decision.entry_spec;
  if (entrySpec && 'entryMode' in entrySpec) {
    return {
      entryMode: (entrySpec as any).entryMode || 'EXECUTE_NOW',
      eqsThesis: (entrySpec as any).eqsThesis || 'unknown',
      eqsRequired: (entrySpec as any).eqsRequired || 70,
      eqsFocus: (entrySpec as any).eqsFocus || [],
      runawayPolicy: (entrySpec as any).runawayPolicy || 'RESCAN',
      projection: (entrySpec as any).projection,
    };
  }

  // Fallback: Infer from existing decision fields
  let entryMode: EntryMode = 'EXECUTE_NOW';
  if (decision.action === 'WAIT') {
    entryMode = 'WAIT_HIGHER_EDGE';
  } else if (decision.entry_intent) {
    entryMode = decision.entry_intent.urgency === 'LOW' ? 'WAIT_ENTRY' : 'EXECUTE_NOW';
  }

  return {
    entryMode,
    eqsThesis: decision.thesis || 'unknown',
    eqsRequired: 70,
    eqsFocus: [],
    runawayPolicy: 'RESCAN',
  };
}

/**
 * Convert Alpha decision to TPS candidate.
 *
 * @param decision - Alpha decision output
 * @param sessionId - Goal session ID
 * @param currentPrice - Current market price
 * @param atr - Current ATR value
 * @returns TPS candidate
 */
export function convertAlphaDecisionToCandidate(
  decision: AlphaDecision,
  sessionId: string,
  currentPrice: number,
  atr: number
): TPSCandidate {
  const symbol = decision.symbol || 'UNKNOWN';
  const direction: 'LONG' | 'SHORT' = decision.action === 'BUY' ? 'LONG' : 'SHORT';

  // Extract or infer entry plan
  const entryPlan = extractEntryPlan(decision);

  // Determine style
  let style: TradeStyle = 'INTRADAY';
  if (decision.resolvedStyle === 'SCALP') style = 'SCALP';
  else if (decision.resolvedStyle === 'MICRO_INTRADAY') style = 'MICRO';
  else if (decision.style_intent === 'SCALP') style = 'SCALP';
  else if (decision.style_intent === 'MICRO_INTRADAY') style = 'MICRO';

  // Calculate entry zone (use entry_intent if available, otherwise use entry price)
  const entryZoneMin = decision.entry_intent?.entry_zone_min || decision.entry;
  const entryZoneMax = decision.entry_intent?.entry_zone_max || decision.entry;

  // Calculate momentum state
  const signalPrice = decision.entry;
  const momentumState = calculateMomentumState(currentPrice, signalPrice, direction, atr);

  // Calculate distance to entry zone
  const distanceToEntryZoneATR = calculateDistanceToEntryZone(
    currentPrice,
    entryZoneMin,
    entryZoneMax,
    atr
  );

  // Time tracking (0 minutes for brand new signal)
  const minutesSinceSignal = 0;

  const candidate: TPSCandidate = {
    symbol,
    direction,
    style,
    entryMode: entryPlan?.entryMode || 'EXECUTE_NOW',
    tradeConfidence: decision.confidence,
    eqsNow: decision.entry_intent ? 70 : 80, // Placeholder, should come from EQS calculator
    eqsRequired: entryPlan?.eqsRequired || 70,
    eqsProjected: entryPlan?.projection?.eqsProjected,
    projectionConfidence: entryPlan?.projection?.projectionConfidence,
    atr,
    distanceToEntryZoneATR,
    momentumState,
    minutesSinceSignal,
    expectedMinutesToImprove: entryPlan?.projection?.expectedMinutesToImprove,
    sessionId,
  };

  logger.info('[TradeCandidateManager] Converted Alpha decision to TPS candidate', {
    symbol: candidate.symbol,
    direction: candidate.direction,
    style: candidate.style,
    entryMode: candidate.entryMode,
    confidence: candidate.tradeConfidence,
    momentumState: candidate.momentumState,
  });

  return candidate;
}

/**
 * Fetch active monitoring intents for a session.
 *
 * @param sessionId - Goal session ID
 * @returns Array of active monitoring intents
 */
export async function getActiveMonitoringIntents(sessionId: string): Promise<ActiveIntent[]> {
  const { data, error } = await supabase
    .from('entry_intents')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'monitoring')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('[TradeCandidateManager] Failed to fetch active intents', { sessionId, error });
    throw new Error(`Failed to fetch active intents: ${error.message}`);
  }

  return data as ActiveIntent[];
}

/**
 * Convert active intent to TPS candidate.
 *
 * @param intent - Active intent from database
 * @param currentPrice - Current market price
 * @returns TPS candidate
 */
export function convertIntentToCandidate(intent: ActiveIntent, currentPrice: number): TPSCandidate {
  const direction: 'LONG' | 'SHORT' = intent.direction as 'LONG' | 'SHORT';
  const style: TradeStyle = intent.style === 'SCALP' ? 'SCALP' : intent.style === 'MICRO_INTRADAY' ? 'MICRO' : 'INTRADAY';
  const atr = intent.atr_at_creation || 0.001;

  // Calculate time since creation
  const createdAt = new Date(intent.created_at);
  const now = new Date();
  const minutesSinceSignal = Math.floor((now.getTime() - createdAt.getTime()) / 60000);

  // Calculate momentum state
  const signalPrice = intent.signal_price || currentPrice;
  const momentumState = calculateMomentumState(currentPrice, signalPrice, direction, atr);

  // Calculate distance to entry zone
  const entryZoneMin = intent.entry_zone_min || currentPrice;
  const entryZoneMax = intent.entry_zone_max || currentPrice;
  const distanceToEntryZoneATR = calculateDistanceToEntryZone(
    currentPrice,
    entryZoneMin,
    entryZoneMax,
    atr
  );

  const candidate: TPSCandidate = {
    symbol: intent.symbol,
    direction,
    style,
    entryMode: (intent.entry_mode as EntryMode) || 'WAIT_ENTRY',
    tradeConfidence: intent.alpha_confidence || 75,
    eqsNow: intent.eqs_score || 70,
    eqsRequired: intent.eqs_required || 70,
    atr,
    distanceToEntryZoneATR,
    momentumState: (intent.momentum_state as MomentumState) || momentumState,
    minutesSinceSignal,
    intentId: intent.id,
    isExistingWait: true,
    sessionId: intent.id,
  };

  return candidate;
}

/**
 * Get all candidates for TPS evaluation (new scan + existing intents).
 *
 * @param sessionId - Goal session ID
 * @param newDecision - New Alpha decision from scan (optional)
 * @param currentPrice - Current market price
 * @param atr - Current ATR value
 * @returns Array of all candidates
 */
export async function getAllCandidates(
  sessionId: string,
  newDecision: AlphaDecision | null,
  currentPrice: number,
  atr: number
): Promise<TPSCandidate[]> {
  const candidates: TPSCandidate[] = [];

  // Add new scan result if available
  if (newDecision && newDecision.action !== 'NO_TRADE') {
    const newCandidate = convertAlphaDecisionToCandidate(newDecision, sessionId, currentPrice, atr);
    candidates.push(newCandidate);
  }

  // Add existing monitoring intents
  const activeIntents = await getActiveMonitoringIntents(sessionId);
  for (const intent of activeIntents) {
    const candidate = convertIntentToCandidate(intent, currentPrice);
    candidates.push(candidate);
  }

  logger.info('[TradeCandidateManager] Collected all candidates', {
    sessionId,
    totalCandidates: candidates.length,
    newScan: newDecision ? 1 : 0,
    existingIntents: activeIntents.length,
  });

  return candidates;
}

/**
 * Get existing intent TPS scores for slot replacement logic.
 *
 * @param sessionId - Goal session ID
 * @returns Array of intent ID, slot, and TPS score
 */
export async function getExistingIntentScores(
  sessionId: string
): Promise<Array<{ intentId: string; slotNumber: number; tpsScore: number }>> {
  const { data, error } = await supabase
    .from('entry_intents')
    .select('id, trade_slot, tps_score')
    .eq('session_id', sessionId)
    .eq('status', 'monitoring')
    .not('tps_score', 'is', null)
    .not('trade_slot', 'is', null);

  if (error) {
    logger.error('[TradeCandidateManager] Failed to fetch intent scores', { sessionId, error });
    return [];
  }

  return data.map(d => ({
    intentId: d.id,
    slotNumber: d.trade_slot!,
    tpsScore: d.tps_score!,
  }));
}
