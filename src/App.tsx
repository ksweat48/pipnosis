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
import StrategyArsenalPage from './pages/StrategyArsenalPage';
import { DatabaseSetupWizard } from './components/DatabaseSetupWizard';
import { DatabaseErrorBoundary } from './components/DatabaseErrorBoundary';
import { logEnvironmentStatus } from './lib/env-validator';
import { runDatabaseDiagnostics, logDiagnostics } from './lib/database-diagnostics';
import { verifyDatabaseSetup } from './lib/migration-checker';
import { connectionValidator } from './lib/connection-validator';
import { dbHealthMonitor } from './services/db-health-monitor';
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
      <Route
        path="/admin/strategy-arsenal"
        element={
          <ProtectedRoute adminOnly={true}>
            <StrategyArsenalPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

export default function App() {
  const [dbValidated, setDbValidated] = useState(true);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  useEffect(() => {
    const runStartupDiagnostics = async () => {
      try {
        logEnvironmentStatus();

        console.log('Running non-blocking database connection validation...');

        const validationTimeout = setTimeout(() => {
          console.log('[Dev Info] Database validation taking too long, allowing app to load anyway');
          setDbValidated(true);
        }, 3000);

        const validationResult = await connectionValidator.validateConnection();
        clearTimeout(validationTimeout);

        if (!validationResult.isValid) {
          console.log('[Dev Info] Database validation issues (non-blocking):', validationResult.warnings);
          if (validationResult.errors.length > 0) {
            console.log('[Dev Info] Database errors (app will continue):', validationResult.errors);
          }
        }

        console.log('Running background database diagnostics...');
        const diagnostics = await runDatabaseDiagnostics();
        logDiagnostics(diagnostics);

        await verifyDatabaseSetup();

        // Silently log database configuration issues for developers only
        // Users don't need to see these warnings
        if (diagnostics.errors.length > 0) {
          console.log('[Dev Info] Database configuration issues detected (non-blocking). Some features may not work correctly.');
          console.log('[Dev Info] See PRODUCTION_DATABASE_SETUP.md for detailed migration instructions');
        }

        // Staggered startup sequence to prevent race conditions
        console.log('🚀 Starting services in coordinated sequence...');

        setTimeout(() => {
          console.log('Starting database health monitoring in background...');
          dbHealthMonitor.startMonitoring();
        }, 5000);

        // STEP 0: Start browser price poller to populate database
        setTimeout(async () => {
          console.log('🌐 STEP 0: Starting browser price poller...');
          console.log('   → This ensures price data flows to database');
          console.log('   → Calls Netlify function which writes to database');
          try {
            await browserPricePoller.start();
            console.log('✅ Browser price poller started successfully');
          } catch (error) {
            console.error('❌ Failed to start browser price poller:', error);
          }
        }, 3000);

        // STEP 1: Start global polling coordinator (reads from DB)
        setTimeout(async () => {
          console.log('📡 STEP 1: Initializing global polling coordinator...');
          console.log('   → This service reads price data from the database');
          try {
            await globalPollingCoordinator.initialize();
            console.log('✅ Global polling coordinator initialized successfully');
          } catch (error) {
            console.error('❌ Failed to initialize global polling coordinator:', error);
          }
        }, 6000);

        setTimeout(() => {
          console.log('📊 Starting system load monitor...');
          try {
            systemLoadMonitor.start();
            console.log('✅ System load monitor started successfully');
          } catch (error) {
            console.error('❌ Failed to start system load monitor:', error);
          }
        }, 7000);

        // STEP 2: Start background candle aggregator (subscribes to realtime)
        // Wait 3 seconds after global coordinator to ensure database has data
        setTimeout(async () => {
          console.log('📊 STEP 2: Starting background candle aggregator...');
          console.log('   → Waiting for global coordinator to populate initial data...');

          // Give global coordinator time to fetch first batch
          await new Promise(resolve => setTimeout(resolve, 2000));

          try {
            console.log('   → Subscribing to live price stream...');
            await backgroundCandleAggregator.start();
            console.log('✅ Background candle aggregator started successfully');
            const status = backgroundCandleAggregator.getStatus();
            console.log(`📊 Aggregator Status: ${status.symbols} symbols × ${status.timeframes} timeframes = ${status.totalCombinations} combinations`);
            console.log(`🔗 Connection: ${status.connectionState}, Listeners: ${status.tickListenerCount}`);
          } catch (error) {
            console.error('❌ Failed to start background candle aggregator:', error);
          }
        }, 9000);

        setDbValidated(true);
      } catch (error) {
        console.error('Startup diagnostics error (non-blocking):', error);
        setDbValidated(true);
      }
    };

    runStartupDiagnostics();

    return () => {
      dbHealthMonitor.stopMonitoring();

      console.log('🛑 Shutting down background candle aggregator...');
      backgroundCandleAggregator.stop().catch(err => {
        console.error('Error shutting down background aggregator:', err);
      });

      console.log('🛑 Shutting down global polling coordinator...');
      globalPollingCoordinator.shutdown().catch(err => {
        console.error('Error shutting down polling coordinator:', err);
      });
    };
  }, []);

  if (showSetupWizard) {
    return (
      <DatabaseSetupWizard
        onComplete={() => {
          setShowSetupWizard(false);
          setDbValidated(true);
          setTimeout(() => dbHealthMonitor.startMonitoring(), 2000);
        }}
      />
    );
  }

  return (
    <DatabaseErrorBoundary>
      <AppRoutes />
      <ConnectionStatusIndicator />
    </DatabaseErrorBoundary>
  );
}