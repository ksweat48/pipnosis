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
import { cacheManager } from './services/cache-manager';
import { supabase } from './lib/supabase';
import { midTradeNotificationQueue } from './services/mid-trade-notification-queue';
import MidTradeUpdateModal from './components/MidTradeUpdateModal';
import { MidTradeAlertListener } from './components/MidTradeAlertListener';
import { FloatingMessageCenter } from './components/FloatingMessageCenter';
import { WeekendProtectionBanner } from './components/WeekendProtectionBanner';
import { realtimeTradeNotificationListener } from './services/realtime-trade-notification-listener';

// Lazy load all pages for code splitting
const LandingPage = lazy(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));
const PublicLandingPage = lazy(() => import('./components/PublicLandingPage'));
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
const CreditsPage = lazy(() => import('./pages/CreditsPage').then(m => ({ default: m.CreditsPage })));

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
  const [loadingTimeout, setLoadingTimeout] = useState(false);

  // Add loading timeout to prevent infinite loading state
  useEffect(() => {
    if (loading) {
      console.log('⏱️ [App] Starting loading timeout (10 seconds)');
      const timer = setTimeout(() => {
        console.warn('⚠️ [App] Loading timeout reached! Forcing render...');
        setLoadingTimeout(true);
      }, 10000); // 10 second timeout

      return () => {
        clearTimeout(timer);
      };
    }
  }, [loading]);

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
      await cacheManager.forceClearOnHardRefresh();
      await cacheManager.checkAndClearStaleCache();
    };

    initCache().catch(error => {
      console.error('[App] Error initializing cache:', error);
    });

    // CACHE INTELLIGENCE: Initialize cache warming for SSOT compliance
    // Pre-populates alpha thesis cache to improve hit rates (target 60-85%)
    const initCacheWarming = async () => {
      try {
        const { thesisCacheWarmer } = await import('./services/thesis-cache-warmer');
        console.log('[App] Starting cache warming for alpha thesis optimization...');

        await thesisCacheWarmer.warmCache();

        console.log('[App] ✅ Cache warming complete - SSOT-compliant cache ready');
      } catch (error) {
        console.warn('[App] Cache warming failed (non-blocking):', error);
      }
    };

    // Run warming async - don't block app startup
    initCacheWarming();

    // Initialize deployment detector in production
    if (import.meta.env.PROD) {
      const initDeploymentDetector = async () => {
        const { deploymentDetector } = await import('./services/deployment-detector');
        await deploymentDetector.initialize();
      };

      initDeploymentDetector().catch(error => {
        console.error('[App] Error initializing deployment detector:', error);
      });
    }

    // Initialize CCIP change tracking for entry intent cleanup fix
    const initCCIPTracking = async () => {
      const { ccipEntryIntentCleanupTracker } = await import('./services/ccip-entry-intent-cleanup-tracker');
      await ccipEntryIntentCleanupTracker.initializeTracking();
    };

    initCCIPTracking().catch(error => {
      console.error('[App] Error initializing CCIP tracking:', error);
    });
  }, []);

  // CCIP FIX (2026-02-03): Initialize realtime trade notification listener
  // Triggers modal popups for server-side trade executions
  useEffect(() => {
    if (user?.id) {
      console.log('[App] 🎯 Initializing realtime trade notification listener for user:', user.id);

      realtimeTradeNotificationListener.initialize(user.id).catch(error => {
        console.error('[App] ⚠️ Failed to initialize realtime trade listener:', error);
        // Non-blocking - app continues without realtime modals
      });

      // Cleanup on unmount or user change
      return () => {
        realtimeTradeNotificationListener.cleanup().catch(error => {
          console.warn('[App] Cleanup warning:', error);
        });
      };
    }
  }, [user?.id]);


  useEffect(() => {
    if (!user) return;

    // Only log in development to reduce console noise
    if (import.meta.env.DEV) {
      console.log('[App] Setting up global event listeners for user:', user.id);
    }

    // Check for pending modals on app load
    const checkPendingModals = async () => {
      const { modalQueueManager } = await import('./services/modal-queue-manager');
      const pendingModals = await modalQueueManager.getPendingModals(user.id);

      if (pendingModals.length > 0) {
        console.log('[App] Found pending modals:', pendingModals.length);

        // Show the oldest modal first
        const modal = pendingModals[0];
        const modalData = modal.modal_data;

        if (modal.modal_type === 'goal_achieved') {
          // Show goal achieved celebration
          globalDialogManager.showGoalAchieved({
            symbol: modalData.symbol,
            profitLoss: modalData.profit_loss,
            targetValue: modalData.target_value,
            tradesInSession: modalData.trades_in_session,
            onClose: async () => {
              await modalQueueManager.dismissModal(modal.id, 'acknowledged');
              // Check for more pending modals
              checkPendingModals();
            }
          });
        } else if (modal.modal_type === 'trade_closed') {
          // Show trade closed dialog with timestamp
          globalDialogManager.showTradeClosed({
            symbol: modalData.symbol,
            direction: modalData.direction,
            entryPrice: modalData.entry_price,
            exitPrice: modalData.exit_price,
            profitLoss: modalData.profit_loss,
            closeReason: modalData.close_reason,
            currentProgress: modalData.current_progress,
            targetValue: modalData.target_value,
            tradesInSession: modalData.trades_in_session,
            timestamp: modalData.timestamp || modal.created_at, // Pass timestamp for "X time ago" display
            onStartNewSession: async () => {
              await modalQueueManager.dismissModal(modal.id, 'close');
              window.location.href = '/ai-trade';
            },
            onContinueSession: async () => {
              await modalQueueManager.dismissModal(modal.id, 'continue');
              // Check for more pending modals
              checkPendingModals();
            }
          });
        }
      }
    };

    // Check immediately on mount
    checkPendingModals();

    // Subscribe to modal updates
    const { modalQueueManager } = import('./services/modal-queue-manager').then(({ modalQueueManager }) => {
      modalQueueManager.subscribeToModalUpdates(user.id, checkPendingModals);
    });

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

          // SSOT: Route notifications to appropriate handlers
          if (['mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action'].includes(notification.type)) {
            console.log('[App] Mid-trade notification added to queue!');
            midTradeNotificationQueue.addNotification(notification as any);
          } else if (['trade_closed', 'goal_achieved', 'session_ended', 'session_timeout', 'entry_edge_loss'].includes(notification.type)) {
            // These notifications trigger modals via pending_user_modals (handled by modalQueueManager)
            console.log('[App] Modal notification (handled by modal queue manager):', notification.type);
          } else {
            // Other notifications handled by NotificationCenter or specific listeners
            console.log('[App] Standard notification:', notification.type);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tradeSignalChannel);
      supabase.removeChannel(midTradeChannel);

      // Unsubscribe from modal updates
      import('./services/modal-queue-manager').then(({ modalQueueManager }) => {
        modalQueueManager.unsubscribeFromModalUpdates();
      });
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

  // Show loading screen unless timeout is reached
  if (loading && !loadingTimeout) {
    return <LoadingFallback />;
  }

  // If loading timeout reached, show error message
  if (loading && loadingTimeout) {
    console.error('🔴 [App] Loading timeout - showing error message');
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center p-4">
        <div className="text-center max-w-md bg-gray-900 border border-gray-700 rounded-xl p-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-600/20 rounded-full mb-4">
            <svg className="w-8 h-8 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Loading is taking longer than expected</h1>
          <p className="text-gray-400 mb-6">The app is having trouble connecting. This might be a temporary issue.</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              Refresh Page
            </button>
          </div>
          <p className="text-center text-gray-500 text-xs mt-6">
            Check your internet connection and try refreshing the page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <UpdateBanner />
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <PWAInstallPrompt />
      {user && <MidTradeAlertListener userId={user.id} />}
      {user && <FloatingMessageCenter userId={user.id} />}
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

    // Start weekend protection service
    const startWeekendProtection = async () => {
      try {
        const { weekendProtectionService } = await import('./services/weekend-protection-service');
        weekendProtectionService.start();
        console.log('[App] 🛡️ Weekend protection service started');
      } catch (error) {
        console.error('[App] ❌ Failed to start weekend protection:', error);
      }
    };

    startWeekendProtection();

    // Cleanup on unmount
    return () => {
      import('./services/candle-cache-manager').then(({ candleCacheManager }) => {
        candleCacheManager.unsubscribeFromInvalidationEvents();
      }).catch(console.warn);

      // Stop alert executor
      import('./services/mid-trade-alert-executor').then(({ midTradeAlertExecutor }) => {
        midTradeAlertExecutor.stop();
      }).catch(console.warn);

      // Stop weekend protection
      import('./services/weekend-protection-service').then(({ weekendProtectionService }) => {
        weekendProtectionService.stop();
      }).catch(console.warn);
    };
  }, []);

  return (
    <DatabaseErrorBoundary>
      <ConfirmDialogProvider>
        <GlobalDialogProvider>
          <WeekendProtectionBanner />
          <AppRoutes />
        </GlobalDialogProvider>
      </ConfirmDialogProvider>
    </DatabaseErrorBoundary>
  );
}