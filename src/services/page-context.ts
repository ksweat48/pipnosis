/**
 * Page Context Service
 *
 * Tracks the current page/route to enable smart polling decisions.
 * Allows polling systems to disable browser-based polling on pages
 * where it's not needed (e.g., AI Training page during backtests).
 *
 * The server-side cron job (continuous-price-collector) runs every 2 minutes
 * regardless of browser state, providing baseline price updates.
 */

export type PageType = 'trade' | 'ai-training' | 'analysis' | 'history' | 'settings' | 'other';

interface PageState {
  currentPage: PageType;
  isBacktestRunning: boolean;
}

class PageContext {
  private state: PageState = {
    currentPage: 'other',
    isBacktestRunning: false
  };

  private listeners: Set<(state: PageState) => void> = new Set();

  /**
   * Set the current page context
   */
  setPage(page: PageType): void {
    if (this.state.currentPage !== page) {
      this.state.currentPage = page;
      console.log(`[PageContext] Page changed to: ${page}`);
      this.notifyListeners();
    }
  }

  /**
   * Get the current page
   */
  getCurrentPage(): PageType {
    return this.state.currentPage;
  }

  /**
   * Mark that a backtest is starting
   */
  setBacktestRunning(running: boolean): void {
    if (this.state.isBacktestRunning !== running) {
      this.state.isBacktestRunning = running;
      console.log(`[PageContext] Backtest ${running ? 'STARTED' : 'STOPPED'}`);
      this.notifyListeners();
    }
  }

  /**
   * Check if backtest is currently running
   */
  isBacktestRunning(): boolean {
    return this.state.isBacktestRunning;
  }

  /**
   * Determine if browser-based price polling should be enabled
   *
   * Browser polling is disabled when:
   * - On AI Training page (synthetic backtests don't need live data)
   * - A backtest is actively running (regardless of page)
   *
   * Server-side cron (runs every 2 min) continues to provide price updates.
   */
  shouldEnableBrowserPolling(): boolean {
    // Disable during any backtest
    if (this.state.isBacktestRunning) {
      return false;
    }

    // Disable on AI Training page (doesn't show live charts)
    if (this.state.currentPage === 'ai-training') {
      return false;
    }

    // Enable for all other pages (trade, analysis, etc.)
    return true;
  }

  /**
   * Subscribe to page context changes
   */
  subscribe(callback: (state: PageState) => void): () => void {
    this.listeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Get current state
   */
  getState(): PageState {
    return { ...this.state };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[PageContext] Error in listener:', error);
      }
    });
  }
}

// Export singleton instance
export const pageContext = new PageContext();
