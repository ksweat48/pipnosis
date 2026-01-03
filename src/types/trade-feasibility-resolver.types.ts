/**
 * Trade Feasibility Resolver Types
 *
 * SSOT for pre-constraint trade feasibility resolution.
 * This runs BEFORE Omega-9 constraints are generated to prevent deadlock scenarios.
 */

export type AssetClass = "FOREX" | "CRYPTO" | "METAL" | "INDEX";

export type TradeStyle = "SCALP" | "INTRADAY" | "SWING";

export type RiskMode = "LOW" | "MEDIUM" | "HIGH";

export type FeasibilityStatus =
  | "OK"
  | "ADJUSTED"
  | "NO_TRADE";

export type AdjustmentReason =
  | "LOW_VOLATILITY_FOR_STYLE"
  | "RR_INFEASIBLE"
  | "RR_BELOW_TARGET"
  | "TP_CEILING_TOO_LOW"
  | "SL_FLOOR_TOO_HIGH"
  | "BROKER_CONSTRAINTS"
  | "DATA_STALE_OR_MISSING"
  | "HIGH_SPREAD_VS_ATR"
  | "ABSOLUTE_SPREAD_TOO_HIGH"
  | "SESSION_TIME_INSUFFICIENT"
  | "STRUCTURAL_DEAD_ZONE";

export type VolatilityRegime = "EXTREME_LOW" | "LOW" | "NORMAL" | "HIGH" | "EXTREME_HIGH";

export type VolatilityTrend = "EXPANDING" | "CONTRACTING" | "STABLE";

export interface FeasibilityInput {
  symbol: string;
  assetClass: AssetClass;

  // User intent
  requestedStyle: TradeStyle;     // e.g. SCALP
  requestedRiskMode: RiskMode;    // e.g. HIGH
  goalContext?: {
    targetProfitUsd?: number;     // used for messaging, NOT TP forcing
    maxTrades?: number;
    timeHorizon?: "TODAY" | "WEEK" | "MONTH";
  };

  // Market reality
  price: number;                 // current mid/last
  atrAbs: number;                // ATR in absolute price units
  atrPercent: number;            // ATR/price * 100 (precomputed)
  spreadAbs?: number;
  spreadPercent?: number;

  // Enhanced volatility context
  volatilityRegime?: {
    current: VolatilityRegime;
    atrPercentile?: number;  // ATR vs 30-day percentile
    trend: VolatilityTrend;
  };

  // Constraints / policy inputs
  policy: {
    minRR: number;               // e.g. 1.0
    maxTpAtrMultiple: number;    // e.g. 12
    minSlPercentByAssetRisk: Record<string, number>; // keyed by `${assetClass}:${riskMode}`
    maxSlPercentByAsset?: Record<AssetClass, number>; // optional cap
    allowAutoDowngradeRisk: boolean;
    allowAutoSwitchStyle: boolean;
    allowBoundedSlRelaxation: boolean;
  };

  // Optional: broker / platform constraints if you have them
  broker?: {
    minStopDistanceAbs?: number;
    minLot?: number;
    lotStep?: number;
  };

  // Optional: data quality
  dataQuality?: {
    priceAgeMs?: number;
    atrAgeMs?: number;
  };

  // Optional: session context
  sessionContext?: {
    name: "asian" | "london" | "ny" | "overlap";
    remainingMinutes: number;
    typicalVolatilityMultiplier: number;  // Session-specific ATR adjustment
  };
}

export interface ResolvedPlan {
  style: TradeStyle;
  riskMode: RiskMode;

  // The resolved constraint targets used downstream
  sl: {
    minPercent: number;          // final SL floor in percent
    maxPercent?: number;         // optional cap
  };

  tp: {
    maxAtrMultiple: number;      // final TP ceiling (can be adjusted)
  };

  rr: {
    min: number;                 // RR floor used by Omega-9
  };
}

export interface FeasibilityResult {
  status: FeasibilityStatus;

  // Always returned when status is OK or ADJUSTED
  plan?: ResolvedPlan;

  // Explains exactly what changed and why
  adjustments: Array<{
    field: "style" | "riskMode" | "sl.minPercent" | "tp.maxAtrMultiple" | "rr";
    from: any;
    to: any;
    reason: AdjustmentReason;
    advisory?: boolean;       // If true, this is advisory guidance, not a mandatory adjustment
    detail?: string;          // Additional context for advisory warnings
  }>;

  // Deterministic explanation for logs + UI
  userMessage: string;

  // If NO_TRADE, include blocking reason(s)
  blockers?: Array<{
    reason: AdjustmentReason;
    detail: string;
  }>;

  // For multi-symbol scanner coordination
  tryAlternatives?: {
    betterVolatilityNeeded: boolean;
    suggestedMinAtrPercent: number;
    suggestedSymbols?: string[];  // If you have cross-asset recommendations
  };

  // Raw diagnostics for logging
  diagnostics?: {
    requestedStyleValid: boolean;
    rrFeasible: boolean;
    rrAchievable: number;
    tpCeilingPercent: number;
    slFloorPercent: number;
    spreadImpact?: number;
  };
}
