import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Clock, Activity, CheckCircle, XCircle, Pause, BarChart2, Cloud, Wifi, AlertTriangle, Search, Shield, Sparkles, Eye, BarChart3, Wrench, StopCircle } from 'lucide-react';
import { smartGoalSessionManager, SmartGoalSession } from '../services/smart-goal-session-manager';
import { goalScannerTrigger, ScanStatus, MarketDataStatus } from '../services/goal-scanner-trigger';
import { useAuth } from '../hooks/useAuth';
import { MarketAnalysisStream } from './MarketAnalysisStream';
import { SimpleEntryMonitor } from './SimpleEntryMonitor';
import { AlphaScanningFeed } from './AlphaScanningFeed';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { ContinuationDialog } from './ContinuationDialog';
import { GoalAchievedDialog } from './GoalAchievedDialog';
import { TradeClosedActionDialog } from './TradeClosedActionDialog';
import { NoTradesFoundDialog } from './NoTradesFoundDialog';
import { goalSessionLiveEngine } from '../services/goal-session-live-engine';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { simpleScanningTimer } from '../services/simple-scanning-timer';
import { getRiskPercentage } from '../config/risk-levels';
import { calculatePipDistance, calculateDollarPerPip } from '../utils/currencyHelpers';
import { useToast } from '../hooks/useToast';
import { calculatePnL } from '../types/position';
import { positionService } from '../services/position-service';
import { continuationHandler } from '../services/continuation-handler';
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
  const [continuationData, setContinuationData] = useState<{
    isAwaiting: boolean;
    prompt: string;
    tradesInSession: number;
  } | null>(null);
  const [continuationLoading, setContinuationLoading] = useState(false);
  const [openTrades, setOpenTrades] = useState<any[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, { bid: number; ask: number }>>({});
  const [showGoalAchieved, setShowGoalAchieved] = useState(false);
  const [showTradeClosedAction, setShowTradeClosedAction] = useState(false);
  const [goalAchievementData, setGoalAchievementData] = useState<any>(null);
  const [tradeClosedData, setTradeClosedData] = useState<any>(null);
  const [showNoTradesModal, setShowNoTradesModal] = useState(false);
  const [noTradesLoading, setNoTradesLoading] = useState(false);
  const [forceCloseAttempted, setForceCloseAttempted] = useState<string | null>(null);
  const [sessionHealth, setSessionHealth] = useState<any>(null);
  const [unstickLoading, setUnstickLoading] = useState(false);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);

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

  // Listen for goal achievement notifications
  useEffect(() => {
    if (!user || !activeSession) return;

    const channel = supabase
      .channel('goal-achievements')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_achievements',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('[GoalSessionDashboard] Goal achievement detected!', payload);

          // Play celebration sound for goal achievement
          import('../services/notification-manager').then(({ notificationManager }) => {
            notificationManager.playSound('trade_entry');
            setTimeout(() => notificationManager.playSound('trade_exit'), 200);
            console.log('[GoalSessionDashboard] 🏆 Played celebration sound for goal achievement!');
          }).catch(err => console.error('[GoalSessionDashboard] Failed to play sound:', err));

          loadSessionData();
          // Show goal achieved dialog
          setGoalAchievementData({
            goalAmount: activeSession.config.goalAmount,
            achievedProfit: payload.new.achieved_pnl,
            symbol: payload.new.symbol,
            timeElapsed: calculateTimeElapsed(activeSession.startTime),
            tradesExecuted: 1
          });
          setShowGoalAchieved(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, activeSession]);

  // Listen for trade closures
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
          console.log('[GoalSessionDashboard] 📡 Realtime UPDATE event received:', {
            old_status: payload.old?.status,
            new_status: payload.new?.status,
            close_reason: payload.new?.close_reason,
            profit_loss: payload.new?.profit_loss
          });

          if (payload.new.status === 'closed' && payload.old.status === 'open') {
            console.log('[GoalSessionDashboard] ✅ Trade closed! Preparing popup...');
            const closeReason = payload.new.close_reason || 'manual';
            const profitLoss = payload.new.profit_loss || 0;
            const isProfit = profitLoss > 0;

            // Play sound notification
            import('../services/notification-manager').then(({ notificationManager }) => {
              if (closeReason === 'take_profit' && isProfit) {
                notificationManager.playSound('trade_exit');
                console.log('[GoalSessionDashboard] 🎉 Played celebration sound for TP hit!');
              } else if (closeReason === 'stop_loss') {
                notificationManager.playSound('alarm');
                console.log('[GoalSessionDashboard] 🔔 Played alert sound for SL hit');
              } else {
                notificationManager.playSound('notification');
              }
            }).catch(err => console.error('[GoalSessionDashboard] Failed to play sound:', err));

            // Don't show action dialog if goal was met (already showing goal achieved)
            if (closeReason !== 'goal_met' && !showGoalAchieved) {
              console.log('[GoalSessionDashboard] 🎯 Showing TradeClosedActionDialog');
              loadSessionData().then(() => {
                // Parse SL/TP with proper null handling
                const stopLoss = payload.new.stop_loss != null ? parseFloat(payload.new.stop_loss) : 0;
                const takeProfit = payload.new.take_profit != null ? parseFloat(payload.new.take_profit) : 0;

                console.log('[GoalSessionDashboard] Trade Close Data:', {
                  symbol: payload.new.symbol,
                  stopLoss: stopLoss,
                  takeProfit: takeProfit,
                  stopLossRaw: payload.new.stop_loss,
                  takeProfitRaw: payload.new.take_profit
                });

                setTradeClosedData({
                  symbol: payload.new.symbol,
                  direction: payload.new.direction,
                  entryPrice: payload.new.entry_price,
                  exitPrice: payload.new.exit_price,
                  profitLoss: profitLoss,
                  stopLoss: stopLoss,
                  takeProfit: takeProfit,
                  closeReason
                });
                setShowTradeClosedAction(true);
                console.log('[GoalSessionDashboard] ✅ TradeClosedActionDialog state updated');
              });
            } else {
              console.log('[GoalSessionDashboard] ℹ️ Skipping popup (goal_met or goal achieved dialog already shown)');
              loadSessionData();
            }
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
  }, [user, activeSession, showGoalAchieved]);

  useEffect(() => {
    if (!activeSession) {
      // No active session - ensure polling is stopped
      goalScannerTrigger.stopPolling();
      return;
    }

    const validStatuses = ['scanning', 'initializing', 'active', 'trade_pending', 'in_trade', 'awaiting_continuation'];
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

  // Fetch live prices for open trades
  useEffect(() => {
    if (openTrades.length === 0) return;

    const symbols = Array.from(new Set(openTrades.map(t => t.symbol)));

    const fetchLivePrices = async () => {
      const prices: Record<string, { bid: number; ask: number }> = {};

      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const { data, error } = await supabase
              .from('realtime_prices')
              .select('bid, ask')
              .eq('symbol', symbol)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (!error && data) {
              prices[symbol] = {
                bid: parseFloat(String(data.bid)),
                ask: parseFloat(String(data.ask))
              };
            }
          } catch (error) {
            console.error(`Error fetching price for ${symbol}:`, error);
          }
        })
      );

      setLivePrices(prices);
    };

    fetchLivePrices();
    const interval = setInterval(fetchLivePrices, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, [openTrades]);

  const loadSessionData = async () => {
    if (!user) return;

    try {
      const session = await smartGoalSessionManager.getActiveSession(user.id);
      setActiveSession(session);

      if (session) {
        // HEALTH CHECK: Check if session has expired timeout (on page load / refresh)
        try {
          const { data: healthCheck, error: healthError } = await supabase.rpc('check_session_timeout_health', {
            p_session_id: session.sessionId
          });

          if (!healthError && healthCheck) {
            if (healthCheck.auto_closed) {
              console.log('[GoalSessionDashboard] ✅ Health check auto-closed expired session:', healthCheck.reason);
              showToast({
                type: 'info',
                title: 'Session Auto-Closed',
                message: healthCheck.message || 'Your session was automatically closed due to timeout'
              });
              setShowNoTradesModal(false);
              setContinuationData(null);
              setActiveSession(null);
              return;
            }
          }
        } catch (healthError) {
          console.error('[GoalSessionDashboard] Health check failed:', healthError);
        }

        // SSOT: Observe session status (database trigger enforces all timeouts)
        // Client is purely observational - it reads status and displays UI accordingly
        try {
          const { data: sessionData } = await supabase
            .from('goal_sessions')
            .select('status, awaiting_continuation_since, trades_in_session, current_progress, target_value, multi_trade_enabled')
            .eq('id', session.sessionId)
            .single();

          // SSOT: Display modal if database status is 'awaiting_continuation'
          // The trigger handles timeout enforcement - we just observe and display
          if (sessionData?.status === 'awaiting_continuation') {
            setShowNoTradesModal(true);
          } else {
            setShowNoTradesModal(false);
            setContinuationData(null);
          }
        } catch (error) {
          console.error('[GoalSessionDashboard] Error checking continuation status:', error);
          setContinuationData(null);
          setShowNoTradesModal(false);
        }

        // Check session health for stuck detection
        try {
          const health = await checkSessionHealth(session.sessionId);
          setSessionHealth(health);
          if (health?.is_stuck) {
            console.log('[GoalSessionDashboard] Session stuck detected:', health.stuck_reason);
          }
        } catch (error) {
          console.error('[GoalSessionDashboard] Error checking session health:', error);
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

    if (forexStatus.isOpen) {
      // All markets open - return full watchlist
      return fullWatchlist;
    }

    // Forex closed - return only crypto pairs
    const cryptoSymbols = ['BTCUSD', 'ETHUSD'];
    const filteredList = fullWatchlist.filter(symbol => cryptoSymbols.includes(symbol));

    console.log(`[GoalSessionDashboard] Forex closed - filtering watchlist: ${fullWatchlist.length} → ${filteredList.length} (crypto only)`);

    return filteredList;
  };

  const handleContinuationResponse = async (response: 'continue' | 'stop') => {
    if (!activeSession || !user) return;

    setContinuationLoading(true);
    try {
      // Import continuation handler
      const { continuationHandler } = await import('../services/continuation-handler');

      if (response === 'continue') {
        await continuationHandler.handleContinue(activeSession.sessionId);
        console.log('[GoalSessionDashboard] User chose to continue - session resumed');
      } else {
        await continuationHandler.handleStop(activeSession.sessionId, user.id);
        console.log('[GoalSessionDashboard] User chose to stop - session ended');
      }

      setContinuationData(null);
      await loadSessionData();
    } catch (error) {
      console.error('[GoalSessionDashboard] Error handling continuation response:', error);
    } finally {
      setContinuationLoading(false);
    }
  };

  const handleStartNewSession = async () => {
    if (!user) return;

    // Stop current session
    if (activeSession) {
      await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);
    }

    setShowGoalAchieved(false);
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

      // CRITICAL FIX: Properly resume the session by updating status to 'scanning'
      // This ensures the goal scanner starts looking for the next opportunity
      await continuationHandler.handleContinue(activeSession.sessionId);

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
    console.log('[GoalSessionDashboard] 🏆 View All Achievements clicked - navigating...');
    setShowGoalAchieved(false);

    // Navigate to achievements tab by dispatching a custom event
    // This will be picked up by AITradePage which manages the tabs
    window.dispatchEvent(new CustomEvent('switch-to-achievements-tab'));

    // Also try direct navigation as fallback
    navigate('/ai-trade?tab=achievements');
  };


  const handleStopSession = async () => {
    if (!activeSession || !user) return;

    // Special handling for awaiting_continuation status - use simplified stop
    if (activeSession.status === 'awaiting_continuation') {
      const confirmed = await confirm({
        title: 'Close Session',
        message: 'Are you sure you want to close this session? Any progress will be saved.',
        confirmText: 'Close Session',
        cancelText: 'Cancel',
        variant: 'warning'
      });

      if (!confirmed) return;

      try {
        const { data, error } = await supabase.rpc('stop_continuation_session', {
          p_session_id: activeSession.sessionId
        });

        if (error) {
          console.error('[GoalSessionDashboard] Error stopping continuation session:', error);
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
          setShowNoTradesModal(false);
          setContinuationData(null);
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
    if (!activeSession || !user) return;

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

    if (!confirmed) return;

    try {
      // If there are open trades, close them all first
      if (hasOpenTrades) {
        console.log(`[GoalSessionDashboard] Closing ${openTrades.length} open trade(s) before stopping session...`);

        let closedCount = 0;
        let failedCount = 0;

        for (const trade of openTrades) {
          try {
            // Fetch current live price for the symbol
            const { data: priceData, error: priceError } = await supabase
              .from('realtime_prices')
              .select('bid, ask')
              .eq('symbol', trade.symbol)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (priceError || !priceData) {
              console.error(`[GoalSessionDashboard] Failed to get price for ${trade.symbol}:`, priceError);
              failedCount++;
              continue;
            }

            // Use bid for long positions, ask for short positions
            const closePrice = trade.direction === 'buy' ? priceData.bid : priceData.ask;

            console.log(`[GoalSessionDashboard] Closing ${trade.symbol} at ${closePrice}`);

            // Close the position
            const result = await positionService.closePosition(
              trade.id,
              closePrice,
              'session_ended',
              user.id,
              activeSession.sessionId
            );

            if (result.success) {
              closedCount++;
              console.log(`[GoalSessionDashboard] ✅ Closed ${trade.symbol} successfully`);
            } else {
              failedCount++;
              console.error(`[GoalSessionDashboard] ❌ Failed to close ${trade.symbol}:`, result.message);
            }
          } catch (error) {
            failedCount++;
            console.error(`[GoalSessionDashboard] ❌ Error closing trade ${trade.symbol}:`, error);
          }
        }

        // Show summary of trade closures
        if (closedCount > 0) {
          showToast({
            type: 'success',
            title: 'Trades Closed',
            message: `Successfully closed ${closedCount} trade${closedCount > 1 ? 's' : ''}`
          });
        }

        if (failedCount > 0) {
          showToast({
            type: 'warning',
            title: 'Some Trades Failed to Close',
            message: `${failedCount} trade${failedCount > 1 ? 's' : ''} could not be closed. Please check manually.`
          });
        }

        console.log(`[GoalSessionDashboard] Trade closure summary: ${closedCount} closed, ${failedCount} failed`);
      }

      // Now stop the session
      const success = await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);
      if (success) {
        showToast({
          type: 'success',
          title: 'Session Stopped',
          message: 'Goal session has been stopped successfully'
        });
        loadSessionData();
      } else {
        showToast({
          type: 'error',
          title: 'Failed to Stop Session',
          message: 'Could not stop the session. Please try again.'
        });
      }
    } catch (error) {
      console.error('[GoalSessionDashboard] Error stopping session:', error);
      showToast({
        type: 'error',
        title: 'Error',
        message: 'An error occurred while stopping the session'
      });
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
      const closePrice = trade.direction === 'buy' ? priceData.bid : priceData.ask;

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
      // Try new force close function first (handles awaiting_continuation better)
      const { data, error } = await supabase.rpc('force_close_continuation_session', {
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
        setShowNoTradesModal(false);
        setContinuationData(null);
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

  const handleNoTradesContinue = async () => {
    if (!activeSession) return;

    setNoTradesLoading(true);
    try {
      console.log('[GoalSessionDashboard] User chose to continue scanning');
      await simpleScanningTimer.handleContinuationResponse(activeSession.sessionId, true);
      setShowNoTradesModal(false);
      loadSessionData();
    } catch (error) {
      console.error('[GoalSessionDashboard] Error continuing scan:', error);
    } finally {
      setNoTradesLoading(false);
    }
  };

  const handleNoTradesClose = async () => {
    if (!activeSession || !user) return;

    setNoTradesLoading(true);
    try {
      console.log('[GoalSessionDashboard] User chose to close session');
      await simpleScanningTimer.handleContinuationResponse(activeSession.sessionId, false);
      setShowNoTradesModal(false);
      loadSessionData();
    } catch (error) {
      console.error('[GoalSessionDashboard] Error closing session:', error);
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
    // SINGLE SOURCE OF TRUTH: Use stored P&L from database
    // Database updates this via position monitoring system
    return trade.current_pnl || trade.profit_loss || 0;
  };

  const calculateLiveProgressPercentage = (): number => {
    if (!progress || !activeSession) return 0;

    // Get closed trades profit
    const closedProfit = progress.stats?.closedProfit || 0;

    // SINGLE SOURCE OF TRUTH: Use current_pnl from database for open trades
    // Database updates this in real-time via position monitoring
    const openUnrealizedPnL = openTrades.reduce((sum, trade) => {
      return sum + (trade.current_pnl || 0);
    }, 0);

    // Total progress = closed + open unrealized
    const totalProgress = closedProfit + openUnrealizedPnL;
    const goalAmount = activeSession.config.goalAmount;

    return (totalProgress / goalAmount) * 100;
  };

  const calculateActualRiskPercentage = (): { percentage: number; dollarRisk: number; displayText: string } => {
    if (!activeSession || openTrades.length === 0) {
      // No open trades - show the configured risk
      // Prioritize dollarRisk if available (new system), otherwise use risk mode (legacy)
      if (activeSession?.config.dollarRisk) {
        const accountBalance = activeSession.config.accountBalance || 10000;
        const percentage = (activeSession.config.dollarRisk / accountBalance) * 100;
        return {
          percentage,
          dollarRisk: activeSession.config.dollarRisk,
          displayText: `$${activeSession.config.dollarRisk}`
        };
      }

      // Legacy risk mode
      const riskMode = getRiskPercentage(activeSession?.config.riskMode || 'medium');
      return {
        percentage: riskMode,
        dollarRisk: 0,
        displayText: `${riskMode}%`
      };
    }

    // Calculate actual risk from open trades
    const accountBalance = activeSession.config.accountBalance || 10000;
    let totalDollarRisk = 0;

    openTrades.forEach(trade => {
      const lotSize = trade.lot_size || trade.position_size || 0.01;
      const entryPrice = trade.entry_price || 0;
      const stopLoss = trade.stop_loss || 0;

      if (entryPrice > 0 && stopLoss > 0) {
        // Calculate pip distance to stop loss
        const pipDistance = calculatePipDistance(trade.symbol, entryPrice, stopLoss);

        // Calculate dollar value per pip for this lot size
        const dollarPerPip = calculateDollarPerPip(trade.symbol, lotSize);

        // Total dollar risk for this trade
        const tradeRisk = pipDistance * dollarPerPip;
        totalDollarRisk += tradeRisk;
      }
    });

    // Calculate risk percentage
    const riskPercentage = (totalDollarRisk / accountBalance) * 100;

    // Display text with appropriate formatting
    let displayText = `${riskPercentage.toFixed(2)}%`;
    if (openTrades.length > 1) {
      displayText += ` (${openTrades.length} trades)`;
    }

    return {
      percentage: riskPercentage,
      dollarRisk: totalDollarRisk,
      displayText
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
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-xl opacity-10 group-hover:opacity-20 transition duration-300 blur" />

        <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl p-12 border border-gray-700/50 shadow-2xl">
          <div className="text-center">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full blur-2xl opacity-30 animate-pulse" />
              <div className="relative w-24 h-24 mx-auto bg-gradient-to-br from-gray-700 to-gray-800 rounded-full flex items-center justify-center border border-gray-600/50">
                <Target className="w-12 h-12 text-gray-500" />
              </div>
            </div>

            <h3 className="text-2xl font-bold text-white mb-2">No active goal session</h3>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              Create a new goal to get started with AI-powered trading.
            </p>

            <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mt-8 pt-8 border-t border-gray-700/50">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 bg-gradient-to-br from-emerald-600/20 to-blue-600/20 rounded-xl flex items-center justify-center border border-emerald-500/20">
                  <Sparkles className="w-6 h-6 text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-gray-300">AI-Powered</p>
                <p className="text-xs text-gray-500 mt-1">Smart analysis</p>
              </div>

              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 bg-gradient-to-br from-blue-600/20 to-emerald-600/20 rounded-xl flex items-center justify-center border border-blue-500/20">
                  <TrendingUp className="w-6 h-6 text-blue-400" />
                </div>
                <p className="text-sm font-medium text-gray-300">Autonomous</p>
                <p className="text-xs text-gray-500 mt-1">Hands-free trading</p>
              </div>

              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 bg-gradient-to-br from-emerald-600/20 to-blue-600/20 rounded-xl flex items-center justify-center border border-emerald-500/20">
                  <Shield className="w-6 h-6 text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-gray-300">Protected</p>
                <p className="text-xs text-gray-500 mt-1">Risk managed</p>
              </div>
            </div>
          </div>
        </div>
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
                className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 rounded-xl text-sm font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 shadow-lg hover:shadow-red-500/25 hover:scale-105 active:scale-95"
              >
                <Pause className="w-4 h-4" />
                Stop Session
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

                const priceDiff = isLong
                  ? (currentPrice - trade.entry_price)
                  : (trade.entry_price - currentPrice);
                const pips = calculatePipDistance(trade.symbol, trade.entry_price, currentPrice);
                const currentPnL = calculateCurrentPnL(trade);

                return (
                  <div key={trade.id} className="space-y-4">
                    {/* Header with Symbol and Actions */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="text-2xl md:text-xl font-bold text-white">{trade.symbol}</div>
                        <div className={`text-sm font-semibold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.direction.toUpperCase()} • {(trade.lot_size || trade.position_size || 0).toFixed(2)} lots
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

                    {/* Mobile-Optimized Trading Levels - Dual TP System */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

                      {/* TP1 - Conservative Target */}
                      <div className={`bg-gradient-to-br from-cyan-900/20 to-blue-900/20 rounded-lg p-3 sm:p-4 border ${trade.tp1_hit ? 'border-cyan-400/70 shadow-lg shadow-cyan-500/20' : 'border-cyan-500/30'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-cyan-300">TP1</span>
                          {trade.tp1_confidence && (
                            <span className="text-xs text-cyan-400 font-semibold">{Math.round(trade.tp1_confidence)}%</span>
                          )}
                          {trade.tp1_hit && (
                            <span className="text-xs text-cyan-400 font-bold">✓ HIT</span>
                          )}
                        </div>
                        <div className="text-2xl sm:text-xl md:text-lg font-bold text-cyan-400 font-mono tracking-tight">
                          {trade.tp1_price ? formatTradingPrice(trade.symbol, trade.tp1_price) : 'N/A'}
                        </div>
                      </div>

                      {/* TP2 - Full Target */}
                      <div className={`bg-gradient-to-br from-emerald-900/20 to-green-900/20 rounded-lg p-3 sm:p-4 border ${trade.tp2_hit ? 'border-emerald-400/70 shadow-lg shadow-emerald-500/20' : 'border-emerald-500/30'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-emerald-300">TP2</span>
                          {trade.tp2_hit && (
                            <span className="text-xs text-emerald-400 font-bold">✓ HIT</span>
                          )}
                        </div>
                        <div className="text-2xl sm:text-xl md:text-lg font-bold text-emerald-400 font-mono tracking-tight">
                          {trade.tp2_price ? formatTradingPrice(trade.symbol, trade.tp2_price) : formatTradingPrice(trade.symbol, trade.take_profit)}
                        </div>
                      </div>
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
              <div className="text-sm text-gray-400 mb-1">Target</div>
              <div className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-blue-400">
                ${activeSession.config.goalAmount.toFixed(0)}
              </div>
            </div>
          </div>

          <div className="relative group overflow-hidden rounded-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-emerald-500/10 group-hover:from-blue-500/20 group-hover:to-emerald-500/20 transition-all duration-300" />
            <div className="relative bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 group-hover:border-blue-500/30 transition-all duration-300">
              <div className="text-sm text-gray-400 mb-1">Progress</div>
              <div className="text-2xl font-bold text-blue-400">
                ${(progress?.stats?.totalProfit || 0).toFixed(2)}
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
            {activeSession.tp1_target && activeSession.config.goalAmount > 0 && (
              <div
                className="absolute top-0 bottom-0 w-1 z-10"
                style={{ left: `${(activeSession.tp1_target / activeSession.config.goalAmount) * 100}%` }}
                title={`TP1: $${activeSession.tp1_target.toFixed(2)} (Conservative Target)`}
              >
                <div className="relative h-full">
                  <div className={`absolute inset-0 ${activeSession.tp1_hit ? 'bg-green-400' : 'bg-yellow-400'} shadow-lg`} />
                  <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                    <div className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      activeSession.tp1_hit
                        ? 'bg-green-500 text-white'
                        : 'bg-yellow-500 text-gray-900'
                    }`}>
                      {activeSession.tp1_hit ? `✓ TP1: $${activeSession.tp1_target.toFixed(2)}` : `TP1: $${activeSession.tp1_target.toFixed(2)}`}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TP2 Marker (Realistic Target) */}
            {activeSession.tp2_target && activeSession.config.goalAmount > 0 && (
              <div
                className="absolute top-0 bottom-0 w-1 z-10"
                style={{ left: `100%` }}
                title={`TP2: $${activeSession.tp2_target.toFixed(2)} (Realistic Target)`}
              >
                <div className="relative h-full">
                  <div className={`absolute inset-0 ${activeSession.tp2_hit ? 'bg-green-400' : 'bg-blue-400'} shadow-lg`} />
                  <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                    <div className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      activeSession.tp2_hit
                        ? 'bg-green-500 text-white'
                        : 'bg-blue-500 text-white'
                    }`}>
                      {activeSession.tp2_hit ? `✓ TP2: $${activeSession.tp2_target.toFixed(2)}` : `TP2: $${activeSession.tp2_target.toFixed(2)}`}
                    </div>
                  </div>
                </div>
              </div>
            )}

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
          <div className="grid grid-cols-3 gap-4">
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

                return (
                  <>
                    <div className={`text-2xl font-bold ${riskColor}`}>
                      {riskData.displayText}
                    </div>
                    <div className="text-xs text-gray-400">
                      {openTrades.length > 0 ? (
                        <span title={`$${riskData.dollarRisk.toFixed(2)} at risk`}>
                          Actual Risk
                        </span>
                      ) : (
                        <span title={
                          activeSession.config.dollarRisk
                            ? `$${activeSession.config.dollarRisk} per trade${activeSession.config.tradeStyle ? ` • ${activeSession.config.tradeStyle} style` : ''}`
                            : `Max ${getRiskPercentage(activeSession.config.riskMode)}% per trade`
                        }>
                          Risk Per Trade
                        </span>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">${(progress.stats.totalProfit || 0).toFixed(2)}</div>
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
          ) : continuationData?.isAwaiting ? (
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4 text-amber-200">
              <div className="flex items-center gap-2">
                <Pause className="w-5 h-5" />
                <span>Trade closed - Decision required</span>
              </div>
              <div className="mt-2 text-xs text-amber-200/70">
                Your trade has closed. Review the dialog below to continue, wait, or stop.
              </div>
            </div>
          ) : (
            <AlphaScanningFeed
              sessionId={activeSession.sessionId}
              hasActiveTrades={openTrades.length > 0}
              isScanning={true}
              activePairsCount={activeSession.activePairsCount || getActiveWatchlist(activeSession.config.watchlist).length}
              totalPairs={activeSession.config.watchlist.length}
              watchlist={getActiveWatchlist(activeSession.config.watchlist)}
            />
          )}
        </div>
      )}

      {activeSession && (
        <>
          <SimpleEntryMonitor sessionId={activeSession.sessionId} />
          <MarketAnalysisStream
            sessionId={activeSession.sessionId}
            watchlist={activeSession.config.watchlist}
          />
        </>
      )}

      {continuationData && progress && activeSession && (
        <ContinuationDialog
          isOpen={continuationData.isAwaiting}
          continuationPrompt={continuationData.prompt}
          tradesInSession={continuationData.tradesInSession}
          currentProgress={progress.stats?.totalProfit || 0}
          targetValue={activeSession.config?.goalAmount || 0}
          onContinue={() => handleContinuationResponse('continue')}
          onStop={() => handleContinuationResponse('stop')}
          isLoading={continuationLoading}
        />
      )}

      {activeSession && (
        <NoTradesFoundDialog
          isOpen={showNoTradesModal}
          onContinue={handleNoTradesContinue}
          onClose={handleNoTradesClose}
          sessionId={activeSession.sessionId}
          isLoading={noTradesLoading}
        />
      )}

      {goalAchievementData && (
        <GoalAchievedDialog
          isOpen={showGoalAchieved}
          goalAmount={goalAchievementData.goalAmount}
          achievedProfit={goalAchievementData.achievedProfit}
          symbol={goalAchievementData.symbol}
          timeElapsed={goalAchievementData.timeElapsed}
          tradesExecuted={goalAchievementData.tradesExecuted}
          onStartNewSession={handleStartNewSession}
          onViewAchievements={handleViewAchievements}
          onClose={() => setShowGoalAchieved(false)}
        />
      )}

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
    </div>
  );
};
