import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Target, TrendingUp, Clock, Activity, CheckCircle, XCircle, Pause, AlertTriangle, Shield, Sparkles, Eye, BarChart3, Wrench, StopCircle } from 'lucide-react';
import { smartGoalSessionManager, SmartGoalSession } from '../services/smart-goal-session-manager';
import { goalScannerTrigger, ScanStatus, MarketDataStatus } from '../services/goal-scanner-trigger';
import { useAuth } from '../hooks/useAuth';
import { AlphaScanningFeed } from './AlphaScanningFeed';
import { TradingMonitorStack } from './TradingMonitorStack';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { TradeClosedActionDialog } from './TradeClosedActionDialog';
import { NoTradesFoundDialog } from './NoTradesFoundDialog';
import { TP1DecisionModal } from './TP1DecisionModal';
import type { TP1DecisionData } from './TP1DecisionModal';
import { goalSessionLiveEngine } from '../services/goal-session-live-engine';
import type { NoTradeRejectionContext } from '../services/goal-session-live-engine';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { getRiskPercentage } from '../config/risk-levels';
import { calculatePipDistance, calculateDollarPerPip, formatLotSize } from '../utils/currencyHelpers';
import { useToast } from '../hooks/useToast';
import { calculatePnL } from '../types/position';
import { positionService } from '../services/position-service';
import { pricePollingCoordinator } from '../services/price-polling-coordinator';
import { getForexMarketStatus } from '../utils/marketHours';
// GoalScanReadinessIndicator removed - using simple indicator

