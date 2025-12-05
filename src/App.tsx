import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DatabaseErrorBoundary } from './components/DatabaseErrorBoundary';

// Lazy load all pages for code splitting
const LandingPage = lazy(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));
const PublicLandingPage = lazy(() => import('./components/PublicLandingPage').then(m => ({ default: m.PublicLandingPage })));
const AuthPage = lazy(() => import('./pages/AuthPage').then(m => ({ default: m.AuthPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const TradePage = lazy(() => import('./pages/TradePage').then(m => ({ default: m.TradePage })));
const AITradePage = lazy(() => import('./pages/AITradePage').then(m => ({ default: m.AITradePage })));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage').then(m => ({ default: m.AnalysisPage })));
const AIJournalPage = lazy(() => import('./pages/AIJournalPage').then(m => ({ default: m.AIJournalPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

// Admin pages - only loaded when needed
const AdminDashboard = lazy(() => import('./pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const SystemDiagnosticsPage = lazy(() => import('./pages/SystemDiagnosticsPage'));
const AILearningCenterPage = lazy(() => import('./pages/AILearningCenterPage'));
const TokensPage = lazy(() => import('./pages/TokensPage').then(m => ({ default: m.TokensPage })));

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

  if (loading) {
    return <LoadingFallback />;
  }

  return (
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
        path="/trade"
        element={
          <ProtectedRoute>
            <TradePage />
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
        path="/tokens"
        element={
          <ProtectedRoute>
            <TokensPage />
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
            <TradePage />
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

    // Only run background services in production and only when user is authenticated
    if (!import.meta.env.PROD) return;

    // Delay service initialization significantly to allow initial render
    const initServices = async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      try {
        // Dynamically import services only when needed
        const [{ pollingOrchestrator }, { backgroundCandleAggregator }] = await Promise.all([
          import('./services/polling-orchestrator'),
          import('./services/background-candle-aggregator')
        ]);

        // Start polling only if user is on a page that needs it
        setTimeout(() => {
          pollingOrchestrator.initialize().catch(err =>
            console.log('[App] Polling init deferred:', err)
          );
        }, 5000);

        // Start aggregator even later
        setTimeout(() => {
          console.log('[App] 🚀 Starting background candle aggregator...');
          backgroundCandleAggregator.start()
            .then(() => console.log('[App] ✅ Background candle aggregator started successfully'))
            .catch(err => console.error('[App] ❌ Aggregator init failed:', err));
        }, 10000);
      } catch (error) {
        console.log('[App] Service initialization deferred:', error);
      }
    };

    initServices();
  }, []);

  return (
    <DatabaseErrorBoundary>
      <AppRoutes />
    </DatabaseErrorBoundary>
  );
}