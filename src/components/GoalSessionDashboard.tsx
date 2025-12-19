import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Clock, Activity, CheckCircle, XCircle, Pause, BarChart2, Cloud, Wifi, WifiOff, AlertTriangle, Search, Shield, Sparkles, Eye, BarChart3 } from 'lucide-react';
import { smartGoalSessionManager, SmartGoalSession } from '../services/smart-goal-session-manager';
import { goalScannerTrigger, ScanStatus, MarketDataStatus } from '../services/goal-scanner-trigger';
import { useAuth } from '../hooks/useAuth';
import { MarketAnalysisStream } from './MarketAnalysisStream';
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
// GoalScanReadinessIndicator removed - using simple indicator

export const GoalSessionDashboard: React.FC = () => {
  const { user } = useAuth();
  const { confirm } = useConfirmDialog();
  const navigate = useNavigate();
  const [activeSession, setActiveSession] = useState<SmartGoalSession | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
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
                setTradeClosedData({
                  symbol: payload.new.symbol,
                  direction: payload.new.direction,
                  entryPrice: payload.new.entry_price,
                  exitPrice: payload.new.exit_price,
                  profitLoss: profitLoss,
                  stopLoss: payload.new.stop_loss,
                  takeProfit: payload.new.take_profit,
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
        console.log('[GoalSessionDashboard] 📊 Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('[GoalSessionDashboard] ✅ Successfully subscribed to trade closures');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[GoalSessionDashboard] ❌ Realtime subscription error');
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

    const validStatuses = ['scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing'];
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
        // Check for no-trades-found continuation modal (15-minute threshold)
        try {
          const { data: sessionData } = await supabase
            .from('goal_sessions')
            .select('status, awaiting_continuation_confirmation, awaiting_user_continuation, continuation_prompt, trades_in_session, current_progress, target_value, multi_trade_enabled')
            .eq('id', session.sessionId)
            .single();

          // New simplified 15-minute modal (takes priority)
          if (sessionData?.awaiting_continuation_confirmation) {
            setShowNoTradesModal(true);
          } else {
            setShowNoTradesModal(false);
          }

          // Legacy continuation dialog (only if multi-trade is disabled AND in correct status)
          const shouldShowLegacyDialog =
            sessionData?.awaiting_user_continuation &&
            !sessionData?.multi_trade_enabled;

          if (shouldShowLegacyDialog) {
            setContinuationData({
              isAwaiting: true,
              prompt: sessionData.continuation_prompt || 'Would you like to continue scanning for more trades?',
              tradesInSession: sessionData.trades_in_session || 0
            });
          } else {
            setContinuationData(null);
          }
        } catch (error) {
          console.error('[GoalSessionDashboard] Error checking continuation status:', error);
          setContinuationData(null);
          setShowNoTradesModal(false);
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
          const convos = await smartGoalSessionManager.getSessionConversations(session.sessionId, 20);

          // Filter out generic error/failure messages that confuse users
          const genericErrorPatterns = [
            'periodic check failed',
            'continuing normally',
            'check failed',
            'analysis failed'
          ];

          const filteredConvos = (convos || []).filter(convo => {
            const message = convo.message?.toLowerCase() || '';
            return !genericErrorPatterns.some(pattern => message.includes(pattern));
          });

          setConversations(filteredConvos);
        } catch (error) {
          console.error('[GoalSessionDashboard] Error loading conversations:', error);
          setConversations([]);
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

      setShowTradeClosedAction(false);
      await loadSessionData();
    } catch (error) {
      console.error('[GoalSessionDashboard] Error continuing session:', error);
    }
  };

  const handleCloseForNow = async () => {
    if (!user || !activeSession) return;

    try {
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

      // Stop the session
      await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);

      setShowTradeClosedAction(false);
      await loadSessionData();
    } catch (error) {
      console.error('[GoalSessionDashboard] Error closing session:', error);
    }
  };

  const handleViewAchievements = () => {
    setShowGoalAchieved(false);
    // The user can switch to the achievements tab in AITradePage
  };


  const handleStopSession = async () => {
    if (!activeSession || !user) return;

    const confirmed = await confirm({
      title: 'Stop Goal Session',
      message: 'Are you sure you want to stop this goal session? Any progress will be saved.',
      confirmText: 'Stop Session',
      cancelText: 'Continue',
      variant: 'warning'
    });

    if (!confirmed) return;

    const success = await smartGoalSessionManager.stopSession(activeSession.sessionId, user.id);
    if (success) {
      loadSessionData();
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
    // If we don't have live prices, fall back to stored P&L
    if (!livePrices[trade.symbol] || !trade.entry_price) {
      return trade.profit_loss || 0;
    }

    const currentPrice = trade.direction === 'buy'
      ? livePrices[trade.symbol].bid
      : livePrices[trade.symbol].ask;

    const isLong = trade.direction === 'buy';
    const priceDiff = isLong
      ? (currentPrice - trade.entry_price)
      : (trade.entry_price - currentPrice);

    // Calculate P&L: price difference * position size * pip value
    // For forex pairs (except JPY pairs), 1 pip = 0.0001
    // For JPY pairs, 1 pip = 0.01
    const isJPY = trade.symbol.includes('JPY');
    const pipSize = isJPY ? 0.01 : 0.0001;
    const lotSize = trade.lot_size || trade.position_size || 0;

    // Standard lot = 100,000 units, so $10 per pip for standard lot (non-JPY)
    // Mini lot = 10,000 units, so $1 per pip
    // Micro lot = 1,000 units, so $0.10 per pip
    const pipValue = isJPY ? 10 : 10; // $10 per pip per standard lot
    const pips = priceDiff / pipSize;
    const pnl = pips * pipValue * lotSize;

    return pnl;
  };

  const calculateLiveProgressPercentage = (): number => {
    if (!progress || !activeSession) return 0;

    // Get closed trades profit
    const closedProfit = progress.stats?.closedProfit || 0;

    // Calculate current unrealized P&L from open trades
    const openUnrealizedPnL = openTrades.reduce((sum, trade) => {
      return sum + calculateCurrentPnL(trade);
    }, 0);

    // Total progress = closed + open unrealized
    const totalProgress = closedProfit + openUnrealizedPnL;
    const goalAmount = activeSession.config.goalAmount;

    return (totalProgress / goalAmount) * 100;
  };

  const calculateActualRiskPercentage = (): { percentage: number; dollarRisk: number; displayText: string } => {
    if (!activeSession || openTrades.length === 0) {
      // No open trades - show the risk mode setting
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
      soft_closing: 'text-amber-400',
      goal_achieved: 'text-emerald-400',
      expired: 'text-gray-400',
      user_stopped: 'text-red-400',
    };
    return colors[status as keyof typeof colors] || 'text-gray-400';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scanning':
        return <Activity className="w-5 h-5 animate-pulse" />;
      case 'in_trade':
        return <TrendingUp className="w-5 h-5" />;
      case 'soft_closing':
        return <Clock className="w-5 h-5 animate-pulse" />;
      case 'goal_achieved':
        return <CheckCircle className="w-5 h-5" />;
      case 'expired':
      case 'user_stopped':
        return <XCircle className="w-5 h-5" />;
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
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className={`absolute inset-0 rounded-xl blur opacity-50 ${getStatusColor(activeSession.status).replace('text-', 'bg-')}`} />
                <div className={`relative p-3 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl ${getStatusColor(activeSession.status)} shadow-lg`}>
                  {getStatusIcon(activeSession.status)}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Active Goal Session
                  <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                </h3>
                <p className="text-sm text-gray-400 capitalize">{activeSession.status.replace('_', ' ')}</p>
                {scanStatus.message && (
                  <p className="text-xs text-gray-500 mt-1">{scanStatus.message}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleStopSession}
              className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 rounded-xl text-sm font-semibold text-white transition-all duration-300 flex items-center gap-2 shadow-lg hover:shadow-red-500/25 hover:scale-105 active:scale-95"
            >
              <Pause className="w-4 h-4" />
              Stop Session
            </button>
          </div>

        {/* Server-Side Status Indicator */}
        {activeSession.serverHeartbeat && (
          <div className="mb-4 p-3 bg-green-900/20 border border-green-500/30 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-green-400 animate-pulse" />
                <span className="text-sm font-medium text-green-400">Running Autonomously in Cloud</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Wifi className="w-3 h-3" />
                <span>Last check: {formatTimeAgo(activeSession.serverHeartbeat)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              This session continues running even when you close this window.
              View from any device!
            </p>
          </div>
        )}

        {activeSession.executionMode === 'client' && !activeSession.serverHeartbeat && (
          <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-medium text-yellow-400">Browser-Only Mode</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Keep this window open. Session will stop if you close the browser.
            </p>
          </div>
        )}

        {openTrades.length > 0 && (
          <div className="mb-4 relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-30 blur animate-pulse" />
            <div className="relative bg-gradient-to-br from-blue-900/40 to-cyan-900/40 border border-blue-500/50 rounded-xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Eye className="w-5 h-5 text-blue-400 animate-pulse" />
                  </div>
                  <div>
                    <div className="text-base font-bold text-white flex items-center gap-2">
                      TRADE {openTrades.length}/{activeSession.config.maxConcurrentTrades || 1} OPEN
                      <span className="px-2 py-0.5 bg-blue-500/30 rounded text-xs font-semibold text-blue-300">
                        MONITORING MODE
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      New trade scanning paused - monitoring open position
                    </p>
                  </div>
                </div>
              </div>

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
                const isJPY = trade.symbol.includes('JPY');
                const pipSize = isJPY ? 0.01 : 0.0001;
                const pips = priceDiff / pipSize;
                const currentPnL = calculateCurrentPnL(trade);

                return (
                  <div key={trade.id} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <button
                        onClick={() => navigate(`/trade?symbol=${trade.symbol}`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-lg text-xs font-semibold text-white transition-all duration-200 shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        View Chart
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Symbol</div>
                        <div className="text-sm font-semibold text-white">{trade.symbol}</div>
                        <div className={`text-xs font-medium ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.direction.toUpperCase()}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500 mb-1">Lot Size</div>
                        <div className="text-sm font-semibold text-blue-300">
                          {(trade.lot_size || trade.position_size || 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500">lots</div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500 mb-1">Entry Price</div>
                        <div className="text-sm font-mono text-gray-300">
                          {trade.entry_price.toFixed(5)}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                          Current P&L
                          {livePrice && (
                            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" title="Live price feed active" />
                          )}
                        </div>
                        <div className={`text-sm font-semibold ${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(2)}
                        </div>
                        <div className={`text-xs ${pips >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pips >= 0 ? '+' : ''}{pips.toFixed(1)} pips
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500 mb-1">Targets</div>
                        <div className="text-xs text-gray-300">
                          <div>TP: {trade.take_profit.toFixed(5)}</div>
                          <div>SL: {trade.stop_loss.toFixed(5)}</div>
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
                {progress?.session?.progress_percentage ? progress.session.progress_percentage.toFixed(1) : '0.0'}%
              </div>
            </div>
          </div>

          <div className="relative group overflow-hidden rounded-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-amber-500/10 group-hover:from-orange-500/20 group-hover:to-amber-500/20 transition-all duration-300" />
            <div className="relative bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 group-hover:border-orange-500/30 transition-all duration-300">
              <div className="text-sm text-gray-400 mb-1">Trades</div>
              <div className="text-lg font-bold text-orange-400">
                {progress?.stats?.closedTradesCount || 0} / {activeSession.strategy.targetTradeCount}
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
                        <span title={`Max ${getRiskPercentage(activeSession.config.riskMode)}% per trade`}>
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
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 text-blue-200">
              <div className="animate-pulse flex items-center gap-2">
                <Search className="w-5 h-5" />
                <span>Scanning {activeSession.config.watchlist.length} pairs for opportunities...</span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeSession && (
        <MarketAnalysisStream
          sessionId={activeSession.sessionId}
          watchlist={activeSession.config.watchlist}
        />
      )}

      {conversations.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            AI Analysis Updates
          </h4>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {conversations.slice(-10).reverse().map((convo) => (
              <div
                key={convo.id}
                className={`p-4 rounded-lg ${
                  convo.role === 'ai' ? 'bg-blue-900/20 border-l-4 border-blue-500' : 'bg-gray-700'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <p className="text-sm text-gray-200 leading-relaxed">{convo.message}</p>
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap ml-3">
                    {new Date(convo.created_at).toLocaleTimeString()}
                  </span>
                </div>

                {convo.technical_data && typeof convo.technical_data === 'object' && Object.keys(convo.technical_data).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <BarChart2 className="w-3 h-3" />
                      <span>Technical Data:</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {convo.technical_data?.ema20 && (
                        <div>
                          <span className="text-gray-500">EMA20:</span>
                          <span className="text-gray-300 ml-1 font-mono">{Number(convo.technical_data.ema20).toFixed(5)}</span>
                        </div>
                      )}
                      {convo.technical_data?.ema50 && (
                        <div>
                          <span className="text-gray-500">EMA50:</span>
                          <span className="text-gray-300 ml-1 font-mono">{Number(convo.technical_data.ema50).toFixed(5)}</span>
                        </div>
                      )}
                      {convo.technical_data?.vwap && (
                        <div>
                          <span className="text-gray-500">VWAP:</span>
                          <span className="text-gray-300 ml-1 font-mono">{Number(convo.technical_data.vwap).toFixed(5)}</span>
                        </div>
                      )}
                      {convo.technical_data?.atr && (
                        <div>
                          <span className="text-gray-500">ATR:</span>
                          <span className="text-gray-300 ml-1 font-mono">{Number(convo.technical_data.atr).toFixed(5)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {convo.market_snapshot && typeof convo.market_snapshot === 'object' && Object.keys(convo.market_snapshot).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <div className="flex items-center gap-4 text-xs">
                      {convo.market_snapshot.trend && (
                        <div>
                          <span className="text-gray-500">Trend:</span>
                          <span className={`ml-1 font-semibold capitalize ${
                            convo.market_snapshot.trend === 'bullish' ? 'text-green-400' :
                            convo.market_snapshot.trend === 'bearish' ? 'text-red-400' : 'text-gray-400'
                          }`}>{convo.market_snapshot.trend}</span>
                        </div>
                      )}
                      {convo.market_snapshot.volatility && (
                        <div>
                          <span className="text-gray-500">Volatility:</span>
                          <span className="ml-1 font-semibold text-yellow-400 capitalize">{convo.market_snapshot.volatility}</span>
                        </div>
                      )}
                      {convo.market_snapshot.confidence && (
                        <div>
                          <span className="text-gray-500">Confidence:</span>
                          <span className="ml-1 font-semibold text-blue-400">{convo.market_snapshot.confidence}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
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
