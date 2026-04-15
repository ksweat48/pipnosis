/**
 * Omega-9 Constraint System Types
 *
 * DUAL-ARENA ARCHITECTURE (v3.0):
 * The system computes boundary walls for BOTH long and short directions.
 * Alpha sees both arenas side-by-side and decides which to trade in,
 * or returns NO_TRADE on its own authority.
 *
 * Arena walls are computed from three immutable sources:
 * 1. User risk settings (risk mode, max risk %)
 * 2. Style parameters (SL/TP ranges, duration, R:R minimum)
 * 3. Market math (ATR, noise floor, current price)
 *
 * No engine interprets or judges. The walls are physics. Alpha is the trader.
 */

export interface Omega9Constraints {
  // Context (SSOT: Constraints must know their context for absolute price calculation)
  symbol: string;
  entryPrice: number;
  direction: 'BUY' | 'SELL';

  // Stop-Loss Constraints
  minStopLossPips: number;
  maxStopLossPips: number;
  recommendedStopLossPips: number;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text explanation of why these SL constraints
   * were computed as they are. Must reference actual ATR, noise floor, and
   * market context — not just restate the numbers.
   */
  stopLossReasoning: string;

  // Noise Floor (statistical minimum for survival)
  noiseFloorPips: number;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text explanation of the noise floor calculation.
   * What spread, volatility, and microstructure factors produced this minimum?
   */
  noiseFloorReasoning: string;

  // Take-Profit Constraints
  minTakeProfitPips: number;  // Minimum for R:R ≥ 1.0 (given current SL)
  maxTakeProfitPips: number;  // Session/volatility ceiling
  recommendedTakeProfitPips: number;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text explanation of TP constraints.
   * Why is the ceiling where it is? What session or volatility factor drives it?
   */
  takeProfitReasoning: string;

  // Risk:Reward Constraints
  minRiskReward: number;      // Hard floor (1.5) - SSOT: TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM
  targetRiskReward: number;   // Professional target (1.5+)
  optimalRiskReward: number;  // Elite target (2.0+)

  // Session Constraints
  sessionTimeRemaining: number; // Minutes
  volatilityPerHour: number;    // Expected pips/hour
  feasibleTravelPips: number;   // Max realistic TP distance
  sessionConstraintMode: 'BLOCKING' | 'ADVISORY' | 'NONE'; // How session constraints are applied

  // Feasibility Status (CCIP: Governance-tracked constraint validation)
  feasibilityStatus?: ConstraintFeasibilityStatus;

  // Constraint Violations (for learning)
  violations: ConstraintViolation[];
}

export interface ConstraintViolation {
  /**
   * Violation routing type — determines which recovery logic runs.
   * CCIP-ALPHA-AUDIT-TEXT: This is a machine-routing tag only.
   * The specific violation context, actual values, and what Alpha should do
   * must be expressed in the `message` field as free text.
   */
  type: 'MIN_RR' | 'MAX_TP' | 'MIN_SL' | 'MAX_SL' | 'BELOW_NOISE_FLOOR' | 'INFEASIBLE_SETUP' | 'TIGHT_CONSTRAINTS' | 'CRYPTO_SCALE_MISMATCH';
  severity: 'WARNING' | 'ERROR' | 'CATASTROPHIC';
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text explanation of this specific violation.
   * Must include actual numbers and context — not just a restatement of the type label.
   */
  message: string;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text description of how this violation could be resolved.
   * Not a label. A specific, actionable suggestion in plain language.
   */
  suggestedFix?: string;
  currentValue?: number;
  minimumValue?: number;
  suggestedActions?: string[];
}

