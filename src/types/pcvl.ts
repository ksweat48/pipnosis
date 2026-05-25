/**
 * PCVL (Position Contract Validation Layer) Types
 *
 * Types for the last-line defense against position sizing disasters.
 * PCVL validates that broker pip values produce the intended risk amount.
 */

export interface PCVLInput {
  symbol: string;
  lot_size: number;
  stop_pips: number;
  intended_risk_dollars: number;
  entry_price: number;
  stop_loss: number;
}

export interface PCVLResult {
  approved: boolean;
  true_risk_dollars: number;
  pip_value_used: number;
  dollar_per_pip: number;
  risk_variance_percent: number;
  block_reason?: string;
  audit: PCVLAudit;
}

export interface PCVLAudit {
  timestamp: string;
  symbol: string;
  lot_size: number;
  stop_pips: number;
  intended_risk: number;
  calculated_risk: number;
  risk_variance: number;
  pip_value: number;
  dollar_per_pip: number;
  approved: boolean;
  block_reason?: string;
}

export interface PCVLConfig {
  enabled: boolean;
  max_risk_variance_percent: number;
  risk_variance_thresholds: {
    warning: number;
    error: number;
    critical: number;
  };
  pip_value_validation: {
    forex: { min: number; max: number };
    metal: { min: number; max: number };
    index: { min: number; max: number };
  };
  contract_size_validation: {
    forex: { min: number; max: number };
    metal: { min: number; max: number };
    index: { min: number; max: number };
  };
}
