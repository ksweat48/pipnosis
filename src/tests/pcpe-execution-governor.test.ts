/**
 * PCPE Execution Governor v2.0 - Comprehensive Unit Tests
 *
 * Tests confidence band classification, distance-to-ATR reachability gates,
 * chase zone viability, and integration with real zones.
 */

// Mock logger to avoid import.meta issues in Jest
jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { applyPCPE, isPCPEEnabled } from '../services/pcpe-execution-governor';
import { PCPE_CONFIG } from '../config/pcpe-config';
import type { PCPEInput } from '../types/pcpe';

describe('PCPE Execution Governor v2.0', () => {
  // Helper to create valid PCPE input
  const createInput = (overrides: Partial<PCPEInput> = {}): PCPEInput => ({
    final_effective_confidence: 80,
    zone_type: 'PRIMARY',
    distance_to_zone_pips: 5,
    atr: 10,
    spread: 1,
    micro_regime: 'Trend Acceleration',
    symbol: 'EURUSD',
    ...overrides,
  });

  describe('Feature Flag', () => {
    it('should return enabled status', () => {
      expect(isPCPEEnabled()).toBe(PCPE_CONFIG.enabled);
    });
  });

  describe('Confidence Band Classification', () => {
    it('should classify FULL band for confidence ≥ 78%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 78 }));
      expect(result.execution_band).toBe('FULL');
      expect(result.size_multiplier).toBe(1.0);
    });

    it('should classify FULL band for confidence at 85%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 85 }));
      expect(result.execution_band).toBe('FULL');
      expect(result.size_multiplier).toBe(1.0);
    });

    it('should classify REDUCED band for confidence 68-77%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 70 }));
      expect(result.execution_band).toBe('REDUCED');
      expect(result.size_multiplier).toBe(0.5);
    });

    it('should classify REDUCED band at 77%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 77 }));
      expect(result.execution_band).toBe('REDUCED');
    });

    it('should classify MICRO band for confidence 58-67%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 60 }));
      expect(result.execution_band).toBe('MICRO');
      expect(result.size_multiplier).toBe(0.25);
    });

    it('should classify MICRO band at 67%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 67 }));
      expect(result.execution_band).toBe('MICRO');
    });

    it('should classify BLOCKED band for confidence < 58%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 50 }));
      expect(result.execution_band).toBe('BLOCKED');
      expect(result.size_multiplier).toBe(0);
      expect(result.block_reason).toBeDefined();
    });

    it('should classify BLOCKED band at 57%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 57 }));
      expect(result.execution_band).toBe('BLOCKED');
    });

    it('should handle boundary case at 77.9%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 77.9 }));
      expect(result.execution_band).toBe('REDUCED');
    });

    it('should handle boundary case at 67.9%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 67.9 }));
      // 67.9% is < 68% threshold, so it's MICRO band
      expect(result.execution_band).toBe('MICRO');
    });

    it('should handle boundary case at 57.9%', () => {
      const result = applyPCPE(createInput({ final_effective_confidence: 57.9 }));
      expect(result.execution_band).toBe('BLOCKED');
    });
  });

  describe('Distance-to-ATR Reachability Gates', () => {
    it('should downgrade FULL → REDUCED if distance > 1.2x ATR', () => {
      // ATR = 10, distance = 13 pips = 1.3x ATR (exceeds 1.2x threshold)
      const result = applyPCPE(createInput({
        final_effective_confidence: 80, // FULL band
        distance_to_zone_pips: 13,
        atr: 10,
      }));

      expect(result.execution_band).toBe('REDUCED');
      expect(result.original_band).toBe('FULL');
      expect(result.downgrade_applied).toBe(true);
      expect(result.size_multiplier).toBe(0.5); // REDUCED multiplier
    });

    it('should NOT downgrade FULL if distance ≤ 1.2x ATR', () => {
      // ATR = 10, distance = 12 pips = 1.2x ATR (within threshold)
      const result = applyPCPE(createInput({
        final_effective_confidence: 80, // FULL band
        distance_to_zone_pips: 12,
        atr: 10,
      }));

      expect(result.execution_band).toBe('FULL');
      expect(result.downgrade_applied).toBe(false);
      expect(result.size_multiplier).toBe(1.0);
    });

    it('should downgrade REDUCED → MICRO if distance > 1.0x ATR', () => {
      // ATR = 10, distance = 11 pips = 1.1x ATR (exceeds 1.0x threshold)
      const result = applyPCPE(createInput({
        final_effective_confidence: 70, // REDUCED band
        distance_to_zone_pips: 11,
        atr: 10,
      }));

      expect(result.execution_band).toBe('MICRO');
      expect(result.original_band).toBe('REDUCED');
      expect(result.downgrade_applied).toBe(true);
      expect(result.size_multiplier).toBe(0.25); // MICRO multiplier
    });

    it('should NOT downgrade REDUCED if distance ≤ 1.0x ATR', () => {
      // ATR = 10, distance = 10 pips = 1.0x ATR (within threshold)
      const result = applyPCPE(createInput({
        final_effective_confidence: 70, // REDUCED band
        distance_to_zone_pips: 10,
        atr: 10,
      }));

      expect(result.execution_band).toBe('REDUCED');
      expect(result.downgrade_applied).toBe(false);
    });

    it('should downgrade MICRO → BLOCKED if distance > 1.0x ATR', () => {
      // ATR = 10, distance = 11 pips = 1.1x ATR (exceeds 1.0x threshold)
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band
        distance_to_zone_pips: 11,
        atr: 10,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.original_band).toBe('MICRO');
      expect(result.downgrade_applied).toBe(true);
      expect(result.size_multiplier).toBe(0);
      expect(result.block_reason).toBe('UNREACHABLE_ZONE');
    });

    it('should NOT downgrade MICRO if distance ≤ 1.0x ATR', () => {
      // ATR = 10, distance = 10 pips = 1.0x ATR (within threshold)
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band
        distance_to_zone_pips: 10,
        atr: 10,
      }));

      expect(result.execution_band).toBe('MICRO');
      expect(result.downgrade_applied).toBe(false);
    });

    it('should downgrade FULL → REDUCED for distance 1.5x ATR', () => {
      // Confidence qualifies for FULL, but distance forces downgrade
      // ATR = 10, distance = 15 pips = 1.5x ATR
      // FULL threshold: 1.2x (fails) → REDUCED
      const result = applyPCPE(createInput({
        final_effective_confidence: 80, // FULL band
        distance_to_zone_pips: 15,
        atr: 10,
      }));

      // Should downgrade once: FULL → REDUCED (logic downgrades one level at a time)
      expect(result.execution_band).toBe('REDUCED');
      expect(result.original_band).toBe('FULL');
      expect(result.downgrade_applied).toBe(true);
    });

    it('should handle zero distance (already in zone)', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80,
        distance_to_zone_pips: 0,
        atr: 10,
      }));

      expect(result.execution_band).toBe('FULL');
      expect(result.downgrade_applied).toBe(false);
    });
  });

  describe('Chase Zone Viability', () => {
    it('should ALLOW chase in Trend Acceleration with MICRO band', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band
        zone_type: 'CHASE',
        micro_regime: 'Trend Acceleration',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 2, // 20% of ATR (< 30% threshold)
      }));

      expect(result.execution_band).toBe('MICRO');
      expect(result.size_multiplier).toBe(0.25);
      expect(result.block_reason).toBeUndefined();
    });

    it('should ALLOW chase in Liquidity Vacuum with MICRO band', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band
        zone_type: 'CHASE',
        micro_regime: 'Liquidity Vacuum',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 2,
      }));

      expect(result.execution_band).toBe('MICRO');
      expect(result.block_reason).toBeUndefined();
    });

    it('should ALLOW chase in Post-Break Retest with MICRO band', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band
        zone_type: 'CHASE',
        micro_regime: 'Post-Break Retest',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 2,
      }));

      expect(result.execution_band).toBe('MICRO');
      expect(result.block_reason).toBeUndefined();
    });

    it('should BLOCK chase in Mean Reversion regime', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band
        zone_type: 'CHASE',
        micro_regime: 'Mean Reversion Pocket',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 2,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('CHASE_ZONE_INVALID');
      expect(result.reasoning).toContain('not permitted');
    });

    it('should BLOCK chase in Neutral regime', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band
        zone_type: 'CHASE',
        micro_regime: 'Neutral Drift',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 2,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('CHASE_ZONE_INVALID');
    });

    it('should BLOCK chase with FULL band (even in valid regime)', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80, // FULL band
        zone_type: 'CHASE',
        micro_regime: 'Trend Acceleration',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 2,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('CHASE_ZONE_INVALID');
      expect(result.reasoning).toContain('require MICRO band');
    });

    it('should BLOCK chase with REDUCED band (even in valid regime)', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 70, // REDUCED band
        zone_type: 'CHASE',
        micro_regime: 'Trend Acceleration',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 2,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('CHASE_ZONE_INVALID');
    });

    it('should BLOCK chase if spread too wide', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band
        zone_type: 'CHASE',
        micro_regime: 'Trend Acceleration',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 4, // 40% of ATR (> 30% threshold)
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('CHASE_ZONE_INVALID');
      expect(result.reasoning).toContain('Spread too wide');
    });
  });

  describe('Integration with Real Zones', () => {
    it('should work with PRIMARY zones', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80,
        zone_type: 'PRIMARY',
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.execution_band).toBe('FULL');
      expect(result.zone_permissions).toContain('PRIMARY');
    });

    it('should work with SECONDARY zones', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80,
        zone_type: 'SECONDARY',
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.execution_band).toBe('FULL');
      expect(result.zone_permissions).toContain('SECONDARY');
    });

    it('should work with CHASE zones in valid regime', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 60, // MICRO band (required for chase)
        zone_type: 'CHASE',
        micro_regime: 'Trend Acceleration',
        distance_to_zone_pips: 5,
        atr: 10,
        spread: 2,
      }));

      expect(result.execution_band).toBe('MICRO');
      expect(result.zone_permissions).toContain('CHASE');
    });

    it('should handle missing regime gracefully for PRIMARY zone', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80,
        zone_type: 'PRIMARY',
        micro_regime: 'UNKNOWN',
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.execution_band).toBe('FULL');
      expect(result.block_reason).toBeUndefined();
    });

    it('should handle missing regime for CHASE zone (should block)', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 60,
        zone_type: 'CHASE',
        micro_regime: 'UNKNOWN',
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('CHASE_ZONE_INVALID');
    });
  });

  describe('Audit Logging', () => {
    it('should generate complete audit trail', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80,
        zone_type: 'PRIMARY',
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.audit).toBeDefined();
      expect(result.audit.timestamp).toBeDefined();
      expect(result.audit.final_effective_confidence).toBe(80);
      expect(result.audit.zone_type).toBe('PRIMARY');
      expect(result.audit.distance_to_zone_pips).toBe(5);
      expect(result.audit.distance_to_atr_ratio).toBe(0.5); // 5 pips / 10 ATR
      expect(result.audit.execution_band).toBe('FULL');
      expect(result.audit.size_multiplier).toBe(1.0);
    });

    it('should log downgrade path in audit', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80, // FULL band
        distance_to_zone_pips: 13, // Forces downgrade
        atr: 10,
      }));

      expect(result.audit.original_band).toBe('FULL');
      expect(result.audit.downgrade_path).toContain('FULL');
      expect(result.audit.downgrade_path).toContain('REDUCED');
    });

    it('should log block reasons in audit', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 50, // BLOCKED band
        zone_type: 'PRIMARY',
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.audit.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should reject invalid confidence (< 0)', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: -10,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('INVALID_CONFIDENCE');
    });

    it('should reject invalid confidence (> 100)', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 110,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('INVALID_CONFIDENCE');
    });

    it('should reject invalid ATR (≤ 0)', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80,
        atr: 0,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('INVALID_ATR');
    });

    it('should reject negative ATR', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80,
        atr: -5,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.block_reason).toBe('INVALID_ATR');
    });

    it('should handle very large distance (10x ATR)', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80,
        distance_to_zone_pips: 100, // 10x ATR
        atr: 10,
      }));

      // FULL band with 10x distance downgrades to REDUCED (one level at a time)
      expect(result.execution_band).toBe('REDUCED');
      expect(result.downgrade_applied).toBe(true);
    });

    it('should handle 100% confidence', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 100,
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.execution_band).toBe('FULL');
      expect(result.size_multiplier).toBe(1.0);
    });

    it('should handle 0% confidence', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 0,
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.execution_band).toBe('BLOCKED');
      expect(result.size_multiplier).toBe(0);
    });
  });

  describe('Reasoning Generation', () => {
    it('should generate clear reasoning for FULL band', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 85,
        zone_type: 'PRIMARY',
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.reasoning).toContain('85');
      expect(result.reasoning).toContain('FULL');
      expect(result.reasoning).toContain('PRIMARY');
    });

    it('should generate clear reasoning for downgrade', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80, // FULL
        distance_to_zone_pips: 13, // Forces downgrade
        atr: 10,
      }));

      expect(result.reasoning).toContain('Downgraded');
      expect(result.reasoning).toContain('reachability');
    });

    it('should generate clear reasoning for chase block', () => {
      const result = applyPCPE(createInput({
        final_effective_confidence: 80, // FULL band
        zone_type: 'CHASE',
        micro_regime: 'Trend Acceleration',
        distance_to_zone_pips: 5,
        atr: 10,
      }));

      expect(result.reasoning).toContain('Chase');
      expect(result.reasoning).toContain('MICRO');
    });
  });
});
