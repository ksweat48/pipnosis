import { supabase } from '../lib/supabase';
import { FlowV2Signal } from '../strategies/flow-trader-v2';
import { tradeExecutionEngine } from './trade-execution-engine';
import { goalSessionManager } from './goal-session-manager';
import { v4 as uuidv4 } from 'uuid';

export interface CountdownState {
  id: string;
  sessionId: string;
  userId: string;
  signal: FlowV2Signal;
  startTime: Date;
  expiryTime: Date;
  status: 'active' | 'cancelled' | 'expired' | 'executed';
  cancelToken: string;
}

export type CountdownStatus = 'DISCOVERED' | 'COUNTDOWN' | 'OPEN' | 'MANAGING' | 'CLOSED';

class CountdownOrchestrator {
  private countdowns: Map<string, CountdownState> = new Map();
  private readonly DEFAULT_COUNTDOWN_SECONDS = 180;

  async startCountdown(
    signal: FlowV2Signal,
    sessionId: string,
    userId: string,
    countdownDuration?: number
  ): Promise<CountdownState | null> {
    try {
      const duration = countdownDuration || this.DEFAULT_COUNTDOWN_SECONDS;
      const startTime = new Date();
      const expiryTime = new Date(startTime.getTime() + duration * 1000);
      const cancelToken = uuidv4();
      const countdownId = uuidv4();

      console.log(`[Countdown] Starting ${duration}s countdown for ${signal.symbol} ${signal.direction}`);

      const { data, error } = await supabase
        .from('countdown_state')
        .insert({
          id: countdownId,
          goal_session_id: sessionId,
          user_id: userId,
          signal_id: uuidv4(),
          symbol: signal.symbol,
          direction: signal.direction,
          entry_price: signal.entryPrice,
          stop_loss: signal.stopLoss,
          take_profit: signal.takeProfit,
          confidence: signal.confidence,
          setup_type: signal.setupType,
          reasoning: signal.reasoning,
          start_time: startTime.toISOString(),
          expiry_time: expiryTime.toISOString(),
          status: 'active',
          cancel_token: cancelToken,
          data: {
            riskReward: signal.riskReward,
            h1Bias: signal.h1Bias,
            m5FilterPassed: signal.m5FilterPassed,
            m1ExecutionReady: signal.m1ExecutionReady
          }
        })
        .select()
        .single();

      if (error) {
        console.error('[Countdown] Error creating countdown:', error);
        return null;
      }

      const countdown: CountdownState = {
        id: data.id,
        sessionId,
        userId,
        signal,
        startTime,
        expiryTime,
        status: 'active',
        cancelToken
      };

      this.countdowns.set(data.id, countdown);

      await goalSessionManager.addAIMessage(
        sessionId,
        userId,
        `Found high-conviction ${signal.direction.toUpperCase()} setup on ${signal.symbol} (${signal.confidence}% confidence)!\n\nEntry: ${signal.entryPrice.toFixed(5)}\nStop Loss: ${signal.stopLoss.toFixed(5)}\nTake Profit: ${signal.takeProfit.toFixed(5)}\nRisk:Reward: 1:${signal.riskReward.toFixed(2)}\n\n${signal.reasoning}\n\n⏱️ Auto-executing in ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')} unless you stop it.`,
        { countdown: data, signal },
        'encouraging'
      );

      this.scheduleExecution(countdown);

      return countdown;
    } catch (error) {
      console.error('[Countdown] Error starting countdown:', error);
      return null;
    }
  }

  async cancelCountdown(countdownId: string, userId: string, reason: string = 'User cancelled'): Promise<boolean> {
    try {
      const countdown = this.countdowns.get(countdownId);

      if (!countdown) {
        console.log('[Countdown] Countdown not found in memory, checking database...');

        const { data: dbCountdown } = await supabase
          .from('countdown_state')
          .select('*')
          .eq('id', countdownId)
          .eq('user_id', userId)
          .eq('status', 'active')
          .single();

        if (!dbCountdown) {
          console.error('[Countdown] Countdown not found or already processed');
          return false;
        }
      }

      console.log(`[Countdown] Cancelling countdown ${countdownId}: ${reason}`);

      const { error } = await supabase
        .from('countdown_state')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString()
        })
        .eq('id', countdownId)
        .eq('user_id', userId);

      if (error) {
        console.error('[Countdown] Error cancelling countdown:', error);
        return false;
      }

      if (countdown) {
        countdown.status = 'cancelled';
        this.countdowns.delete(countdownId);
      }

      await goalSessionManager.addAIMessage(
        countdown?.sessionId || '',
        userId,
        `Countdown cancelled. Trade signal on ${countdown?.signal.symbol || 'unknown'} will not be executed. Continuing market scan...`,
        { countdownId, reason },
        'neutral'
      );

