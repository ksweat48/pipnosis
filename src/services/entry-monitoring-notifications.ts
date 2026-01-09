/**
 * Entry Monitoring Notifications Service
 *
 * SSOT for all entry monitoring notifications.
 * Sends notifications when:
 * - Entry monitoring starts (user sees trade found)
 * - EQS improves across thresholds (progress updates)
 * - EQS reaches execution threshold (ready to execute)
 * - Entry monitoring is abandoned (timeout/invalidated)
 */

import { supabase } from '../lib/supabase';
import { notificationManager } from './notification-manager';
import { pushNotificationDispatcher } from './push-notification-dispatcher';
import type { TradeStyle } from './entry-monitor-quality-scorer';

interface MonitoringStartedParams {
  userId: string;
  sessionId: string;
  intentId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryZoneMin: number;
  entryZoneMax: number;
  stopLoss: number;
  takeProfit: number;
  currentEQS: number;
  requiredEQS: number;
  currentGrade: string;
  requiredGrade: string;
  confidence: number;
  style: TradeStyle;
  maxWaitSeconds: number;
  reasoning?: string;
}

interface EQSProgressParams {
  userId: string;
  sessionId: string;
  intentId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  oldEQS: number;
  newEQS: number;
  oldGrade: string;
  newGrade: string;
  requiredEQS: number;
  requiredGrade: string;
  currentPrice: number;
  inEntryZone: boolean;
}

interface EQSReadyParams {
  userId: string;
  sessionId: string;
  intentId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  eqs: number;
  grade: string;
  requiredEQS: number;
  executionPrice: number;
}

interface MonitoringAbandonedParams {
  userId: string;
  sessionId: string;
  intentId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  reason: string;
  eqs: number;
  grade: string;
  requiredEQS: number;
  durationSeconds: number;
}

class EntryMonitoringNotifications {
  /**
   * Send notification when entry monitoring starts
   * PRIMARY function to fix user's visibility gap
   */
  async sendMonitoringStarted(params: MonitoringStartedParams): Promise<void> {
    const {
      userId,
      sessionId,
      intentId,
      symbol,
      direction,
      entryZoneMin,
      entryZoneMax,
      stopLoss,
      takeProfit,
      currentEQS,
      requiredEQS,
      currentGrade,
      requiredGrade,
      confidence,
      style,
      maxWaitSeconds,
      reasoning
    } = params;

    const title = `🎯 Entry Monitor Active - ${symbol} ${direction}`;
    const message = this.formatMonitoringStartedMessage(params);

    const metadata = {
      intent_id: intentId,
      symbol,
      direction,
      entry_zone: { min: entryZoneMin, max: entryZoneMax },
      stop_loss: stopLoss,
      take_profit: takeProfit,
      current_eqs: currentEQS,
      required_eqs: requiredEQS,
      current_grade: currentGrade,
      required_grade: requiredGrade,
      confidence,
      style,
      max_wait_seconds: maxWaitSeconds,
      reasoning
    };

    try {
      const { data, error } = await supabase
        .from('goal_notifications')
        .insert({
          user_id: userId,
          goal_session_id: sessionId,
          type: 'entry_monitoring_started',
          title,
          message,
          priority: 'high',
          metadata,
          viewed: false
        })
        .select('id')
        .single();

      if (error) {
        console.error('[Entry Monitor Notif] Failed to save monitoring started:', error);
        return;
      }

      console.log('[Entry Monitor Notif] Monitoring started notification saved:', data.id);

      notificationManager.notify({
        title,
        body: message,
        icon: 'target',
        type: 'trade',
        priority: 'high'
      });

      await pushNotificationDispatcher.sendTradeSignal({
        userId,
        notificationId: data.id,
        symbol,
        direction: direction.toLowerCase() as 'buy' | 'sell',
        setupType: `${style} Entry Monitor`,
        confidence,
        entryPrice: (entryZoneMin + entryZoneMax) / 2,
        stopLoss,
        takeProfit
      });

    } catch (error) {
      console.error('[Entry Monitor Notif] Error sending monitoring started:', error);
    }
  }

  /**
   * Send notification when EQS improves across meaningful thresholds
   */
  async sendEQSProgress(params: EQSProgressParams): Promise<void> {
    const {
      userId,
      sessionId,
      intentId,
      symbol,
      direction,
      oldEQS,
      newEQS,
      oldGrade,
      newGrade,
      requiredEQS,
      requiredGrade,
      currentPrice,
      inEntryZone
    } = params;

    if (newGrade === oldGrade) {
      return;
    }

    const title = `📈 Entry Quality Improving - ${symbol}`;
    const message = this.formatEQSProgressMessage(params);

    const metadata = {
      intent_id: intentId,
      symbol,
      direction,
      old_eqs: oldEQS,
      new_eqs: newEQS,
      old_grade: oldGrade,
      new_grade: newGrade,
      required_eqs: requiredEQS,
      required_grade: requiredGrade,
      current_price: currentPrice,
      in_entry_zone: inEntryZone
    };

    try {
      await supabase
        .from('goal_notifications')
        .insert({
          user_id: userId,
          goal_session_id: sessionId,
          type: 'entry_quality_improving',
          title,
          message,
          priority: newGrade === requiredGrade ? 'high' : 'medium',
          metadata,
          viewed: false
        });

      console.log(`[Entry Monitor Notif] EQS progress: ${oldGrade} → ${newGrade} (${newEQS}/100)`);

      if (newGrade === requiredGrade || newEQS >= requiredEQS - 5) {
        notificationManager.notify({
          title,
          body: message,
          icon: 'trending-up',
          type: 'info',
          priority: 'medium'
        });
      }

    } catch (error) {
      console.error('[Entry Monitor Notif] Error sending EQS progress:', error);
    }
  }

