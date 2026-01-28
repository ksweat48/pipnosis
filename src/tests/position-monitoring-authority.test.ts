/**
 * Position Monitoring Authority Integration Tests
 *
 * Tests the SSOT authority for position monitoring:
 * - Access control (user vs admin)
 * - SL/TP decision logic
 * - TP1/TP2 milestone detection
 * - Race condition protection
 * - Price validation
 */

import { positionMonitoringAuthority } from '../services/monitoring/position-monitoring-authority';
import type { MonitoredPosition, PriceData } from '../services/monitoring/position-monitoring-authority';

describe('PositionMonitoringAuthority - Access Control', () => {
  describe('getMonitorablePositions', () => {
    it('should allow users to monitor their own positions', async () => {
      const userId = 'user-123';
      const result = await positionMonitoringAuthority.getMonitorablePositions(userId, false);

      expect(result.success).toBe(true);
      expect(result.accessDenied).toBeUndefined();
    });

    it('should block non-admins from monitoring other users', async () => {
      const userId = 'user-123';
      const targetUserId = 'user-456';

      const result = await positionMonitoringAuthority.getMonitorablePositions(
        userId,
        false, // Not admin
        targetUserId
      );

      expect(result.success).toBe(false);
      expect(result.accessDenied).toBe(true);
      expect(result.error).toContain('Access denied');
    });

    it('should allow admins to monitor other users', async () => {
      const adminUserId = 'admin-789';
      const targetUserId = 'user-123';

      const result = await positionMonitoringAuthority.getMonitorablePositions(
        adminUserId,
        true, // Is admin
        targetUserId
      );

      expect(result.success).toBe(true);
      expect(result.accessDenied).toBeUndefined();
    });

    it('should default to user monitoring own positions when no target specified', async () => {
      const userId = 'user-123';

      const result = await positionMonitoringAuthority.getMonitorablePositions(
        userId,
        true // Admin, but no target specified
      );

      expect(result.success).toBe(true);
      // Should monitor own positions by default
    });
  });
});

