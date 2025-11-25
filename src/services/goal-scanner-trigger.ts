import { supabase } from '../lib/supabase';

export interface ScanTriggerResult {
  success: boolean;
  message: string;
  scannedSessions?: number;
  results?: any[];
  error?: string;
}

class GoalScannerTrigger {
  private isScanning: boolean = false;
  private lastScanTime: Date | null = null;
  private pollingInterval: number | null = null;
  private listeners: Set<(status: ScanStatus) => void> = new Set();

  async triggerScan(sessionId?: string): Promise<ScanTriggerResult> {
    if (this.isScanning) {
      return {
        success: false,
        message: 'Scan already in progress',
      };
    }

    this.isScanning = true;
    this.notifyListeners({ isScanning: true, message: 'Initiating scan...' });

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase configuration missing');
      }

      // Silently invoke scanner (logging reduced for clean console)
      this.notifyListeners({ isScanning: true, message: 'Calling scanner function...' });

      const response = await fetch(
        `${supabaseUrl}/functions/v1/goal-session-scanner`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({ sessionId }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Scanner function failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      this.lastScanTime = new Date();

      // Only log if there's meaningful activity
      if (result.scanned > 0) {
        console.log('[Scanner Trigger] Scan completed:', result);
      }
      this.notifyListeners({
        isScanning: false,
        message: result.message || 'Scan completed',
        lastScanTime: this.lastScanTime,
      });

      return {
        success: true,
        message: result.message || 'Scan completed successfully',
        scannedSessions: result.scanned,
        results: result.results,
      };
    } catch (error) {
      console.error('[Scanner Trigger] Scan failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.notifyListeners({
        isScanning: false,
        message: `Scan failed: ${errorMessage}`,
        error: errorMessage,
      });

      return {
        success: false,
        message: 'Scan failed',
        error: errorMessage,
      };
    } finally {
      this.isScanning = false;
    }
  }

  async checkAndTriggerIfNeeded(sessionId: string): Promise<boolean> {
    try {
      const { data: session, error } = await supabase
        .from('goal_sessions')
        .select('id, next_scan_time, status, last_scan_time')
        .eq('id', sessionId)
        .in('status', ['scanning', 'trade_pending', 'in_trade'])
        .maybeSingle();

      if (error || !session) {
        console.log('[Scanner Trigger] No active session found or error:', error);
        return false;
      }

      const now = new Date();
      const nextScan = session.next_scan_time ? new Date(session.next_scan_time) : null;

      if (!nextScan) {
        // Session missing scan time, trigger immediately
        await this.triggerScan(sessionId);
        return true;
      }

      if (nextScan <= now) {
        console.log('[Smart Goal] 🔍 Scanning markets for opportunities...');
        await this.triggerScan(sessionId);
        return true;
      }

      // Silently wait for next scan (reduced console noise)
      return false;
    } catch (error) {
      console.error('[Scanner Trigger] Error checking scan schedule:', error);
      return false;
    }
  }

  startPolling(sessionId: string, intervalMs: number = 60000): void {
    if (this.pollingInterval) {
      this.stopPolling();
    }

    console.log(`[Smart Goal] ✓ Session monitoring started (scan interval: ${intervalMs/1000}s)`);

    this.checkAndTriggerIfNeeded(sessionId);

    this.pollingInterval = window.setInterval(() => {
      this.checkAndTriggerIfNeeded(sessionId);
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      console.log('[Smart Goal] Session monitoring stopped');
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  onStatusChange(callback: (status: ScanStatus) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(status: ScanStatus): void {
    this.listeners.forEach(listener => listener(status));
  }

  getStatus(): ScanStatus {
    return {
      isScanning: this.isScanning,
      lastScanTime: this.lastScanTime,
      message: this.isScanning ? 'Scanning in progress...' : 'Ready',
    };
  }

  async getMarketDataStatus(symbols: string[]): Promise<MarketDataStatus[]> {
    const results: MarketDataStatus[] = [];

    for (const symbol of symbols) {
      try {
        const { data, error } = await supabase
          .from('forex_candles')
          .select('open_time')
          .eq('symbol', symbol)
          .eq('timeframe', '15m')
          .order('open_time', { ascending: false })
          .limit(100);

        if (error) {
          results.push({
            symbol,
            available: false,
            candleCount: 0,
            error: error.message,
          });
          continue;
        }

        const candleCount = data?.length || 0;
        const lastUpdate = data?.[0]?.timestamp ? new Date(data[0].timestamp) : null;

        results.push({
          symbol,
          available: candleCount >= 50,
          candleCount,
          lastUpdate,
          status: candleCount >= 50 ? 'ready' : 'insufficient',
        });
      } catch (error) {
        results.push({
          symbol,
          available: false,
          candleCount: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }
}

export interface ScanStatus {
  isScanning: boolean;
  message: string;
  lastScanTime?: Date | null;
  error?: string;
}

export interface MarketDataStatus {
  symbol: string;
  available: boolean;
  candleCount: number;
  lastUpdate?: Date | null;
  status?: string;
  error?: string;
}

export const goalScannerTrigger = new GoalScannerTrigger();
