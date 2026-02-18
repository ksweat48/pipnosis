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
  type: 'MIN_RR' | 'MAX_TP' | 'MIN_SL' | 'MAX_SL' | 'BELOW_NOISE_FLOOR' | 'INFEASIBLE_SETUP' | 'TIGHT_CONSTRAINTS' | 'CRYPTO_SCALE_MISMATCH';
  severity: 'WARNING' | 'ERROR' | 'CATASTROPHIC';
  message: string;
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
  conflictSource: 'SESSION_TIME' | 'MARKET_ATR' | 'NONE';
  advisoryMessage: string;
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
  volatilityRegime: 'low' | 'medium' | 'high';
  proposedStopLoss?: number;

  resolvedPlan?: {
    slMinPercent?: number;
    tpMaxAtrMultiple?: number;
    minRR?: number;
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
  sandwichAdvisory: string | null;
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
  volatilityRegime: 'low' | 'medium' | 'high';
  resolvedPlan?: {
    slMinPercent?: number;
    tpMaxAtrMultiple?: number;
    minRR?: number;
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