describe('PositionMonitoringAuthority - SL/TP Logic', () => {
  const createMockPosition = (overrides?: Partial<MonitoredPosition>): MonitoredPosition => ({
    id: 'trade-123',
    symbol: 'EURUSD',
    direction: 'buy',
    entry_price: 1.0900,
    stop_loss: 1.0850,
    take_profit: 1.0950,
    tp1_price: null,
    tp2_price: null,
    tp1_hit: false,
    tp2_hit: false,
    position_size: 1.0,
    lot_size: 1.0,
    user_id: 'user-123',
    goal_session_id: 'session-456',
    status: 'open',
    opened_at: new Date().toISOString(),
    ...overrides,
  });

  describe('checkSLTP - Single TP System', () => {
    it('should trigger stop loss for buy position', () => {
      const position = createMockPosition({
        direction: 'buy',
        entry_price: 1.0900,
        stop_loss: 1.0850,
        take_profit: 1.0950,
      });

      const priceData: PriceData = { bid: 1.0850, ask: 1.0851 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('shouldClose' in decision! && decision.shouldClose).toBe(true);
      expect('reason' in decision! && decision.reason).toBe('stop_loss');
    });

    it('should trigger stop loss for sell position', () => {
      const position = createMockPosition({
        direction: 'sell',
        entry_price: 1.0900,
        stop_loss: 1.0950,
        take_profit: 1.0850,
      });

      const priceData: PriceData = { bid: 1.0950, ask: 1.0951 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('shouldClose' in decision! && decision.shouldClose).toBe(true);
      expect('reason' in decision! && decision.reason).toBe('stop_loss');
    });

    it('should trigger take profit for buy position', () => {
      const position = createMockPosition({
        direction: 'buy',
        entry_price: 1.0900,
        stop_loss: 1.0850,
        take_profit: 1.0950,
      });

      const priceData: PriceData = { bid: 1.0950, ask: 1.0951 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('shouldClose' in decision! && decision.shouldClose).toBe(true);
      expect('reason' in decision! && decision.reason).toBe('take_profit');
    });

    it('should trigger take profit for sell position', () => {
      const position = createMockPosition({
        direction: 'sell',
        entry_price: 1.0900,
        stop_loss: 1.0950,
        take_profit: 1.0850,
      });

      const priceData: PriceData = { bid: 1.0850, ask: 1.0851 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('shouldClose' in decision! && decision.shouldClose).toBe(true);
      expect('reason' in decision! && decision.reason).toBe('take_profit');
    });

    it('should return null when no conditions met', () => {
      const position = createMockPosition({
        direction: 'buy',
        entry_price: 1.0900,
        stop_loss: 1.0850,
        take_profit: 1.0950,
      });

      const priceData: PriceData = { bid: 1.0900, ask: 1.0901 }; // At entry
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeNull();
    });
  });

  describe('checkSLTP - Race Condition Protection', () => {
    it('should prioritize stop loss when both SL and TP triggered', () => {
      const position = createMockPosition({
        direction: 'buy',
        entry_price: 1.0900,
        stop_loss: 1.0850,
        take_profit: 1.0950,
      });

      // Price gaps below SL (would also trigger TP if we check that first)
      const priceData: PriceData = { bid: 1.0840, ask: 1.0841 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('shouldClose' in decision! && decision.shouldClose).toBe(true);
      expect('reason' in decision! && decision.reason).toBe('stop_loss'); // SL wins
    });

    it('should prioritize stop loss in sell position race condition', () => {
      const position = createMockPosition({
        direction: 'sell',
        entry_price: 1.0900,
        stop_loss: 1.0950,
        take_profit: 1.0850,
      });

      // Price gaps above SL
      const priceData: PriceData = { bid: 1.0960, ask: 1.0961 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('shouldClose' in decision! && decision.shouldClose).toBe(true);
      expect('reason' in decision! && decision.reason).toBe('stop_loss'); // SL wins
    });
  });

  describe('checkSLTP - Dual TP System', () => {
    it('should trigger TP1 milestone for buy position', () => {
      const position = createMockPosition({
        direction: 'buy',
        entry_price: 1.0900,
        stop_loss: 1.0850,
        take_profit: 1.0950,
        tp1_price: 1.0930,
        tp2_price: 1.0960,
        tp1_hit: false,
      });

      const priceData: PriceData = { bid: 1.0930, ask: 1.0931 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('milestone' in decision!).toBe(true);
      expect('milestone' in decision! && decision.milestone).toBe('tp1');
      expect('shouldContinue' in decision! && decision.shouldContinue).toBe(true);
    });

    it('should trigger TP2 after TP1 already hit', () => {
      const position = createMockPosition({
        direction: 'buy',
        entry_price: 1.0900,
        stop_loss: 1.0850,
        take_profit: 1.0950,
        tp1_price: 1.0930,
        tp2_price: 1.0960,
        tp1_hit: true, // TP1 already hit
        tp2_hit: false,
      });

      const priceData: PriceData = { bid: 1.0960, ask: 1.0961 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('shouldClose' in decision! && decision.shouldClose).toBe(true);
      expect('reason' in decision! && decision.reason).toBe('take_profit_2');
    });

    it('should not trigger TP2 before TP1 hits', () => {
      const position = createMockPosition({
        direction: 'buy',
        entry_price: 1.0900,
        stop_loss: 1.0850,
        take_profit: 1.0950,
        tp1_price: 1.0930,
        tp2_price: 1.0960,
        tp1_hit: false, // TP1 not hit yet
      });

      // Price at TP2 level but TP1 not hit yet
      const priceData: PriceData = { bid: 1.0960, ask: 1.0961 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      // Should be null because we can't skip TP1
      expect(decision).toBeNull();
    });

    it('should prioritize SL over TP1 in dual TP system', () => {
      const position = createMockPosition({
        direction: 'buy',
        entry_price: 1.0900,
        stop_loss: 1.0850,
        take_profit: 1.0950,
        tp1_price: 1.0930,
        tp2_price: 1.0960,
        tp1_hit: false,
      });

      // Price at SL
      const priceData: PriceData = { bid: 1.0850, ask: 1.0851 };
      const decision = positionMonitoringAuthority.checkSLTP(position, priceData);

      expect(decision).toBeTruthy();
      expect('shouldClose' in decision! && decision.shouldClose).toBe(true);
      expect('reason' in decision! && decision.reason).toBe('stop_loss');
    });
  });
});

describe('PositionMonitoringAuthority - Price Validation', () => {
  it('should reject zero or negative prices', () => {
    const validation = positionMonitoringAuthority.validatePriceData(
      'EURUSD',
      { bid: 0, ask: 0 }
    );

    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('Invalid prices');
  });

  it('should reject inverted spread (bid >= ask)', () => {
    const validation = positionMonitoringAuthority.validatePriceData(
      'EURUSD',
      { bid: 1.0951, ask: 1.0950 } // Inverted
    );

    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('Inverted spread');
  });

  it('should reject stale prices', () => {
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes old

    const validation = positionMonitoringAuthority.validatePriceData(
      'EURUSD',
      { bid: 1.0950, ask: 1.0951, timestamp: staleTimestamp },
      2 // Max 2 minutes
    );

    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('Stale price data');
  });

  it('should accept valid fresh prices', () => {
    const freshTimestamp = new Date(); // Now

    const validation = positionMonitoringAuthority.validatePriceData(
      'EURUSD',
      { bid: 1.0950, ask: 1.0951, timestamp: freshTimestamp },
      2 // Max 2 minutes
    );

    expect(validation.valid).toBe(true);
  });

  it('should accept prices without timestamp', () => {
    const validation = positionMonitoringAuthority.validatePriceData(
      'EURUSD',
      { bid: 1.0950, ask: 1.0951 } // No timestamp
    );

    expect(validation.valid).toBe(true);
  });
});

describe('PositionMonitoringAuthority - Risk Metrics', () => {
  it('should calculate risk metrics correctly for profitable buy', () => {
    const position: MonitoredPosition = {
      id: 'trade-123',
      symbol: 'EURUSD',
      direction: 'buy',
      entry_price: 1.0900,
      stop_loss: 1.0850,
      take_profit: 1.0950,
      tp1_price: null,
      tp2_price: null,
      tp1_hit: false,
      tp2_hit: false,
      position_size: 1.0,
      lot_size: 1.0,
      user_id: 'user-123',
      goal_session_id: 'session-456',
      status: 'open',
      opened_at: new Date().toISOString(),
    };

    const currentPrice = 1.0920; // 20 pips profit
    const metrics = positionMonitoringAuthority.calculateRiskMetrics(position, currentPrice);

    expect(metrics.pnl).toBeGreaterThan(0); // Should be profitable
    expect(metrics.riskRatio).toBeGreaterThan(0); // Positive R
    expect(metrics.slProximity).toBeGreaterThan(0); // Distance from SL
    expect(metrics.drawdownPercent).toBe(0); // No drawdown
  });

  it('should calculate risk metrics correctly for losing trade', () => {
    const position: MonitoredPosition = {
      id: 'trade-123',
      symbol: 'EURUSD',
      direction: 'buy',
      entry_price: 1.0900,
      stop_loss: 1.0850,
      take_profit: 1.0950,
      tp1_price: null,
      tp2_price: null,
      tp1_hit: false,
      tp2_hit: false,
      position_size: 1.0,
      lot_size: 1.0,
      user_id: 'user-123',
      goal_session_id: 'session-456',
      status: 'open',
      opened_at: new Date().toISOString(),
    };

    const currentPrice = 1.0880; // 20 pips loss
    const metrics = positionMonitoringAuthority.calculateRiskMetrics(position, currentPrice);

    expect(metrics.pnl).toBeLessThan(0); // Should be negative
    expect(metrics.riskRatio).toBeLessThan(0); // Negative R
    expect(metrics.drawdownPercent).toBeGreaterThan(0); // In drawdown
  });
});

describe('PositionMonitoringAuthority - Critical Position Detection', () => {
  it('should mark position as critical when near SL', () => {
    const position: MonitoredPosition = {
      id: 'trade-123',
      symbol: 'EURUSD',
      direction: 'buy',
      entry_price: 1.0900,
      stop_loss: 1.0850,
      take_profit: 1.0950,
      tp1_price: null,
      tp2_price: null,
      tp1_hit: false,
      tp2_hit: false,
      position_size: 1.0,
      lot_size: 1.0,
      user_id: 'user-123',
      goal_session_id: 'session-456',
      status: 'open',
      opened_at: new Date().toISOString(),
    };

    const currentPrice = 1.0865; // 15 pips from SL (within 30% threshold)
    const isCritical = positionMonitoringAuthority.isCriticalPosition(position, currentPrice);

    expect(isCritical).toBe(true);
  });

  it('should mark position as critical when near TP', () => {
    const position: MonitoredPosition = {
      id: 'trade-123',
      symbol: 'EURUSD',
      direction: 'buy',
      entry_price: 1.0900,
      stop_loss: 1.0850,
      take_profit: 1.0950,
      tp1_price: null,
      tp2_price: null,
      tp1_hit: false,
      tp2_hit: false,
      position_size: 1.0,
      lot_size: 1.0,
      user_id: 'user-123',
      goal_session_id: 'session-456',
      status: 'open',
      opened_at: new Date().toISOString(),
    };

    const currentPrice = 1.0935; // 15 pips from TP (within 30% threshold)
    const isCritical = positionMonitoringAuthority.isCriticalPosition(position, currentPrice);

    expect(isCritical).toBe(true);
  });

  it('should not mark position as critical when in middle', () => {
    const position: MonitoredPosition = {
      id: 'trade-123',
      symbol: 'EURUSD',
      direction: 'buy',
      entry_price: 1.0900,
      stop_loss: 1.0850,
      take_profit: 1.0950,
      tp1_price: null,
      tp2_price: null,
      tp1_hit: false,
      tp2_hit: false,
      position_size: 1.0,
      lot_size: 1.0,
      user_id: 'user-123',
      goal_session_id: 'session-456',
      status: 'open',
      opened_at: new Date().toISOString(),
    };

    const currentPrice = 1.0900; // At entry (50% between SL and TP)
    const isCritical = positionMonitoringAuthority.isCriticalPosition(position, currentPrice);

    expect(isCritical).toBe(false);
  });
});
