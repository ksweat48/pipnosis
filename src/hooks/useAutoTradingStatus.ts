import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { autoTradingController } from '../strategies/core/autoTradingController';

export interface AutoTradingStatus {
  isActive: boolean;
  monitoredSymbols: string[];
  lastScanTime: Date | null;
  nextScanTime: Date | null;
  tradesToday: number;
  tradesRemaining: number;
  currentPhase: string | null;
  scanningSymbol: string | null;
  sessionStartTime: Date | null;
}

interface SymbolPhaseStatus {
  symbol: string;
  phase1: { passed: boolean | null; confidence: number | null; reason: string | null };
  phase2: { passed: boolean | null; confidence: number | null; reason: string | null };
  phase3: { passed: boolean | null; confidence: number | null; reason: string | null };
  overallConfidence: number;
  signalGenerated: boolean;
  direction?: 'BUY' | 'SELL';
  entryPrice?: number;
  currentPrice?: number;
  rsi?: number;
  vwap?: number;
  atr?: number;
}

const DEFAULT_STATUS: AutoTradingStatus = {
  isActive: false,
  monitoredSymbols: [],
  lastScanTime: null,
  nextScanTime: null,
  tradesToday: 0,
  tradesRemaining: 0,
  currentPhase: null,
  scanningSymbol: null,
  sessionStartTime: null,
};

export function useAutoTradingStatus() {
  const { user } = useAuth();
  const [status, setStatus] = useState<AutoTradingStatus>(DEFAULT_STATUS);
  const [symbolStatuses, setSymbolStatuses] = useState<SymbolPhaseStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!user) {
      setStatus(DEFAULT_STATUS);
      setSymbolStatuses([]);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);

      const { data: statusData, error: statusError } = await supabase
        .from('auto_trading_status')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (statusError) throw statusError;

      if (statusData) {
        setStatus({
          isActive: statusData.is_active,
          monitoredSymbols: statusData.monitored_symbols || [],
          lastScanTime: statusData.last_scan_at ? new Date(statusData.last_scan_at) : null,
          nextScanTime: statusData.next_scan_at ? new Date(statusData.next_scan_at) : null,
          tradesToday: statusData.trades_today,
          tradesRemaining: statusData.trades_remaining,
          currentPhase: statusData.current_phase,
          scanningSymbol: statusData.scanning_symbol,
          sessionStartTime: statusData.session_start_at ? new Date(statusData.session_start_at) : null,
        });
      } else {
        setStatus(DEFAULT_STATUS);
      }

      const { data: historyData, error: historyError } = await supabase
        .from('auto_trading_scan_history')
        .select('*')
        .eq('user_id', user.id)
        .order('scan_timestamp', { ascending: false })
        .limit(50);

      if (historyError) throw historyError;

      if (historyData && historyData.length > 0) {
        const symbolMap = new Map<string, SymbolPhaseStatus>();

        for (const scan of historyData) {
          if (!symbolMap.has(scan.symbol)) {
            symbolMap.set(scan.symbol, {
              symbol: scan.symbol,
              phase1: {
                passed: scan.phase1_passed,
                confidence: scan.phase1_confidence,
                reason: scan.phase1_reason,
              },
              phase2: {
                passed: scan.phase2_passed,
                confidence: scan.phase2_confidence,
                reason: scan.phase2_reason,
              },
              phase3: {
                passed: scan.phase3_passed,
                confidence: scan.phase3_confidence,
                reason: scan.phase3_reason,
              },
              overallConfidence: scan.overall_confidence || 0,
              signalGenerated: scan.signal_generated,
              direction: scan.trade_direction as 'BUY' | 'SELL' | undefined,
              entryPrice: scan.entry_price ? parseFloat(scan.entry_price.toString()) : undefined,
            });
          }
        }

        setSymbolStatuses(Array.from(symbolMap.values()));
      } else {
        setSymbolStatuses([]);
      }
    } catch (err) {
      console.error('Error loading auto-trading status:', err);
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadStatus();

    const interval = setInterval(() => {
      loadStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [loadStatus]);

  const updateStatus = useCallback(async (updates: Partial<AutoTradingStatus>) => {
    if (!user) return;

    try {
      setError(null);

      const updateData: any = {};

      if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
      if (updates.monitoredSymbols !== undefined) updateData.monitored_symbols = updates.monitoredSymbols;
      if (updates.lastScanTime !== undefined) updateData.last_scan_at = updates.lastScanTime?.toISOString();
      if (updates.nextScanTime !== undefined) updateData.next_scan_at = updates.nextScanTime?.toISOString();
      if (updates.tradesToday !== undefined) updateData.trades_today = updates.tradesToday;
      if (updates.tradesRemaining !== undefined) updateData.trades_remaining = updates.tradesRemaining;
      if (updates.currentPhase !== undefined) updateData.current_phase = updates.currentPhase;
      if (updates.scanningSymbol !== undefined) updateData.scanning_symbol = updates.scanningSymbol;
      if (updates.sessionStartTime !== undefined) updateData.session_start_at = updates.sessionStartTime?.toISOString();

      const { data: existing } = await supabase
        .from('auto_trading_status')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from('auto_trading_status')
          .update(updateData)
          .eq('user_id', user.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('auto_trading_status')
          .insert({
            user_id: user.id,
            ...updateData,
          });

        if (insertError) throw insertError;
      }

      setStatus(prev => ({ ...prev, ...updates }));
    } catch (err) {
      console.error('Error updating auto-trading status:', err);
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  }, [user]);

  const recordScan = useCallback(async (
    symbol: string,
    phaseResults: {
      phase1: { passed: boolean; confidence: number; reason: string };
      phase2: { passed: boolean; confidence: number; reason: string };
      phase3: { passed: boolean; confidence: number; reason: string };
      overallConfidence: number;
      signalGenerated: boolean;
      direction?: 'BUY' | 'SELL';
      entryPrice?: number;
    }
  ) => {
    if (!user) return;

    try {
      const { error: insertError } = await supabase
        .from('auto_trading_scan_history')
        .insert({
          user_id: user.id,
          symbol,
          phase1_passed: phaseResults.phase1.passed,
          phase1_confidence: phaseResults.phase1.confidence,
          phase1_reason: phaseResults.phase1.reason,
          phase2_passed: phaseResults.phase2.passed,
          phase2_confidence: phaseResults.phase2.confidence,
          phase2_reason: phaseResults.phase2.reason,
          phase3_passed: phaseResults.phase3.passed,
          phase3_confidence: phaseResults.phase3.confidence,
          phase3_reason: phaseResults.phase3.reason,
          overall_confidence: phaseResults.overallConfidence,
          signal_generated: phaseResults.signalGenerated,
          trade_direction: phaseResults.direction,
          entry_price: phaseResults.entryPrice,
        });

      if (insertError) throw insertError;

      loadStatus();
    } catch (err) {
      console.error('Error recording scan:', err);
    }
  }, [user, loadStatus]);

  return {
    status,
    symbolStatuses,
    isLoading,
    error,
    updateStatus,
    recordScan,
    refresh: loadStatus,
  };
}
