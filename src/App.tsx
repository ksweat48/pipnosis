import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DatabaseErrorBoundary } from './components/DatabaseErrorBoundary';
import { ConfirmDialogProvider } from './hooks/useConfirmDialog';
import { GlobalDialogProvider } from './hooks/useGlobalDialog';
import { ToastContainer } from './components/ToastNotification';
import { useToast } from './hooks/useToast';
import { globalToastManager } from './services/global-toast-manager';
import { globalDialogManager } from './services/global-dialog-manager';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { UpdateBanner } from './components/UpdateBanner';
import { cacheClearOnRefresh } from './services/cache-clear-on-refresh';
import { supabase } from './lib/supabase';
import { midTradeNotificationQueue } from './services/mid-trade-notification-queue';
import MidTradeUpdateModal from './components/MidTradeUpdateModal';
import { MidTradeAlertListener } from './components/MidTradeAlertListener';

// Lazy load all pages for code splitting
const LandingPage = lazy(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));
const PublicLandingPage = lazy(() => import('./components/PublicLandingPage').then(m => ({ default: m.PublicLandingPage })));
const AuthPage = lazy(() => import('./pages/AuthPage').then(m => ({ default: m.AuthPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const PositionsPage = lazy(() => import('./pages/PositionsPage').then(m => ({ default: m.PositionsPage })));
const TradePage = lazy(() => import('./pages/TradePage').then(m => ({ default: m.TradePage })));
const AITradePage = lazy(() => import('./pages/AITradePage').then(m => ({ default: m.AITradePage })));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage').then(m => ({ default: m.AnalysisPage })));
const AIJournalPage = lazy(() => import('./pages/AIJournalPage').then(m => ({ default: m.AIJournalPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const GetAppPage = lazy(() => import('./pages/GetAppPage'));

// Admin pages - only loaded when needed
const AdminDashboard = lazy(() => import('./pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const SystemDiagnosticsPage = lazy(() => import('./pages/SystemDiagnosticsPage'));
const AILearningCenterPage = lazy(() => import('./pages/AILearningCenterPage'));
const CreditsPage = lazy(() => import('./pages/TokensPage').then(m => ({ default: m.CreditsPage })));
const OptimizedCandleTestPage = lazy(() => import('./pages/OptimizedCandleTestPage'));

// Loading component
const LoadingFallback = () => (
  <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-4"></div>
      <p className="text-white/70 text-lg">Loading...</p>
    </div>
  </div>
);


const AppRoutes: React.FC = () => {
  const { user, loading } = useAuth();
  const toast = useToast();
  const [showMidTradeModal, setShowMidTradeModal] = useState(false);

  useEffect(() => {
    const handleGlobalToast = (toastData: any) => {
      toast.showToast(toastData.type, toastData.title, toastData.message, toastData.duration);
    };

    globalToastManager.onToast(handleGlobalToast);

    return () => {
      globalToastManager.offToast(handleGlobalToast);
    };
  }, [toast]);

  useEffect(() => {
    const handleShowNotification = () => {
      setShowMidTradeModal(true);
    };

    const handleHideNotification = () => {
      setShowMidTradeModal(false);
    };

    midTradeNotificationQueue.on('show-notification', handleShowNotification);
    midTradeNotificationQueue.on('hide-notification', handleHideNotification);

    return () => {
      midTradeNotificationQueue.off('show-notification', handleShowNotification);
      midTradeNotificationQueue.off('hide-notification', handleHideNotification);
    };
  }, []);

  useEffect(() => {
    const initCache = async () => {
      await cacheClearOnRefresh.forceClearOnHardRefresh();
      await cacheClearOnRefresh.checkAndClearStaleCache();
    };

    initCache().catch(error => {
      console.error('[App] Error initializing cache:', error);
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    console.log('[App] Setting up global event listeners for user:', user.id);

    // Note: Goal achievement notifications are handled by GoalNotificationListener component
    // on SmartGoalModePage to prevent duplicate dialogs

    const tradeClosureChannel = supabase
      .channel('global-trade-closures')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'goal_session_trades',
          filter: `user_id=eq.${user.id}`
        },
        async (payload) => {
          if (payload.new.status === 'closed' && payload.old.status === 'open') {
            console.log('[App] Trade closed!', payload);

            const trade = payload.new;
            const closeReason = trade.close_reason || 'manual';

            if (closeReason === 'goal_met') {
              return;
            }

            // Calculate cumulative profit from all closed trades
            const { data: closedTrades } = await supabase
              .from('goal_session_trades')
              .select('profit_loss')
              .eq('goal_session_id', trade.goal_session_id)
              .eq('status', 'closed');

            const cumulativeProfit = closedTrades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;

            const { data: session } = await supabase
              .from('goal_sessions')
              .select('target_value')
              .eq('id', trade.goal_session_id)
              .maybeSingle();

            const { data: tradesCount } = await supabase
              .from('goal_session_trades')
              .select('id', { count: 'exact' })
              .eq('goal_session_id', trade.goal_session_id);

            console.log('[App] Trade closed dialog data:', {
              symbol: trade.symbol,
              profitLoss: trade.profit_loss,
              cumulativeProfit,
              targetValue: session?.target_value,
              tradesCount: tradesCount?.length
            });

            globalDialogManager.showTradeClosed({
              symbol: trade.symbol,
              direction: trade.direction,
              entryPrice: trade.entry_price,
              exitPrice: trade.exit_price,
              profitLoss: trade.profit_loss,
              closeReason: closeReason,
              currentProgress: cumulativeProfit,
              targetValue: session?.target_value || 0,
              tradesInSession: tradesCount?.length || 0,
              onStartNewSession: () => {
                window.location.href = '/ai-trade';
              },
              onContinueSession: () => {
                window.location.href = '/ai-trade';
              }
            });
          }
        }
      )
      .subscribe();

    const tradeSignalChannel = supabase
      .channel('global-trade-signals')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const notification = payload.new;

          if (notification.type === 'signal') {
            console.log('[App] Trade signal received!', notification);

            const notificationData = notification.data || {};
            const priority = notification.priority || 'high';

            const executionUrgency = priority === 'high'
              ? Date.now()
              : priority === 'medium'
                ? Date.now() + (60 * 1000)
                : Date.now() + (5 * 60 * 1000);

            globalDialogManager.showTradeSignal({
              symbol: notificationData.symbol || 'Unknown',
              direction: notificationData.direction || 'BUY',
              entryPrice: notificationData.entryPrice || notificationData.entry_price || 0,
              stopLoss: notificationData.stopLoss || notificationData.stop_loss || 0,
              takeProfit: notificationData.takeProfit || notificationData.take_profit || 0,
              confidence: notificationData.confidence || 0,
              setupType: notificationData.setupType || notificationData.setup_type || 'Unknown',
              reasoning: notificationData.reasoning || notification.message || '',
              priority: priority,
              executionUrgency: executionUrgency,
              expectedProfit: notificationData.expectedProfit || notificationData.expected_profit,
              riskReward: notificationData.riskReward || notificationData.risk_reward
            }, priority);

            globalToastManager.info(
              'Trade Signal',
              `${priority.toUpperCase()} priority signal on ${notificationData.symbol}`,
              priority === 'high' ? 0 : 5000
            );
          }
        }
      )
      .subscribe();

    // Listen for mid-trade notifications
    const midTradeChannel = supabase
      .channel('mid-trade-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const notification = payload.new;
          console.log('[App] Notification received:', { type: notification.type, id: notification.id });

          if (['mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action'].includes(notification.type)) {
            console.log('[App] Mid-trade notification added to queue!');
            midTradeNotificationQueue.addNotification(notification as any);
          } else {
            console.log('[App] Notification type not handled:', notification.type);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tradeClosureChannel);
      supabase.removeChannel(tradeSignalChannel);
      supabase.removeChannel(midTradeChannel);
    };
  }, [user]);

  const formatTimeElapsed = (startTime: string): string => {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const diff = now - start;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  if (loading) {
    return <LoadingFallback />;
  }

  return (
    <>
      <UpdateBanner />
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <PWAInstallPrompt />
      {user && <MidTradeAlertListener userId={user.id} />}
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/"
        element={
          user ? (
            <TradePage />
          ) : (
            <PublicLandingPage />
          )
        }
      />
      <Route
        path="/charts"
        element={
          <ProtectedRoute>
            <TradePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/trade"
        element={
          <ProtectedRoute>
            <TradePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/positions"
        element={
          <ProtectedRoute>
            <PositionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ai-trade"
        element={
          <ProtectedRoute>
            <AITradePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analysis"
        element={
          <ProtectedRoute>
            <AnalysisPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/journal"
        element={
          <ProtectedRoute>
            <AIJournalPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/get-app"
        element={
          <ProtectedRoute>
            <GetAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/credits"
        element={
          <ProtectedRoute>
            <CreditsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ai-learning-center"
        element={
          <ProtectedRoute>
            <AILearningCenterPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AITradePage />
          </ProtectedRoute>
        }
      />
      <Route path="/waitlist" element={<LandingPage />} />
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute adminOnly={true}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute adminOnly={true}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/diagnostics"
        element={
          <ProtectedRoute adminOnly={true}>
            <SystemDiagnosticsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/optimized-candles"
        element={
          <ProtectedRoute>
            <OptimizedCandleTestPage />
          </ProtectedRoute>
        }
      />
        </Routes>
      </Suspense>
      <MidTradeUpdateModal
        isOpen={showMidTradeModal}
        onClose={() => setShowMidTradeModal(false)}
      />
    </>
  );
};

export default function App() {
  useEffect(() => {
    // CRITICAL: Clear potentially contaminated cache on startup
    const clearCache = async () => {
      try {
        const { candleCacheManager } = await import('./services/candle-cache-manager');
        await candleCacheManager.clearAllCache();
        console.log('[App] ✅ Cleared all candle cache on startup to prevent cross-contamination');

        // Subscribe to real-time cache invalidation events
        candleCacheManager.subscribeToInvalidationEvents();
      } catch (error) {
        console.warn('[App] Could not clear cache:', error);
      }
    };

    // CRITICAL: Reset circuit breaker on startup to clear false positives
    const resetCircuitBreaker = async () => {
      try {
        const { chartCircuitBreaker } = await import('./services/chart-circuit-breaker');
        chartCircuitBreaker.reset();
        console.log('[App] ✅ Reset circuit breaker on startup');
      } catch (error) {
        console.warn('[App] Could not reset circuit breaker:', error);
      }
    };

    // Load circuit breaker utilities for emergency use
    import('./utils/reset-circuit-breaker').catch(console.warn);

    clearCache();
    resetCircuitBreaker();

    // Initialize polling services for ALL environments (dev needs to read from database)
    const initServices = async () => {
      // Shorter delay in dev for faster startup
      const delay = import.meta.env.PROD ? 3000 : 1000;
      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        // Import polling orchestrator for all environments
        const { pollingOrchestrator } = await import('./services/polling-orchestrator');

        console.log('[App] 🚀 Initializing polling orchestrator...');
        await pollingOrchestrator.initialize();
        console.log('[App] ✅ Polling orchestrator initialized');

        // In production only, also start background aggregator
        if (import.meta.env.PROD) {
          const { backgroundCandleAggregator } = await import('./services/background-candle-aggregator');
          setTimeout(() => {
            console.log('[App] 🚀 Starting background candle aggregator...');
            backgroundCandleAggregator.start()
              .then(() => console.log('[App] ✅ Background candle aggregator started'))
              .catch(err => console.error('[App] ❌ Aggregator init failed:', err));
          }, 5000);
        }
      } catch (error) {
        console.error('[App] ❌ Failed to initialize services:', error);
      }
    };

    initServices();

    // Start mid-trade alert auto-execution engine
    const startAlertExecutor = async () => {
      try {
        const { midTradeAlertExecutor } = await import('./services/mid-trade-alert-executor');
        midTradeAlertExecutor.start();
        console.log('[App] ✅ Mid-trade alert auto-executor started');
      } catch (error) {
        console.error('[App] ❌ Failed to start alert executor:', error);
      }
    };

    startAlertExecutor();

    // Cleanup on unmount
    return () => {
      import('./services/candle-cache-manager').then(({ candleCacheManager }) => {
        candleCacheManager.unsubscribeFromInvalidationEvents();
      }).catch(console.warn);

      // Stop alert executor
      import('./services/mid-trade-alert-executor').then(({ midTradeAlertExecutor }) => {
        midTradeAlertExecutor.stop();
      }).catch(console.warn);
    };
  }, []);

  return (
    <DatabaseErrorBoundary>
      <ConfirmDialogProvider>
        <GlobalDialogProvider>
          <AppRoutes />
        </GlobalDialogProvider>
      </ConfirmDialogProvider>
    </DatabaseErrorBoundary>
  );
}