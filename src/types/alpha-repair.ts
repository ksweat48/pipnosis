/**
 * Alpha Repair Pass System
 *
 * Implements: "Engines validate. Alpha decides. Trades degrade intelligently."
 *
 * When Alpha's initial decision violates constraints, the system requests
 * an Alpha Repair Pass instead of silently correcting or blocking.
 *
 * Alpha receives:
 * - Clear violation descriptions
 * - Allowed adjustment parameters
 * - Market constraints (not rules)
 * - Original decision context
 *
 * Alpha can:
 * - Revise SL/TP/risk within constraints
 * - Degrade target (e.g., $100 goal → $50 feasible trade)
 * - Choose NO_TRADE if truly impossible
 *
 * Alpha cannot:
 * - Invent new R:R ratios
 * - Override hard geometry blocks (wrong-side SL/TP)
 * - Trade with stale data
 */

export interface AlphaRepairViolation {
  type:
    | 'TP_WRONG_SIDE'
    | 'SL_WRONG_SIDE'
    | 'RR_BELOW_MIN'
    | 'TP_EXCEEDS_MAX'
    | 'SL_TOO_WIDE'
    | 'SL_TOO_TIGHT'
    | 'RISK_EXCEEDS_MAX'
    | 'GOAL_INFEASIBLE'
    | 'POSITION_SIZE_INVALID';

  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  description: string;
  currentValue?: number;
  constraint?: {
    min?: number;
    max?: number;
    unit: 'pips' | 'price' | 'percent' | 'ratio' | 'dollars';
  };
}

export interface AlphaRepairContext {
  // Original decision that violated constraints
  originalDecision: {
    action: string;
    symbol: string;
    direction: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    risk_pct: number;
    confidence: number;
    reasoning: string;
  };

  // List of constraint violations
  violations: AlphaRepairViolation[];

  // Available constraints for this symbol/market
  constraints: {
    // Risk:Reward constraints
    minRR?: number;
    maxRR?: number;

    // Stop Loss constraints (in pips)
    minSLPips?: number;
    maxSLPips?: number;

    // Take Profit constraints (in pips)
    minTPPips?: number;
    maxTPPips?: number;

    // Risk constraints
    minRiskPct?: number;
    maxRiskPct?: number;

    // Goal constraints
    userGoalDollars?: number;
    maxFeasibleDollars?: number;
  };

  // Market context for intelligent degradation
  marketContext: {
    currentPrice: number;
    atr?: number;
    volatility?: string;
    liquidity?: string;
    session?: string;
    keyLevels?: Array<{ price: number; type: string }>;
  };

  // Guidance for Alpha (not rules)
  guidance: {
    suggestedSLRange?: { min: number; max: number };
    suggestedTPRange?: { min: number; max: number };
    suggestedRiskRange?: { min: number; max: number };
    degradationOptions?: string[]; // e.g., ["Reduce target to $50", "Wait for better setup"]
  };
}

export interface AlphaRepairRequest {
  repairContext: AlphaRepairContext;
  attemptNumber: number; // 1st, 2nd revision attempt
  maxAttempts: number; // Don't loop forever
}

export interface AlphaRepairResponse {
  revised: boolean;

  // If revised=true, Alpha's new decision
  revisedDecision?: {
    action: 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE';
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
    risk_pct?: number;
    confidence: number;
    reasoning: string;
    degradationApplied?: {
      original: string; // e.g., "Target $100"
      revised: string;  // e.g., "Target $50 (best available)"
      userMessage: string; // e.g., "Market can offer ~$50 right now"
    };
  };

  // If revised=false, why Alpha couldn't revise
  blockReason?: string;

  // Metadata
  repairAttempt: number;
  tokensUsed: number;
}

export interface HardBlockResult {
  blocked: true;
  reason: string;
  violationType:
    | 'GEOMETRY_INVALID' // wrong-side SL/TP
    | 'MISSING_REQUIRED_FIELDS'
    | 'STALE_DATA'
    | 'MARKET_CLOSED'
    | 'SIZING_IMPOSSIBLE'
    | 'NAN_VALUES'
    | 'CATASTROPHIC_ERROR';
  loggingRequired: boolean;
  ssotViolationType?: string;
}

/**
 * Result of initial validation before Alpha Repair
 */
export interface PreRepairValidation {
  // If hardBlocked=true, don't attempt repair
  hardBlocked: boolean;
  hardBlockResult?: HardBlockResult;

  // If softViolations exist, attempt Alpha Repair
  softViolations: AlphaRepairViolation[];

  // Constraints for this trade
  constraints: AlphaRepairContext['constraints'];

  // Guidance for repair
  guidance: AlphaRepairContext['guidance'];
}

/**
 * Allowed hard blocks (everything else must flow through Alpha Repair)
 */
export const ALLOWED_HARD_BLOCKS = [
  'SL_WRONG_SIDE',      // SL on wrong side of entry (geometry)
  'TP_WRONG_SIDE',      // TP on wrong side of entry (geometry)
  'ENTRY_EQUALS_SL',    // Entry === SL (zero distance)
  'ENTRY_EQUALS_TP',    // Entry === TP (zero distance)
  'MISSING_ENTRY',      // No entry price
  'MISSING_SL',         // No stop loss
  'MISSING_TP',         // No take profit
  'STALE_PRICES',       // Realtime prices too old
  'STALE_INTELLIGENCE', // Omega/Alpha cache too old
  'PRICE_DRIFT_EXCESSIVE', // Signal vs current price diverged
  'MARKET_CLOSED',      // Market not open for trading
  'INVALID_SYMBOL',     // Symbol not tradeable
  'NAN_VALUE',          // NaN in critical field
  'SIZING_FAILED',      // Position sizing calculation failed
] as const;

export type AllowedHardBlock = typeof ALLOWED_HARD_BLOCKS[number];
