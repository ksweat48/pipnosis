/**
 * Minimal stub for synthetic trade copier
 * Used by simple-auto-backtest-service
 */

export interface CopyTradesResult {
  totalCopied: number;
  copiedTrades: any[];
}

class SyntheticTradeCopier {
  async copyTradesToHistory(
    syntheticSessionId: string,
    userId: string
  ): Promise<CopyTradesResult> {
    console.log('[Synthetic Trade Copier] Copying trades from session', syntheticSessionId);

    // Minimal stub - returns empty result
    return {
      totalCopied: 0,
      copiedTrades: []
    };
  }
}

export const syntheticTradeCopier = new SyntheticTradeCopier();
