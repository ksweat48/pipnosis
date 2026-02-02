/**
 * Entry Monitor Coordinator (Legacy Stub)
 *
 * DEPRECATED: Entry monitoring coordination is now handled by goal-session-live-engine
 * and AlphaTradeExecutor. This stub exists for backward compatibility.
 *
 * New monitoring logic is in:
 * - src/services/alpha-trade-executor.ts (MONITORED execution mode)
 * - src/services/goal-session-live-engine.ts (session lifecycle management)
 */

export interface MonitorState {
  isMonitoring: boolean;
  activeIntentCount: number;
}

class EntryMonitorCoordinator {
  private executeCallback: ((signal: any) => Promise<void>) | null = null;
  private rescanCallback: ((sessionId: string) => Promise<void>) | null = null;

  /**
   * Set callback for trade execution (stub)
   */
  setExecuteTradeCallback(callback: (signal: any) => Promise<void>): void {
    console.log('[EntryMonitorCoordinator] STUB: setExecuteTradeCallback called');
    this.executeCallback = callback;
  }

  /**
   * Set callback for rescan (stub)
   */
  setRescanCallback(callback: (sessionId: string) => Promise<void>): void {
    console.log('[EntryMonitorCoordinator] STUB: setRescanCallback called');
    this.rescanCallback = callback;
  }

  /**
   * Resume monitoring if needed (stub)
   */
  async resumeMonitoringIfNeeded(sessionId: string, userId: string): Promise<void> {
    console.log('[EntryMonitorCoordinator] STUB: resumeMonitoringIfNeeded called for session:', sessionId);
    // No-op: Monitoring is now handled by goal-session-live-engine
  }

  /**
   * Cleanup session (stub)
   */
  async cleanupSession(sessionId: string): Promise<void> {
    console.log('[EntryMonitorCoordinator] STUB: cleanupSession called for session:', sessionId);
    // No-op: Cleanup is now handled by goal-session-live-engine
  }

  /**
   * Can scan now (stub - always returns true)
   */
  async canScanNow(sessionId: string): Promise<{ canScan: boolean; reason?: string }> {
    console.log('[EntryMonitorCoordinator] STUB: canScanNow called for session:', sessionId);
    return { canScan: true };
  }

  /**
   * Get monitor state (stub)
   */
  async getMonitorState(sessionId: string): Promise<MonitorState> {
    console.log('[EntryMonitorCoordinator] STUB: getMonitorState called for session:', sessionId);
    return {
      isMonitoring: false,
      activeIntentCount: 0
    };
  }
}

export const entryMonitorCoordinator = new EntryMonitorCoordinator();