export interface ConstraintFeasibilityStatus {
  isFeasible: boolean;
  minTakeProfitRequired: number;
  maxTakeProfitAvailable: number;
  minRiskRewardRequired: number;
  maxRiskRewardAchievable: number;
  /**
   * Conflict source routing tag — identifies which constraint system is limiting.
   * CCIP-ALPHA-AUDIT-TEXT: This is a machine-routing tag.
   * The full context of the conflict must appear in `advisoryMessage`.
   */
  conflictSource: 'SESSION_TIME' | 'MARKET_ATR' | 'NONE';
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text advisory explaining the feasibility situation.
   * Must describe actual numbers, what the constraint means, and why Alpha
   * should care. Not a restatement of the conflictSource label.
   */
  advisoryMessage: string;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Alpha's available options expressed as free-text descriptions.
   * Each string must be a plain-language description of a viable path forward,
   * not a label from a predefined option set. Alpha reads these and decides.
   */
  alphaOptions: string[];
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
  /** @deprecated CCIP-2026-04-07: No longer influences wall/stop math. Kept optional for log context only. */
  volatilityRegime?: 'low' | 'medium' | 'high';
  proposedStopLoss?: number;

  /**
   * CCIP-ALPHA-GOV-001: Alpha's per-trade R:R ceiling override.
   * When present, this replaces the static style ceiling from getMaxRRForStyle().
   * The system logs a WARN when falling back to the static default.
   * Clamped to MAXIMUM_INTRADAY (3.0) as an absolute physics cap.
   */
  rr_ceiling_override?: number;

  resolvedPlan?: {
    slMinPercent?: number;
    tpMaxAtrMultiple?: number;
    minRR?: number;
    /** CCIP-2026-04-07: Envelope TP floor in pips from WallCalibrationEngine. No compression applied. */
    calibratedEnvelopeTpMinPips?: number;
  };
}

export interface ArenaWalls {
  direction: 'BUY' | 'SELL';

  slPrice: { min: number; max: number; recommended: number };
  tpPrice: { min: number; max: number; recommended: number };

  slPips: { min: number; max: number; recommended: number };
  tpPips: { min: number; max: number; recommended: number };

  noiseFloorPips: number;
  minRiskReward: number;

  feasible: boolean;
  sandwiched: boolean;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text description of the sandwich trap risk.
   * What levels surround the trade? What is the risk of the stop being swept?
   * Alpha's words — not a template string.
   */
  sandwichAdvisory: string | null;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text description of the feasibility situation.
   * What is limiting this arena? Session time, ATR, or corridor width?
   * Specific numbers and context required.
   */
  feasibilityAdvisory: string | null;
}

export interface WallCalibrationMeta {
  wasCalibrated: boolean;
  calibrationReason: string;
  originalAtrMultiple: number;
  calibratedAtrMultiple: number;
  assetClass: string;
  safetyCapApplied: boolean;
  sessionExpansionApplied: boolean;
  corridorWidthPips: number;
}

export interface DualArenaWalls {
  symbol: string;
  entryPrice: number;
  style: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
  riskMode: 'low' | 'medium' | 'high';

  long: ArenaWalls;
  short: ArenaWalls;

  sessionTimeRemaining: number;
  volatilityPerHour: number;
  feasibleTravelPips: number;
  sessionConstraintMode: 'ADVISORY' | 'NONE';

  durationBand: { min: number; max: number };
  targetCandles: { min: number; max: number };
  timeframe: string;
  entryMode: 'IMMEDIATE' | 'PATIENT';

  correlationExposure: {
    longWarnings: string[];
    shortWarnings: string[];
  } | null;

  violations: ConstraintViolation[];

  wallCalibration?: WallCalibrationMeta;
}

export interface DualArenaInput {
  symbol: string;
  entry: number;
  atr: number;
  tradeStyle: TradeStyle;
  riskMode: LegacyRiskMode;
  currentSession: 'london' | 'ny' | 'asian' | 'sydney' | 'overlap' | 'closed';
  sessionTimeRemainingMinutes: number;
  /** @deprecated CCIP-2026-04-07: No longer influences wall/stop math. Kept optional for log context only. */
  volatilityRegime?: 'low' | 'medium' | 'high';
  /** CCIP-ALPHA-GOV-001: Alpha's per-trade R:R ceiling override. */
  rr_ceiling_override?: number;
  resolvedPlan?: {
    slMinPercent?: number;
    tpMaxAtrMultiple?: number;
    minRR?: number;
    calibratedEnvelopeTpMinPips?: number;
  };
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
