/**
 * Display Formatters Tests
 *
 * Comprehensive tests to ensure consistent financial data formatting
 * across all display contexts and edge cases.
 */

import {
  formatAccountBalance,
  formatProfitLoss,
  formatPositionPrice,
  formatLotSize,
  formatRiskReward,
  formatPercentage,
  formatPipDistance,
  formatDuration,
  formatTimestamp,
  formatDirection,
  formatCloseReason,
  formatTradeNotification,
  formatTradeEntry,
  formatGoalProgress,
  formatPositionSummary,
  format
} from '../utils/displayFormatters';

describe('Display Formatters', () => {
  describe('formatAccountBalance', () => {
    it('should format balance correctly for desktop', () => {
      expect(formatAccountBalance(10000, 'desktop')).toBe('$10000.00');
      expect(formatAccountBalance(10234.56, 'desktop')).toBe('$10234.56');
      expect(formatAccountBalance(0, 'desktop')).toBe('$0.00');
    });

    it('should format balance correctly for mobile', () => {
      expect(formatAccountBalance(10234.56, 'mobile')).toBe('$10235');
      expect(formatAccountBalance(9999.99, 'mobile')).toBe('$10000');
      expect(formatAccountBalance(100.49, 'mobile')).toBe('$100');
    });

    it('should format balance correctly for notifications', () => {
      expect(formatAccountBalance(150000, 'notification')).toBe('$150.0k');
      expect(formatAccountBalance(99999, 'notification')).toBe('$99999.00');
      expect(formatAccountBalance(1000, 'notification')).toBe('$1000.00');
    });

    it('should handle edge cases', () => {
      expect(formatAccountBalance(0, 'desktop')).toBe('$0.00');
      expect(formatAccountBalance(-100, 'desktop')).toBe('$-100.00');
      expect(formatAccountBalance(null as any, 'desktop')).toBe('$0.00');
      expect(formatAccountBalance(undefined as any, 'desktop')).toBe('$0.00');
      expect(formatAccountBalance(NaN, 'desktop')).toBe('$0.00');
    });
  });

  describe('formatProfitLoss', () => {
    it('should format positive PnL correctly', () => {
      expect(formatProfitLoss(15.50, 'desktop')).toBe('+$15.50');
      expect(formatProfitLoss(100, 'desktop')).toBe('+$100.00');
      expect(formatProfitLoss(0.01, 'desktop')).toBe('+$0.01');
    });

    it('should format negative PnL correctly', () => {
      expect(formatProfitLoss(-15.50, 'desktop')).toBe('-$15.50');
      expect(formatProfitLoss(-100, 'desktop')).toBe('-$100.00');
      expect(formatProfitLoss(-0.01, 'desktop')).toBe('-$0.01');
    });

    it('should format zero correctly', () => {
      expect(formatProfitLoss(0, 'desktop')).toBe('+$0.00');
    });

    it('should format for mobile context', () => {
      expect(formatProfitLoss(15.99, 'mobile')).toBe('+$16');
      expect(formatProfitLoss(-15.99, 'mobile')).toBe('-$16');
    });

    it('should handle edge cases', () => {
      expect(formatProfitLoss(null as any, 'desktop')).toBe('$0.00');
      expect(formatProfitLoss(undefined as any, 'desktop')).toBe('$0.00');
      expect(formatProfitLoss(NaN, 'desktop')).toBe('$0.00');
    });
  });

  describe('formatPositionPrice', () => {
    it('should format standard forex pair correctly', () => {
      expect(formatPositionPrice(1.08456, 'EURUSD', 'desktop')).toBe('1.08456');
      expect(formatPositionPrice(0.65432, 'AUDUSD', 'desktop')).toBe('0.65432');
    });

    it('should format JPY pair correctly', () => {
      expect(formatPositionPrice(149.234, 'USDJPY', 'desktop')).toBe('149.23');
      expect(formatPositionPrice(160.567, 'EURJPY', 'desktop')).toBe('160.57');
    });

    it('should format gold correctly', () => {
      expect(formatPositionPrice(2045.67, 'XAUUSD', 'desktop')).toBe('2045.67');
      expect(formatPositionPrice(2000, 'GOLD', 'desktop')).toBe('2000.00');
    });

    it('should handle null prices', () => {
      expect(formatPositionPrice(null, 'EURUSD', 'desktop')).toBe('N/A');
      expect(formatPositionPrice(undefined as any, 'EURUSD', 'desktop')).toBe('N/A');
    });
  });

  describe('formatLotSize', () => {
    it('should format lot sizes with 2 decimals', () => {
      expect(formatLotSize(0.01, 'desktop')).toBe('0.01');
      expect(formatLotSize(0.15, 'desktop')).toBe('0.15');
      expect(formatLotSize(1.0, 'desktop')).toBe('1.00');
      expect(formatLotSize(2.5, 'desktop')).toBe('2.50');
    });

    it('should round properly', () => {
      expect(formatLotSize(0.666666, 'desktop')).toBe('0.67');
      expect(formatLotSize(0.333333, 'desktop')).toBe('0.33');
    });

    it('should handle edge cases', () => {
      expect(formatLotSize(0, 'desktop')).toBe('0.00');
      expect(formatLotSize(null as any, 'desktop')).toBe('0.00');
      expect(formatLotSize(undefined as any, 'desktop')).toBe('0.00');
    });
  });

  describe('formatRiskReward', () => {
    it('should format R:R correctly for desktop', () => {
      expect(formatRiskReward(2.50, 'desktop')).toBe('1:2.50');
      expect(formatRiskReward(1.85, 'desktop')).toBe('1:1.85');
      expect(formatRiskReward(3.0, 'desktop')).toBe('1:3.00');
    });

    it('should format R:R correctly for mobile', () => {
      expect(formatRiskReward(2.567, 'mobile')).toBe('1:2.6');
      expect(formatRiskReward(1.234, 'mobile')).toBe('1:1.2');
    });

    it('should handle edge cases', () => {
      expect(formatRiskReward(0, 'desktop')).toBe('1:0.00');
      expect(formatRiskReward(null as any, 'desktop')).toBe('1:0.00');
    });
  });

  describe('formatPercentage', () => {
    it('should format percentages correctly', () => {
      expect(formatPercentage(75.5, 1, 'desktop')).toBe('75.5%');
      expect(formatPercentage(12.34, 2, 'desktop')).toBe('12.34%');
      expect(formatPercentage(100, 0, 'desktop')).toBe('100%');
    });

    it('should format for mobile context', () => {
      expect(formatPercentage(75.567, 1, 'mobile')).toBe('76%');
    });

    it('should handle edge cases', () => {
      expect(formatPercentage(0, 1, 'desktop')).toBe('0.0%');
      expect(formatPercentage(null as any, 1, 'desktop')).toBe('0.0%');
    });
  });

  describe('formatPipDistance', () => {
    it('should format pip distances correctly', () => {
      expect(formatPipDistance(25.5, 'desktop')).toBe('25.5 pips');
      expect(formatPipDistance(150.0, 'desktop')).toBe('150.0 pips');
    });

    it('should format for mobile context', () => {
      expect(formatPipDistance(25.789, 'mobile')).toBe('26 pips');
    });
  });

  describe('formatDuration', () => {
    const startTime = new Date('2024-01-01T10:00:00Z');

    it('should format minutes correctly', () => {
      const endTime = new Date('2024-01-01T10:45:00Z');
      expect(formatDuration(startTime, endTime, 'desktop')).toBe('45m');
    });

    it('should format hours and minutes correctly', () => {
      const endTime = new Date('2024-01-01T12:15:00Z');
      expect(formatDuration(startTime, endTime, 'desktop')).toBe('2h 15m');
    });

    it('should format days correctly', () => {
      const endTime = new Date('2024-01-02T14:30:00Z');
      expect(formatDuration(startTime, endTime, 'desktop')).toBe('1d 4h');
    });
  });

  describe('formatDirection', () => {
    it('should format directions correctly', () => {
      expect(formatDirection('buy', 'desktop')).toBe('BUY');
      expect(formatDirection('sell', 'desktop')).toBe('SELL');
    });
  });

  describe('formatCloseReason', () => {
    it('should format close reasons correctly', () => {
      expect(formatCloseReason('manual', 'desktop')).toBe('Manual');
      expect(formatCloseReason('stop_loss', 'desktop')).toBe('Stop Loss');
      expect(formatCloseReason('take_profit', 'desktop')).toBe('Take Profit');
      expect(formatCloseReason('goal_achieved', 'desktop')).toBe('Goal Achieved');
      expect(formatCloseReason('session_ended', 'desktop')).toBe('Session Ended');
    });

    it('should handle null reasons', () => {
      expect(formatCloseReason(null, 'desktop')).toBe('Manual');
    });
  });

  describe('formatTradeNotification', () => {
    it('should format trade notifications correctly', () => {
      const result = formatTradeNotification({
        symbol: 'EURUSD',
        direction: 'buy',
        pnl: 15.50,
        closeReason: 'take_profit'
      });
      expect(result).toBe('EURUSD BUY +$15.50 (Take Profit)');
    });

    it('should format without close reason', () => {
      const result = formatTradeNotification({
        symbol: 'EURUSD',
        direction: 'sell',
        pnl: -10.25
      });
      expect(result).toBe('EURUSD SELL -$10.25');
    });
  });

  describe('formatTradeEntry', () => {
    it('should format trade entry messages correctly', () => {
      const result = formatTradeEntry({
        symbol: 'EURUSD',
        direction: 'buy',
        entryPrice: 1.08456,
        lotSize: 0.15,
        stopLoss: 1.08356,
        takeProfit: 1.08656
      });
      expect(result).toContain('Entered BUY EURUSD at 1.08456');
      expect(result).toContain('0.15 lots');
      expect(result).toContain('SL: 1.08356');
      expect(result).toContain('TP: 1.08656');
    });
  });

  describe('formatGoalProgress', () => {
    it('should format goal progress correctly', () => {
      const result = formatGoalProgress(45.50, 200.00, 'desktop');
      expect(result).toContain('$45.50');
      expect(result).toContain('$200.00');
      expect(result).toContain('22.8%');
    });
  });

  describe('formatPositionSummary', () => {
    it('should format complete position summary', () => {
      const result = formatPositionSummary({
        symbol: 'EURUSD',
        direction: 'buy',
        lotSize: 0.15,
        entryPrice: 1.08456,
        currentPrice: 1.08556,
        stopLoss: 1.08356,
        takeProfit: 1.08656,
        currentPnl: 15.00
      });

      expect(result.header).toBe('EURUSD BUY 0.15 lots');
      expect(result.entry).toBe('1.08456');
      expect(result.current).toBe('1.08556');
      expect(result.stopLoss).toBe('1.08356');
      expect(result.takeProfit).toBe('1.08656');
      expect(result.pnl).toBe('+$15.00');
    });
  });

  describe('format shorthand', () => {
    it('should provide shorthand access to formatters', () => {
      expect(format.balance(1000, 'desktop')).toBe('$1000.00');
      expect(format.pnl(15, 'desktop')).toBe('+$15.00');
      expect(format.lots(0.15, 'desktop')).toBe('0.15');
      expect(format.rr(2.5, 'desktop')).toBe('1:2.50');
      expect(format.percent(75, 1, 'desktop')).toBe('75.0%');
      expect(format.pips(25, 'desktop')).toBe('25.0 pips');
      expect(format.direction('buy', 'desktop')).toBe('BUY');
    });
  });

  describe('context-specific formatting', () => {
    it('should apply mobile formatting consistently', () => {
      expect(formatAccountBalance(10234.56, 'mobile')).toBe('$10235');
      expect(formatProfitLoss(15.99, 'mobile')).toBe('+$16');
      expect(formatRiskReward(2.567, 'mobile')).toBe('1:2.6');
      expect(formatPercentage(75.567, 1, 'mobile')).toBe('76%');
    });

    it('should apply desktop formatting consistently', () => {
      expect(formatAccountBalance(10234.56, 'desktop')).toBe('$10234.56');
      expect(formatProfitLoss(15.99, 'desktop')).toBe('+$15.99');
      expect(formatRiskReward(2.567, 'desktop')).toBe('1:2.57');
      expect(formatPercentage(75.567, 1, 'desktop')).toBe('75.6%');
    });

    it('should apply notification formatting consistently', () => {
      expect(formatAccountBalance(150000, 'notification')).toBe('$150.0k');
      expect(formatProfitLoss(15.50, 'notification')).toBe('+$15.50');
    });
  });

  describe('floating point precision', () => {
    it('should handle floating point issues correctly', () => {
      expect(formatProfitLoss(0.1 + 0.2, 'desktop')).toBe('+$0.30');
      expect(formatProfitLoss(1.005, 'desktop')).toBe('+$1.01');
      expect(formatProfitLoss(1.004, 'desktop')).toBe('+$1.00');
    });
  });
});
