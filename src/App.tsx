import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DatabaseErrorBoundary } from './components/DatabaseErrorBoundary';
import { ConfirmDialogProvider } from './hooks/useConfirmDialog';
import { ToastContainer } from './components/ToastNotification';
import { useToast } from './hooks/useToast';
import { globalToastManager } from './services/global-toast-manager';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { cacheClearOnRefresh } from './services/cache-clear-on-refresh';

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
    const initCache = async () => {
      await cacheClearOnRefresh.forceClearOnHardRefresh();
      await cacheClearOnRefresh.checkAndClearStaleCache();
    };

    initCache().catch(error => {
      console.error('[App] Error initializing cache:', error);
    });
  }, []);

  if (loading) {
    return <LoadingFallback />;
  }

  return (
    <>
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <PWAInstallPrompt />
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

    // Cleanup on unmount
    return () => {
      import('./services/candle-cache-manager').then(({ candleCacheManager }) => {
        candleCacheManager.unsubscribeFromInvalidationEvents();
      }).catch(console.warn);
    };
  }, []);

  return (
    <DatabaseErrorBoundary>
      <ConfirmDialogProvider>
        <AppRoutes />
      </ConfirmDialogProvider>
    </DatabaseErrorBoundary>
  );
}