import { recommendationTracker } from './recommendation-tracker';

/**
 * Real-time Recommendation Status Synchronization
 *
 * Monitors automatic adjustments and updates recommendation statuses in real-time
 */

class RecommendationStatusSync {
  private syncInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private userId: string | null = null;

  /**
   * Start monitoring for status updates
   */
  start(userId: string): void {
    if (this.isRunning) {
      console.log('[Recommendation Status Sync] Already running');
      return;
    }

    this.userId = userId;
    this.isRunning = true;

    console.log('[Recommendation Status Sync] 🔄 Starting real-time monitoring');

    // Initial sync
    this.syncStatuses();

    // Sync every 10 seconds
    this.syncInterval = setInterval(() => {
      this.syncStatuses();
    }, 10000);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.isRunning = false;
    this.userId = null;

    console.log('[Recommendation Status Sync] ⏹️ Stopped monitoring');
  }

  /**
   * Perform synchronization
   */
  private async syncStatuses(): Promise<void> {
    if (!this.userId) return;

    try {
      // Monitor adjustment queue for completion
      await recommendationTracker.monitorAdjustmentCompletion(this.userId);
    } catch (error) {
      console.error('[Recommendation Status Sync] Error during sync:', error);
    }
  }

  /**
   * Force an immediate sync
   */
  async forceSyncNow(userId: string): Promise<void> {
    console.log('[Recommendation Status Sync] 🔄 Force syncing now');
    await recommendationTracker.monitorAdjustmentCompletion(userId);
  }

  /**
   * Check if currently running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

export const recommendationStatusSync = new RecommendationStatusSync();
