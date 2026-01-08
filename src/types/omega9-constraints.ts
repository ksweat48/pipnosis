/**
 * Omega-9 Constraint System Types
 *
 * Defines the constraint-first architecture where Omega-9 provides boundaries
 * up-front, and Alpha optimizes within those boundaries.
 *
 * This separates:
 * - CONSTRAINTS (optimization boundaries) from CATASTROPHIC BLOCKS (survival violations)
 * - PRE-DECISION guidance from POST-DECISION validation
 */

export interface Omega9Constraints {
  // Stop-Loss Constraints
  minStopLossPips: number;
  maxStopLossPips: number;
  recommendedStopLossPips: number;
  stopLossReasoning: string;

  // Noise Floor (statistical minimum for survival)
  noiseFloorPips: number;       // Minimum stop to survive spread + volatility noise
  noiseFloorReasoning: string;  // Explanation of noise floor calculation

  // Take-Profit Constraints
  minTakeProfitPips: number;  // Minimum for R:R ≥ 1.0 (given current SL)
  maxTakeProfitPips: number;  // Session/volatility ceiling
  recommendedTakeProfitPips: number;
  takeProfitReasoning: string;

  // Risk:Reward Constraints
  minRiskReward: number;      // Hard floor (1.0)
  targetRiskReward: number;   // Professional target (1.5+)
  optimalRiskReward: number;  // Elite target (2.0+)

  // Session Constraints
  sessionTimeRemaining: number; // Minutes
  volatilityPerHour: number;    // Expected pips/hour
  feasibleTravelPips: number;   // Max realistic TP distance
  sessionConstraintMode: 'BLOCKING' | 'ADVISORY' | 'NONE'; // How session constraints are applied

  // Constraint Violations (for learning)
  violations: ConstraintViolation[];
}

export interface ConstraintViolation {
  type: 'MIN_RR' | 'MAX_TP' | 'MIN_SL' | 'MAX_SL' | 'BELOW_NOISE_FLOOR' | 'INFEASIBLE_SETUP';
  severity: 'WARNING' | 'ERROR' | 'CATASTROPHIC';
  message: string;
  suggestedFix?: string;
  currentValue?: number;
  minimumValue?: number;
  suggestedActions?: string[];
}

/**
 * INTRADAY-ONLY TRADE STYLES
 * NO SWING TRADES ALLOWED - Pipnosis is intraday-only
 */
export type TradeStyle = 'scalper' | 'micro' | 'intraday';

export type LegacyRiskMode = 'low' | 'medium' | 'high';

export interface Omega9ConstraintInput {
  symbol: string;
  entry: number;
  direction: 'BUY' | 'SELL';
  atr: number;

  tradeStyle: TradeStyle;
  dollarRisk: number;

  riskMode?: LegacyRiskMode;

  currentSession: 'london' | 'ny' | 'asian' | 'sydney' | 'overlap' | 'closed';
  sessionTimeRemainingMinutes: number;
  volatilityRegime: 'low' | 'medium' | 'high';
  proposedStopLoss?: number;

  resolvedPlan?: {
    slMinPercent?: number;
    tpMaxAtrMultiple?: number;
    minRR?: number;
  };
}

export interface AlphaRevisionRequest {
  originalDecision: {
    action: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    confidence: number;
    reasoning: string;
  };
  constraintViolations: ConstraintViolation[];
  constraints: Omega9Constraints;
  revisionSuggestions: string[];
}

export interface AlphaRevisionResponse {
  revised: boolean;
  revisedDecision?: {
    action: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    confidence: number;
    reasoning: string;
  };
  revisionReasoning?: string;
  acceptedConstraints: string[];
}

export interface CatastrophicValidation {
  isCatastrophic: boolean;
  catastrophicErrors: CatastrophicError[];
  canProceed: boolean;
}

export interface CatastrophicError {
  type:
    | 'SL_WRONG_SIDE'       // Stop on wrong side of entry
    | 'TP_WRONG_SIDE'       // TP on wrong side of entry
    | 'ZERO_DISTANCE'       // SL or TP at entry price
    | 'SUB_SURVIVAL_SL'     // SL < 5 pips (below survival minimum)
    | 'MISSING_PARAMS'      // Missing SL or TP
    | 'NON_FINITE'          // NaN or Infinity values
    | 'RISK_EXCEEDS_CAP';   // Risk > absolute account limit

  message: string;
  canAutoCorrect: boolean;
  suggestedCorrection?: {
    stopLoss?: number;
    takeProfit?: number;
  };
}
