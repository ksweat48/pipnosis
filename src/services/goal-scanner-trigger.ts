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

      console.log('[Scanner Trigger] Invoking goal-session-scanner Edge Function...');
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

      console.log('[Scanner Trigger] Scan completed:', result);
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
        console.log('[Scanner Trigger] Session has no next_scan_time, triggering scan...');
        await this.triggerScan(sessionId);
        return true;
      }

      if (nextScan <= now) {
        console.log('[Scanner Trigger] Scan is due, triggering now...');
        await this.triggerScan(sessionId);
        return true;
      }

      const timeUntilScan = nextScan.getTime() - now.getTime();
      console.log(`[Scanner Trigger] Next scan in ${Math.round(timeUntilScan / 1000)}s`);
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

    console.log(`[Scanner Trigger] Starting polling for session ${sessionId} every ${intervalMs}ms`);

    this.checkAndTriggerIfNeeded(sessionId);

    this.pollingInterval = window.setInterval(() => {
      this.checkAndTriggerIfNeeded(sessionId);
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      console.log('[Scanner Trigger] Stopping polling');
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
          .eq('timeframe', 'M15')
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