      return true;
    } catch (error) {
      console.error('[Countdown] Error in cancelCountdown:', error);
      return false;
    }
  }

  private async scheduleExecution(countdown: CountdownState): Promise<void> {
    const now = Date.now();
    const expiryTimestamp = countdown.expiryTime.getTime();
    const delay = expiryTimestamp - now;

    if (delay <= 0) {
      await this.executeOnExpiry(countdown);
      return;
    }

    setTimeout(async () => {
      const currentCountdown = this.countdowns.get(countdown.id);
      if (currentCountdown && currentCountdown.status === 'active') {
        await this.executeOnExpiry(currentCountdown);
      }
    }, delay);
  }

  private async executeOnExpiry(countdown: CountdownState): Promise<void> {
    try {
      const { data: dbCountdown } = await supabase
        .from('countdown_state')
        .select('status')
        .eq('id', countdown.id)
        .single();

      if (!dbCountdown || dbCountdown.status !== 'active') {
        console.log(`[Countdown] Countdown ${countdown.id} was cancelled or already processed`);
        this.countdowns.delete(countdown.id);
        return;
      }

      console.log(`[Countdown] Executing trade on expiry: ${countdown.signal.symbol} ${countdown.signal.direction}`);

      const executionResult = await tradeExecutionEngine.executeSignal(
        {
          sessionId: countdown.sessionId,
          symbol: countdown.signal.symbol,
          direction: countdown.signal.direction,
          entryPrice: countdown.signal.entryPrice,
          stopLoss: countdown.signal.stopLoss,
          takeProfit: countdown.signal.takeProfit,
          positionSize: 0.01,
          confidence: countdown.signal.confidence,
          setupType: countdown.signal.setupType,
          reasoning: countdown.signal.reasoning,
          riskReward: countdown.signal.riskReward,
          expectedProfit: 100
        },
        countdown.userId,
        true
      );

      if (executionResult.success) {
        await supabase
          .from('countdown_state')
          .update({
            status: 'executed',
            executed_at: new Date().toISOString()
          })
          .eq('id', countdown.id);

        countdown.status = 'executed';

        await goalSessionManager.addAIMessage(
          countdown.sessionId,
          countdown.userId,
          `✅ Trade executed on countdown expiry!\n\n${countdown.signal.symbol} ${countdown.signal.direction.toUpperCase()} at ${countdown.signal.entryPrice.toFixed(5)}\nStop Loss: ${countdown.signal.stopLoss.toFixed(5)}\nTake Profit: ${countdown.signal.takeProfit.toFixed(5)}\n\nMonitoring position actively...`,
          { countdown, executionResult },
          'encouraging'
        );

      } else {
        await supabase
          .from('countdown_state')
          .update({ status: 'expired' })
          .eq('id', countdown.id);

        countdown.status = 'expired';

        await goalSessionManager.addAIMessage(
          countdown.sessionId,
          countdown.userId,
          `⚠️ Auto-execution failed: ${executionResult.error || executionResult.message}. Continuing market scan...`,
          { countdown, error: executionResult.error },
          'neutral'
        );
      }

      this.countdowns.delete(countdown.id);

    } catch (error) {
      console.error('[Countdown] Error executing on expiry:', error);

      await supabase
        .from('countdown_state')
        .update({ status: 'expired' })
        .eq('id', countdown.id);

      this.countdowns.delete(countdown.id);
    }
  }

  async getActiveCountdown(sessionId: string): Promise<CountdownState | null> {
    try {
      const { data, error } = await supabase
        .from('countdown_state')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      const countdown: CountdownState = {
        id: data.id,
        sessionId: data.goal_session_id,
        userId: data.user_id,
        signal: {
          symbol: data.symbol,
          direction: data.direction as 'buy' | 'sell',
          entryPrice: parseFloat(data.entry_price),
          stopLoss: parseFloat(data.stop_loss),
          takeProfit: parseFloat(data.take_profit),
          confidence: parseFloat(data.confidence),
          setupType: data.setup_type,
          reasoning: data.reasoning,
          h1Bias: data.data?.h1Bias || 'bullish',
          m5FilterPassed: data.data?.m5FilterPassed || false,
          m1ExecutionReady: data.data?.m1ExecutionReady || false,
          riskReward: data.data?.riskReward || 2.0,
          phase: 'complete'
        },
        startTime: new Date(data.start_time),
        expiryTime: new Date(data.expiry_time),
        status: 'active',
        cancelToken: data.cancel_token
      };

      if (!this.countdowns.has(data.id) && countdown.expiryTime.getTime() > Date.now()) {
        this.countdowns.set(data.id, countdown);
        this.scheduleExecution(countdown);
      }

      return countdown;
    } catch (error) {
      console.error('[Countdown] Error getting active countdown:', error);
      return null;
    }
  }

  async getCountdownHistory(sessionId: string, limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('countdown_state')
        .select('*')
        .eq('goal_session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Countdown] Error fetching countdown history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Countdown] Error in getCountdownHistory:', error);
      return [];
    }
  }

  getTimeRemaining(countdown: CountdownState): number {
    const now = Date.now();
    const expiryTimestamp = countdown.expiryTime.getTime();
    const remaining = Math.max(0, Math.floor((expiryTimestamp - now) / 1000));
    return remaining;
  }

  formatTimeRemaining(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  async cleanupExpiredCountdowns(): Promise<void> {
    try {
      const { data } = await supabase
        .from('countdown_state')
        .select('id, expiry_time')
        .eq('status', 'active')
        .lt('expiry_time', new Date().toISOString());

      if (data && data.length > 0) {
        console.log(`[Countdown] Cleaning up ${data.length} expired countdowns`);

        for (const countdown of data) {
          await supabase
            .from('countdown_state')
            .update({ status: 'expired' })
            .eq('id', countdown.id);

          this.countdowns.delete(countdown.id);
        }
      }
    } catch (error) {
      console.error('[Countdown] Error cleaning up expired countdowns:', error);
    }
  }
}

export const countdownOrchestrator = new CountdownOrchestrator();

setInterval(() => {
  countdownOrchestrator.cleanupExpiredCountdowns();
}, 60000);
