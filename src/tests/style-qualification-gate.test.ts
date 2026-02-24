/**
 * Style Qualification Gate Tests
 *
 * CCIP-2026-02-24: Omega consensus validation removed.
 * Omegas no longer vote — Alpha reasons from raw data.
 *
 * Tests the ADVISORY layer that validates trades match their style execution contracts.
 * Critical scenarios:
 * 1. SCALP with 28.7 hour duration (SHOULD FLAG)
 * 2. Insufficient ATR for style (SHOULD FLAG)
 * 3. Valid trades within style boundaries (SHOULD PASS)
 */

import {
  validateStyleQualification,
  getStyleContract,
  meetsDurationRequirement
} from '../services/style-qualification-gate';

describe('Style Qualification Gate', () => {
  describe('Duration Validation', () => {
    it('should FLAG SCALP trade with 28.7 hour expected fill time', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 28.7,
        alphaFinalConfidence: 62,
        atrPercent: 0.06,
        targetPips: 30,
        stopPips: 20,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      const durationViolation = result.violations.find(v => v.type === 'DURATION');
      expect(durationViolation).toBeDefined();
      expect(durationViolation?.severity).toBe('MAJOR');
      expect(durationViolation?.actual).toBe(28.7 * 60);
    });

    it('should PASS SCALP trade with 45 minute expected fill time', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.75,
        alphaFinalConfidence: 70,
        atrPercent: 0.06,
        targetPips: 20,
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(true);
      expect(result.blockReason).toBeUndefined();
      expect(result.violations).toHaveLength(0);
    });

    it('should FLAG INTRADAY trade with 15 hour duration (beyond max)', async () => {
      const result = await validateStyleQualification({
        symbol: 'XAUUSD',
        style: 'INTRADAY',
        assetClass: 'METAL',
        expectedFillTimeHours: 15,
        alphaFinalConfidence: 65,
        atrPercent: 0.15,
        targetPips: 120,
        stopPips: 50,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      const durationViolation = result.violations.find(v => v.type === 'DURATION');
      expect(durationViolation).toBeDefined();
      expect(durationViolation?.severity).toBe('MAJOR');
    });
  });

  describe('ATR Gate Validation', () => {
    it('should FLAG trade with ATR below style gate (MAJOR violation)', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.5,
        alphaFinalConfidence: 70,
        atrPercent: 0.02,
        targetPips: 20,
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      const atrViolation = result.violations.find(v => v.type === 'ATR_GATE');
      expect(atrViolation).toBeDefined();
      expect(atrViolation?.severity).toBe('MAJOR');
      expect(atrViolation?.actual).toBe(0.02);
    });
  });

  describe('Target/Stop Size Validation', () => {
    it('should FLAG SCALP with 150 pip target (INTRADAY-sized target)', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.5,
        alphaFinalConfidence: 70,
        atrPercent: 0.06,
        targetPips: 150,
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      const targetViolation = result.violations.find(v => v.type === 'TARGET_SIZE');
      expect(targetViolation).toBeDefined();
      expect(targetViolation?.severity).toBe('MAJOR');
      expect(targetViolation?.actual).toBe(150);
      expect(targetViolation?.required).toBeLessThan(150);
    });

    it('should PASS SCALP with 20 pip target (within SCALP range)', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 0.5,
        alphaFinalConfidence: 70,
        atrPercent: 0.06,
        targetPips: 20,
        stopPips: 15,
        sessionId: 'test-session',
        userId: 'test-user'
      });

      expect(result.qualified).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('Helper Functions', () => {
    it('meetsDurationRequirement should validate duration ranges', () => {
      expect(meetsDurationRequirement(28.7, 'SCALP')).toBe(false);
      expect(meetsDurationRequirement(0.75, 'SCALP')).toBe(true);
      expect(meetsDurationRequirement(5, 'INTRADAY')).toBe(true);
      expect(meetsDurationRequirement(15, 'INTRADAY')).toBe(false);
    });

    it('getStyleContract should return correct contract for each style', () => {
      const scalpContract = getStyleContract('SCALP');
      expect(scalpContract.maxFillTimeMinutes).toBe(60);

      const intradayContract = getStyleContract('INTRADAY');
      expect(intradayContract.maxFillTimeMinutes).toBe(600);
    });
  });

  describe('Real-World Scenario: EURUSD 28.7hr SCALP', () => {
    it('should reproduce the exact scenario from production logs', async () => {
      const result = await validateStyleQualification({
        symbol: 'EURUSD',
        style: 'SCALP',
        assetClass: 'FOREX',
        expectedFillTimeHours: 28.7,
        alphaFinalConfidence: 62,
        atrPercent: 0.06,
        targetPips: 30,
        stopPips: 20,
        sessionId: 'ec166e0f-2f3c-4dac-9b7e-fd26a66b9818',
        userId: 'test-user',
        goalAmount: 94.93
      });

      expect(result.qualified).toBe(false);
      expect(result.blockReason).toBeDefined();

      const durationViolation = result.violations.find(v => v.type === 'DURATION');
      expect(durationViolation).toBeDefined();
    });
  });
});
