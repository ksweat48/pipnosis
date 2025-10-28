import React, { useState, useRef, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';
import { Header } from './components/Header';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PromptInput } from './components/PromptInput';
import { MarketChart } from './components/MarketChart';
import { StrategyOptions } from './components/StrategyOptions';
import { TradingDashboard } from './components/TradingDashboard';
import { NotificationCenter } from './components/NotificationCenter';
import { TradeJournal } from './components/TradeJournal';
import { TradingKPIs } from './components/TradingKPIs';
import { TradingLaws } from './components/TradingLaws';
import { LandingPage } from './components/LandingPage';
import { PublicLandingPage } from './components/PublicLandingPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { AuthPage } from './pages/AuthPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ActivePositions } from './components/ActivePositions';
import { TradeConfirmationModal } from './components/TradeConfirmationModal';
import { ConfigurationStatus } from './components/ConfigurationStatus';
import { DatabaseSetupWizard } from './components/DatabaseSetupWizard';
import { DatabaseErrorBoundary } from './components/DatabaseErrorBoundary';
import { AITradingConsole } from './components/AITradingConsole';
import { SearchStatusPanel } from './components/SearchStatusPanel';
import { usePromptAnalysis, useMarketData } from './hooks/useAPI';
import { simulatedTradingService } from './services/simulated-trading';
import { promptValidationService } from './services/prompt-validation';
import { extendedSearchService } from './services/extended-search';
import { multiSymbolScanner } from './strategies/core/multiSymbolScanner';
import { strategyService } from './strategies';
import { logEnvironmentStatus } from './lib/env-validator';
import { supabase } from './lib/supabase';
import { runDatabaseDiagnostics, logDiagnostics } from './lib/database-diagnostics';
import { verifyDatabaseSetup } from './lib/migration-checker';
import { connectionValidator } from './lib/connection-validator';
import { dbHealthMonitor } from './services/db-health-monitor';

interface StrategyOption {
  id: string;
  name: string;
  risk: string;
  symbol: string;
  action: string;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  lotSize: number;
  estimatedGain: string;
  riskRewardRatio?: number;
  feasible: boolean;
  reasoning: string;
  confidence: string;
}

interface Notification {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [strategyOptions, setStrategyOptions] = useState<StrategyOption[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeTradeLines, setActiveTradeLines] = useState<{
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  }>({});
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyOption | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [validationError, setValidationError] = useState<{
    message: string;
    details?: string[];
    suggestion?: string;
  } | null>(null);
  const [activeSearchSessionId, setActiveSearchSessionId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const strategyOptionsRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToStrategy, setShouldScrollToStrategy] = useState(false);

  const { analyzePrompt, isAnalyzing, error: aiError } = usePromptAnalysis();
  const { balance: accountBalance, totalPnL, openPositionsCount, refreshBalance, refreshPositions } = useUserBalance(user?.id || null);
  const { marketData, isLoading: marketLoading, error: marketError, lastUpdated, refetch } = useMarketData();

  useEffect(() => {
    if (shouldScrollToStrategy && strategyOptions.length > 0 && strategyOptionsRef.current) {
      setTimeout(() => {
        strategyOptionsRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
        setShouldScrollToStrategy(false);
      }, 100);
    }
  }, [shouldScrollToStrategy, strategyOptions]);

