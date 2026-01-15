/**
 * Trade Priority Score (TPS) System Types
 *
 * SSOT for all TPS-related type definitions.
 * Supports intelligent EXECUTE_NOW vs WAIT arbitration with mode-aware evaluation.
 */

export type EntryMode = 'EXECUTE_NOW' | 'WAIT_ENTRY' | 'WAIT_HIGHER_EDGE';
export type RunawayPolicy = 'RESCAN' | 'EXECUTE_ON_FIRST_PULLBACK';
export type MomentumState = 'IMPULSE' | 'NORMAL' | 'STALLED';
export type TradeMode = 'SINGLE' | 'MULTI';
export type TradeStyle = 'SCALP' | 'MICRO' | 'INTRADAY';

/**
 * Core candidate structure for TPS evaluation.
 * Represents a single trading opportunity being considered.
 */
export interface TPSCandidate {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  style: TradeStyle;
  entryMode: EntryMode;

  // Confidence metrics
  tradeConfidence: number;

  // Entry quality metrics
  eqsNow: number;
  eqsRequired: number;
  eqsProjected?: number;
  projectionConfidence?: number;

  // Market context
  atr: number;
  distanceToEntryZoneATR: number;
  momentumState: MomentumState;

  // Time-based metrics
  minutesSinceSignal: number;
  expectedMinutesToImprove?: number;

  // Additional metadata
  intentId?: string;
  isExistingWait?: boolean;
  sessionId: string;
}

/**
 * TPS scoring components breakdown.
 * Provides transparency into how the final score was calculated.
 */
export interface TPSScoreComponents {
  confidence: number;
  readiness: number;
  urgency: number;
  total: number;
}

/**
 * Detailed TPS evaluation result.
 * Contains the final score and all intermediate calculations.
 */
export interface TPSEvaluation {
  candidate: TPSCandidate;
  scores: TPSScoreComponents;
  reasoning: string;
  shouldExecute: boolean;
  patienceGateApplied: boolean;
}

/**
 * Multi-candidate comparison result.
 * Used when evaluating multiple opportunities simultaneously.
 */
export interface TPSComparisonResult {
  winner: TPSEvaluation;
  runners: TPSEvaluation[];
  marginToSecondPlace: number;
  patienceGateTriggered: boolean;
  comparisonReasoning: string;
}

/**
 * Trade slot assignment for multi-trade mode.
 */
export interface TradeSlotAssignment {
  slotNumber: number;
  evaluation: TPSEvaluation;
  replacedIntentId?: string;
}

/**
 * Entry plan from Alpha decision.
 * This is the structure Alpha outputs that gets converted to TPSCandidate.
 */
export interface AlphaEntryPlan {
  entryMode: EntryMode;
  eqsThesis: string;
  eqsRequired: number;
  eqsFocus: string[];
  runawayPolicy: RunawayPolicy;
  projection?: {
    eqsProjected: number;
    projectionConfidence: number;
    expectedMinutesToImprove: number;
  };
}

/**
 * TPS comparison data stored with entry intent.
 * Captures the decision context for audit and UI display.
 */
export interface TPSComparisonData {
  winnerScore: number;
  runnerUpScore?: number;
  candidatesEvaluated: number;
  patienceGateApplied: boolean;
  evaluatedAt: string;
  reasoning: string;
}

/**
 * Style-specific urgency configuration.
 */
export interface UrgencyConfig {
  halfLifeMinutes: number;
  maxUrgencyScore: number;
  expirationMinutes: number;
  impulseBonus: number;
  stalledPenalty: number;
}

/**
 * Trade mode configuration from goal session.
 */
export interface TradeModeConfig {
  mode: TradeMode;
  maxConcurrentTrades: number;
  allowScanning: boolean;
  allowTPSReEvaluation: boolean;
}
