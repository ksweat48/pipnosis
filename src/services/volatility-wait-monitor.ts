/**
 * Volatility Wait Monitor
 *
 * SSOT Authority: Monitor and resolve volatility wait intents
 *
 * Responsibilities:
 * - Check waiting intents every 15 minutes
 * - Resolve when target volatility reached
 * - Expire intents after max wait time
 * - Create entry intent when conditions met
 *
 * Does NOT:
 * - Make entry qualification decisions (EQE responsibility)
 * - Perform economic validation (EEG responsibility)
 * - Execute trades directly (execution coordinator responsibility)
 */

import { supabase } from '../lib/supabase';
import { productionLogger } from '../lib/production-logger';
import { m5MicrostructureProvider } from './m5-microstructure-provider';
import { EntryExecutionCoordinator } from './entry-execution-coordinator';
import type { VolatilityWaitIntent } from '../types/entry';

export class VolatilityWaitMonitor {
  private checkIntervalMs = 15 * 60 * 1000; // 15 minutes
  private intervalId: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.intervalId) {
      productionLogger.warn('[Volatility Wait Monitor] Already running');
      return;
    }

    productionLogger.info('[Volatility Wait Monitor] Starting...');

    await this.checkWaitingIntents();

    this.intervalId = setInterval(async () => {
      await this.checkWaitingIntents();
    }, this.checkIntervalMs);

    productionLogger.info('[Volatility Wait Monitor] Started successfully');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      productionLogger.info('[Volatility Wait Monitor] Stopped');
    }
  }

  private async checkWaitingIntents(): Promise<void> {
    try {
      const { data: waitingIntents, error } = await supabase
        .from('volatility_wait_intents')
        .select('*')
        .eq('status', 'waiting');

      if (error) {
        productionLogger.error('[Volatility Wait Monitor] Failed to fetch waiting intents', {
          error: error.message
        });
        return;
      }

      if (!waitingIntents || waitingIntents.length === 0) {
        return;
      }

      productionLogger.info('[Volatility Wait Monitor] Checking intents', {
        count: waitingIntents.length
      });

      for (const intent of waitingIntents) {
        await this.checkIntent(intent as VolatilityWaitIntent);
      }
    } catch (error) {
      productionLogger.error('[Volatility Wait Monitor] Error in check cycle', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async checkIntent(intent: VolatilityWaitIntent): Promise<void> {
    try {
      const createdAt = new Date(intent.created_at);
      const now = new Date();
      const hoursWaited = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

      if (hoursWaited >= intent.max_wait_hours) {
        await this.expireIntent(intent);
        return;
      }

      const m5Data = await m5MicrostructureProvider.getMicrostructure(intent.symbol);

      if (!m5Data) {
        productionLogger.warn('[Volatility Wait Monitor] No M5 data available', {
          intentId: intent.id,
          symbol: intent.symbol
        });
        return;
      }

      const currentATR = m5Data.atr;
      const targetATR = intent.target_atr;

      if (currentATR >= targetATR) {
        await this.resolveIntent(intent, currentATR);
      } else {
        productionLogger.info('[Volatility Wait Monitor] Still waiting for volatility', {
          intentId: intent.id,
          symbol: intent.symbol,
          currentATR: currentATR.toFixed(5),
          targetATR: targetATR.toFixed(5),
          progress: ((currentATR / targetATR) * 100).toFixed(1) + '%'
        });
      }
    } catch (error) {
      productionLogger.error('[Volatility Wait Monitor] Error checking intent', {
        intentId: intent.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async resolveIntent(intent: VolatilityWaitIntent, currentATR: number): Promise<void> {
    productionLogger.info('[Volatility Wait Monitor] Volatility conditions met', {
      intentId: intent.id,
      symbol: intent.symbol,
      currentATR: currentATR.toFixed(5),
      targetATR: intent.target_atr.toFixed(5)
    });

    const { error: updateError } = await supabase
      .from('volatility_wait_intents')
      .update({
        status: 'conditions_met',
        resolved_at: new Date().toISOString(),
        current_atr: currentATR
      })
      .eq('id', intent.id);

    if (updateError) {
      productionLogger.error('[Volatility Wait Monitor] Failed to update intent status', {
        intentId: intent.id,
        error: updateError.message
      });
      return;
    }

    await this.incrementMetric(intent.user_id, 'volatility_waits_conditions_met');

    await supabase.from('goal_notifications').insert({
      user_id: intent.user_id,
      session_id: intent.session_id,
      type: 'volatility_conditions_met',
      title: 'Volatility Conditions Met',
      message: `${intent.symbol} volatility increased to ${currentATR.toFixed(5)} (target: ${intent.target_atr.toFixed(5)}). Trade is now eligible for entry.`,
      metadata: {
        intent_id: intent.id,
        symbol: intent.symbol,
        current_atr: currentATR,
        target_atr: intent.target_atr
      }
    });

    productionLogger.info('[Volatility Wait Monitor] Intent resolved successfully', {
      intentId: intent.id
    });
  }

  private async expireIntent(intent: VolatilityWaitIntent): Promise<void> {
    productionLogger.info('[Volatility Wait Monitor] Expiring intent (max wait time reached)', {
      intentId: intent.id,
      symbol: intent.symbol,
      maxWaitHours: intent.max_wait_hours
    });

    const { error } = await supabase
      .from('volatility_wait_intents')
      .update({
        status: 'expired',
        resolved_at: new Date().toISOString()
      })
      .eq('id', intent.id);

    if (error) {
      productionLogger.error('[Volatility Wait Monitor] Failed to expire intent', {
        intentId: intent.id,
        error: error.message
      });
      return;
    }

    await this.incrementMetric(intent.user_id, 'volatility_waits_expired');

    await supabase.from('goal_notifications').insert({
      user_id: intent.user_id,
      session_id: intent.session_id,
      type: 'volatility_wait_expired',
      title: 'Volatility Wait Expired',
      message: `${intent.symbol} volatility wait expired after ${intent.max_wait_hours} hours. Conditions were not met in time.`,
      metadata: {
        intent_id: intent.id,
        symbol: intent.symbol,
        max_wait_hours: intent.max_wait_hours
      }
    });
  }

  private async incrementMetric(userId: string, metric: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('increment_patience_metric', {
        p_user_id: userId,
        p_metric_name: metric,
        p_increment: 1
      });

      if (error) {
        productionLogger.error('[Volatility Wait Monitor] Failed to increment metric', {
          userId,
          metric,
          error: error.message
        });
      }
    } catch (error) {
      productionLogger.error('[Volatility Wait Monitor] Error incrementing metric', {
        userId,
        metric,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async getActiveWaitIntents(userId: string): Promise<VolatilityWaitIntent[]> {
    const { data, error } = await supabase
      .from('volatility_wait_intents')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'waiting')
      .order('created_at', { ascending: false });

    if (error) {
      productionLogger.error('[Volatility Wait Monitor] Failed to fetch active intents', {
        userId,
        error: error.message
      });
      return [];
    }

    return (data as VolatilityWaitIntent[]) || [];
  }

  async cancelIntent(intentId: string, userId: string, reason: string): Promise<boolean> {
    const { error } = await supabase
      .from('volatility_wait_intents')
      .update({
        status: 'canceled',
        resolved_at: new Date().toISOString()
      })
      .eq('id', intentId)
      .eq('user_id', userId);

    if (error) {
      productionLogger.error('[Volatility Wait Monitor] Failed to cancel intent', {
        intentId,
        error: error.message
      });
      return false;
    }

    await this.incrementMetric(userId, 'volatility_waits_canceled');

    productionLogger.info('[Volatility Wait Monitor] Intent canceled', {
      intentId,
      reason
    });

    return true;
  }
}

export const volatilityWaitMonitor = new VolatilityWaitMonitor();