  const handlePromptSubmit = async (prompt: string) => {
    if (!user) return;

    setValidationError(null);
    setStrategyOptions([]);
    setActiveSearchSessionId(null);

    try {
      const validation = await promptValidationService.validatePrompt(prompt, accountBalance);

      if (!validation.isValid || !validation.isFeasible) {
        setValidationError({
          message: validation.errorMessage || 'This request cannot be fulfilled',
          details: validation.validationDetails?.reasons,
          suggestion: validation.suggestedAlternative
        });
        return;
      }

      const promptAnalysis = await multiSymbolScanner.analyzePrompt(prompt);
      const opportunities = await multiSymbolScanner.scanAllSymbols(promptAnalysis);

      if (opportunities.length > 0) {
        const bestOpportunity = opportunities[0];

        const transformedStrategy = {
          id: `opportunity-${Date.now()}`,
          name: `${bestOpportunity.signal.symbol} ${bestOpportunity.signal.direction} Trade`,
          risk: promptAnalysis.riskTolerance,
          symbol: bestOpportunity.signal.symbol,
          action: bestOpportunity.signal.direction.toLowerCase(),
          entry: bestOpportunity.signal.entryPrice.toFixed(5),
          stopLoss: bestOpportunity.signal.stopLoss.toFixed(5),
          takeProfit: bestOpportunity.signal.takeProfit.toFixed(5),
          lotSize: 0.1,
          estimatedGain: '$TBD',
          riskRewardRatio: bestOpportunity.signal.riskReward,
          feasible: true,
          reasoning: Array.isArray(bestOpportunity.signal.reasoning) ? bestOpportunity.signal.reasoning.join(', ') : bestOpportunity.signal.reasoning,
          confidence: bestOpportunity.signal.confidence.toString()
        };

        setStrategyOptions([transformedStrategy]);
        setShouldScrollToStrategy(true);
        setActiveTradeLines({
          entry: bestOpportunity.signal.entryPrice,
          stopLoss: bestOpportunity.signal.stopLoss,
          takeProfit: bestOpportunity.signal.takeProfit
        });
        setSelectedSymbol(bestOpportunity.signal.symbol);

        const notification: Notification = {
          id: Date.now().toString(),
          type: 'success',
          title: 'Trade Opportunity Found',
          message: `${bestOpportunity.signal.symbol} ${bestOpportunity.signal.direction} - Confidence: ${bestOpportunity.signal.confidence}%`,
          timestamp: 'Just now',
          read: false
        };
        setNotifications(prev => [notification, ...prev]);

        return;
      }

      const notification: Notification = {
        id: Date.now().toString(),
        type: 'info',
        title: 'Extended Search Started',
        message: 'No immediate trades found. Searching for up to 1 hour...',
        timestamp: 'Just now',
        read: false
      };
      setNotifications(prev => [notification, ...prev]);

      const sessionId = await extendedSearchService.startExtendedSearch(
        user.id,
        prompt,
        accountBalance
      );

      setActiveSearchSessionId(sessionId);
      setIsSearching(true);
    } catch (err) {
      console.error('Failed to process prompt:', err);

      const notification: Notification = {
        id: Date.now().toString(),
        type: 'error',
        title: 'Search Failed',
        message: 'Unable to process request. Please try again.',
        timestamp: 'Just now',
        read: false
      };
      setNotifications(prev => [notification, ...prev]);
    }
  };

  const handleStrategySelect = (option: StrategyOption) => {
    setSelectedStrategy(option);
    setConfirmModalOpen(true);
  };

  const handleConfirmTrade = async () => {
    if (!selectedStrategy || !user?.id) return;

    setIsExecuting(true);
    setConfirmModalOpen(false);

    try {
      const result = await simulatedTradingService.executeTrade(
        {
          symbol: selectedStrategy.symbol,
          action: selectedStrategy.action as 'buy' | 'sell',
          lotSize: selectedStrategy.lotSize,
          entry: parseFloat(selectedStrategy.entry),
          stopLoss: parseFloat(selectedStrategy.stopLoss),
          takeProfit: parseFloat(selectedStrategy.takeProfit),
          strategy: selectedStrategy
        },
        user.id
      );

      const notification: Notification = {
        id: Date.now().toString(),
        type: result.success ? 'success' : 'error',
        title: result.success ? 'Demo Trade Executed' : 'Trade Failed',
        message: result.message,
        timestamp: 'Just now',
        read: false
      };

      setNotifications(prev => [notification, ...prev]);

      if (result.success) {
        refreshBalance();
        refreshPositions();
      }
    } catch (error) {
      console.error('Trade execution failed:', error);

      const notification: Notification = {
        id: Date.now().toString(),
        type: 'error',
        title: 'Trade Execution Error',
        message: 'Failed to execute trade. Please try again.',
        timestamp: 'Just now',
        read: false
      };

      setNotifications(prev => [notification, ...prev]);
    } finally {
      setIsExecuting(false);
      setSelectedStrategy(null);
    }
  };

