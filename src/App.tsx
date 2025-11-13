import React, { useState, useRef, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LandingPage } from './components/LandingPage';
import { PublicLandingPage } from './components/PublicLandingPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { AuthPage } from './pages/AuthPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { TradePage } from './pages/TradePage';
import { AITradePage } from './pages/AITradePage';
import { HistoryPage } from './pages/HistoryPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { SettingsPage } from './pages/SettingsPage';
import { KPIsPage } from './pages/KPIsPage';
import AITrainingPage from './pages/AITrainingPage';
import SessionLearningsPage from './pages/SessionLearningsPage';
import { DatabaseErrorBoundary } from './components/DatabaseErrorBoundary';
import { logEnvironmentStatus } from './lib/env-validator';
import { runDatabaseDiagnostics, logDiagnostics } from './lib/database-diagnostics';
import { verifyDatabaseSetup } from './lib/migration-checker';
import { connectionValidator } from './lib/connection-validator';
import { dbHealthMonitor } from './services/system-monitoring-service';
import { globalPollingCoordinator } from './services/global-polling-coordinator';
import { backgroundCandleAggregator } from './services/background-candle-aggregator';
import { systemLoadMonitor } from './services/system-load-monitor';
import { browserPricePoller } from './services/browser-price-poller';
import ConnectionStatusIndicator from './components/ConnectionStatusIndicator';


const AppRoutes: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-4"></div>
          <p className="text-white/70 text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  return (
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
        path="/history"
        element={
          <ProtectedRoute>
            <HistoryPage />
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
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
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
        path="/kpis"
        element={
          <ProtectedRoute adminOnly={true}>
            <KPIsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/ai-training"
        element={
          <ProtectedRoute adminOnly={true}>
            <AITrainingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/learnings"
        element={
          <ProtectedRoute adminOnly={true}>
            <SessionLearningsPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

export default function App() {
  const [dbValidated, setDbValidated] = useState(true);

  useEffect(() => {
    // Run ALL diagnostics and service initialization in the background
    // WITHOUT blocking the app from loading
    const runStartupDiagnostics = async () => {
      // Give the app 500ms to fully render first
      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        logEnvironmentStatus();

        // All diagnostics wrapped in try-catch to prevent cascade failures
        try {
          await Promise.race([
            connectionValidator.validateConnection(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection validation timeout')), 2000))
          ]);
        } catch (error) {
          console.log('[Dev Info] Connection validation skipped:', error);
        }

        try {
          await Promise.race([
            runDatabaseDiagnostics().then(logDiagnostics),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Diagnostics timeout')), 2000))
          ]);
        } catch (error) {
          console.log('[Dev Info] Database diagnostics skipped:', error);
        }

        try {
          await Promise.race([
            verifyDatabaseSetup(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Schema verification timeout')), 2000))
          ]);
        } catch (error) {
          console.log('[Dev Info] Schema verification skipped:', error);
        }

        // Start background services with delays and error handling
        setTimeout(() => {
          try {
            dbHealthMonitor.startMonitoring();
          } catch (error) {
            console.log('[Dev Info] Health monitor failed to start:', error);
          }
        }, 3000);

        setTimeout(async () => {
          try {
            await browserPricePoller.start();
          } catch (error) {
            console.log('[Dev Info] Price poller failed to start:', error);
          }
        }, 5000);

        setTimeout(async () => {
          try {
            await globalPollingCoordinator.initialize();
          } catch (error) {
            console.log('[Dev Info] Polling coordinator failed to start:', error);
          }
        }, 8000);

        setTimeout(() => {
          try {
            systemLoadMonitor.start();
          } catch (error) {
            console.log('[Dev Info] Load monitor failed to start:', error);
          }
        }, 10000);

        setTimeout(async () => {
          try {
            await backgroundCandleAggregator.start();
          } catch (error) {
            console.log('[Dev Info] Candle aggregator failed to start:', error);
          }
        }, 12000);

        setDbValidated(true);
      } catch (error) {
        console.log('[Dev Info] Startup diagnostics error:', error);
        setDbValidated(true);
      }
    };

    // Run diagnostics in background - don't await
    runStartupDiagnostics().catch(err => {
      console.log('[Dev Info] Background diagnostics failed:', err);
    });

    return () => {
      try {
        dbHealthMonitor.stopMonitoring();
      } catch (err) {
        console.log('[Dev Info] Error stopping health monitor:', err);
      }

      backgroundCandleAggregator.stop().catch(err => {
        console.log('[Dev Info] Error shutting down aggregator:', err);
      });

      globalPollingCoordinator.shutdown().catch(err => {
        console.log('[Dev Info] Error shutting down coordinator:', err);
      });
    };
  }, []);

  return (
    <DatabaseErrorBoundary>
      <AppRoutes />
      <ConnectionStatusIndicator />
    </DatabaseErrorBoundary>
  );
}