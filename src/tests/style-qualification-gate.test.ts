/**
 * Style Qualification Gate Tests
 *
 * Tests the HARD ENFORCEMENT layer that validates trades match their style execution contracts.
 * Critical scenarios:
 * 1. SCALP with 28.7 hour duration (SHOULD BLOCK)
 * 2. Low Omega consensus with inflated Alpha confidence (SHOULD BLOCK)
 * 3. Insufficient ATR for style (SHOULD BLOCK)
 * 4. Valid trades within style boundaries (SHOULD PASS)
 */

import {
  validateStyleQualification,
  getStyleContract,
  meetsConsensusRequirement,
  meetsDurationRequirement
} from '../services/style-qualification-gate';

describe('Style Qualification Gate', () => {
  describe('Duration Validation', () => {
    it('should BLOCK SCALP trade with 28.7 hour expected fill time', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 28.7, // CRITICAL: Way beyond SCALP max (1 hour)
        omegaConsensusPercent: 25.5,
        alphaFinalConfidence: 62,
        atrPercent: 0.06,
        targetPips: 30,
        stopPips: 20,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(false);
      expect(result.blockReason).toContain('DURATION');
      expect(result.violations).toHaveLength(3); // Duration + Consensus + Target (likely)

      const durationViolation = result.violations.find(v => v.type === 'DURATION');
      expect(durationViolation).toBeDefined();
      expect(durationViolation?.severity).toBe('CRITICAL');
      expect(durationViolation?.actual).toBe(28.7 * 60); // 1722 minutes
    });

    it('should PASS SCALP trade with 45 minute expected fill time', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.75, // 45 minutes - within SCALP range
        omegaConsensusPercent: 65, // Good consensus
        alphaFinalConfidence: 70,
        atrPercent: 0.06,
        targetPips: 30,
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(true);
      expect(result.blockReason).toBeUndefined();
      expect(result.violations).toHaveLength(0);
    });

    it('should BLOCK INTRADAY trade with 15 hour duration (beyond max)', async () => {
      const result = await validateStyleQualification({
        symbol: 'XAUUSD',
        style: 'INTRADAY',
        assetClass: 'METAL',
        expectedFillTimeHours: 15, // Beyond INTRADAY max (10 hours)
        omegaConsensusPercent: 50,
        alphaFinalConfidence: 65,
        atrPercent: 0.15,
        targetPips: 120,
        stopPips: 50,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(false);
      expect(result.blockReason).toContain('DURATION');

      const durationViolation = result.violations.find(v => v.type === 'DURATION');
      expect(durationViolation?.severity).toBe('CRITICAL');
    });
  });

  describe('Omega Consensus Validation', () => {
    it('should BLOCK trade with 25.5% Omega consensus (below SCALP min 40%)', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.5, // Valid duration
        omegaConsensusPercent: 25.5, // CRITICAL: Only 1/6 Omegas voted
        alphaFinalConfidence: 62, // Alpha inflated it
        atrPercent: 0.06,
        targetPips: 30,
        stopPips: 20,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(false);

      const consensusViolation = result.violations.find(v => v.type === 'CONSENSUS');
      expect(consensusViolation).toBeDefined();
      expect(consensusViolation?.severity).toBe('MAJOR');
      expect(consensusViolation?.actual).toBe(25.5);
      expect(consensusViolation?.required).toBe(40); // SCALP minimum
      expect(consensusViolation?.detail).toContain('inflated');
    });

    it('should PASS trade with 65% Omega consensus', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.5,
        omegaConsensusPercent: 65, // Good consensus
        alphaFinalConfidence: 70,
        atrPercent: 0.06,
        targetPips: 30,
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('ATR Gate Validation', () => {
    it('should FLAG trade with ATR below style gate (MAJOR violation)', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.5,
        omegaConsensusPercent: 65,
        alphaFinalConfidence: 70,
        atrPercent: 0.02, // Below SCALP gate of 0.05
        targetPips: 30,
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      const atrViolation = result.violations.find(v => v.type === 'ATR_GATE');
      expect(atrViolation).toBeDefined();
      expect(atrViolation?.severity).toBe('MAJOR');
      expect(atrViolation?.actual).toBe(0.02);
      expect(atrViolation?.required).toBe(0.05);
    });
  });

  describe('Target/Stop Size Validation', () => {
    it('should BLOCK SCALP with 150 pip target (INTRADAY-sized target)', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.5,
        omegaConsensusPercent: 65,
        alphaFinalConfidence: 70,
        atrPercent: 0.06,
        targetPips: 150, // CRITICAL: Way beyond SCALP max (60 pips)
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(false);

      const targetViolation = result.violations.find(v => v.type === 'TARGET_SIZE');
      expect(targetViolation).toBeDefined();
      expect(targetViolation?.severity).toBe('CRITICAL');
      expect(targetViolation?.actual).toBe(150);
      expect(targetViolation?.required).toBeLessThan(150);
    });

    it('should PASS SCALP with 40 pip target (within SCALP range)', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.5,
        omegaConsensusPercent: 65,
        alphaFinalConfidence: 70,
        atrPercent: 0.06,
        targetPips: 40, // Within SCALP 10-60 pip range
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('Helper Functions', () => {
    it('meetsConsensusRequirement should validate consensus thresholds', () => {
      expect(meetsConsensusRequirement(25.5, 'SCALP')).toBe(false); // Below 40%
      expect(meetsConsensusRequirement(45, 'SCALP')).toBe(true); // Above 40%
      expect(meetsConsensusRequirement(32, 'INTRADAY')).toBe(true); // Above 30%
    });

    it('meetsDurationRequirement should validate duration ranges', () => {
      expect(meetsDurationRequirement(28.7, 'SCALP')).toBe(false); // Beyond max
      expect(meetsDurationRequirement(0.75, 'SCALP')).toBe(true); // Within range
      expect(meetsDurationRequirement(5, 'INTRADAY')).toBe(true); // Within 2-10 hour range
      expect(meetsDurationRequirement(15, 'INTRADAY')).toBe(false); // Beyond max
    });

    it('getStyleContract should return correct contract for each style', () => {
      const scalpContract = getStyleContract('SCALP');
      expect(scalpContract.maxFillTimeMinutes).toBe(60);
      expect(scalpContract.minOmegaConsensus).toBe(40);

      const intradayContract = getStyleContract('INTRADAY');
      expect(intradayContract.maxFillTimeMinutes).toBe(600);
      expect(intradayContract.minOmegaConsensus).toBe(30);
    });
  });

  describe('Real-World Scenario: EURUSD 28.7hr SCALP', () => {
    it('should reproduce the exact scenario from production logs', async () => {
      // This is the EXACT trade that was executed incorrectly
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 28.7, // From logs
        omegaConsensusPercent: 25.5, // Real Omega consensus (1/6)
        alphaFinalConfidence: 62, // Alpha inflated confidence
        atrPercent: 0.06, // Approximate from context
        targetPips: 30, // Approximate SCALP target
        stopPips: 20, // Approximate SCALP stop
        sessionId: 'ec166e0f-2f3c-4dac-9b7e-fd26a66b9818',
        userId: 'test-user',
        goalAmount: 94.93 // Downgraded from $400
      });

      // Should have been BLOCKED
      expect(result.qualified).toBe(false);
      expect(result.blockReason).toBeDefined();

      // Should have CRITICAL duration violation
      const durationViolation = result.violations.find(v => v.type === 'DURATION');
      expect(durationViolation?.severity).toBe('CRITICAL');

      // Should have MAJOR consensus violation
      const consensusViolation = result.violations.find(v => v.type === 'CONSENSUS');
      expect(consensusViolation?.severity).toBe('MAJOR');

      // Total violations should block trade
      const criticalViolations = result.violations.filter(v => v.severity === 'CRITICAL');
      expect(criticalViolations.length).toBeGreaterThan(0);
    });
  });
});
