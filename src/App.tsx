import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
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
import { pricePollingCoordinator } from './services/price-polling-coordinator';
import { systemReadinessRegistry } from './services/system-readiness-registry';
import { midTradeNotificationQueue } from './services/mid-trade-notification-queue';
import MidTradeUpdateModal from './components/MidTradeUpdateModal';
import { MidTradeAlertListener } from './components/MidTradeAlertListener';
import { ClubAccessButton } from './components/ClubAccessButton';
import { WeekendProtectionBanner } from './components/WeekendProtectionBanner';
import { OpenAIQuotaBanner } from './components/OpenAIQuotaBanner';
import { realtimeTradeNotificationListener } from './services/realtime-trade-notification-listener';
import { realtimeConnectionManager } from './services/realtime-connection-manager';
import { useNotificationPermission } from './hooks/useNotificationPermission';

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
const ClubEntryGatePage = lazy(() => import('./pages/ClubEntryGatePage').then(m => ({ default: m.ClubEntryGatePage })));
const ClubHomePage = lazy(() => import('./pages/ClubHomePage').then(m => ({ default: m.ClubHomePage })));
const ClubChatPage = lazy(() => import('./pages/ClubChatPage').then(m => ({ default: m.ClubChatPage })));
const ClubRewardsPage = lazy(() => import('./pages/ClubRewardsPage').then(m => ({ default: m.ClubRewardsPage })));
const ClubGovernancePage = lazy(() => import('./pages/ClubGovernancePage').then(m => ({ default: m.ClubGovernancePage })));
const ClubReferralsPage = lazy(() => import('./pages/ClubReferralsPage').then(m => ({ default: m.ClubReferralsPage })));

// Loading component
const LoadingFallback = () => (
  <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-4"></div>
      <p className="text-white/70 text-lg">Loading...</p>
    </div>
  </div>
);


const ReferralCodeCapture: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const refCode = searchParams.get('ref');
    if (refCode) {
      localStorage.setItem('pending_referral_code', refCode);
    }
  }, [location.search]);

  return null;
};

