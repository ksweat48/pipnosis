import { supabase } from '@/lib/supabase';

/**
 * Auto Trading Persistence Service
 *
 * This service enables auto trading to persist across page reloads by:
 * 1. Storing the scanning schedule in the database
 * 2. Using a polling mechanism instead of JavaScript intervals
 * 3. Tracking heartbeats to detect stale sessions
 * 4. Automatically resuming scanning when the page loads
 */

export class AutoTradingPersistence {
  private pollingInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private userId: string | null = null;

  /**
   * Initialize the persistence system for a user
   * This should be called when the user logs in or the app loads
   */
  async initialize(userId: string): Promise<void> {
    if (this.isInitialized && this.userId === userId) {
      return;
    }

    this.userId = userId;
    this.isInitialized = true;

    console.log('[AutoTradingPersistence] Initializing for user:', userId);

    // Check if auto trading should be running
    await this.checkAndResumeScanning();

    // Start the polling mechanism to check for scheduled scans
    this.startPolling();

    console.log('[AutoTradingPersistence] Initialization complete');
  }

  /**
   * Check if auto trading should be scanning and resume if necessary
   */
  private async checkAndResumeScanning(): Promise<void> {
    if (!this.userId) return;

    try {
      const { data, error } = await supabase
        .from('auto_trading_status')
        .select('*')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (error || !data) return;

      console.log('[AutoTradingPersistence] Current status:', {
        shouldBeScanning: data.should_be_scanning,
        enabled: data.enabled,
        emergencyStop: data.emergency_stop,
        lastHeartbeat: data.last_heartbeat_at
      });

      // Check if scanning should be active
      if (data.should_be_scanning && data.enabled && !data.emergency_stop) {
        // Check if the session is stale (no heartbeat in the last 5 minutes)
        const lastHeartbeat = data.last_heartbeat_at ? new Date(data.last_heartbeat_at) : null;
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

        if (!lastHeartbeat || lastHeartbeat < fiveMinutesAgo) {
          console.log('[AutoTradingPersistence] Resuming stale auto trading session');
          // Session is stale, resume it
          await this.updateHeartbeat();
          // The polling mechanism will handle the actual scanning
        } else {
          console.log('[AutoTradingPersistence] Auto trading is already active in another tab/session');
          // Another tab is handling it, just monitor
          await this.updateHeartbeat();
        }

        // Start heartbeat updates
        this.startHeartbeat();
      }
    } catch (error) {
      console.error('[AutoTradingPersistence] Error checking scanning status:', error);
    }
  }

  /**
   * Start the polling mechanism to check for scheduled scans
   * This runs every 30 seconds and checks if it's time to scan
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    console.log('[AutoTradingPersistence] Starting polling mechanism');

    this.pollingInterval = setInterval(async () => {
      await this.checkForScheduledScan();
    }, 30000); // Check every 30 seconds

    // Also check immediately
    this.checkForScheduledScan();
  }

  /**
   * Check if a scan should be performed now
   */
  private async checkForScheduledScan(): Promise<void> {
    if (!this.userId) return;

    try {
      const { data, error } = await supabase
        .from('auto_trading_status')
        .select('*')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (error || !data) return;

      // Check if scanning should be active
      if (!data.should_be_scanning || !data.enabled || data.emergency_stop) {
        return;
      }

      const now = new Date();
      const nextScan = data.next_scan_scheduled_at ? new Date(data.next_scan_scheduled_at) : null;

      // If no next scan is scheduled or it's time to scan
      if (!nextScan || nextScan <= now) {
        console.log('[AutoTradingPersistence] Time for scheduled scan');

        // Calculate next scan time
        const scanIntervalSeconds = data.scan_interval_seconds || 120;
        const nextScanTime = new Date(now.getTime() + scanIntervalSeconds * 1000);

        // Update the schedule
        await supabase
          .from('auto_trading_status')
          .update({
            next_scan_scheduled_at: nextScanTime.toISOString(),
            last_scan_time: now.toISOString()
          })
          .eq('user_id', this.userId);

        // Trigger a custom event that the scanner can listen to
        window.dispatchEvent(new CustomEvent('autoTradingScheduledScan', {
          detail: { userId: this.userId, scheduledAt: now }
        }));

        console.log('[AutoTradingPersistence] Scheduled scan event dispatched. Next scan:', nextScanTime);
      }
    } catch (error) {
      console.error('[AutoTradingPersistence] Error checking scheduled scan:', error);
    }
  }

