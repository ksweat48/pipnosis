/**
 * PCPE (Post-Confidence Position Eligibility) Types
 *
 * PCPE v2.0 - Alpha Sovereignty Edition
 * Evaluates execution viability based on:
 * - Final effective confidence (post-penalty)
 * - Zone reachability (distance-to-ATR) - ADVISORY only
 * - Chase zone viability (regime-specific)
 *
 * ALPHA SOVEREIGNTY: No more BLOCKED band - all trades execute with appropriate sizing
 */

export type ExecutionBand = 'FULL' | 'REDUCED' | 'MICRO';
export type ZoneType = 'PRIMARY' | 'SECONDARY' | 'CHASE';

export interface PCPEInput {
  // Confidence (MUST be post-penalty final value)
  final_effective_confidence: number;

  // Zone information (MUST exist before PCPE runs)
  zone_type: ZoneType;
  distance_to_zone_pips: number;

  // Market conditions
  atr: number;
  spread: number;
  micro_regime: string;
  symbol: string;
}

export interface PCPEAudit {
  timestamp: string;
  final_effective_confidence: number;
  zone_type: ZoneType;
  distance_to_zone_pips: number;
  distance_to_atr_ratio: number;
  micro_regime: string;
  execution_band: ExecutionBand;
  size_multiplier: number;
  block_reason?: string;
  downgrade_path?: string; // e.g., "FULL → REDUCED → MICRO"
  original_band?: ExecutionBand;
}

export interface PCPEResult {
  // Execution decision
  execution_band: ExecutionBand;
  size_multiplier: number;  // 1.0 | 0.5 | 0.25 | 0
  zone_permissions: ZoneType[];

  // Blocking information
  block_reason?: string;

  // Downgrade tracking
  original_band?: ExecutionBand;
  downgrade_applied: boolean;
  downgrade_reason?: string;

  // Audit trail
  audit: PCPEAudit;

  // Human-readable reasoning
  reasoning: string;
}

export interface ReachabilityGateResult {
  band: ExecutionBand;
  downgraded: boolean;
  downgrade_reason?: string;
  distance_check: {
    distance_to_atr_ratio: number;
    threshold: number;
    within_threshold: boolean;
  };
}

export interface ChaseViabilityResult {
  allowed: boolean;
  blocked: boolean;
  reason: string;
}