  /**
   * Send notification when EQS reaches execution threshold
   */
  async sendEQSReady(params: EQSReadyParams): Promise<void> {
    const {
      userId,
      sessionId,
      intentId,
      symbol,
      direction,
      eqs,
      grade,
      requiredEQS,
      executionPrice
    } = params;

    const title = `✅ Entry Quality Ready - ${symbol} ${direction}`;
    const message = this.formatEQSReadyMessage(params);

    const metadata = {
      intent_id: intentId,
      symbol,
      direction,
      eqs,
      grade,
      required_eqs: requiredEQS,
      execution_price: executionPrice
    };

    try {
      const { data, error } = await supabase
        .from('goal_notifications')
        .insert({
          user_id: userId,
          goal_session_id: sessionId,
          type: 'entry_quality_ready',
          title,
          message,
          priority: 'urgent',
          metadata,
          viewed: false
        })
        .select('id')
        .single();

      if (error) {
        console.error('[Entry Monitor Notif] Failed to save EQS ready:', error);
        return;
      }

      console.log('[Entry Monitor Notif] EQS ready notification saved:', data.id);

      notificationManager.notify({
        title,
        body: message,
        icon: 'check-circle',
        type: 'success',
        priority: 'high'
      });

    } catch (error) {
      console.error('[Entry Monitor Notif] Error sending EQS ready:', error);
    }
  }

  /**
   * Send notification when entry monitoring is abandoned
   */
  async sendMonitoringAbandoned(params: MonitoringAbandonedParams): Promise<void> {
    const {
      userId,
      sessionId,
      intentId,
      symbol,
      direction,
      reason,
      eqs,
      grade,
      requiredEQS,
      durationSeconds
    } = params;

    const title = `⏸️ Entry Monitor Stopped - ${symbol}`;
    const message = this.formatMonitoringAbandonedMessage(params);

    const metadata = {
      intent_id: intentId,
      symbol,
      direction,
      reason,
      final_eqs: eqs,
      final_grade: grade,
      required_eqs: requiredEQS,
      duration_seconds: durationSeconds
    };

    try {
      await supabase
        .from('goal_notifications')
        .insert({
          user_id: userId,
          goal_session_id: sessionId,
          type: 'entry_abandoned',
          title,
          message,
          priority: 'medium',
          metadata,
          viewed: false
        });

      console.log(`[Entry Monitor Notif] Monitoring abandoned: ${symbol} (${reason})`);

      notificationManager.notify({
        title,
        body: message,
        icon: 'pause-circle',
        type: 'warning',
        priority: 'low'
      });

    } catch (error) {
      console.error('[Entry Monitor Notif] Error sending monitoring abandoned:', error);
    }
  }

  private formatMonitoringStartedMessage(params: MonitoringStartedParams): string {
    const {
      symbol,
      direction,
      entryZoneMin,
      entryZoneMax,
      currentEQS,
      requiredEQS,
      currentGrade,
      requiredGrade,
      confidence,
      maxWaitSeconds
    } = params;

    const timeoutMinutes = Math.round(maxWaitSeconds / 60);
    const gapToThreshold = requiredEQS - currentEQS;

    return `${symbol} ${direction} setup detected (${confidence}% confidence)\n\n` +
      `📊 Entry Quality: ${currentGrade} (${currentEQS}/100)\n` +
      `🎯 Need: ${requiredGrade} (${requiredEQS}/100) — ${gapToThreshold} points away\n` +
      `💰 Entry Zone: ${entryZoneMin.toFixed(5)} - ${entryZoneMax.toFixed(5)}\n` +
      `⏱️ Max Wait: ${timeoutMinutes}m\n\n` +
      `Monitoring for optimal entry... (Zero-LLM execution mode)`;
  }

  private formatEQSProgressMessage(params: EQSProgressParams): string {
    const {
      symbol,
      oldEQS,
      newEQS,
      oldGrade,
      newGrade,
      requiredEQS,
      requiredGrade,
      inEntryZone
    } = params;

    const improvement = newEQS - oldEQS;
    const gapToThreshold = requiredEQS - newEQS;

    return `${symbol} entry conditions improving\n\n` +
      `Grade: ${oldGrade} → ${newGrade} (+${improvement} points)\n` +
      `Current: ${newEQS}/100\n` +
      `Target: ${requiredGrade} (${requiredEQS}/100)\n` +
      `${gapToThreshold > 0 ? `Gap: ${gapToThreshold} points remaining` : '✅ Threshold reached!'}\n` +
      `${inEntryZone ? '✅ Price in entry zone' : '⏳ Waiting for price'}`;
  }

  private formatEQSReadyMessage(params: EQSReadyParams): string {
    const {
      symbol,
      direction,
      eqs,
      grade,
      executionPrice
    } = params;

    return `${symbol} ${direction} entry conditions optimal!\n\n` +
      `✅ Grade ${grade} (${eqs}/100)\n` +
      `💰 Executing at ${executionPrice.toFixed(5)}\n\n` +
      `Trade will appear in Positions tab shortly...`;
  }

  private formatMonitoringAbandonedMessage(params: MonitoringAbandonedParams): string {
    const {
      symbol,
      reason,
      eqs,
      grade,
      requiredEQS,
      durationSeconds
    } = params;

    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return `${symbol} entry monitoring stopped after ${timeStr}\n\n` +
      `Reason: ${reason}\n` +
      `Final Quality: ${grade} (${eqs}/100)\n` +
      `Required: ${requiredEQS}/100\n\n` +
      `Returning to discovery scanning...`;
  }
}

export const entryMonitoringNotifications = new EntryMonitoringNotifications();
