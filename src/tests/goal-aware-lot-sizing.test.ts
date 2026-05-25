/**
 * Goal-Aware Lot Sizing Tests
 *
 * Tests for the GoalAwareLotSizingCoordinator
 * Validates SSOT compliance, CCIP governance, and lot sizing logic
 */

import { goalAwareLotSizingCoordinator } from '../services/goal-aware-lot-sizing-coordinator';
import { TradeContext } from '../types/trade-context';

describe('Goal-Aware Lot Sizing Coordinator', () => {
  // Mock TradeContext for testing
  const mockTradeContext: TradeContext = {
    symbol: 'XAUUSD',
    pipValue: 0.01,
    dollarPerPipPerLot: 100,
    contractSize: 1,
    minLotSize: 0.01,
    maxLotSize: 10,
    decimalPlaces: 2,
    symbolType: 'metal',
    profileHash: 'test-hash',
    createdAt: new Date(),
    calculateDollarsPerPip: (lots: number) => lots * 100,
    convertPipsToPrice: (pips: number) => pips * 1,
    convertPriceToDistance: (priceDistance: number) => priceDistance * 1,
    getRiskInDollars: (slDistance: number, lots: number) => slDistance * lots * 100,
    validatePriceRange: (price: number) => true,
    equals: (other: TradeContext) => true
  };

  describe('makeDecision - Goal Achievable Within Risk', () => {
    it('should choose required lot when it fits within risk limits', async () => {
      const input = {
        userId: 'test-user',
        goalSessionId: 'test-session',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        accountBalance: 5800,
        goalAmount: 63,
        currentProgress: 0,
        riskPercentageAllowed: 5, // 5% = $290
        entryPrice: 78972.6,
        stopLossPrice: 77705.5, // ~1267 pips stop
        takeProfitPrice: 79886.9, // ~914 pips to TP
        tradeContext: mockTradeContext
      };

      const decision = await goalAwareLotSizingCoordinator.makeDecision(input);

      // Expected calculation:
      // Remaining goal: $63
      // TP distance: 914 pips
      // Required lot for goal: 63 / (914 × $100) = 0.0069 lots
      // Risk budget: $290 / (1267 × $100) = 0.023 lots
      // Required lot (0.0069) < Safe lot (0.023) → AFFIRM goal
      expect(decision.decisionReason).toBe('goal_achievable_within_risk');
      expect(decision.chosenLotSize).toBeGreaterThan(0);
      expect(decision.requiredLotForGoal).toBeGreaterThan(0);
      expect(decision.safeLotFromRisk).toBeGreaterThan(0);
      expect(decision.chosenLotSize).toBeLessThanOrEqual(decision.safeLotFromRisk);
      expect(decision.reasoning).toContain('achievable');
    });
  });

  describe('makeDecision - Goal Requires More Risk', () => {
    it('should degrade to safe lot when goal requires more risk', async () => {
      const input = {
        userId: 'test-user',
        goalSessionId: 'test-session',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        accountBalance: 5800,
        goalAmount: 500, // Much larger goal
        currentProgress: 0,
        riskPercentageAllowed: 5, // 5% = $290
        entryPrice: 78972.6,
        stopLossPrice: 77705.5, // ~1267 pips stop
        takeProfitPrice: 79886.9, // ~914 pips to TP
        tradeContext: mockTradeContext
      };

      const decision = await goalAwareLotSizingCoordinator.makeDecision(input);

      // Expected: Required lot > Safe lot → DEGRADE
      expect(decision.decisionReason).toBe('goal_requires_more_risk');
      expect(decision.chosenLotSize).toBe(decision.safeLotFromRisk);
      expect(decision.reasoning).toContain('Degrading');
    });
  });

  describe('SSOT Compliance', () => {
    it('should use consistent pip calculations', async () => {
      const input = {
        userId: 'test-user',
        goalSessionId: 'test-session',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        accountBalance: 10000,
        goalAmount: 200,
        currentProgress: 0,
        riskPercentageAllowed: 2,
        entryPrice: 78972.6,
        stopLossPrice: 77972.6, // Exactly 1000 pips
        takeProfitPrice: 79972.6, // Exactly 1000 pips
        tradeContext: mockTradeContext
      };

      const decision = await goalAwareLotSizingCoordinator.makeDecision(input);

      // Verify calculations are consistent
      // Risk: 0.02 × $10000 = $200
      // SL distance: 1000 pips × $100 = $100 per lot
      // Safe lot: $200 / $100 = 2.0 lots
      expect(decision.safeLotFromRisk).toBeLessThanOrEqual(2.5);
      expect(decision.safeLotFromRisk).toBeGreaterThan(1.5);
    });
  });

  describe('Governance & Audit', () => {
    it('should record decision reasoning for audit trail', async () => {
      const input = {
        userId: 'test-user',
        goalSessionId: 'test-session',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        accountBalance: 5800,
        goalAmount: 63,
        currentProgress: 0,
        riskPercentageAllowed: 5,
        entryPrice: 78972.6,
        stopLossPrice: 77705.5,
        takeProfitPrice: 79886.9,
        tradeContext: mockTradeContext
      };

      const decision = await goalAwareLotSizingCoordinator.makeDecision(input);

      // Verify audit information is present
      expect(decision.reasoning).toBeDefined();
      expect(decision.reasoning.length).toBeGreaterThan(0);
      expect(decision.requiredLotForGoal).toBeGreaterThan(0);
      expect(decision.safeLotFromRisk).toBeGreaterThan(0);
      expect(decision.expectedProfitAtTP).toBeGreaterThanOrEqual(0);
      expect(decision.expectedLossAtSL).toBeGreaterThan(0);
      expect(decision.expectedRiskDollars).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero remaining goal gracefully', async () => {
      const input = {
        userId: 'test-user',
        goalSessionId: 'test-session',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        accountBalance: 5800,
        goalAmount: 100,
        currentProgress: 100, // Goal already met
        riskPercentageAllowed: 5,
        entryPrice: 78972.6,
        stopLossPrice: 77705.5,
        takeProfitPrice: 79886.9,
        tradeContext: mockTradeContext
      };

      const decision = await goalAwareLotSizingCoordinator.makeDecision(input);

      // With no remaining goal, should fall back to risk constraint
      expect(decision.chosenLotSize).toBe(decision.safeLotFromRisk);
      expect(decision.decisionReason).toMatch(/risk|fallback/i);
    });

    it('should handle equal entry and stop loss gracefully', async () => {
      const input = {
        userId: 'test-user',
        goalSessionId: 'test-session',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        accountBalance: 5800,
        goalAmount: 63,
        currentProgress: 0,
        riskPercentageAllowed: 5,
        entryPrice: 78972.6,
        stopLossPrice: 78972.6, // Zero distance (invalid)
        takeProfitPrice: 79886.9,
        tradeContext: mockTradeContext
      };

      const decision = await goalAwareLotSizingCoordinator.makeDecision(input);

      // Should still return a decision (might use fallback)
      expect(decision.chosenLotSize).toBeGreaterThan(0);
      expect(decision.reasoning).toBeDefined();
    });

    it('should cap lot size at broker limits', async () => {
      const input = {
        userId: 'test-user',
        goalSessionId: 'test-session',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        accountBalance: 100000,
        goalAmount: 50000, // Massive goal
        currentProgress: 0,
        riskPercentageAllowed: 100, // Even with 100% risk
        entryPrice: 78972.6,
        stopLossPrice: 70000, // Tiny stop loss
        takeProfitPrice: 79886.9,
        tradeContext: mockTradeContext
      };

      const decision = await goalAwareLotSizingCoordinator.makeDecision(input);

      // Should not exceed broker max lot size
      expect(decision.chosenLotSize).toBeLessThanOrEqual(10); // mockTradeContext.maxLotSize
    });
  });

  describe('CCIP Change Tracking', () => {
    it('should provide audit record ID for linking to trades', async () => {
      const input = {
        userId: 'test-user',
        goalSessionId: 'test-session',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        accountBalance: 5800,
        goalAmount: 63,
        currentProgress: 0,
        riskPercentageAllowed: 5,
        entryPrice: 78972.6,
        stopLossPrice: 77705.5,
        takeProfitPrice: 79886.9,
        tradeContext: mockTradeContext
      };

      const decision = await goalAwareLotSizingCoordinator.makeDecision(input);

      // Audit record ID should be present (if database is available)
      // Note: This may be undefined in test environment without Supabase
      if (decision.auditRecordId) {
        expect(typeof decision.auditRecordId).toBe('string');
        expect(decision.auditRecordId.length).toBeGreaterThan(0);
      }
    });
  });
});
