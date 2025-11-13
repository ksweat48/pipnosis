/**
 * Simple Auto-Backtest Service
 *
 * Direct execution model - no queuing, no complex state management.
 * Runs one backtest at a time, learns from results, then runs the next.
 *
 * Flow:
 * 1. Run complete backtest (synthetic data + trade simulation)
 * 2. Store results
 * 3. Trigger AI learning from results
 * 4. Update AI skill progression
 * 5. Wait random delay (1-20 seconds)
 * 6. Repeat
 */

import { syntheticBacktestingEngine, SyntheticBacktestConfig } from './synthetic-backtesting-engine';

export interface SimpleAutoBacktestState {
  isRunning: boolean;
  totalBacktestsCompleted: number;
  currentBacktestNumber: number;
  lastBacktestResult: {
    sessionName: string;
    winRate: number;
    totalTrades: number;
    pnl: number;
    completedAt: Date;
  } | null;
  nextRunIn: number; // seconds
}

class SimpleAutoBacktestService {
  private isRunning = false;
  private userId: string | null = null;
  private totalBacktestsCompleted = 0;
  private currentBacktestNumber = 0;
  private abortController: AbortController | null = null;
  private nextRunTimer: NodeJS.Timeout | null = null;
  private lastBacktestResult: any = null;

  // Configuration
  private readonly MIN_DELAY_SECONDS = 2;
  private readonly MAX_DELAY_SECONDS = 10;
  private readonly MIN_DURATION_DAYS = 1;
  private readonly MAX_DURATION_DAYS = 3;

  /**
   * Start auto-backtest loop
   */
  async start(userId: string): Promise<void> {
    if (this.isRunning) {
      console.log('[Simple Auto-Backtest] Already running');
      return;
    }

    console.log('[Simple Auto-Backtest] 🚀 Starting auto-backtest system');
    this.userId = userId;
    this.isRunning = true;
    this.abortController = new AbortController();

    // Start the loop immediately
    this.runLoop();
  }

  /**
   * Stop auto-backtest loop
   */
  async stop(): Promise<void> {
    console.log('[Simple Auto-Backtest] 🛑 Stopping auto-backtest system');
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.nextRunTimer) {
      clearTimeout(this.nextRunTimer);
      this.nextRunTimer = null;
    }

    console.log('[Simple Auto-Backtest] Stopped');
  }

  /**
   * Get current state
   */
  getState(): SimpleAutoBacktestState {
    return {
      isRunning: this.isRunning,
      totalBacktestsCompleted: this.totalBacktestsCompleted,
      currentBacktestNumber: this.currentBacktestNumber,
      lastBacktestResult: this.lastBacktestResult,
      nextRunIn: 0 // Will be calculated by UI
    };
  }

  /**
   * Main loop - runs one backtest, learns, waits, repeats
   */
  private async runLoop(): Promise<void> {
    while (this.isRunning && this.userId) {
      try {
        console.log('\n[Simple Auto-Backtest] ========== STARTING NEW BACKTEST ==========');

        // Generate random parameters
        const sessionName = this.generateSessionName();
        const durationDays = this.randomDuration();
        const riskLevel = this.randomRiskLevel();
        const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];

        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - durationDays * 24 * 60 * 60 * 1000);

        console.log(`[Simple Auto-Backtest] Session: ${sessionName}`);
        console.log(`[Simple Auto-Backtest] Duration: ${durationDays} days`);
        console.log(`[Simple Auto-Backtest] Risk Level: ${riskLevel}`);
        console.log(`[Simple Auto-Backtest] Pairs: ${symbols.join(', ')}`);

        // Configure backtest
        const config: SyntheticBacktestConfig = {
          sessionName,
          description: `Auto-backtest - ${riskLevel} risk, ${durationDays}d duration`,
          symbols,
          startDate,
          endDate,
          timeframes: ['H1', 'M5', 'M1'],
          useGPT4Reasoning: false,
          confidenceThreshold: this.getRiskThreshold(riskLevel),
          riskMode: riskLevel,
          maxConcurrentTrades: 2,
          initialBalance: 10000,
          positionSizePercent: 2,
          commissionPerTrade: 0,
          slippagePips: 1,
          marketScenario: 'mixed'
        };

        this.currentBacktestNumber++;

        // Execute backtest (this includes AI learning automatically)
        const result = await syntheticBacktestingEngine.runSyntheticBacktest(
          this.userId,
          config,
          (progress) => {
            console.log(`[Simple Auto-Backtest] Progress: ${progress.message} (${progress.percentComplete.toFixed(1)}%)`);
          }
        );

        // Update completion stats
        this.totalBacktestsCompleted++;
        this.lastBacktestResult = {
          sessionName,
          winRate: result.winRate,
          totalTrades: result.totalTrades,
          pnl: result.totalPnL,
          completedAt: new Date()
        };

        console.log(`[Simple Auto-Backtest] ✅ Completed! Win rate: ${result.winRate.toFixed(1)}%, P&L: $${result.totalPnL.toFixed(2)}`);
        console.log('[Simple Auto-Backtest] ===============================================\n');

        // Random delay before next run
        if (this.isRunning) {
          const delaySeconds = this.randomDelay();
          console.log(`[Simple Auto-Backtest] Waiting ${delaySeconds}s before next backtest...`);

          await this.sleep(delaySeconds * 1000);
        }

      } catch (error) {
        console.error('[Simple Auto-Backtest] Error in backtest loop:', error);
        // Wait before retrying on error
        await this.sleep(10000);
      }
    }

    console.log('[Simple Auto-Backtest] Loop terminated');
  }

  /**
   * Generate unique session name
   */
  private generateSessionName(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `Auto-BT-${timestamp}`;
  }

  /**
   * Random duration between min and max days
   */
  private randomDuration(): number {
    return Math.floor(Math.random() * (this.MAX_DURATION_DAYS - this.MIN_DURATION_DAYS + 1)) + this.MIN_DURATION_DAYS;
  }

  /**
   * Random risk level
   */
  private randomRiskLevel(): 'low' | 'medium' | 'high' {
    const levels: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
    return levels[Math.floor(Math.random() * levels.length)];
  }

  /**
   * Get confidence threshold for risk level
   */
  private getRiskThreshold(riskLevel: 'low' | 'medium' | 'high'): number {
    const thresholds = { low: 85, medium: 75, high: 70 };
    return thresholds[riskLevel];
  }

  /**
   * Random delay between runs
   */
  private randomDelay(): number {
    return Math.floor(Math.random() * (this.MAX_DELAY_SECONDS - this.MIN_DELAY_SECONDS + 1)) + this.MIN_DELAY_SECONDS;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      if (this.abortController?.signal.aborted) {
        resolve();
      } else {
        this.nextRunTimer = setTimeout(resolve, ms);
      }
    });
  }
}

export const simpleAutoBacktestService = new SimpleAutoBacktestService();
