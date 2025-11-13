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
    const runStartupDiagnostics = async () => {
      try {
        logEnvironmentStatus();

        const validationTimeout = setTimeout(() => setDbValidated(true), 3000);
        const validationResult = await connectionValidator.validateConnection();
        clearTimeout(validationTimeout);

        const diagnostics = await runDatabaseDiagnostics();
        logDiagnostics(diagnostics);
        await verifyDatabaseSetup();

        setTimeout(() => dbHealthMonitor.startMonitoring(), 5000);

        setTimeout(async () => {
          try {
            await browserPricePoller.start();
          } catch (error) {
            console.error('Failed to start browser price poller:', error);
          }
        }, 3000);

        setTimeout(async () => {
          try {
            await globalPollingCoordinator.initialize();
          } catch (error) {
            console.error('Failed to initialize global polling coordinator:', error);
          }
        }, 6000);

        setTimeout(() => {
          try {
            systemLoadMonitor.start();
          } catch (error) {
            console.error('Failed to start system load monitor:', error);
          }
        }, 7000);

        setTimeout(async () => {
          await new Promise(resolve => setTimeout(resolve, 2000));
          try {
            await backgroundCandleAggregator.start();
          } catch (error) {
            console.error('Failed to start background candle aggregator:', error);
          }
        }, 9000);

        setDbValidated(true);
      } catch (error) {
        console.error('Startup diagnostics error:', error);
        setDbValidated(true);
      }
    };

    runStartupDiagnostics();

    return () => {
      dbHealthMonitor.stopMonitoring();
      backgroundCandleAggregator.stop().catch(err => console.error('Error shutting down aggregator:', err));
      globalPollingCoordinator.shutdown().catch(err => console.error('Error shutting down coordinator:', err));
    };
  }, []);

  return (
    <DatabaseErrorBoundary>
      <AppRoutes />
      <ConnectionStatusIndicator />
    </DatabaseErrorBoundary>
  );
}