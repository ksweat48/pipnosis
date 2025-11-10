/**
 * Browser Price Poller
 *
 * Calls the Netlify get-live-price function every 2 seconds for all symbols.
 * The Netlify function automatically saves prices to the database.
 * This provides a reliable fallback when server-side cron jobs aren't working.
 */

const FOREX_PAIRS = ['EURUSD', 'XAUUSD', 'US30', 'GBPUSD', 'USDJPY'];
const POLL_INTERVAL_MS = 2000;

class BrowserPricePoller {
  private isActive = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 10;

  async start(): Promise<void> {
    if (this.isActive) {
      console.warn('[BrowserPoller] Already active');
      return;
    }

    console.log('[BrowserPoller] 🚀 Starting browser-based price polling...');
    console.log('[BrowserPoller] This ensures prices flow even without server-side cron');

    this.isActive = true;
    this.consecutiveErrors = 0;

    await this.poll();

    this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);

    console.log(`[BrowserPoller] ✅ Polling started (every ${POLL_INTERVAL_MS}ms)`);
  }

  private async poll(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      let successCount = 0;

      for (const symbol of FOREX_PAIRS) {
        try {
          const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            if (data.bid && data.ask) {
              successCount++;
              console.log(`[BrowserPoller] ✅ ${symbol}: ${data.bid}/${data.ask} (${data.source || 'unknown'})`);
            }
          }
        } catch (error) {
          console.error(`[BrowserPoller] Error fetching ${symbol}:`, error instanceof Error ? error.message : String(error));
        }
      }

      if (successCount > 0) {
        this.consecutiveErrors = 0;
      } else {
        this.consecutiveErrors++;
        console.warn(`[BrowserPoller] ⚠️ No successful fetches (${this.consecutiveErrors}/${this.MAX_CONSECUTIVE_ERRORS})`);

        if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
          console.error('[BrowserPoller] ❌ Too many consecutive errors, stopping poller');
          this.stop();
        }
      }
    } catch (error) {
      console.error('[BrowserPoller] Poll error:', error);
      this.consecutiveErrors++;
    }
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }

    console.log('[BrowserPoller] 🛑 Stopping...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isActive = false;
    console.log('[BrowserPoller] ✅ Stopped');
  }

  isRunning(): boolean {
    return this.isActive;
  }

  getStatus(): { isActive: boolean; consecutiveErrors: number } {
    return {
      isActive: this.isActive,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

export const browserPricePoller = new BrowserPricePoller();
