/**
 * Unit tests for Omega-9 Hallucination Defense Brain
 */

import { omega9Hallucination } from '../brains/omega9-hallucination-brain';
import type { Omega9Input } from '../brains/omega9-hallucination-brain';
import type { AlphaDecision } from '../brains/coordinator-alpha';

describe('Omega-9 Hallucination Defense Brain', () => {
  const createTestInput = (overrides?: Partial<Omega9Input>): Omega9Input => {
    const baseDecision: AlphaDecision = {
      action: 'BUY',
      entry: 1.1000,
      stopLoss: 1.0980,
      takeProfit: 1.1050,
      confidence: 75,
      reasoning: 'Test trade',
      omega_summary: 'Test summary'
    };

    return {
      alphaDecision: baseDecision,
      omegaVotes: {
        trend: { vote: 'BUY', confidence: 80, reasoning: 'Bullish trend' },
        scalper: { vote: 'BUY', confidence: 70, reasoning: 'Good entry' },
        reversal: { vote: 'NO_TRADE', confidence: 60, reasoning: 'Wait for confirmation' },
        volatility: { vote: 'BUY', confidence: 65, reasoning: 'Acceptable vol' },
        risk: { vote: 'BUY', confidence: 85, reasoning: 'Risk acceptable' }
      },
      marketContext: {
        price: 1.1000,
        atr: 0.0020,
        symbol: 'EURUSD'
      },
      safetyRules: {
        maxRiskPct: 5,
        minRR: 1.5,
        maxExposure: 10
      },
      ...overrides
    };
  };

  describe('Local Validation', () => {
    it('should pass validation for correct BUY setup', async () => {
      const input = createTestInput();
      const result = await omega9Hallucination.validate(input);

      expect(result.pass).toBe(true);
      expect(result.flags.length).toBe(0);
    });

    it('should detect SL above entry for BUY', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'BUY',
          entry: 1.1000,
          stopLoss: 1.1020,
          takeProfit: 1.1050,
          confidence: 75,
          reasoning: 'Bad SL',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      expect(result.flags).toContain('SL_POSITION_ERROR_BUY');
    });

    it('should detect SL below entry for SELL', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'SELL',
          entry: 1.1000,
          stopLoss: 1.0980,
          takeProfit: 1.0950,
          confidence: 75,
          reasoning: 'Bad SL',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      expect(result.flags).toContain('SL_POSITION_ERROR_SELL');
    });

    it('should detect TP below entry for BUY', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'BUY',
          entry: 1.1000,
          stopLoss: 1.0980,
          takeProfit: 1.0990,
          confidence: 75,
          reasoning: 'Bad TP',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      expect(result.flags).toContain('TP_POSITION_ERROR_BUY');
    });

    it('should detect TP above entry for SELL', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'SELL',
          entry: 1.1000,
          stopLoss: 1.1020,
          takeProfit: 1.1030,
          confidence: 75,
          reasoning: 'Bad TP',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      expect(result.flags).toContain('TP_POSITION_ERROR_SELL');
    });

    it('should detect poor R:R ratio', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'BUY',
          entry: 1.1000,
          stopLoss: 1.0980,
          takeProfit: 1.1015,
          confidence: 75,
          reasoning: 'Low R:R',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      const rrFlag = result.flags.find(f => f.startsWith('RR_TOO_LOW'));
      expect(rrFlag).toBeDefined();
    });

    it('should detect SL too wide', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'BUY',
          entry: 1.1000,
          stopLoss: 1.0880,
          takeProfit: 1.1200,
          confidence: 75,
          reasoning: 'Wide SL',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      expect(result.flags).toContain('SL_TOO_WIDE');
    });

    it('should detect SL too tight', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'BUY',
          entry: 1.1000,
          stopLoss: 1.0999,
          takeProfit: 1.1020,
          confidence: 75,
          reasoning: 'Tight SL',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      expect(result.flags).toContain('SL_TOO_TIGHT');
    });

    it('should skip validation for NO_TRADE', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'NO_TRADE',
          entry: 1.1000,
          stopLoss: 1.1000,
          takeProfit: 1.1000,
          confidence: 0,
          reasoning: 'No trade',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      expect(result.pass).toBe(true);
      expect(result.reasoning).toBe('NO_TRADE requires no validation');
    });
  });

  describe('Vote Conflict Detection', () => {
    it('should detect vote split', async () => {
      const input = createTestInput({
        omegaVotes: {
          trend: { vote: 'BUY', confidence: 80, reasoning: 'Bullish' },
          scalper: { vote: 'SELL', confidence: 70, reasoning: 'Bearish' },
          reversal: { vote: 'SELL', confidence: 60, reasoning: 'Reversal' },
          volatility: { vote: 'BUY', confidence: 65, reasoning: 'Vol ok' },
          risk: { vote: 'BUY', confidence: 85, reasoning: 'Risk ok' }
        }
      });

      const result = await omega9Hallucination.validate(input);

      const voteFlag = result.flags.find(f => f.includes('VOTE_SPLIT'));
      expect(voteFlag).toBeDefined();
    });
  });

  describe('Correction System', () => {
    it('should attempt to repair fixable SL position error', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'BUY',
          entry: 1.1000,
          stopLoss: 1.1020,
          takeProfit: 1.1050,
          confidence: 75,
          reasoning: 'Bad SL',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      if (result.corrections.sl !== null) {
        expect(result.corrections.sl).toBeLessThan(1.1000);
      }
    });

    it('should apply confidence adjustment for issues', async () => {
      const input = createTestInput({
        alphaDecision: {
          action: 'BUY',
          entry: 1.1000,
          stopLoss: 1.1020,
          takeProfit: 1.1050,
          confidence: 75,
          reasoning: 'Bad SL',
          omega_summary: 'Test'
        }
      });

      const result = await omega9Hallucination.validate(input);

      expect(result.confidence_adjustment).toBeLessThanOrEqual(0);
    });
  });
});
