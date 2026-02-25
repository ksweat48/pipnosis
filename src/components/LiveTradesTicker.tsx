/**
 * LIVE TRADES TICKER
 *
 * SSOT: Reads open trades from goal_session_trades (read-only, no mutations).
 * CCIP: No business logic — purely a display/social proof component.
 * Governance: Uses Supabase realtime subscription + polling fallback.
 *             Realtime UPDATE payloads are applied surgically in local state
 *             (zero network round-trip) so P&L values update instantly for
 *             all viewers, not just the user who owns the trade.
 *             Anonymises all user emails before display.
 *             Hides entirely when zero open trades exist — no empty UI.
 *
 * P&L UPDATE STRATEGY:
 *   - INSERT  → full re-fetch (new trade needs email lookup)
 *   - UPDATE  → surgical local state patch using Realtime payload.new
 *               (current_pnl, status). Re-fetch only if trade closed (status != open).
 *   - Polling → 4-second safety net in case Realtime misses an event.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface LiveTrade {
  id: string;
  symbol: string;
  direction: string;
  current_pnl: number | null;
  email: string;
}

function abbreviateEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  const prefix = local.length >= 2 ? local.slice(0, 2) : local;
  const domainInitial = domain.length > 0 ? domain[0] : '?';
  return `${prefix}***@${domainInitial}`;
}

const POLL_INTERVAL_MS = 4_000;

export const LiveTradesTicker: React.FC = () => {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tradesRef = useRef<LiveTrade[]>([]);

  tradesRef.current = trades;

  const fetchOpenTrades = useCallback(async () => {
    const { data: tradesData, error: tradesError } = await supabase
      .from('goal_session_trades')
      .select('id, symbol, direction, current_pnl, user_id')
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(50);

    if (tradesError || !tradesData || tradesData.length === 0) {
      setTrades([]);
      return;
    }

    const userIds = [...new Set(tradesData.map((t) => t.user_id as string).filter(Boolean))];

    const emailMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('user_profiles')
        .select('id, email')
        .in('id', userIds);

      (profilesData || []).forEach((p: { id: string; email?: string }) => {
        emailMap[p.id] = abbreviateEmail(p.email ?? '');
      });
    }

    const mapped: LiveTrade[] = tradesData.map((row) => ({
      id: row.id as string,
      symbol: row.symbol as string,
      direction: row.direction as string,
      current_pnl: row.current_pnl as number | null,
      email: emailMap[row.user_id as string] ?? '***',
    }));

    setTrades(mapped);
  }, []);

  const handleTradeUpdate = useCallback((payload: { new: Record<string, unknown> }) => {
    const updated = payload.new;
    if (!updated || typeof updated.id !== 'string') return;

    if (updated.status !== 'open') {
      setTrades((prev) => prev.filter((t) => t.id !== updated.id));
      return;
    }

    const newPnl = typeof updated.current_pnl === 'number' ? updated.current_pnl : null;

    setTrades((prev) => {
      const idx = prev.findIndex((t) => t.id === updated.id);
      if (idx === -1) {
        fetchOpenTrades();
        return prev;
      }
      const next = [...prev];
      next[idx] = { ...next[idx], current_pnl: newPnl };
      return next;
    });
  }, [fetchOpenTrades]);

  useEffect(() => {
    fetchOpenTrades();

    channelRef.current = supabase
      .channel('live-trades-ticker')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'goal_session_trades' },
        () => { fetchOpenTrades(); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'goal_session_trades' },
        handleTradeUpdate
      )
      .subscribe();

    pollTimerRef.current = setInterval(fetchOpenTrades, POLL_INTERVAL_MS);

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fetchOpenTrades, handleTradeUpdate]);

  if (trades.length === 0) return null;

  const displayList = trades.length < 4 ? [...trades, ...trades, ...trades] : [...trades, ...trades];

  return (
    <div className="w-full overflow-hidden bg-gray-900/80 border border-gray-700/60 rounded-xl mb-6 backdrop-blur-sm">
      <div className="flex items-stretch">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-emerald-600/20 border-r border-emerald-500/30">
          <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase whitespace-nowrap">
            Live Trades
          </span>
        </div>

        <div className="flex-1 overflow-hidden py-2">
          <div
            className="flex items-center gap-6 ticker-scroll"
            style={{
              display: 'flex',
              whiteSpace: 'nowrap',
              animation: `ticker-scroll ${Math.max(18, displayList.length * 4)}s linear infinite`,
              willChange: 'transform',
            }}
          >
            {displayList.map((trade, i) => {
              const pnl = trade.current_pnl ?? 0;
              const isPositive = pnl >= 0;

              return (
                <div
                  key={`${trade.id}-${i}`}
                  className="inline-flex items-center gap-2.5 px-4 py-1 bg-gray-800/60 rounded-lg border border-gray-700/40 flex-shrink-0"
                >
                  <span className="text-[11px] text-gray-400 font-mono">{trade.email}</span>

                  <span className="text-[11px] font-bold text-white tracking-wide">{trade.symbol}</span>

                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    trade.direction?.toLowerCase() === 'buy'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}>
                    {trade.direction?.toLowerCase() === 'buy'
                      ? <TrendingUp className="w-2.5 h-2.5" />
                      : <TrendingDown className="w-2.5 h-2.5" />
                    }
                    {trade.direction?.toUpperCase()}
                  </span>

                  <span className={`text-[11px] font-bold tabular-nums ${
                    isPositive ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {isPositive ? '+' : ''}{pnl.toFixed(2)}
                  </span>

                  <span className="text-gray-600 text-[10px] select-none">|</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
};
