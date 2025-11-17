/**
 * Countdown Notification System
 *
 * Manages 1-3 minute countdown before automatic trade execution.
 * Accounts for notification delay when calculating actual entry price.
 */

import { PIPNOSIS_CORE_RULES, PipnosisCoreRules } from '../lib/pipnosis-core-rules';
import { LLMTradeDecision } from './llm-strategy-brain';

export interface CountdownNotification {
  id: string;
  symbol: string;
  action: 'enter_long' | 'enter_short';
  originalDecision: LLMTradeDecision;
  countdownSeconds: number;
  startTime: Date;
  executionTime: Date;
  status: 'active' | 'cancelled' | 'executed' | 'expired';
  userId: string;
  sessionId: string;
}

export interface ExecutionAdjustment {
  originalEntry: number;
  adjustedEntry: number;
  originalStop: number;
  adjustedStop: number;
  originalTarget: number;
  adjustedTarget: number;
  slippageEstimate: number;
  adjustmentReason: string;
}

class CountdownNotificationSystem {
  private activeCountdowns: Map<string, CountdownNotification> = new Map();
  private countdownCallbacks: Map<string, {
    onTick: (remaining: number) => void;
    onComplete: () => void;
    onCancel: () => void;
  }> = new Map();

  createCountdown(
    userId: string,
    sessionId: string,
    symbol: string,
    decision: LLMTradeDecision,
    timeframe: string,
    volatility: 'low' | 'medium' | 'high'
  ): CountdownNotification {
    const countdownSeconds = PipnosisCoreRules.calculateCountdownDuration(timeframe, volatility);
    const id = `${sessionId}-${Date.now()}`;
    const startTime = new Date();
    const executionTime = new Date(startTime.getTime() + countdownSeconds * 1000);

    const notification: CountdownNotification = {
      id,
      symbol,
      action: decision.action as 'enter_long' | 'enter_short',
      originalDecision: decision,
      countdownSeconds,
      startTime,
      executionTime,
      status: 'active',
      userId,
      sessionId
    };

    this.activeCountdowns.set(id, notification);
    this.startCountdownTimer(id);

    console.log(`[Countdown] Created ${countdownSeconds}s countdown for ${symbol} ${decision.action}`);

    return notification;
  }

  private startCountdownTimer(id: string): void {
    const notification = this.activeCountdowns.get(id);
    if (!notification) return;

    const interval = setInterval(() => {
      const now = new Date();
      const elapsed = (now.getTime() - notification.startTime.getTime()) / 1000;
      const remaining = Math.max(0, notification.countdownSeconds - elapsed);

      const callbacks = this.countdownCallbacks.get(id);
      if (callbacks) {
        callbacks.onTick(Math.ceil(remaining));
      }

      if (remaining <= 0) {
        clearInterval(interval);
        if (notification.status === 'active') {
          notification.status = 'executed';
          const callbacks = this.countdownCallbacks.get(id);
          if (callbacks) {
            callbacks.onComplete();
          }
          console.log(`[Countdown] Timer expired for ${id}, executing trade`);
        }
      }
    }, 1000);
  }

  registerCallbacks(
    id: string,
    callbacks: {
      onTick: (remaining: number) => void;
      onComplete: () => void;
      onCancel: () => void;
    }
  ): void {
    this.countdownCallbacks.set(id, callbacks);
  }

  cancelCountdown(id: string): boolean {
    const notification = this.activeCountdowns.get(id);
    if (!notification || notification.status !== 'active') {
      return false;
    }

    notification.status = 'cancelled';
    const callbacks = this.countdownCallbacks.get(id);
    if (callbacks) {
      callbacks.onCancel();
    }

    console.log(`[Countdown] Cancelled countdown ${id}`);
    return true;
  }