export const GoalSessionDashboard: React.FC = () => {
  const { user } = useAuth();
  const { confirm } = useConfirmDialog();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [activeSession, setActiveSession] = useState<SmartGoalSession | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [scanStatus, setScanStatus] = useState<ScanStatus>(goalScannerTrigger.getStatus());
  const [openTrades, setOpenTrades] = useState<any[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, { bid: number; ask: number }>>({});
  const [showTradeClosedAction, setShowTradeClosedAction] = useState(false);
  const [tradeClosedData, setTradeClosedData] = useState<any>(null);
  const [showNoTradesModal, setShowNoTradesModal] = useState(false);
  const [noTradesLoading, setNoTradesLoading] = useState(false);
  const [noTradeRejectionContext, setNoTradeRejectionContext] = useState<NoTradeRejectionContext | null>(null);
  const noTradesSessionIdRef = useRef<string | null>(null);
  const showNoTradesModalRef = useRef(false);
  const [forceCloseAttempted, setForceCloseAttempted] = useState<string | null>(null);
  const [sessionHealth, setSessionHealth] = useState<any>(null);
  const [unstickLoading, setUnstickLoading] = useState(false);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [isClosingSession, setIsClosingSession] = useState(false);
  const [closureTimeoutId, setClosureTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [processedTradeClosures, setProcessedTradeClosures] = useState<Set<string>>(new Set());
  const [showTP1Modal, setShowTP1Modal] = useState(false);
  const [tp1DecisionData, setTP1DecisionData] = useState<TP1DecisionData | null>(null);
  const processedTP1Hits = useRef<Set<string>>(new Set());
  // CCIP-SSOT (2026-03-02 TRADE-CLOSE-MODAL-SSOT): Guard ref so the fallback
  // condition check on line ~176 does not crash. GoalSessionDashboard no longer
  // owns trade-close modal display — RealtimeTradeNotificationListener is the
  // sole authority (see realtime-trade-notification-listener.ts). This ref is kept
  // for forward-compatibility: if a GoalAchieved modal is ever shown locally, set
  // showGoalAchievedRef.current = true to prevent downstream logic from firing.
  const showGoalAchievedRef = useRef(false);

  useEffect(() => {
    if (!activeSession) return;

    const handleNoTradeFound = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId !== activeSession.sessionId) return;
      if (showNoTradesModal) return;

      console.log('[GoalSessionDashboard] Scan completed with no qualifying trade - showing dialog');
      setNoTradeRejectionContext(detail?.rejectionContext || null);
      noTradesSessionIdRef.current = activeSession.sessionId;
      showNoTradesModalRef.current = true;
      setShowNoTradesModal(true);
    };

    window.addEventListener('alpha-scan-no-trade', handleNoTradeFound);
    return () => window.removeEventListener('alpha-scan-no-trade', handleNoTradeFound);
  // CCIP-GUARD: showNoTradesModal intentionally excluded from deps. The guard
  // `if (showNoTradesModal) return` inside the handler is sufficient. Including it
  // caused the listener to tear down and re-register on every modal toggle, creating
  // a gap window during which the no-trade event could fire unheard.
  }, [activeSession?.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    loadSessionData();

    // More frequent updates for real-time progress (every 3 seconds)
    const interval = setInterval(loadSessionData, 3000);

    const handleSessionCreated = () => {
      loadSessionData();
    };

    window.addEventListener('goal-session-created', handleSessionCreated);

    const unsubscribe = goalScannerTrigger.onStatusChange((status) => {
      setScanStatus(status);
      if (!status.isScanning) {
        loadSessionData();
      }
    });

    return () => {
      console.log('[GoalSessionDashboard] Component cleanup - stopping polling');
      clearInterval(interval);
      window.removeEventListener('goal-session-created', handleSessionCreated);
      unsubscribe();
      // Stop polling on component unmount
      goalScannerTrigger.stopPolling();
    };
  }, [user?.id]); // Use user.id instead of user to prevent re-runs when user object changes

  // Listen for trade closures
  // CCIP-FIX (2026-03-02 SUBSCRIPTION-CHURN-SSOT): deps use stable primitives (user.id,
  // activeSession.sessionId) instead of the full activeSession object, which is a new
  // reference on every loadSessionData() call (every 3s).  The channel filter only
  // needs the session ID string, so rebuilding on every progress poll was causing the
  // subscription to tear down and re-subscribe every 3 seconds — creating a window
  // where real-time trade-close events could be missed.
  useEffect(() => {
    if (!user || !activeSession) return;

    console.log('[GoalSessionDashboard] 🔌 Setting up realtime subscription for trade closures');
    console.log('[GoalSessionDashboard] Session ID:', activeSession.sessionId);

    const channel = supabase
      .channel('trade-closures')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'goal_session_trades',
          filter: `goal_session_id=eq.${activeSession.sessionId}`
        },
        (payload) => {
          // GOVERNANCE: Smart filtering - only process meaningful state changes
          // Ignore heartbeat events where nothing actually changed
          const statusChanged = payload.new?.status !== payload.old?.status;
          const closedReasonAdded = payload.new?.close_reason && !payload.old?.close_reason;
          const meaningfulChange = statusChanged || closedReasonAdded;

          if (!meaningfulChange) {
            // Skip logging for heartbeat events
            return;
          }

          console.log('[GoalSessionDashboard] 📡 Realtime UPDATE event received (meaningful):', {
            old_status: payload.old?.status,
            new_status: payload.new?.status,
            close_reason: payload.new?.close_reason,
            profit_loss: payload.new?.profit_loss
          });

          if (payload.new.status === 'closed' && payload.old.status === 'open') {
            // CCIP-SSOT (2026-03-02 TRADE-CLOSE-MODAL-SSOT): GoalSessionDashboard is NOT
            // the authority for trade-close modal display or audio. That responsibility
            // belongs exclusively to RealtimeTradeNotificationListener (via goal_notifications
            // INSERT path). Owning the modal here created a duplicate popup + duplicate sound
            // because both this subscription and the notification listener fired for every
            // trade close within seconds of each other.
            //
            // GoalSessionDashboard's sole responsibility here: reload session state so the
            // UI reflects the updated progress/balance after the trade closes.
            console.log('[GoalSessionDashboard] Trade closed — reloading session data (modal owned by RealtimeTradeNotificationListener)');
            loadSessionData();
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[GoalSessionDashboard] ✅ Realtime subscription active for trade updates');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.log('[GoalSessionDashboard] ℹ️ Realtime subscription unavailable, polling will handle updates');
        } else if (status === 'CLOSED') {
          console.log('[GoalSessionDashboard] 📡 Realtime subscription closed');
        }
      });

    return () => {
      console.log('[GoalSessionDashboard] 🔌 Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeSession?.sessionId]);

  // CCIP-FIX (2026-03-02 SUBSCRIPTION-CHURN-SSOT + TP1-COLUMN-SSOT):
  // 1. Deps changed from [user, activeSession] to stable primitives to prevent 3-second churn.
  // 2. Column names corrected to match DB SSOT schema:
  //    - unrealized_pnl  -> current_pnl    (SSOT: universal PNL column for open/closed trades)
  //    - take_profit_2   -> tp2_price       (SSOT: dual-TP system column name from migration 20260103072555)
  useEffect(() => {
    if (!user || !activeSession) return;

    const sessionId = activeSession.sessionId;
    const goalAmount = activeSession.config.goalAmount;

    const tp1Channel = supabase
      .channel(`tp1-hits-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'goal_session_trades',
          filter: `goal_session_id=eq.${sessionId}`
        },
        (payload) => {
          const tp1JustHit =
            payload.new?.tp1_hit === true &&
            payload.old?.tp1_hit === false &&
            payload.new?.status === 'open';

          if (!tp1JustHit) return;

          // CCIP GOVERNANCE (2026-03-12 SCALP-TP-FIX): Scalp trades have tp2_price = NULL.
          // The TP1 modal must only fire for dual-TP trades (MICRO_INTRADAY / INTRADAY).
          // For scalp trades the position is already closing via the legacy single-TP path;
          // showing a TP1 modal with TP2 language would be incorrect and confusing.
          const tp2Price = payload.new.tp2_price != null ? parseFloat(payload.new.tp2_price) : null;
          if (tp2Price === null) {
            console.log('[GoalSessionDashboard] TP1 hit on single-TP trade (scalp) — suppressing TP1 modal, trade is closing normally');
            return;
          }

          const tradeId = payload.new.id as string;
          if (processedTP1Hits.current.has(tradeId)) return;
          processedTP1Hits.current.add(tradeId);

          console.log('[GoalSessionDashboard] TP1 hit detected for dual-TP trade', tradeId);

          // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): Mark modal as shown in DB immediately.
          // This prevents checkMissedTP1 from re-showing the modal after a page reload.
          supabase.rpc('mark_tp1_modal_shown', {
            p_trade_id: tradeId,
            p_user_id: user!.id,
          }).then(({ data: wasFirstShow, error }) => {
            if (error) console.warn('[GoalSessionDashboard] mark_tp1_modal_shown failed (non-critical):', error.message);
            else if (!wasFirstShow) {
              console.log('[GoalSessionDashboard] TP1 modal already shown for trade', tradeId, '— suppressing duplicate');
              processedTP1Hits.current.add(tradeId);
              return;
            }
          });

          const currentProfit = parseFloat(payload.new.current_pnl ?? '0') ||
            parseFloat(payload.new.profit_loss ?? '0') || 0;

          setTP1DecisionData({
            tradeId,
            sessionId,
            symbol: payload.new.symbol,
            direction: payload.new.direction,
            tp1Price: parseFloat(payload.new.take_profit ?? '0'),
            tp2Price,
            currentProfit,
            goalAmount,
          });
          setShowTP1Modal(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tp1Channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeSession?.sessionId]);

  // CCIP FIX (2026-03-01 TP-MODAL-PNL-SSOT): Missed-event guard for TP1 modal.
  // If the component mounts AFTER the Realtime tp1_hit event was already emitted
  // (e.g. page reload while trade is active between TP1 and TP2), the subscription
  // above will never fire. This effect queries on mount and whenever the session
  // changes to catch any open trade that already has tp1_hit=true but has not yet
  // been shown the TP1 decision modal.
  useEffect(() => {
    if (!user || !activeSession) return;

    let cancelled = false;

    const checkMissedTP1 = async () => {
      // CCIP-FIX (2026-03-02 TP1-COLUMN-SSOT): Column names corrected to match DB SSOT schema:
      //   take_profit_2  -> tp2_price    (dual-TP SSOT, migration 20260103072555)
      //   unrealized_pnl -> current_pnl  (universal PNL SSOT, migration 20260114001122)
      //
      // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): Added .eq('tp1_modal_shown', false).
      // Previously the query returned any tp1_hit=true open trade — including ones where the
      // modal was already shown and dismissed. After a page reload the modal would re-appear.
      // tp1_modal_shown is set to true by mark_tp1_modal_shown() the moment the modal opens,
      // so this query only returns trades that genuinely missed the modal event.
      const { data: openTP1Trade } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, direction, take_profit, tp2_price, current_pnl, profit_loss')
        .eq('goal_session_id', activeSession.sessionId)
        .eq('status', 'open')
        .eq('tp1_hit', true)
        .eq('tp1_modal_shown', false)
        .maybeSingle();

      if (cancelled || !openTP1Trade) return;
      if (processedTP1Hits.current.has(openTP1Trade.id)) return;

      // CCIP GOVERNANCE (2026-03-12 SCALP-TP-FIX): Suppress TP1 modal for single-TP (scalp) trades.
      const recoveredTP2Price = openTP1Trade.tp2_price != null ? parseFloat(openTP1Trade.tp2_price) : null;
      if (recoveredTP2Price === null) {
        console.log('[GoalSessionDashboard] Recovered TP1 event is for single-TP trade — suppressing modal');
        return;
      }

      processedTP1Hits.current.add(openTP1Trade.id);
      console.log('[GoalSessionDashboard] Recovered missed TP1 modal for dual-TP trade', openTP1Trade.id);

      // CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): Mark modal as shown in DB before displaying.
      supabase.rpc('mark_tp1_modal_shown', {
        p_trade_id: openTP1Trade.id,
        p_user_id: user!.id,
      }).then(({ error }) => {
        if (error) console.warn('[GoalSessionDashboard] mark_tp1_modal_shown (recovery) failed (non-critical):', error.message);
      });

      const currentProfit =
        parseFloat(openTP1Trade.current_pnl ?? '0') ||
        parseFloat(openTP1Trade.profit_loss ?? '0') || 0;

      setTP1DecisionData({
        tradeId: openTP1Trade.id,
        sessionId: activeSession.sessionId,
        symbol: openTP1Trade.symbol,
        direction: openTP1Trade.direction,
        tp1Price: parseFloat(openTP1Trade.take_profit ?? '0'),
        tp2Price: recoveredTP2Price,
        currentProfit,
        goalAmount: activeSession.config.goalAmount,
      });
      setShowTP1Modal(true);
    };

    checkMissedTP1();
    return () => { cancelled = true; };
  }, [user, activeSession?.sessionId]);

  useEffect(() => {
    if (!activeSession) {
      // No active session - ensure polling is stopped
      goalScannerTrigger.stopPolling();
      return;
    }

    const validStatuses = ['scanning', 'initializing', 'active', 'trade_pending', 'in_trade'];
    if (validStatuses.includes(activeSession.status)) {
      console.log(`[GoalSessionDashboard] Starting polling for session ${activeSession.sessionId} (status: ${activeSession.status})`);
      goalScannerTrigger.startPolling(activeSession.sessionId, 60000);
    } else {
      console.log(`[GoalSessionDashboard] Stopping polling - session status is ${activeSession.status}`);
      goalScannerTrigger.stopPolling();
    }

    // Cleanup: don't stop polling here, let the next render decide
    return () => {
      // No cleanup needed - next render will handle it
    };
  }, [activeSession?.sessionId, activeSession?.status]);

  // CRITICAL: Subscribe to active_pairs_count updates from goal-scanner
  // This ensures the UI displays the correct filtered count when markets close
  useEffect(() => {
    if (!user || !activeSession) return;

    console.log('[GoalSessionDashboard] 🔌 Setting up realtime subscription for active_pairs_count updates');

    const channel = supabase
      .channel('active-pairs-count-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'goal_sessions',
          filter: `id=eq.${activeSession.sessionId}`
        },
        (payload) => {
          const newPairsCount = payload.new.active_pairs_count;
          const oldPairsCount = payload.old?.active_pairs_count;

          if (newPairsCount !== oldPairsCount) {
            console.log(`[GoalSessionDashboard] 📊 Active pairs count updated: ${oldPairsCount} → ${newPairsCount}`);

            // Update activeSession with new count
            setActiveSession(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                activePairsCount: newPairsCount
              };
            });
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[GoalSessionDashboard] 🔌 Cleaning up active_pairs_count subscription');
      supabase.removeChannel(channel);
    };
  }, [user, activeSession?.sessionId]);

  // Subscribe to live prices via shared coordinator (no direct DB reads, CDN-cached)
  const openTradesRef = useRef(openTrades);
  openTradesRef.current = openTrades;

  useEffect(() => {
    if (!activeSession) return;

    const unsubscribe = pricePollingCoordinator.subscribe((update) => {
      const trades = openTradesRef.current;
      if (trades.length === 0) return;

      const symbols = new Set(trades.map((t) => t.symbol));
      const prices: Record<string, { bid: number; ask: number }> = {};

      for (const priceData of update.prices) {
        if (symbols.has(priceData.symbol)) {
          prices[priceData.symbol] = { bid: priceData.bid, ask: priceData.ask };
        }
      }

      if (Object.keys(prices).length > 0) {
        setLivePrices((prev) => ({ ...prev, ...prices }));
      }
    });

    return () => unsubscribe();
  }, [activeSession?.sessionId]);

  const loadSessionData = async () => {
    if (!user) return;

    try {
      const previousSessionId = activeSession?.sessionId ?? null;
      const session = await smartGoalSessionManager.getActiveSession(user.id);
      // CCIP-GUARD: Do NOT clear activeSession while the no-trade modal is visible.
      // The engine sets status='user_stopped' (terminal) right before firing the no-trade
      // event. The 3-second polling loop would immediately call setActiveSession(null),
      // unmounting the modal before the 30-second countdown completes. We preserve the
      // session object in state until the user explicitly dismisses the dialog.
      if (session !== null || !showNoTradesModalRef.current) {
        setActiveSession(session);
      }

      // SSOT FIX (CCIP 2026-02-25): When a session transitions from active → null (terminal),
      // check if it was closed by a NO_TRADE event. getActiveSession excludes terminal statuses,
      // so once the engine sets status='user_stopped' the session disappears from the query.
      // We must check the DB directly before the session becomes unreachable.
      if (!session && previousSessionId && !showNoTradesModal) {
        const { data: closedSession } = await supabase
          .from('goal_sessions')
          .select('status, no_trade_found_at')
          .eq('id', previousSessionId)
          .maybeSingle();

        if (closedSession?.no_trade_found_at != null) {
          console.log('[GoalSessionDashboard] DB-detected NO_TRADE session closure - showing dialog');
          showNoTradesModalRef.current = true;
          setShowNoTradesModal(true);
        }
      }

      if (session) {
        try {
          await supabase.rpc('check_session_timeout_health', {
            p_session_id: session.sessionId
          });
        } catch {
          // Health check is diagnostic only - failures are non-critical
        }

        try {
          const health = await checkSessionHealth(session.sessionId);
          setSessionHealth(health);
        } catch {
          // Stuck detection failure is non-critical
        }

        // Load data separately with individual error handling
        try {
          const progressData = await smartGoalSessionManager.getSessionProgress(session.sessionId);
          setProgress(progressData);
        } catch (error) {
          console.error('[GoalSessionDashboard] Error loading progress:', error);
          setProgress(null);
        }

        try {
          const { data: trades } = await supabase
            .from('goal_session_trades')
            .select('*')
            .eq('goal_session_id', session.sessionId)
            .eq('status', 'open')
            .order('opened_at', { ascending: false });

          setOpenTrades(trades || []);

          if ((!trades || trades.length === 0) && session.status === 'active') {
            const updatedMs = new Date(session.lastUpdated || session.startTime).getTime();
            const staleForMs = Date.now() - updatedMs;
            if (staleForMs > 2 * 60 * 1000) {
              console.warn('[GoalSessionDashboard] Orphan detected: active session with 0 open trades, stale >2min. Running cleanup.');
              const { data: cleanupResult } = await supabase.rpc('cleanup_orphaned_sessions');
              if (cleanupResult?.sessions_cleaned > 0) {
                console.log('[GoalSessionDashboard] Orphan cleanup result:', cleanupResult);
                await loadSessionData();
                return;
              }
            }
          }
        } catch (error) {
          console.error('[GoalSessionDashboard] Error loading open trades:', error);
          setOpenTrades([]);
        }
      }
    } catch (error) {
      console.error('[GoalSessionDashboard] Error loading session data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateTimeElapsed = (startTime: string): string => {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const diffMs = now - start;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
      const mins = diffMins % 60;
      return `${diffHours}h ${mins}m`;
    }
    return `${diffMins}m`;
  };

  const formatTradingPrice = (symbol: string, price: number): string => {
    const normalized = symbol.toUpperCase();

    if (normalized.includes('BTC') || normalized.includes('ETH')) {
      return price.toFixed(1);
    }
    if (normalized.includes('XAU') || normalized.includes('GOLD')) {
      return price.toFixed(1);
    }
    if (normalized.includes('US30') || normalized.includes('NAS') ||
        normalized.includes('SPX') || normalized.includes('DJI')) {
      return price.toFixed(1);
    }
    if (normalized.includes('JPY')) {
      return price.toFixed(3);
    }

    return price.toFixed(5);
  };

  /**
   * SSOT: Filter watchlist based on market hours
   * Crypto (BTCUSD, ETHUSD) = 24/7
   * Forex/Indices = Only when Forex market is open
   */
  const getActiveWatchlist = (fullWatchlist: string[]): string[] => {
    const forexStatus = getForexMarketStatus();
    if (forexStatus.isOpen) return fullWatchlist;
    const cryptoSymbols = ['BTCUSD', 'ETHUSD'];
    return fullWatchlist.filter(symbol => cryptoSymbols.includes(symbol));
  };

  const activeWatchlist = useMemo(
    () => activeSession ? getActiveWatchlist(activeSession.config.watchlist) : [],
    [activeSession?.config?.watchlist]
  );

  const handleStartNewSession = async () => {
    if (!user) return;

    // Stop current session
    if (activeSession) {
      await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);
    }

    setShowTradeClosedAction(false);

    // Navigate to start new session (user will use the SmartGoalPanel)
    await loadSessionData();
  };

  const handleContinueCurrentSession = async () => {
    if (!user || !activeSession) return;

    try {
      console.log('[GoalSessionDashboard] ✅ Continue Session clicked - resuming scanning');

      // Record user's choice
      if (tradeClosedData) {
        await supabase.from('goal_trade_actions').insert({
          user_id: user.id,
          goal_session_id: activeSession.sessionId,
          action_type: 'continue_current',
          trade_close_reason: tradeClosedData.closeReason,
          profit_loss: tradeClosedData.profitLoss,
          cumulative_progress: progress?.stats?.totalProfit || 0,
          target_value: activeSession.config.goalAmount
        });
      }

      // Resume scanning
      await supabase
        .from('goal_sessions')
        .update({ status: 'scanning' })
        .eq('id', activeSession.sessionId);

      console.log('[GoalSessionDashboard] ✅ Session resumed - scanner will look for next opportunity');

      setShowTradeClosedAction(false);
      await loadSessionData();
    } catch (error) {
      console.error('[GoalSessionDashboard] Error continuing session:', error);
    }
  };

  const handleCloseForNow = async () => {
    if (!user || !activeSession) return;

    try {
      console.log('[GoalSessionDashboard] 🛑 Close for Now clicked - stopping session', activeSession.sessionId);

      // Record user's choice
      if (tradeClosedData) {
        await supabase.from('goal_trade_actions').insert({
          user_id: user.id,
          goal_session_id: activeSession.sessionId,
          action_type: 'close_for_now',
          trade_close_reason: tradeClosedData.closeReason,
          profit_loss: tradeClosedData.profitLoss,
          cumulative_progress: progress?.stats?.totalProfit || 0,
          target_value: activeSession.config.goalAmount
        });
      }

      // CRITICAL: Stop ALL scanning and polling immediately
      console.log('[GoalSessionDashboard] 🛑 Stopping goal scanner polling...');
      goalScannerTrigger.stopPolling();

      // Stop the session in database
      console.log('[GoalSessionDashboard] 🛑 Stopping session in database...');
      const stopSuccess = await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);

      if (!stopSuccess) {
        console.error('[GoalSessionDashboard] ❌ Failed to stop session');
        throw new Error('Failed to stop session');
      }

      console.log('[GoalSessionDashboard] ✅ Session stopped successfully');

      // Close the dialog
      setShowTradeClosedAction(false);

      // Reload data to show stopped state
      await loadSessionData();

      console.log('[GoalSessionDashboard] ✅ Session closed completely');
    } catch (error) {
      console.error('[GoalSessionDashboard] ❌ Error closing session:', error);
      // Still close the dialog even if there was an error
      setShowTradeClosedAction(false);
    }
  };

  const handleViewAchievements = () => {
    console.log('[GoalSessionDashboard] View All Achievements clicked - navigating...');
    window.dispatchEvent(new CustomEvent('switch-to-achievements-tab'));
    navigate('/ai-trade?tab=achievements');
  };

  const handleTP1ContinueToTP2 = async () => {
    console.log('[GoalSessionDashboard] TP1 decision: continue to TP2');
    if (tp1DecisionData && user) {
      await supabase.from('tp1_decision_log').insert({
        user_id: user.id,
        trade_id: tp1DecisionData.tradeId,
        session_id: tp1DecisionData.sessionId,
        decision: 'continue_to_tp2',
        auto_decided: false,
      }).then(({ error }) => {
        if (error) console.warn('[GoalSessionDashboard] tp1_decision_log insert failed (non-critical):', error.message);
      });
    }
    setShowTP1Modal(false);
    setTP1DecisionData(null);
  };

  const handleTP1CloseSession = async () => {
    console.log('[GoalSessionDashboard] TP1 decision: close session now');
    if (tp1DecisionData && user) {
      await supabase.from('tp1_decision_log').insert({
        user_id: user.id,
        trade_id: tp1DecisionData.tradeId,
        session_id: tp1DecisionData.sessionId,
        decision: 'close_session',
        auto_decided: false,
      }).then(({ error }) => {
        if (error) console.warn('[GoalSessionDashboard] tp1_decision_log insert failed (non-critical):', error.message);
      });
    }
    setShowTP1Modal(false);
    setTP1DecisionData(null);
    await handleCloseForNow();
  };


  const handleStopSession = async () => {
    if (!activeSession || !user) return;

    // All sessions now use standard stop flow
    if (false) { // Disabled code path
      const confirmed = await confirm({
        title: 'Close Session',
        message: 'Are you sure you want to close this session? Any progress will be saved.',
        confirmText: 'Close Session',
        cancelText: 'Cancel',
        variant: 'warning'
      });

      if (!confirmed) return;

      try {
        const { data, error } = await supabase.rpc('stop_session_placeholder', {
          p_session_id: activeSession.sessionId
        });

        if (error) {
          console.error('[GoalSessionDashboard] Error stopping session:', error);
          showToast({
            type: 'error',
            title: 'Failed to Stop Session',
            message: error.message || 'Could not stop the session. Please try again.'
          });
          return;
        }

        if (data?.success) {
          showToast({
            type: 'success',
            title: 'Session Stopped',
            message: 'Goal session has been stopped successfully'
          });
          showNoTradesModalRef.current = false;
          setShowNoTradesModal(false);
                    await loadSessionData();
        } else {
          // Fall back to normal stop flow if function returns error
          console.log('[GoalSessionDashboard] Falling back to normal stop flow');
          await handleNormalStopSession();
        }
      } catch (error: any) {
        console.error('[GoalSessionDashboard] Error stopping session:', error);
        showToast({
          type: 'error',
          title: 'Error',
          message: error.message || 'An error occurred while stopping the session'
        });
      }
      return;
    }

    // Normal stop flow for other statuses
    await handleNormalStopSession();
  };

  const handleNormalStopSession = async () => {
    // CRITICAL FIX: Prevent multiple concurrent closure attempts
    if (!activeSession || !user) return;
    if (isClosingSession) {
      console.warn('[GoalSessionDashboard] ⚠️ Session closure already in progress, ignoring duplicate click');
      return;
    }

    // IMMEDIATE UI FEEDBACK: Disable button BEFORE showing dialog
    // This prevents user from clicking again while dialog is shown
    setIsClosingSession(true);
    console.log('[GoalSessionDashboard] ✋ UI locked to prevent double-click');

    try {
      // Check if there are open trades
      const hasOpenTrades = openTrades.length > 0;

      // Show different confirmation message based on whether there are open trades
      const confirmed = await confirm({
        title: hasOpenTrades ? 'Stop Session with Open Trades?' : 'Stop Goal Session',
        message: hasOpenTrades
          ? `You are closing this session with ${openTrades.length} open trade${openTrades.length > 1 ? 's' : ''}.\n\nAll open positions will be closed at current market prices. Do you want to continue?`
          : 'Are you sure you want to stop this goal session? Any progress will be saved.',
        confirmText: hasOpenTrades ? 'Close All & Stop Session' : 'Stop Session',
        cancelText: 'Cancel',
        variant: 'warning'
      });

      if (!confirmed) {
        console.log('[GoalSessionDashboard] User cancelled session closure');
        setIsClosingSession(false);
        return;
      }

      console.log('[GoalSessionDashboard] 🔄 Starting atomic session closure...');

      // Set timeout for error handling (15 seconds)
      const timeoutId = setTimeout(() => {
        console.error('[GoalSessionDashboard] ⏱️ Session closure timeout - exceeded 15 seconds');
        setIsClosingSession(false);
        showToast({
          type: 'error',
          title: 'Session Closure Timeout',
          message: 'The session closure is taking too long. Please check the status and try again.'
        });
      }, 15000);

      setClosureTimeoutId(timeoutId);

      // Use atomic RPC function (SSOT compliant)
      // This handles: polling stop, trade closing, entry intent cancellation, and database update
      const success = await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);

      // Clear timeout if operation completed
      if (timeoutId) clearTimeout(timeoutId);
      setClosureTimeoutId(null);

      if (success) {
        console.log('[GoalSessionDashboard] ✅ Session closure completed successfully');
        showToast({
          type: 'success',
          title: 'Session Stopped',
          message: 'Goal session has been stopped successfully'
        });

        // Reload session data to confirm status change
        await loadSessionData();
      } else {
        console.error('[GoalSessionDashboard] ❌ Session closure failed');
        showToast({
          type: 'error',
          title: 'Failed to Stop Session',
          message: 'Could not stop the session. Please try again.'
        });
        // Unlock UI on failure so user can try again
        setIsClosingSession(false);
      }
    } catch (error) {
      console.error('[GoalSessionDashboard] ❌ Exception during session closure:', error);

      // Clear timeout on exception
      if (closureTimeoutId) clearTimeout(closureTimeoutId);
      setClosureTimeoutId(null);

      showToast({
        type: 'error',
        title: 'Error',
        message: 'An error occurred while stopping the session'
      });

      // Unlock UI on error so user can try again
      setIsClosingSession(false);
    }
  };

  const handleManualClose = async (trade: any) => {
    if (!user || !activeSession) return;

    // Show confirmation dialog
    const confirmed = await confirm({
      title: 'Close Position Manually?',
      message: `Are you sure you want to manually close your ${trade.direction.toUpperCase()} position on ${trade.symbol}? This will close the trade at the current market price.`,
      confirmText: 'Close Position',
      cancelText: 'Cancel',
      variant: 'warning'
    });

    if (!confirmed) return;

    setClosingPosition(trade.id);
    try {
      console.log('[GoalSessionDashboard] 📤 Manually closing position:', trade.id);

      // Fetch current live price for the symbol
      const { data: priceData, error: priceError } = await supabase
        .from('realtime_prices')
        .select('bid, ask')
        .eq('symbol', trade.symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (priceError || !priceData) {
        throw new Error('Could not fetch current price. Please try again.');
      }

      // Use bid for long positions, ask for short positions
      const rawClosePrice = trade.direction === 'buy' ? priceData.bid : priceData.ask;

      // CRITICAL: Validate price is a valid number, fallback to trade's current price
      const closePrice = (rawClosePrice && !isNaN(rawClosePrice) && rawClosePrice > 0)
        ? rawClosePrice
        : trade.current_price || trade.currentPrice;

      if (!closePrice || isNaN(closePrice) || closePrice <= 0) {
        throw new Error(`Invalid close price for ${trade.symbol}. No valid market price available. Current price from trade: ${trade.current_price || trade.currentPrice}`);
      }

      console.log('[GoalSessionDashboard] 💵 Closing at price:', closePrice);

      // Close the position
      const result = await positionService.closePosition(
        trade.id,
        closePrice,
        'manual',
        user.id,
        activeSession.sessionId
      );

      if (result.success) {
        showToast({
          type: 'success',
          title: 'Position Closed',
          message: `Successfully closed ${trade.symbol} at ${closePrice.toFixed(5)}`
        });

        console.log('[GoalSessionDashboard] ✅ Position closed successfully');

        // Reload session data to update UI
        await loadSessionData();
      } else {
        throw new Error(result.message || 'Failed to close position');
      }
    } catch (error: any) {
      console.error('[GoalSessionDashboard] ❌ Error closing position:', error);
      showToast({
        type: 'error',
        title: 'Close Failed',
        message: error.message || 'Could not close position. Please try again.'
      });
    } finally {
      setClosingPosition(null);
    }
  };

  const checkSessionHealth = async (sessionId: string) => {
    try {
      const { data, error } = await supabase.rpc('get_session_health', {
        p_session_id: sessionId
      });

      if (error) {
        console.error('[GoalSessionDashboard] Error checking session health:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[GoalSessionDashboard] Exception checking session health:', error);
      return null;
    }
  };

  const handleUnstickSession = async () => {
    if (!activeSession || !user) return;

    // Show warning dialog
    const confirmed = await confirm({
      title: 'Force Close Stuck Session',
      message: `This will manually close your stuck session. This action cannot be undone.\n\nReason: ${sessionHealth?.stuck_reason || 'Session appears to be stuck'}\n\nOpen trades: ${sessionHealth?.open_trades || 0}`,
      confirmText: 'Force Close',
      cancelText: 'Cancel',
      variant: 'danger'
    });

    if (!confirmed) return;

    setUnstickLoading(true);
    try {
      // Manual session recovery - SSOT compliant (requires no open trades)
      const { data, error } = await supabase.rpc('unstick_session', {
        p_session_id: activeSession.sessionId
      });

      if (error) {
        console.error('[GoalSessionDashboard] Error force closing session:', error);
        showToast({
          type: 'error',
          title: 'Failed to Close Session',
          message: error.message || 'Could not close the session. Please try again.'
        });
        return;
      }

      if (data?.success) {
        showToast({
          type: 'success',
          title: 'Session Closed',
          message: data.message || 'Your session has been successfully closed!'
        });
        setSessionHealth(null);
        showNoTradesModalRef.current = false;
        setShowNoTradesModal(false);
                await loadSessionData();
      } else {
        showToast({
          type: 'error',
          title: 'Cannot Close Session',
          message: data?.error || 'Session cannot be closed at this time.'
        });
      }
    } catch (error: any) {
      console.error('[GoalSessionDashboard] Exception force closing session:', error);
      showToast({
        type: 'error',
        title: 'Force Close Failed',
        message: error.message || 'An unexpected error occurred.'
      });
    } finally {
      setUnstickLoading(false);
    }
  };

  const handleNoTradesClose = async () => {
    if (!user) return;

    setNoTradesLoading(true);
    try {
      goalScannerTrigger.stopPolling();
      if (activeSession) {
        console.log('[GoalSessionDashboard] No trades found - closing session via authoritative coordinator');
        await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);
      }
      showNoTradesModalRef.current = false;
      setShowNoTradesModal(false);
      await loadSessionData();
    } catch (error) {
      console.error('[GoalSessionDashboard] Error closing session:', error);
      showNoTradesModalRef.current = false;
      setShowNoTradesModal(false);
    } finally {
      setNoTradesLoading(false);
    }
  };

  const formatTimeRemaining = (endTime: string) => {
    const end = new Date(endTime).getTime();
    const now = Date.now();
    const remaining = end - now;

    if (remaining <= 0) return 'Expired';

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h remaining`;
    }

    return `${hours}h ${minutes}m remaining`;
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diffMs = now - time;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
  };

  const calculateCurrentPnL = (trade: any): number => {
    const livePrice = livePrices[trade.symbol];
    if (livePrice) {
      const entryPrice = trade.entry_price || 0;
      const lotSize = trade.lot_size || trade.position_size || 0.01;
      const isLong = trade.direction === 'buy';
      const currentPrice = isLong ? livePrice.bid : livePrice.ask;
      if (entryPrice <= 0) return trade.current_pnl || 0;
      return calculatePnL(trade.direction, entryPrice, currentPrice, lotSize, trade.symbol);
    }
    return trade.current_pnl || trade.profit_loss || 0;
  };

  const calculateExpectedProfitAtPrice = (trade: any, targetPrice: number): number => {
    const entryPrice = trade.entry_price || 0;
    const lotSize = trade.lot_size || trade.position_size || 0.01;
    const symbol = trade.symbol || '';
    if (entryPrice <= 0 || targetPrice <= 0 || !symbol) return 0;
    return calculatePnL(trade.direction, entryPrice, targetPrice, lotSize, symbol);
  };

  const getCurrentTradeTarget = (): number => {
    if (openTrades.length > 0) {
      const totalExpected = openTrades.reduce((sum, trade) => {
        const tpPrice = trade.take_profit || trade.tp2_price || 0;
        return sum + calculateExpectedProfitAtPrice(trade, tpPrice);
      }, 0);
      if (totalExpected > 0) return totalExpected;
    }
    return activeSession?.config.goalAmount || 0;
  };

  const calculateLiveProgressPercentage = (): number => {
    if (!progress || !activeSession) return 0;
    const closedProfit = progress.stats?.closedProfit || 0;
    const openUnrealizedPnL = openTrades.reduce((sum, trade) => sum + calculateCurrentPnL(trade), 0);
    const totalProgress = closedProfit + openUnrealizedPnL;

    if (openTrades.length > 0) {
      const totalExpectedAtTP = openTrades.reduce((sum, trade) => {
        const tpPrice = trade.take_profit || trade.tp2_price || 0;
        return sum + calculateExpectedProfitAtPrice(trade, tpPrice);
      }, 0);
      const denominator = closedProfit + totalExpectedAtTP;
      if (denominator > 0) return (totalProgress / denominator) * 100;
    }

    const sessionGoal = activeSession?.config?.goalAmount || 0;
    return sessionGoal > 0 ? (totalProgress / sessionGoal) * 100 : 0;
  };

  const getTPMarkerData = () => {
    const closedProfit = progress?.stats?.closedProfit || 0;

    if (openTrades.length > 0) {
      let totalExpectedAtTP1 = 0;
      let totalExpectedAtFullTP = 0;
      let hasTP1 = false;
      let hasAnyDualTP = false;

      openTrades.forEach(trade => {
        const tp1Price = trade.tp1_price || 0;
        const hasDualTP = !!trade.tp2_price;
        const fullTargetPrice = trade.take_profit || trade.tp2_price || 0;
        if (fullTargetPrice > 0) totalExpectedAtFullTP += calculateExpectedProfitAtPrice(trade, fullTargetPrice);
        if (tp1Price > 0 && hasDualTP) { totalExpectedAtTP1 += calculateExpectedProfitAtPrice(trade, tp1Price); hasTP1 = true; }
        if (hasDualTP) hasAnyDualTP = true;
      });

      const denominator = closedProfit + totalExpectedAtFullTP;
      return {
        tp1Pct: hasTP1 && denominator > 0 ? ((closedProfit + totalExpectedAtTP1) / denominator) * 100 : null,
        tp1Label: hasTP1 ? `$${totalExpectedAtTP1.toFixed(0)}` : null,
        tp2Label: hasAnyDualTP && totalExpectedAtFullTP > 0 ? `$${totalExpectedAtFullTP.toFixed(0)}` : null,
        tp1Hit: activeSession?.tp1_hit || false,
        tp2Hit: activeSession?.tp2_hit || false,
      };
    }

    const goalAmount = activeSession?.config?.goalAmount || 0;
    const hasDualTPSession = !!activeSession?.tp2_target;
    return {
      tp1Pct: hasDualTPSession && activeSession?.tp1_target && goalAmount > 0 ? (activeSession.tp1_target / goalAmount) * 100 : null,
      tp1Label: hasDualTPSession && activeSession?.tp1_target ? `$${activeSession.tp1_target.toFixed(0)}` : null,
      tp2Label: hasDualTPSession && activeSession?.tp2_target ? `$${activeSession.tp2_target.toFixed(0)}` : null,
      tp1Hit: activeSession?.tp1_hit || false,
      tp2Hit: activeSession?.tp2_hit || false,
    };
  };

  const getTargetRisk = (): { percentage: number; dollarRisk: number } => {
    if (!activeSession) return { percentage: 0, dollarRisk: 0 };
    const accountBalance = activeSession.config.accountBalance || 10000;

    if (activeSession.config.dollarRisk) {
      return {
        percentage: (activeSession.config.dollarRisk / accountBalance) * 100,
        dollarRisk: activeSession.config.dollarRisk
      };
    }

    const riskPct = getRiskPercentage(activeSession.config.riskMode || 'medium');
    return {
      percentage: riskPct,
      dollarRisk: (riskPct / 100) * accountBalance
    };
  };

  const calculateActualRiskPercentage = (): {
    percentage: number;
    dollarRisk: number;
    displayText: string;
    targetPercentage: number;
    targetDollarRisk: number;
    hasDiscrepancy: boolean;
    discrepancyReason: string;
  } => {
    const target = getTargetRisk();

    if (!activeSession || openTrades.length === 0) {
      return {
        percentage: target.percentage,
        dollarRisk: target.dollarRisk,
        displayText: activeSession?.config.dollarRisk
          ? `$${activeSession.config.dollarRisk}`
          : `${target.percentage}%`,
        targetPercentage: target.percentage,
        targetDollarRisk: target.dollarRisk,
        hasDiscrepancy: false,
        discrepancyReason: ''
      };
    }

    const accountBalance = activeSession.config.accountBalance || 10000;
    let totalDollarRisk = 0;

    openTrades.forEach(trade => {
      const lotSize = trade.lot_size || trade.position_size || 0.01;
      const entryPrice = trade.entry_price || 0;
      const stopLoss = trade.stop_loss || 0;

      if (entryPrice > 0 && stopLoss > 0) {
        const pipDistance = calculatePipDistance(trade.symbol, entryPrice, stopLoss);
        const dollarPerPip = calculateDollarPerPip(trade.symbol, lotSize);
        const tradeRisk = pipDistance * dollarPerPip;
        totalDollarRisk += tradeRisk;
      }
    });

    const riskPercentage = (totalDollarRisk / accountBalance) * 100;

    let displayText = `${riskPercentage.toFixed(2)}%`;
    if (openTrades.length > 1) {
      displayText += ` (${openTrades.length} trades)`;
    }

    const discrepancyThreshold = 0.30;
    const ratio = target.percentage > 0 ? riskPercentage / target.percentage : 1;
    const hasDiscrepancy = Math.abs(1 - ratio) > discrepancyThreshold;

    let discrepancyReason = '';
    if (hasDiscrepancy && riskPercentage < target.percentage) {
      discrepancyReason = 'Position undersized due to lot size constraints';
    } else if (hasDiscrepancy && riskPercentage > target.percentage) {
      discrepancyReason = 'Position oversized relative to target risk';
    }

    return {
      percentage: riskPercentage,
      dollarRisk: totalDollarRisk,
      displayText,
      targetPercentage: target.percentage,
      targetDollarRisk: target.dollarRisk,
      hasDiscrepancy,
      discrepancyReason
    };
  };

  const getStatusColor = (status: string) => {
    const colors = {
      initializing: 'text-yellow-400',
      scanning: 'text-blue-400',
      trade_pending: 'text-orange-400',
      in_trade: 'text-green-400',
      goal_achieved: 'text-emerald-400',
      expired: 'text-gray-400',
      stopped: 'text-red-400',
      user_stopped: 'text-red-400',
      timeout: 'text-gray-400',
      weekend_shutdown: 'text-orange-400',
    };
    return colors[status as keyof typeof colors] || 'text-gray-400';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scanning':
        return <Activity className="w-5 h-5 animate-pulse" />;
      case 'in_trade':
        return <TrendingUp className="w-5 h-5" />;
      case 'goal_achieved':
        return <CheckCircle className="w-5 h-5" />;
      case 'expired':
      case 'user_stopped':
      case 'stopped':
      case 'timeout':
        return <StopCircle className="w-5 h-5" />;
      case 'weekend_shutdown':
        return <Pause className="w-5 h-5" />;
      default:
        return <Clock className="w-5 h-5" />;
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="text-center text-gray-400">Loading session...</div>
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="space-y-6">
        <TradingMonitorStack />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

        <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl p-6 border border-gray-700/50 shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="relative hidden sm:block">
                <div className={`absolute inset-0 rounded-xl blur opacity-50 ${getStatusColor(activeSession.status).replace('text-', 'bg-')}`} />
                <div className={`relative p-3 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl ${getStatusColor(activeSession.status)} shadow-lg`}>
                  {getStatusIcon(activeSession.status)}
                </div>
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span className="sm:hidden">Active session</span>
                  <span className="hidden sm:inline">Active Goal Session</span>
                  <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse hidden sm:inline-flex" />
                </h3>
                <p className="text-sm text-gray-400 capitalize hidden sm:block">{activeSession.status.replace('_', ' ')}</p>
                {scanStatus.message && (
                  <p className="text-xs text-gray-500 mt-1 hidden sm:block">{scanStatus.message}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              {sessionHealth?.is_stuck && sessionHealth?.can_unstick && (
                <button
                  onClick={handleUnstickSession}
                  disabled={unstickLoading}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 rounded-xl text-sm font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 shadow-lg hover:shadow-orange-500/25 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`Session stuck: ${sessionHealth.stuck_reason}`}
                >
                  <Wrench className="w-4 h-4" />
                  {unstickLoading ? 'Recovering...' : 'Force Close'}
                </button>
              )}
              <button
                onClick={handleStopSession}
                disabled={isClosingSession}
                className={`w-full sm:w-auto px-4 py-3 sm:py-2 bg-gradient-to-r from-red-600 to-red-700 ${isClosingSession ? 'opacity-50 cursor-not-allowed from-red-700 to-red-800' : 'hover:from-red-500 hover:to-red-600 hover:scale-105 active:scale-95'} rounded-xl text-sm font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 shadow-lg ${isClosingSession ? '' : 'hover:shadow-red-500/25'}`}
              >
                {isClosingSession ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Closing Session...
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4" />
                    Stop Session
                  </>
                )}
              </button>
            </div>
          </div>

        {/* Stuck Session Warning Banner */}
        {sessionHealth?.is_stuck && (
          <div className="mb-4 p-4 bg-orange-900/20 border border-orange-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-orange-300 mb-1">Session Appears Stuck</h4>
                <p className="text-xs text-orange-200/80 mb-2">{sessionHealth.stuck_reason}</p>
                <div className="flex items-center gap-4 text-xs text-orange-200/60">
                  <span>Status: {sessionHealth.status}</span>
                  <span>Time in state: {sessionHealth.minutes_in_state} minutes</span>
                  {sessionHealth.open_trades > 0 && (
                    <span className="text-red-400 font-medium">Open trades: {sessionHealth.open_trades} (close them first)</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Session Ended Banner */}
        {(activeSession.status === 'stopped' || activeSession.status === 'timeout') && (
          <div className="mb-4 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <StopCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-red-300 mb-1">
                  {activeSession.status === 'stopped' ? 'Session Ended' : 'Session Timeout'}
                </h4>
                <p className="text-xs text-red-200/80 mb-3">
                  {activeSession.status === 'stopped'
                    ? 'Your trading session has ended because you closed all trades. Start a new session to continue trading.'
                    : 'Your trading session has ended due to timeout. Start a new session to continue trading.'}
                </p>
                <button
                  onClick={() => navigate('/smart-goal-mode')}
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-lg text-sm font-semibold text-white transition-all duration-300 flex items-center gap-2 shadow-lg hover:shadow-blue-500/25"
                >
                  <Target className="w-4 h-4" />
                  Start New Session
                </button>
              </div>
            </div>
          </div>
        )}

        {openTrades.length > 0 && (
          <div className="mb-4 relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-30 blur animate-pulse" />
            <div className="relative bg-gradient-to-br from-blue-900/40 to-cyan-900/40 border border-blue-500/50 rounded-xl p-4">
              {openTrades.map((trade, index) => {
                const isLong = trade.direction === 'buy';

                // Get live price if available, otherwise fallback to stored price
                const livePrice = livePrices[trade.symbol];
                const currentPrice = livePrice
                  ? (isLong ? livePrice.bid : livePrice.ask)
                  : (trade.current_price || trade.entry_price);

                const currentPnL = calculateCurrentPnL(trade);
                const dollarPerPipValue = calculateDollarPerPip(trade.symbol, trade.lot_size || trade.position_size || 0.01);
                const pips = dollarPerPipValue > 0 ? currentPnL / dollarPerPipValue : 0;

                return (
                  <div key={trade.id} className="space-y-4">
                    {/* Header with Symbol and Actions */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="text-2xl md:text-xl font-bold text-white">{trade.symbol}</div>
                        <div className={`text-sm font-semibold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.direction.toUpperCase()} • {formatLotSize(trade.position_size || trade.lot_size || 0)} lots
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/trade?symbol=${trade.symbol}`)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-lg text-xs font-semibold text-white transition-all duration-200 shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95"
                        >
                          <BarChart3 className="w-4 h-4" />
                          <span className="hidden sm:inline">View Chart</span>
                        </button>
                        <button
                          onClick={() => handleManualClose(trade)}
                          disabled={closingPosition === trade.id}
                          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 rounded-lg text-xs font-semibold text-white transition-all duration-200 shadow-lg hover:shadow-red-500/25 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <StopCircle className="w-4 h-4" />
                          <span className="hidden sm:inline">{closingPosition === trade.id ? 'Closing...' : 'Close'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Mobile-Optimized Trading Levels - Dual TP for Micro/Intraday, Single TP for Scalp */}
                    <div className={`grid grid-cols-2 ${trade.tp2_price ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-3`}>
                      {/* Entry Price */}
                      <div className="bg-gray-800/70 rounded-lg p-3 sm:p-4 border border-gray-700/50">
                        <div className="text-xs font-medium text-gray-400 mb-2">Entry</div>
                        <div className="text-2xl sm:text-xl md:text-lg font-bold text-white font-mono tracking-tight">
                          {formatTradingPrice(trade.symbol, trade.entry_price)}
                        </div>
                      </div>

                      {/* Stop Loss */}
                      <div className="bg-gradient-to-br from-red-900/20 to-orange-900/20 rounded-lg p-3 sm:p-4 border border-red-500/30">
                        <div className="text-xs font-medium text-red-300 mb-2">Stop Loss</div>
                        <div className="text-2xl sm:text-xl md:text-lg font-bold text-red-400 font-mono tracking-tight">
                          {formatTradingPrice(trade.symbol, trade.stop_loss)}
                        </div>
                      </div>

                      {/* TP1 / Target - Shows as "Target" for scalp (single TP), "TP1" for dual TP */}
                      <div className={`bg-gradient-to-br from-cyan-900/20 to-blue-900/20 rounded-lg p-3 sm:p-4 border ${trade.tp1_hit ? 'border-cyan-400/70 shadow-lg shadow-cyan-500/20' : 'border-cyan-500/30'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-cyan-300">{trade.tp2_price ? 'TP1' : 'Target'}</span>
                          {trade.tp1_confidence && trade.tp2_price && (
                            <span className="text-xs text-cyan-400 font-semibold">{Math.round(trade.tp1_confidence)}%</span>
                          )}
                          {trade.tp1_hit && (
                            <span className="text-xs text-cyan-400 font-bold">✓ HIT</span>
                          )}
                        </div>
                        <div className="text-2xl sm:text-xl md:text-lg font-bold text-cyan-400 font-mono tracking-tight">
                          {trade.tp1_price ? formatTradingPrice(trade.symbol, trade.tp1_price) : formatTradingPrice(trade.symbol, trade.take_profit)}
                        </div>
                      </div>

                      {/* TP2 - Full Target (only for Micro/Intraday styles with dual TP) */}
                      {trade.tp2_price && (
                        <div className={`bg-gradient-to-br from-emerald-900/20 to-green-900/20 rounded-lg p-3 sm:p-4 border ${trade.tp2_hit ? 'border-emerald-400/70 shadow-lg shadow-emerald-500/20' : 'border-emerald-500/30'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-emerald-300">TP2</span>
                            {trade.tp2_hit && (
                              <span className="text-xs text-emerald-400 font-bold">✓ HIT</span>
                            )}
                          </div>
                          <div className="text-2xl sm:text-xl md:text-lg font-bold text-emerald-400 font-mono tracking-tight">
                            {formatTradingPrice(trade.symbol, trade.tp2_price)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Current P&L */}
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">Current P&L</span>
                          {livePrice && (
                            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" title="Live price feed active" />
                          )}
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-bold ${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(2)}
                          </div>
                          <div className={`text-xs ${pips >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pips >= 0 ? '+' : ''}{pips.toFixed(1)} pips
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="relative group overflow-hidden rounded-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-blue-500/10 group-hover:from-emerald-500/20 group-hover:to-blue-500/20 transition-all duration-300" />
            <div className="relative bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 group-hover:border-emerald-500/30 transition-all duration-300">
              <div className="text-sm text-gray-400 mb-1" title="Alpha's calculated profit target for the current trade">
                {openTrades.length > 0 ? 'Trade Target' : 'Session Goal'}
              </div>
              <div className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-blue-400">
                ${getCurrentTradeTarget().toFixed(0)}
              </div>
              {openTrades.length > 0 && activeSession.config.goalAmount !== getCurrentTradeTarget() && (
                <div className="text-xs text-gray-500 mt-1">
                  Session Goal: ${activeSession.config.goalAmount.toFixed(0)}
                </div>
              )}
            </div>
          </div>

          <div className="relative group overflow-hidden rounded-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-emerald-500/10 group-hover:from-blue-500/20 group-hover:to-emerald-500/20 transition-all duration-300" />
            <div className="relative bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 group-hover:border-blue-500/30 transition-all duration-300">
              <div className="text-sm text-gray-400 mb-1">Progress</div>
              <div className="text-2xl font-bold text-blue-400">
                ${((progress?.stats?.closedProfit || 0) + openTrades.reduce((sum, trade) => sum + calculateCurrentPnL(trade), 0)).toFixed(2)}
              </div>
            </div>
          </div>

          <div className="relative group overflow-hidden rounded-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-green-500/10 group-hover:from-emerald-500/20 group-hover:to-green-500/20 transition-all duration-300" />
            <div className="relative bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 group-hover:border-emerald-500/30 transition-all duration-300">
              <div className="text-sm text-gray-400 mb-1">Completion</div>
              <div className="text-2xl font-bold text-emerald-400">
                {calculateLiveProgressPercentage().toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="relative group overflow-hidden rounded-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-amber-500/10 group-hover:from-orange-500/20 group-hover:to-amber-500/20 transition-all duration-300" />
            <div className="relative bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 group-hover:border-orange-500/30 transition-all duration-300">
              <div className="text-sm text-gray-400 mb-1">Trades</div>
              <div className="text-lg font-bold text-orange-400">
                {(openTrades.length + (progress?.stats?.closedTradesCount || 0))} / {activeSession.strategy.targetTradeCount}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex justify-between text-sm mb-3">
            <span className="text-gray-400 font-medium">Goal Progress</span>
            <span className="text-white font-bold">{calculateLiveProgressPercentage().toFixed(1)}%</span>
          </div>
          <div className="relative w-full bg-gray-700/50 backdrop-blur-sm rounded-full h-4 overflow-hidden border border-gray-600/50">
            <div className="absolute inset-0 bg-gradient-to-r from-gray-700 to-gray-800" />

            {/* TP1 Marker (Conservative Target) */}
            {(() => {
              const tpData = getTPMarkerData();
              return tpData.tp1Pct !== null && tpData.tp1Label && (
                <div
                  className="absolute top-0 bottom-0 w-1 z-10"
                  style={{ left: `${Math.min(tpData.tp1Pct, 100)}%` }}
                  title={`TP1: ${tpData.tp1Label} (Conservative Target)`}
                >
                  <div className="relative h-full">
                    <div className={`absolute inset-0 ${tpData.tp1Hit ? 'bg-green-400' : 'bg-yellow-400'} shadow-lg`} />
                    <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                      <div className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        tpData.tp1Hit
                          ? 'bg-green-500 text-white'
                          : 'bg-yellow-500 text-gray-900'
                      }`}>
                        {tpData.tp1Hit ? `✓ TP1: ${tpData.tp1Label}` : `TP1: ${tpData.tp1Label}`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* TP2 Marker (Full Target = 100%) */}
            {(() => {
              const tpData = getTPMarkerData();
              return tpData.tp2Label && (
                <div
                  className="absolute top-0 bottom-0 w-1 z-10"
                  style={{ left: `100%` }}
                  title={`TP2: ${tpData.tp2Label} (Full Target)`}
                >
                  <div className="relative h-full">
                    <div className={`absolute inset-0 ${tpData.tp2Hit ? 'bg-green-400' : 'bg-blue-400'} shadow-lg`} />
                    <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                      <div className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        tpData.tp2Hit
                          ? 'bg-green-500 text-white'
                          : 'bg-blue-500 text-white'
                      }`}>
                        {tpData.tp2Hit ? `✓ TP2: ${tpData.tp2Label}` : `TP2: ${tpData.tp2Label}`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div
              className={`relative h-full transition-all duration-500 shadow-lg ${
                openTrades.length > 0
                  ? 'bg-gradient-to-r from-emerald-500 via-cyan-500 to-emerald-400 animate-pulse'
                  : 'bg-gradient-to-r from-emerald-500 via-blue-500 to-emerald-400'
              }`}
              style={{ width: `${Math.max(0, Math.min(calculateLiveProgressPercentage(), 100))}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/20 to-transparent" />
            </div>
          </div>
        </div>

        {progress && progress.stats && (
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{progress.stats.totalTrades || 0}</div>
              <div className="text-xs text-gray-400">Total Trades</div>
            </div>
            <div className="text-center">
              {(() => {
                const riskData = calculateActualRiskPercentage();
                const riskColor =
                  riskData.percentage < 2 ? 'text-green-400' :
                  riskData.percentage < 5 ? 'text-yellow-400' :
                  riskData.percentage < 10 ? 'text-orange-400' : 'text-red-400';

                if (openTrades.length > 0) {
                  return (
                    <div className="space-y-0.5">
                      <div className="flex items-baseline justify-center gap-1">
                        <span className={`text-lg font-bold tabular-nums ${riskColor}`}>
                          {riskData.percentage.toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-gray-500">
                          / {riskData.targetPercentage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-xs text-gray-400">Risk</div>
                    </div>
                  );
                }

                return (
                  <>
                    <div className={`text-2xl font-bold ${riskColor}`}>
                      {riskData.displayText}
                    </div>
                    <div className="text-xs text-gray-400"
                      title={
                        activeSession.config.dollarRisk
                          ? `$${activeSession.config.dollarRisk} per trade${activeSession.config.tradeStyle ? ` • ${activeSession.config.tradeStyle} style` : ''}`
                          : `Max ${getRiskPercentage(activeSession.config.riskMode)}% per trade`
                      }
                    >
                      Risk
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="text-center min-w-0">
              <div className="text-xl font-bold text-blue-400 tabular-nums truncate">
                ${((progress.stats.closedProfit || 0) + openTrades.reduce((sum, trade) => sum + calculateCurrentPnL(trade), 0)).toFixed(2)}
              </div>
              <div className="text-xs text-gray-400">Total Profit</div>
            </div>
          </div>
        )}
        </div>
      </div>

      {activeSession && activeSession.status === 'scanning' && openTrades.length === 0 && (
        <div>
          {/* Show block status if system is blocked by adversarial conditions */}
          {activeSession.block_state ? (
            <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-5">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <AlertTriangle className="w-6 h-6 text-yellow-400" />
                </div>
                <div className="flex-1">
                  <h4 className="text-yellow-200 font-semibold mb-2 flex items-center gap-2">
                    Protected from Manipulation
                    {activeSession.block_candles_ago > 0 && (
                      <span className="text-xs bg-yellow-900/50 px-2 py-1 rounded-full">
                        {activeSession.block_candles_ago} candles ago
                      </span>
                    )}
                  </h4>
                  <p className="text-yellow-100 text-sm mb-3">
                    {activeSession.block_reason || 'Market conditions detected that suggest manipulation or high risk'}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-yellow-200/80">
                    {activeSession.block_expires_at && (
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>
                          Expires: {new Date(activeSession.block_expires_at).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Shield className="w-4 h-4" />
                      <span>Your account is protected</span>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-yellow-200/60">
                    The system will automatically resume scanning when market conditions stabilize.
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <AlphaScanningFeed
              sessionId={activeSession.sessionId}
              hasActiveTrades={openTrades.length > 0}
              isScanning={true}
              activePairsCount={activeSession.activePairsCount || activeWatchlist.length}
              totalPairs={activeSession.config.watchlist.length}
              watchlist={activeWatchlist}
            />
          )}
        </div>
      )}

      {activeSession && (
        <TradingMonitorStack />
      )}

      <NoTradesFoundDialog
        isOpen={showNoTradesModal}
        onClose={handleNoTradesClose}
        sessionId={noTradesSessionIdRef.current ?? ''}
        isLoading={noTradesLoading}
        rejectionContext={noTradeRejectionContext}
      />

      {tradeClosedData && activeSession && progress && (
        <TradeClosedActionDialog
          isOpen={showTradeClosedAction}
          symbol={tradeClosedData.symbol}
          direction={tradeClosedData.direction}
          entryPrice={tradeClosedData.entryPrice}
          exitPrice={tradeClosedData.exitPrice}
          profitLoss={tradeClosedData.profitLoss}
          closeReason={tradeClosedData.closeReason}
          stopLoss={tradeClosedData.stopLoss}
          takeProfit={tradeClosedData.takeProfit}
          currentProgress={progress?.stats?.totalProfit || 0}
          targetValue={activeSession.config.goalAmount}
          tradesInSession={progress?.stats?.totalTrades || 0}
          isGoalAchieved={(progress?.stats?.totalProfit || 0) >= activeSession.config.goalAmount}
          onStartNewSession={handleStartNewSession}
          onContinueSession={handleContinueCurrentSession}
          onCloseForNow={handleCloseForNow}
        />
      )}

      <TP1DecisionModal
        isOpen={showTP1Modal}
        data={tp1DecisionData}
        onContinueToTP2={handleTP1ContinueToTP2}
        onCloseSession={handleTP1CloseSession}
      />
    </div>
  );
};
