import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';

export interface ScanCandidate {
  symbol: string;
  action: 'BUY' | 'SELL' | 'WAIT';
  confidence: number;
  score: number;
  reasoning: string;
  trend?: string;
  volatility?: string;
  session?: string;
  adversarialLevel?: string;
}

export interface ScanResult {
  id?: string;
  sessionId: string;
  scanTimestamp: Date;
  scanDurationMs: number;
  symbolsEvaluated: number;
  topCandidate: ScanCandidate | null;
  rejectionReason: string | null;
  allCandidates: ScanCandidate[];
  userId: string;
}

export interface ScanResultSummary {
  scanId: string;
  scanTimestamp: Date;
  scanDurationMs: number;
  topCandidateSymbol: string | null;
  topCandidateAction: string | null;
  topCandidateConfidence: number | null;
  rejectionReason: string | null;
}

/**
 * ScanResultsManager - Manages Alpha scan results for user visibility
 *
 * Responsibilities:
 * - Store scan results to database
 * - Retrieve latest scan results
 * - Track scan history
 * - Provide realtime updates via Supabase subscriptions
 */
export class ScanResultsManager {
  private static instance: ScanResultsManager;
  private realtimeSubscription: any = null;
  private listeners: Set<(result: ScanResult) => void> = new Set();

  private constructor() {}

  static getInstance(): ScanResultsManager {
    if (!ScanResultsManager.instance) {
      ScanResultsManager.instance = new ScanResultsManager();
    }
    return ScanResultsManager.instance;
  }

  /**
   * Store a scan result
   */
  async storeScanResult(result: ScanResult): Promise<void> {
    try {
      const topCandidate = result.topCandidate;

      const { error } = await supabase
        .from('goal_session_scan_results')
        .insert({
          session_id: result.sessionId,
          scan_timestamp: result.scanTimestamp.toISOString(),
          scan_duration_ms: result.scanDurationMs,
          symbols_evaluated: result.symbolsEvaluated,
          top_candidate_symbol: topCandidate?.symbol || null,
          top_candidate_action: topCandidate?.action || null,
          top_candidate_confidence: topCandidate?.confidence || null,
          top_candidate_score: topCandidate?.score || null,
          rejection_reason: result.rejectionReason,
          all_candidates: result.allCandidates,
          user_id: result.userId
        });

      if (error) {
        logger.error(LogCategory.AI_TRADING, '[storeScanResult] Failed to store scan result:', error);
        throw error;
      }

      logger.info(LogCategory.AI_TRADING, '[storeScanResult] ✅ Scan result stored', {
        sessionId: result.sessionId,
        topCandidate: topCandidate?.symbol,
        action: topCandidate?.action,
        confidence: topCandidate?.confidence
      });
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[storeScanResult] Error storing scan result:', error);
      throw error;
    }
  }

  /**
   * Get the latest scan result for a session
   */
  async getLatestScanResult(sessionId: string): Promise<ScanResult | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_latest_scan_result', { p_session_id: sessionId })
        .maybeSingle();

      if (error) {
        logger.error(LogCategory.AI_TRADING, '[getLatestScanResult] Failed to fetch latest scan result:', error);
        throw error;
      }

      if (!data) {
        return null;
      }

      return this.mapDatabaseResultToScanResult(data);
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[getLatestScanResult] Error fetching latest scan result:', error);
      return null;
    }
  }

  /**
   * Get scan history for a session
   */
  async getScanHistory(sessionId: string, limit: number = 5): Promise<ScanResultSummary[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_scan_history', {
          p_session_id: sessionId,
          p_limit: limit
        });

      if (error) {
        logger.error(LogCategory.AI_TRADING, '[getScanHistory] Failed to fetch scan history:', error);
        throw error;
      }

      return (data || []).map((row: any) => ({
        scanId: row.scan_id,
        scanTimestamp: new Date(row.scan_timestamp),
        scanDurationMs: row.scan_duration_ms,
        topCandidateSymbol: row.top_candidate_symbol,
        topCandidateAction: row.top_candidate_action,
        topCandidateConfidence: row.top_candidate_confidence,
        rejectionReason: row.rejection_reason
      }));
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[getScanHistory] Error fetching scan history:', error);
      return [];
    }
  }

  /**
   * Subscribe to realtime scan result updates for a session
   */
  subscribeToScanResults(sessionId: string, callback: (result: ScanResult) => void): () => void {
    this.listeners.add(callback);

    if (!this.realtimeSubscription) {
      logger.info(LogCategory.AI_TRADING, '[subscribeToScanResults] 🔔 Setting up realtime subscription for scan results');

      this.realtimeSubscription = supabase
        .channel('scan-results-updates')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'goal_session_scan_results',
            filter: `session_id=eq.${sessionId}`
          },
          (payload) => {
            logger.info(LogCategory.AI_TRADING, '[subscribeToScanResults] 📊 New scan result received', payload);
            const result = this.mapDatabaseResultToScanResult(payload.new);
            this.listeners.forEach(listener => listener(result));
          }
        )
        .subscribe();

      logger.info(LogCategory.AI_TRADING, '[subscribeToScanResults] ✅ Realtime subscription active');
    }

    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0 && this.realtimeSubscription) {
        logger.info(LogCategory.AI_TRADING, '[subscribeToScanResults] 🔕 Unsubscribing from scan results');
        this.realtimeSubscription.unsubscribe();
        this.realtimeSubscription = null;
      }
    };
  }

  /**
   * Map database row to ScanResult object
   */
  private mapDatabaseResultToScanResult(row: any): ScanResult {
    const topCandidate = row.top_candidate_symbol ? {
      symbol: row.top_candidate_symbol,
      action: row.top_candidate_action as 'BUY' | 'SELL' | 'WAIT',
      confidence: row.top_candidate_confidence,
      score: parseFloat(row.top_candidate_score),
      reasoning: ''
    } : null;

    return {
      id: row.id || row.scan_id,
      sessionId: row.session_id,
      scanTimestamp: new Date(row.scan_timestamp),
      scanDurationMs: row.scan_duration_ms,
      symbolsEvaluated: row.symbols_evaluated,
      topCandidate,
      rejectionReason: row.rejection_reason,
      allCandidates: Array.isArray(row.all_candidates) ? row.all_candidates : [],
      userId: row.user_id
    };
  }

  /**
   * Cleanup method
   */
  cleanup(): void {
    if (this.realtimeSubscription) {
      this.realtimeSubscription.unsubscribe();
      this.realtimeSubscription = null;
    }
    this.listeners.clear();
  }
}

export const scanResultsManager = ScanResultsManager.getInstance();
