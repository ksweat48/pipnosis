import { supabase } from '../lib/supabase';
import { flowTraderV2 } from '../strategies/flow-trader-v2';
import { autonomousReasoningEngine } from './autonomous-reasoning-engine';
import { countdownOrchestrator } from './countdown-orchestrator';
import { goalSessionManager } from './goal-session-manager';
import { soundNotificationService } from './sound-notification-service';

export interface AutonomousScanConfig {
  sessionId: string;
  userId: string;
  watchlist: string[];
  autoExecute: boolean;
  countdownDuration: number;
  riskMode: string;
}

class AutonomousGoalScanner {
  private activeSessions: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEFAULT_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'USDJPY', 'GBPUSD'];

  async startAutonomousSession(config: AutonomousScanConfig): Promise<void> {
    const { sessionId, userId } = config;

    if (this.activeSessions.has(sessionId)) {
      console.log(`[Autonomous Scanner] Session ${sessionId} already active`);
      return;
    }

    console.log(`[Autonomous Scanner] Starting autonomous session ${sessionId}`);

    await goalSessionManager.addAIMessage(
      sessionId,
      userId,
      `Autonomous co-pilot activated. Monitoring ${config.watchlist.join(', ')} for high-quality setups using Flow Trader V2 strategy. Will analyze every signal with GPT-4o for optimal execution timing.`,
      { config },
      'encouraging'
    );

    this.scheduleScan(config);
  }

  private scheduleScan(config: AutonomousScanConfig): void {
    const scanInterval = this.getScanInterval(config.riskMode);

    const intervalId = setInterval(async () => {
      await this.performScan(config);
    }, scanInterval);

    this.activeSessions.set(config.sessionId, intervalId);
  }

  private getScanInterval(riskMode: string): number {
    const intervals = {
      low: 30000,
      medium: 20000,
      high: 10000
    };

    return intervals[riskMode as keyof typeof intervals] || 20000;
  }

  async performScan(config: AutonomousScanConfig): Promise<void> {
    try {
      const { sessionId, userId, watchlist, autoExecute } = config;

      const { data: session } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (!session || !['initializing', 'scanning', 'trade_pending'].includes(session.status)) {
        console.log(`[Autonomous Scanner] Session ${sessionId} no longer active, stopping...`);
        this.stopSession(sessionId);
        return;
      }

      const existingCountdown = await countdownOrchestrator.getActiveCountdown(sessionId);
      if (existingCountdown) {
        console.log(`[Autonomous Scanner] Countdown already active for ${sessionId}, skipping scan`);
        return;
      }

      const { data: openTrades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'open');

      const openTradesCount = openTrades?.length || 0;
      const maxConcurrent = session.max_concurrent_trades || 2;

      if (openTradesCount >= maxConcurrent) {
        console.log(`[Autonomous Scanner] Max concurrent trades (${maxConcurrent}) reached for ${sessionId}`);
        return;
      }

      const symbols = watchlist || this.DEFAULT_SYMBOLS;

      for (const symbol of symbols) {
        const signal = await flowTraderV2.analyzeSetup(symbol, sessionId);

        if (signal) {
          console.log(`[Autonomous Scanner] Flow V2 signal detected on ${symbol}`);

          const decision = await autonomousReasoningEngine.reasonAboutSignal(
            signal,
            sessionId,
            userId,
            session,
            openTrades || []
          );

          await goalSessionManager.addAIMessage(
            sessionId,
            userId,
            `Reasoning: ${decision.rationale}`,
            { signal, decision },
            'neutral'
          );

          if (decision.shouldExecute) {
            await soundNotificationService.playNotification(`${symbol} ${signal.direction.toUpperCase()} setup found`);

            await countdownOrchestrator.startCountdown(
              signal,
              sessionId,
              userId,
              session.countdown_duration_seconds || 180
            );

            await goalSessionManager.transitionStatus(sessionId, 'trade_pending');

            break;
          }
        }
      }

      await goalSessionManager.updateScanTime(
        sessionId,
        new Date(),
        new Date(Date.now() + this.getScanInterval(config.riskMode))
      );

    } catch (error) {
      console.error('[Autonomous Scanner] Error during scan:', error);
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const intervalId = this.activeSessions.get(sessionId);

    if (intervalId) {
      clearInterval(intervalId);
      this.activeSessions.delete(sessionId);
      console.log(`[Autonomous Scanner] Stopped session ${sessionId}`);
    }
  }

  async resumeActiveSessions(): Promise<void> {
    try {
      const { data: activeSessions } = await supabase
        .from('goal_sessions')
        .select('*')
        .in('status', ['scanning', 'trade_pending', 'in_trade'])
        .eq('auto_execute', true);

      if (!activeSessions || activeSessions.length === 0) {
        console.log('[Autonomous Scanner] No active sessions to resume');
        return;
      }

      console.log(`[Autonomous Scanner] Resuming ${activeSessions.length} active sessions`);

      for (const session of activeSessions) {
        const config: AutonomousScanConfig = {
          sessionId: session.id,
          userId: session.user_id,
          watchlist: session.watchlist || this.DEFAULT_SYMBOLS,
          autoExecute: session.auto_execute,
          countdownDuration: session.countdown_duration_seconds || 180,
          riskMode: session.risk_mode
        };

        await this.startAutonomousSession(config);
      }
    } catch (error) {
      console.error('[Autonomous Scanner] Error resuming sessions:', error);
    }
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  async getSessionStatus(sessionId: string): Promise<{
    isActive: boolean;
    nextScanETA: number | null;
    activeCountdown: any | null;
  }> {
    const isActive = this.isSessionActive(sessionId);

    let nextScanETA = null;
    if (isActive) {
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('next_scan_time')
        .eq('id', sessionId)
        .single();

      if (session?.next_scan_time) {
        const eta = new Date(session.next_scan_time).getTime() - Date.now();
        nextScanETA = Math.max(0, Math.floor(eta / 1000));
      }
    }

    const activeCountdown = await countdownOrchestrator.getActiveCountdown(sessionId);

    return {
      isActive,
      nextScanETA,
      activeCountdown
    };
  }
}

export const autonomousGoalScanner = new AutonomousGoalScanner();

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    autonomousGoalScanner.resumeActiveSessions();
  });
}