  const handleSymbolChange = (symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveTradeLines({});
  };

  const handleMarkAsRead = (id: string) => {
    setNotifications(notifications.map(n => 
      n.id === id ? { ...n, read: true } : n
    ));
  };

  const handleDismissNotification = (id: string) => {
    setNotifications(notifications.filter(n => n.id !== id));
  };

  const handleJournalReaction = async (entryId: string, reaction: 'thumbs-up' | 'explain-more') => {
    console.log('Journal reaction:', entryId, reaction);
  };

  const handleSearchComplete = async (opportunity: any) => {
    if (!opportunity) return;

    const transformedStrategy = {
      id: `extended-search-${Date.now()}`,
      name: `${opportunity.symbol} ${opportunity.signal.direction} Trade`,
      risk: 'medium',
      symbol: opportunity.symbol,
      action: opportunity.signal.direction.toLowerCase(),
      entry: opportunity.signal.entryPrice.toFixed(5),
      stopLoss: opportunity.signal.stopLoss.toFixed(5),
      takeProfit: opportunity.signal.takeProfit.toFixed(5),
      lotSize: 0.1,
      estimatedGain: '$TBD',
      riskRewardRatio: opportunity.signal.riskReward,
      feasible: true,
      reasoning: Array.isArray(opportunity.signal.reasoning) ? opportunity.signal.reasoning.join(', ') : opportunity.signal.reasoning,
      confidence: opportunity.signal.confidence.toString()
    };

    setStrategyOptions([transformedStrategy]);
    setShouldScrollToStrategy(true);
    setActiveTradeLines({
      entry: opportunity.signal.entryPrice,
      stopLoss: opportunity.signal.stopLoss,
      takeProfit: opportunity.signal.takeProfit
    });
    setSelectedSymbol(opportunity.symbol);
    setIsSearching(false);

    const notification: Notification = {
      id: Date.now().toString(),
      type: 'success',
      title: 'Trade Opportunity Found!',
      message: `${opportunity.symbol} ${opportunity.signal.direction} - Confidence: ${opportunity.signal.confidence}%`,
      timestamp: 'Just now',
      read: false
    };
    setNotifications(prev => [notification, ...prev]);
  };

  const handleSearchTimeout = () => {
    setIsSearching(false);

    const notification: Notification = {
      id: Date.now().toString(),
      type: 'warning',
      title: 'Search Complete',
      message: 'No valid trades found in 1 hour. Try again later or adjust your criteria.',
      timestamp: 'Just now',
      read: false
    };
    setNotifications(prev => [notification, ...prev]);
  };