  calculateExecutionAdjustment(
    notification: CountdownNotification,
    currentPrice: number,
    atr: number
  ): ExecutionAdjustment {
    const decision = notification.originalDecision;
    const delaySeconds = notification.countdownSeconds;

    const isLong = notification.action === 'enter_long';
    const originalEntry = decision.entryZone?.ideal || currentPrice;

    const priceMovementEstimate = (atr * 0.3) * (delaySeconds / 60);

    const direction = isLong ? 1 : -1;
    const slippageEstimate = priceMovementEstimate * (Math.random() * 0.5 + 0.75);

    const adjustedEntry = originalEntry + (slippageEstimate * direction * 0.5);

    const stopDistance = Math.abs(originalEntry - (decision.stopLoss || 0));
    const adjustedStop = adjustedEntry - (stopDistance * direction);

    const targetDistance = Math.abs((decision.takeProfit || 0) - originalEntry);
    const adjustedTarget = adjustedEntry + (targetDistance * direction);

    const adjustment: ExecutionAdjustment = {
      originalEntry,
      adjustedEntry,
      originalStop: decision.stopLoss || 0,
      adjustedStop,
      originalTarget: decision.takeProfit || 0,
      adjustedTarget,
      slippageEstimate,
      adjustmentReason: `Adjusted for ${delaySeconds}s notification delay. Estimated ${(slippageEstimate * 10000).toFixed(1)} pips movement during countdown.`
    };

    console.log(`[Countdown] Execution adjustment: Entry ${originalEntry.toFixed(5)} → ${adjustedEntry.toFixed(5)}`);

    return adjustment;
  }

  shouldStillExecute(
    notification: CountdownNotification,
    currentPrice: number,
    currentSnapshot: any
  ): { shouldExecute: boolean; reason: string } {
    if (notification.status !== 'active') {
      return {
        shouldExecute: false,
        reason: 'Countdown no longer active'
      };
    }

    const decision = notification.originalDecision;
    const isLong = notification.action === 'enter_long';

    if (!decision.entryZone) {
      return {
        shouldExecute: false,
        reason: 'No entry zone defined'
      };
    }

    const { min, max } = decision.entryZone;

    if (currentPrice < min || currentPrice > max) {
      return {
        shouldExecute: false,
        reason: `Price ${currentPrice.toFixed(5)} moved outside entry zone [${min.toFixed(5)}, ${max.toFixed(5)}]`
      };
    }

    if (currentSnapshot) {
      const trend = currentSnapshot.timeframes?.M15?.trend;
      const expectedTrend = isLong ? 'bullish' : 'bearish';

      if (trend && trend !== expectedTrend && trend !== 'sideways') {
        return {
          shouldExecute: false,
          reason: `Market trend changed to ${trend} during countdown`
        };
      }

      const rsi = currentSnapshot.timeframes?.M15?.rsi;
      if (rsi) {
        if (isLong && rsi > 75) {
          return {
            shouldExecute: false,
            reason: 'RSI became overbought during countdown'
          };
        }
        if (!isLong && rsi < 25) {
          return {
            shouldExecute: false,
            reason: 'RSI became oversold during countdown'
          };
        }
      }
    }

    return {
      shouldExecute: true,
      reason: 'Market conditions remain favorable'
    };
  }

  getActiveCountdowns(userId?: string, sessionId?: string): CountdownNotification[] {
    const all = Array.from(this.activeCountdowns.values()).filter(n => n.status === 'active');

    if (userId && sessionId) {
      return all.filter(n => n.userId === userId && n.sessionId === sessionId);
    }
    if (userId) {
      return all.filter(n => n.userId === userId);
    }
    if (sessionId) {
      return all.filter(n => n.sessionId === sessionId);
    }

    return all;
  }

  getCountdown(id: string): CountdownNotification | null {
    return this.activeCountdowns.get(id) || null;
  }

  cleanupExpiredCountdowns(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [id, notification] of this.activeCountdowns.entries()) {
      if (notification.status !== 'active') {
        const ageMinutes = (now.getTime() - notification.executionTime.getTime()) / 60000;
        if (ageMinutes > 5) {
          this.activeCountdowns.delete(id);
          this.countdownCallbacks.delete(id);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[Countdown] Cleaned up ${cleaned} expired countdowns`);
    }

    return cleaned;
  }

  getStats(): {
    total: number;
    active: number;
    executed: number;
    cancelled: number;
  } {
    const all = Array.from(this.activeCountdowns.values());

    return {
      total: all.length,
      active: all.filter(n => n.status === 'active').length,
      executed: all.filter(n => n.status === 'executed').length,
      cancelled: all.filter(n => n.status === 'cancelled').length
    };
  }
}

export const countdownNotificationSystem = new CountdownNotificationSystem();
