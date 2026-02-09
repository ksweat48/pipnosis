/**
 * PCVL (Position Contract Validation Layer) Configuration
 *
 * CRITICAL: Last-line defense against position sizing disasters.
 *
 * This config defines validation thresholds for broker pip value verification.
 * PCVL ensures that: trueRisk = lot_size × pip_value × stop_pips = intended_risk
 *
 * Kill Switch: Set enabled = false to bypass PCVL in emergencies.
 */

import type { PCVLConfig } from '../types/pcvl';

export const PCVL_CONFIG: PCVLConfig = {
  // Master kill switch - set to false to bypass PCVL
  enabled: true,

  // Maximum allowed variance between intended and actual risk
  // If variance exceeds this, a critical warning is added (advisory mode)
  max_risk_variance_percent: 2.0,  // ±2%

  // Variance thresholds for different alert levels
  risk_variance_thresholds: {
    warning: 1.0,      // Log warning at ±1%
    error: 2.0,        // Block at ±2%
    critical: 5.0,     // Critical alert at ±5% (should never happen)
  },

  // Pip value validation rules - expected dollar per pip per lot ranges
  // Used to detect misconfigured pip values
  pip_value_validation: {
    forex: { min: 5, max: 15 },       // $10 typical for standard pairs
    metal: { min: 1, max: 150 },      // $1-100 range (Silver $5, Gold $100)
    index: { min: 50, max: 150 },     // $100 typical for 1 lot
    crypto: { min: 0.05, max: 5 },    // $0.1-1.0 range (varies by crypto)
  },

  // Contract size validation - detect unreasonable lot sizes
  contract_size_validation: {
    forex: { min: 1000, max: 100000 },      // Standard lot = 100,000
    metal: { min: 1, max: 5000 },           // Gold = 100oz, Silver = 5000oz
    index: { min: 1, max: 10 },             // Typically 1 contract
    crypto: { min: 0.001, max: 100 },       // Variable by crypto
  },
};

/**
 * Check if PCVL is enabled
 * Can be disabled via config or environment variable
 */
export function isPCVLEnabled(): boolean {
  // Check environment variable override
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const envOverride = import.meta.env.VITE_PCVL_ENABLED;
    if (envOverride !== undefined) {
      return envOverride === 'true' || envOverride === true;
    }
  }

  return PCVL_CONFIG.enabled;
}

/**
 * Get PCVL configuration (for testing and debugging)
 */
export function getPCVLConfig(): PCVLConfig {
  return PCVL_CONFIG;
}