  const handleSearchCancel = () => {
    setActiveSearchSessionId(null);
    setIsSearching(false);

    const notification: Notification = {
      id: Date.now().toString(),
      type: 'info',
      title: 'Search Cancelled',
      message: 'Extended search was cancelled by user.',
      timestamp: 'Just now',
      read: false
    };
    setNotifications(prev => [notification, ...prev]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <Header />
      
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Main Trading Interface */}
        <div className="space-y-6 sm:space-y-8 lg:space-y-12">
          {/* Notifications Section */}
          <NotificationCenter
            notifications={notifications}
            onMarkAsRead={handleMarkAsRead}
            onDismiss={handleDismissNotification}
            isCollapsible={true}
          />
          {/* Configuration Status */}
          <ConfigurationStatus />

          {/* Market Chart Section */}
          <div className="glass-card p-4 sm:p-6 lg:p-8">
            <MarketChart
              symbol={selectedSymbol}
              onSymbolChange={handleSymbolChange}
              tradeLines={activeTradeLines}
            />
          </div>
          
          {/* AI Trading Console - New ChatGPT Integration */}
          <AITradingConsole />

          {/* Extended Search Status Panel */}
          {activeSearchSessionId && isSearching && (
            <SearchStatusPanel
              sessionId={activeSearchSessionId}
              onSearchComplete={handleSearchComplete}
              onSearchTimeout={handleSearchTimeout}
              onCancel={handleSearchCancel}
            />
          )}

          {/* AI Analysis Loading State */}
          {isAnalyzing && (
            <div className="glass-card p-6 sm:p-8 lg:p-12 text-center">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-full blur-xl"></div>
                <div className="relative animate-spin h-8 w-8 sm:h-12 sm:w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-4 sm:mb-6"></div>
              </div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-semibold text-white mb-2 sm:mb-3">AI Analyzing Market Conditions</h3>
              <p className="text-white/70 text-base sm:text-lg">Generating optimal trading strategies...</p>
              <p className="text-white/50 text-sm mt-2 sm:mt-3">This may take 10-30 seconds</p>
            </div>
          )}

          {/* Strategy Options */}
          <div ref={strategyOptionsRef}>
            <StrategyOptions
              options={strategyOptions}
              onSelect={handleStrategySelect}
              isExecuting={isExecuting}
            />
          </div>
        </div>
        
        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 sm:gap-8 mt-8 sm:mt-12 lg:mt-16">
          <div className="xl:col-span-2 space-y-6 sm:space-y-8">
            <ActivePositions />

            <TradingDashboard
              todayPnL={totalPnL}
              weeklyPnL={totalPnL}
              totalBalance={accountBalance}
            />

            <TradingKPIs />
          </div>

          <div className="space-y-6 sm:space-y-8">
            <TradeJournal onReaction={handleJournalReaction} />
            <TradingLaws />
          </div>
        </div>

        {selectedStrategy && (
          <TradeConfirmationModal
            isOpen={confirmModalOpen}
            onClose={() => {
              setConfirmModalOpen(false);
              setSelectedStrategy(null);
            }}
            onConfirm={handleConfirmTrade}
            strategy={selectedStrategy}
            accountBalance={accountBalance}
          />
        )}
      </main>
    </div>
  );
};

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
            <Dashboard />
          ) : (
            <PublicLandingPage />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
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
          console.warn('Database validation taking too long, allowing app to load anyway');
          setDbValidated(true);
        }, 3000);

        const validationResult = await connectionValidator.validateConnection();
        clearTimeout(validationTimeout);

        if (!validationResult.isValid) {
          console.warn('Database validation issues (non-blocking):', validationResult.warnings);
          if (validationResult.errors.length > 0) {
            console.error('Database errors (app will continue):', validationResult.errors);
          }
        }

        console.log('Running background database diagnostics...');
        const diagnostics = await runDatabaseDiagnostics();
        logDiagnostics(diagnostics);

        await verifyDatabaseSetup();

        if (diagnostics.errors.length > 0) {
          console.warn('⚠️ Database configuration issues detected (non-blocking). Some features may not work correctly.');
          console.info('📖 See PRODUCTION_DATABASE_SETUP.md for detailed migration instructions');
        }

        setTimeout(() => {
          console.log('Starting database health monitoring in background...');
          dbHealthMonitor.startMonitoring();
        }, 5000);

        setDbValidated(true);
      } catch (error) {
        console.error('Startup diagnostics error (non-blocking):', error);
        setDbValidated(true);
      }
    };

    runStartupDiagnostics();

    return () => {
      dbHealthMonitor.stopMonitoring();
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
    </DatabaseErrorBoundary>
  );
}