/**
 * Unified Entry Monitor (Legacy Stub)
 *
 * DEPRECATED: Entry monitoring is now handled by AlphaTradeExecutor.
 * This stub exists only for backward compatibility with useAuth.tsx.
 *
 * New monitoring logic is in:
 * - src/services/alpha-trade-executor.ts (MONITORED mode)
 * - src/services/entry-monitor-coordinator.ts (active monitoring coordinator)
 */

class UnifiedEntryMonitor {
  /**
   * Stop all monitoring (stub - actual monitoring handled by entry-monitor-coordinator)
   */
  stopAllMonitoring(): void {
    console.log('[UnifiedEntryMonitor] STUB: stopAllMonitoring called (entry-monitor-coordinator handles this)');
    // No-op: Monitoring is now handled by entry-monitor-coordinator
    // which is managed by goal-session-live-engine
  }

  /**
   * Resume all active intents (stub - actual resumption handled by entry-monitor-coordinator)
   */
  async resumeAllActiveIntents(userId: string): Promise<void> {
    console.log('[UnifiedEntryMonitor] STUB: resumeAllActiveIntents called for user:', userId, '(entry-monitor-coordinator handles this)');
    // No-op: Resumption is now handled by entry-monitor-coordinator.resumeMonitoringIfNeeded()
    // which is called by goal-session-live-engine when session starts
  }
}

export const unifiedEntryMonitor = new UnifiedEntryMonitor();
