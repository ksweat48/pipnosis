/**
 * Entry Execution Coordinator (Legacy Stub)
 *
 * DEPRECATED: Entry execution coordination is now handled by AlphaTradeExecutor.
 * This stub exists only for backward compatibility.
 *
 * New execution logic is in:
 * - src/services/alpha-trade-executor.ts (unified execution)
 */

export interface EntryExecutionResult {
  shouldExecuteImmediately: boolean;
  blockReason?: string;
  intentId?: string;
}

export class EntryExecutionCoordinator {
  /**
   * Handle alpha decision (stub - always execute immediately)
   */
  async handleAlphaDecision(decision: any, userId: string, sessionId: string): Promise<EntryExecutionResult> {
    console.log('[EntryExecutionCoordinator] STUB: handleAlphaDecision called (AlphaTradeExecutor handles this)');

    // Always execute immediately - real logic in AlphaTradeExecutor
    return {
      shouldExecuteImmediately: true
    };
  }
}

export const entryExecutionCoordinator = new EntryExecutionCoordinator();
