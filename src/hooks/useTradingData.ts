import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Types
interface Trade {
  id: string;
  symbol: string;
  trade_type: 'buy' | 'sell';
  lot_size: number;
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  status: 'open' | 'closed' | 'pending';
  pnl: number;
  opened_at: string;
  closed_at?: string;
  mt5_ticket?: string;
  trade_metadata: any;
}

interface KPIData {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  averageRRR: number;
  maxDrawdown: number;
  openTrades: number;
}

interface JournalEntry {
  id: string;
  trade_id?: string;
  entry_type: string;
  title: string;
  content: string;
  confidence_level: string;
  created_at: string;
  metadata: any;
}

// Hook for fetching user's trading KPIs
export const useTradingKPIs = () => {
  const { user } = useAuth();
  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKPIs = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/user/kpis', {
        headers: {
          'Authorization': `Bearer ${user.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch KPIs');
      }

      const data = await response.json();
      setKpis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch KPIs');
      console.error('Error fetching KPIs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchKPIs();
  }, [fetchKPIs]);

  return {
    kpis,
    isLoading,
    error,
    refetch: fetchKPIs
  };
};

// Hook for fetching user's active trades
export const useActiveTrades = () => {
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveTrades = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/user/active-trades', {
        headers: {
          'Authorization': `Bearer ${user.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch active trades');
      }

      const data = await response.json();
      setTrades(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch active trades');
      console.error('Error fetching active trades:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchActiveTrades();
    
    // Refresh active trades every 30 seconds
    const interval = setInterval(fetchActiveTrades, 30000);
    return () => clearInterval(interval);
  }, [fetchActiveTrades]);

  return {
    trades,
    isLoading,
    error,
    refetch: fetchActiveTrades
  };
};

// Hook for fetching user's trade history
export const useTradeHistory = (limit = 50) => {
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTradeHistory = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/user/trade-history?limit=${limit}`, {
        headers: {
          'Authorization': `Bearer ${user.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch trade history');
      }

      const data = await response.json();
      setTrades(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch trade history');
      console.error('Error fetching trade history:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, limit]);

  useEffect(() => {
    fetchTradeHistory();
  }, [fetchTradeHistory]);

  return {
    trades,
    isLoading,
    error,
    refetch: fetchTradeHistory
  };
};

// Hook for fetching user's journal entries
export const useJournalEntries = (limit = 20) => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJournalEntries = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/user/journal-entries?limit=${limit}`, {
        headers: {
          'Authorization': `Bearer ${user.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch journal entries');
      }

      const data = await response.json();
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch journal entries');
      console.error('Error fetching journal entries:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, limit]);

  useEffect(() => {
    fetchJournalEntries();
    
    // Refresh journal entries every 60 seconds to catch AI guidance
    const interval = setInterval(fetchJournalEntries, 60000);
    return () => clearInterval(interval);
  }, [fetchJournalEntries]);

  return {
    entries,
    isLoading,
    error,
    refetch: fetchJournalEntries
  };
};