  /**
   * Update heartbeat to indicate this session is alive
   */
  private async updateHeartbeat(): Promise<void> {
    if (!this.userId) return;

    try {
      await supabase
        .from('auto_trading_status')
        .update({
          last_heartbeat_at: new Date().toISOString()
        })
        .eq('user_id', this.userId);
    } catch (error) {
      console.error('[AutoTradingPersistence] Error updating heartbeat:', error);
    }
  }

  /**
   * Start sending heartbeats every minute
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    console.log('[AutoTradingPersistence] Starting heartbeat updates');

    this.heartbeatInterval = setInterval(async () => {
      await this.updateHeartbeat();
    }, 60000); // Update every minute

    // Send initial heartbeat
    this.updateHeartbeat();
  }

  /**
   * Stop heartbeat updates
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Enable auto trading scanning
   */
  async enableScanning(userId: string, scanIntervalSeconds: number = 120): Promise<void> {
    const now = new Date();
    const nextScan = new Date(now.getTime() + scanIntervalSeconds * 1000);

    console.log('[AutoTradingPersistence.enableScanning] Enabling scanning for user:', userId);
    console.log('[AutoTradingPersistence.enableScanning] Scan interval:', scanIntervalSeconds, 'seconds');

    const { error } = await supabase
      .from('auto_trading_status')
      .update({
        should_be_scanning: true,
        scan_interval_seconds: scanIntervalSeconds,
        next_scan_scheduled_at: nextScan.toISOString(),
        last_heartbeat_at: now.toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[AutoTradingPersistence.enableScanning] Failed to enable scanning:', error);
      throw new Error(`Failed to enable scanning: ${error.message}`);
    }

    console.log('[AutoTradingPersistence.enableScanning] ✓ Scanning enabled. Next scan:', nextScan);

    // Start heartbeat for this session
    if (this.userId === userId) {
      this.startHeartbeat();
    }
  }

  /**
   * Disable auto trading scanning
   */
  async disableScanning(userId: string): Promise<void> {
    console.log('[AutoTradingPersistence.disableScanning] Disabling scanning for user:', userId);

    const { error } = await supabase
      .from('auto_trading_status')
      .update({
        should_be_scanning: false,
        next_scan_scheduled_at: null,
        last_heartbeat_at: null
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[AutoTradingPersistence.disableScanning] Failed to disable scanning:', error);
      throw new Error(`Failed to disable scanning: ${error.message}`);
    }

    console.log('[AutoTradingPersistence.disableScanning] ✓ Scanning disabled');

    // Stop heartbeat
    if (this.userId === userId) {
      this.stopHeartbeat();
    }
  }

  /**
   * Clean up when component unmounts or user logs out
   */
  cleanup(): void {
    console.log('[AutoTradingPersistence] Cleaning up');

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.stopHeartbeat();

    this.isInitialized = false;
    this.userId = null;
  }

  /**
   * Check if auto trading is active for a user
   */
  async isActive(userId: string): Promise<boolean> {
    const { data } = await supabase
      .from('auto_trading_status')
      .select('should_be_scanning, enabled, emergency_stop')
      .eq('user_id', userId)
      .maybeSingle();

    return !!(data?.should_be_scanning && data?.enabled && !data?.emergency_stop);
  }
}

export const autoTradingPersistence = new AutoTradingPersistence();