const AppRoutes: React.FC = () => {
  const { user, loading } = useAuth();
  const toast = useToast();
  useNotificationPermission(user?.id);
  const [showMidTradeModal, setShowMidTradeModal] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);

  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => setLoadingTimeout(true), 10000);
      return () => clearTimeout(timer);
    } else {
      setLoadingTimeout(false);
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

    // CCIP-BOOT-ORDER-2026-04-02: Start price polling eagerly — no auth required.
    // This guarantees the 'price-poller' boot gate resolves before the first scan
    // request reaches goal-scanner.ts, eliminating the cold-start race condition
    // where preCheckFreshness received ageSeconds: Infinity on the very first scan.
    // Calling start() here is idempotent; if a component has already subscribed the
    // coordinator is already active and this is a no-op.
    pricePollingCoordinator.start();

    // Wait for auth to be ready before starting database-dependent services
    const initDatabaseServices = async () => {
      if (loading) return;

      // CCIP-STALENESS-FIX-2026-02-20: Start candle realtime invalidation subscription.
      // When a new candle is written to the database the Supabase realtime channel fires,
      // clearning the IndexedDB candle cache, the in-memory market snapshot, and (on H1+)
      // the Alpha thesis local cache.  This is the event-driven freshness layer that
      // replaces the previous timer-only TTL approach.
      // subscribeToInvalidationEvents() is idempotent — safe to call multiple times.
      const initCandleInvalidation = async () => {
        try {
          const { candleCacheManager } = await import('./services/candle-cache-manager');
          candleCacheManager.subscribeToInvalidationEvents();
        } catch {
          // Non-blocking
        }
      };

      initCandleInvalidation();

      const initCacheWarming = async () => {
        try {
          const { thesisCacheWarmer } = await import('./services/thesis-cache-warmer');
          await thesisCacheWarmer.warmCache();
          // CCIP-BOOT-ORDER-2026-04-02: Self-register advisory gate on completion.
          systemReadinessRegistry.markReady('thesis-cache');
        } catch (err) {
          // Non-blocking — advisory gate, does not block scans
          const reason = err instanceof Error ? err.message : String(err);
          systemReadinessRegistry.markFailed('thesis-cache', reason);
        }
      };

      // Run warming async - don't block app startup
      initCacheWarming();

      const initCCIPTracking = async () => {
        try {
          const { ccipEntryIntentCleanupTracker } = await import('./services/ccip-entry-intent-cleanup-tracker');
          await ccipEntryIntentCleanupTracker.initializeTracking();
        } catch {
          // Non-blocking
        }
      };

      initCCIPTracking();
    };

    initDatabaseServices();

    // Initialize deployment detector in production (doesn't require auth)
    if (import.meta.env.PROD) {
      const initDeploymentDetector = async () => {
        const { deploymentDetector } = await import('./services/deployment-detector');
        await deploymentDetector.initialize();
      };

      initDeploymentDetector().catch(error => {
        console.error('[App] Error initializing deployment detector:', error);
      });
    }
  }, [loading]);

  useEffect(() => {
    if (user?.id) {
      realtimeTradeNotificationListener.initialize(user.id).catch(() => {});
      return () => { realtimeTradeNotificationListener.cleanup().catch(() => {}); };
    }
  }, [user?.id]);

  // CCIP-2026-0322A: Start Alpha Mid-Trade Escalation Engine
  // This is the missing orchestrator that bridges trigger detection → Alpha re-analysis.
  // Runs every 30s, evaluates open trades, calls Alpha when meaningful triggers fire,
  // and persists verdicts to DB so the MidTradeMonitor panel can display them.
  useEffect(() => {
    if (!user?.id) return;

    let engine: import('./services/mid-trade-escalation-engine').MidTradeEscalationEngine | null = null;

    const startEscalationEngine = async () => {
      try {
        const mod = await import('./services/mid-trade-escalation-engine');
        engine = mod.midTradeEscalationEngine as any;
        (engine as any).start();
      } catch {
        // Non-blocking — monitor still shows deterministic guidance without Alpha calls
      }
    };

    startEscalationEngine();

    return () => {
      if (engine) {
        (engine as any).stop();
      }
    };
  }, [user?.id]);


  useEffect(() => {
    if (!user) return;

    // Check for pending modals on app load
    let _modalDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const checkPendingModals = async () => {
      const { modalQueueManager } = await import('./services/modal-queue-manager');
      const pendingModals = await modalQueueManager.getPendingModals(user.id);

      if (pendingModals.length > 0) {

        // Show the oldest modal first
        const modal = pendingModals[0];
        const modalData = modal.modal_data;

        if (modal.modal_type === 'trade_closed') {
          // CCIP FIX (2026-02-20 DUAL-MODAL-FIX): skipPersist: true is MANDATORY here.
          // This path reads from pending_user_modals (already created by tradeClosureCoordinator).
          // Without skipPersist:true, showDialog() calls modalNotificationBridge.captureDialog()
          // which inserts into goal_notifications, which immediately triggers
          // realtimeTradeNotificationListener.handleNotificationInsert() → a SECOND showTradeClosed()
          // call on the same trade, bypassing the GlobalDialogManager dedup because the dedup
          // key was already cleared by the time the realtime event arrives (~3-5s later).
          // Authority: pending_user_modals is the persistence SSOT. goal_notifications must NOT
          // be written again for the same event.
          globalDialogManager.showTradeClosed({
            symbol: modalData.symbol,
            direction: modalData.direction,
            entryPrice: modalData.entry_price,
            exitPrice: modalData.exit_price,
            profitLoss: modalData.profit_loss,
            closeReason: modalData.close_reason,
            stopLoss: modalData.stop_loss,
            takeProfit: modalData.take_profit,
            currentProgress: modalData.current_progress,
            targetValue: modalData.target_value,
            tradesInSession: modalData.trades_in_session,
            isGoalAchieved: modalData.isGoalAchieved || false,
            dollarRisk: modalData.dollar_risk || 0,
            sessionId: modal.goal_session_id,
            tradeId: modalData.trade_id,
            timestamp: modalData.timestamp || modal.created_at,
            onStartNewSession: async () => {
              await modalQueueManager.dismissModal(modal.id, 'close');
              window.location.href = '/ai-trade';
            },
            onContinueSession: async () => {
              await modalQueueManager.dismissModal(modal.id, 'continue');
              checkPendingModals();
            }
          }, { skipPersist: true });
        }
      }
    };

    // Check immediately on mount
    checkPendingModals();

    // CCIP FIX (2026-02-20 DUAL-MODAL-FIX): Corrected broken subscription wiring.
    // The previous code assigned the Promise to a destructured variable (a no-op),
    // meaning subscribeToModalUpdates() was never called and checkPendingModals() never
    // fired reactively on new pending_user_modals inserts. The modal was only shown on
    // initial mount, not when a new one arrived mid-session.
    // Now correctly awaited inside the async init chain.
    const debouncedModalCheck = () => {
      if (_modalDebounceTimer) clearTimeout(_modalDebounceTimer);
      _modalDebounceTimer = setTimeout(checkPendingModals, 200);
    };

    import('./services/modal-queue-manager').then(({ modalQueueManager }) => {
      modalQueueManager.subscribeToModalUpdates(user.id, debouncedModalCheck);
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

            // CCIP FIX (2026-02-27): Column is `metadata`, not `data`.
            // `notification.data` was always undefined, causing all fields to fall
            // back to 'Unknown' / 0 in the push notification body.
            // Authority: goal-session-live-engine.logNotification() stores trade
            // details under `metadata` (symbol, direction, confidence, entry, SL, TP).
            const notificationData = notification.metadata || {};
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
              riskReward: notificationData.riskReward || notificationData.risk_reward,
              tradeId: notificationData.tradeId || notificationData.trade_id || ''
            // CCIP FIX (2026-02-27): skipPersist:true is MANDATORY here.
            // notificationCoordinator.send() already created the goal_notifications
            // record. Without skipPersist, captureDialog() would create a second
            // record and fire a push with stale dialog data (the 'Unknown' bug source).
            }, priority, { skipPersist: true });

            globalToastManager.info(
              'Trade Signal',
              `${priority.toUpperCase()} priority signal on ${notificationData.symbol}`,
              priority === 'high' ? 0 : 5000
            );
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          realtimeConnectionManager.logChannelError('App/TradeSignals');
        }
      });

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

          if (['mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action'].includes(notification.type)) {
            midTradeNotificationQueue.addNotification(notification as any);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          realtimeConnectionManager.logChannelError('App/MidTrade');
        }
      });

    return () => {
      if (_modalDebounceTimer) clearTimeout(_modalDebounceTimer);
      supabase.removeChannel(tradeSignalChannel);
      supabase.removeChannel(midTradeChannel);

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
      {user && <ClubAccessButton userId={user.id} />}
      <ReferralCodeCapture />
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
        path="/club"
        element={
          <ProtectedRoute>
            <ClubEntryGatePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/club/home"
        element={
          <ProtectedRoute>
            <ClubHomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/club/chat"
        element={
          <ProtectedRoute>
            <ClubChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/club/rewards"
        element={
          <ProtectedRoute>
            <ClubRewardsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/club/governance"
        element={
          <ProtectedRoute>
            <ClubGovernancePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/club/referrals"
        element={
          <ProtectedRoute>
            <ClubReferralsPage />
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
  const location = useLocation();
  const isClubPage = location.pathname.startsWith('/club');

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
          {!isClubPage && <WeekendProtectionBanner />}
          {!isClubPage && <OpenAIQuotaBanner />}
          <AppRoutes />
        </GlobalDialogProvider>
      </ConfirmDialogProvider>
    </DatabaseErrorBoundary>
  );
}