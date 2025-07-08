import React, { useState, useRef, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { PromptInput } from './components/PromptInput';
import { StrategyOptions } from './components/StrategyOptions';
import { TradingDashboard } from './components/TradingDashboard';
import { MarketAnalysis } from './components/MarketAnalysis';
import { NotificationCenter } from './components/NotificationCenter';
import { TradeJournal } from './components/TradeJournal';
import { TradingKPIs } from './components/TradingKPIs';
import { TradingLaws } from './components/TradingLaws';
import { RiskManagementEngine } from './components/RiskManagementEngine';
import { MT5Dashboard } from './components/MT5Dashboard';
import { UserProfile } from './components/UserProfile';
import { AuthModal } from './components/auth/AuthModal';
import { MT5ConnectionModal } from './components/MT5ConnectionModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useBackendPromptAnalysis, useBackendTradeExecution } from './hooks/useBackendAPI';
import { useOpenAI } from './hooks/useOpenAI'; 
import { usePipnosisAI } from './hooks/usePipnosisAI';
import { useTradeExecution } from './hooks/useTradeExecution';
import { useDatabaseStats } from './hooks/useDatabase';
import { useMarketData } from './hooks/useMarketData';

const WelcomeScreen = () => {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  
  return (
    <div className="min-h-screen bg-slate-900">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              <h2 className="text-2xl font-bold text-white mb-4">Welcome to Pipnosis AI</h2>
              <p className="text-slate-300 mb-6">Your intelligent forex trading companion powered by advanced AI.</p>
              
              <div className="space-y-4">
                <button
                  onClick={() => {
                    setAuthMode('login');
                    setShowAuthModal(true);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Login to Continue
                </button>
                
                <button
                  onClick={() => {
                    setAuthMode('signup');
                    setShowAuthModal(true);
                  }}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Create Account
                </button>
              </div>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              <h3 className="text-xl font-semibold text-white mb-4">Key Features</h3>
              <ul className="space-y-3 text-slate-300">
                <li className="flex items-center">
                  <span className="mr-2">🤖</span>
                  Advanced AI Trading Analysis
                </li>
                <li className="flex items-center">
                  <span className="mr-2">📊</span>
                  Real-time Market Data
                </li>
                <li className="flex items-center">
                  <span className="mr-2">📈</span>
                  MT5 Integration
                </li>
                <li className="flex items-center">
                  <span className="mr-2">🛡️</span>
                  Risk Management
                </li>
              </ul>
            </div>
          </div>

          {/* Live Market Preview */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
              <h4 className="text-white font-medium mb-2">Live Market Data</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">EURUSD</span>
                  <span className="text-green-400">1.1425 (+0.15%)</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">GBPUSD</span>
                  <span className="text-red-400">1.2735 (-0.08%)</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">USDJPY</span>
                  <span className="text-green-400">149.85 (+0.22%)</span>
                </div>
              </div>
            </div>
            
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600 mt-4">
              <h4 className="text-white font-medium mb-2">Risk Management Tiers</h4>
              <div className="space-y-2">
                <div className="p-2 bg-green-500/20 border border-green-500/30 rounded text-green-400 text-sm">
                  Low Risk: 2% per trade
                </div>
                <div className="p-2 bg-yellow-500/20 border border-yellow-500/30 rounded text-yellow-400 text-sm">
                  Medium Risk: 5% per trade
                </div>
                <div className="p-2 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-sm">
                  High Risk: 10% per trade
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialMode={authMode}
      />
    </div>
  );
};

// Dashboard Component
const Dashboard: React.FC = () => {
  const [strategyOptions, setStrategyOptions] = useState<StrategyOption[]>([]);
  const [analysisMode, setAnalysisMode] = useState<'api' | 'screenshot'>('api');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [showRiskDashboard, setShowRiskDashboard] = useState(false); // Default closed
  const [showMT5Dashboard, setShowMT5Dashboard] = useState(true); // Default open
  const [showMT5Modal, setShowMT5Modal] = useState(false);
  
  const strategyOptionsRef = useRef<HTMLDivElement>(null);
  
  // API Hooks
  const { generateJournalEntry, explainDecision } = useOpenAI();
  
  // Pipnosis AI Brain Hook
  const { processPrompt, executeStrategy, isProcessing, error: aiError } = usePipnosisAI();
  
  const { profile, user, databaseConnected } = useAuth();
  const { updateTradeCount } = useDatabaseStats();
  const accountBalance = profile?.account_balance || 10000;
  const { marketData, isLoading: marketLoading, error: marketError, lastUpdated, refetch } = useMarketData();
  
  // Combined execution state
  const isExecuting = isProcessing;
  const error = aiError;

  // Auto-scroll to strategy options when they're available
  useEffect(() => {
    if (strategyOptions.length > 0 && strategyOptionsRef.current) {
      // Small delay to ensure the content is rendered
      setTimeout(() => {
        strategyOptionsRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }, 100);
    }
  }, [strategyOptions]);

  const handlePromptSubmit = async (prompt: string) => {
    try {
      // Use Pipnosis AI Brain for analysis
      const analysis = await processPrompt(prompt);
      
      if (analysis && analysis.strategies.length > 0) {
        // Transform API strategies to match our component format
        const transformedStrategies = analysis.strategies.map((strategy, index) => ({
          id: strategy.id || `ai-${index}`,
          name: strategy.name,
          risk: strategy.risk,
          tradeType: `${strategy.symbol} ${strategy.action.toUpperCase()}`,
          entry: strategy.entry.toFixed(strategy.symbol.includes('JPY') ? 2 : 5),
          stopLoss: strategy.stopLoss.toFixed(strategy.symbol.includes('JPY') ? 2 : 5),
          takeProfit: strategy.takeProfit.toFixed(strategy.symbol.includes('JPY') ? 2 : 5),
          lotSize: strategy.lotSize,
          estimatedGain: strategy.estimatedGain,
          feasible: strategy.feasible,
          reasoning: strategy.reasoning,
          symbol: strategy.symbol,
          action: strategy.action,
          confidence: strategy.confidence,
          pipnosisLawsCompliance: strategy.pipnosisLawsCompliance
        }));
        
        setStrategyOptions(transformedStrategies);

        // Generate AI journal entry for the analysis
        const journalEntry = await generateJournalEntry('market_update', {
          prompt,
          strategies: transformedStrategies.length,
          confidence: analysis.confidence,
          marketAnalysis: analysis.marketAnalysis
        });

        if (journalEntry) {
          setJournalEntries(prev => [
            {
              ...journalEntry,
              id: Date.now().toString(),
              userReaction: null
            },
            ...prev
          ]);
        }
        
        // Add notification for analysis
        const notification: Notification = {
          id: Date.now().toString(),
          type: 'info',
          title: 'AI Analysis Complete',
          message: `Generated ${transformedStrategies.length} trading strategies with ${analysis.confidence} confidence`,
          timestamp: 'Just now',
          read: false
        };
        
        setNotifications(prev => [notification, ...prev]);
      }
    } catch (err) {
      console.error('Failed to process prompt:', err);
      
      // Add error notification
      const notification: Notification = {
        id: Date.now().toString(),
        type: 'error',
        title: 'AI Analysis Failed',
        message: 'Unable to generate strategies. Please try again.',
        timestamp: 'Just now',
        read: false
      };
      
      setNotifications(prev => [notification, ...prev]);
    }
  };

  const handleStrategySelect = async (option: StrategyOption) => {
    try {
      console.log('🚀 Executing strategy:', option);
      
      // Extract symbol and action from tradeType if not provided directly
      const symbol = option.symbol || option.tradeType.split(' ')[0];
      const action = option.action || (option.tradeType.includes('BUY') ? 'buy' : 'sell');
      
      // Execute strategy via Pipnosis AI Brain
      const result = await executeStrategy(option);

      // Update trade count in localStorage
      updateTradeCount(result.success);

      // Generate AI journal entry for strategy execution
      const journalEntry = await generateJournalEntry('trade_entry', {
        symbol,
        action: 'entry',
        price: parseFloat(option.entry),
        strategy: option.name,
        reasoning: option.reasoning,
        tradeId: result.tradeId,
        success: result.success
      });

      if (journalEntry) {
        setJournalEntries(prev => [
          {
            ...journalEntry,
            id: Date.now().toString(),
            tradeId: result.tradeId || `TRD-${Date.now()}`,
            symbol,
            userReaction: null
          },
          ...prev
        ]);
      }

      // Add notification for trade execution
      const notification: Notification = {
        id: Date.now().toString(),
        type: result.success ? 'success' : 'error',
        title: result.success ? 'Trade Executed' : 'Trade Failed',
        message: result.message,
        timestamp: 'Just now',
        read: false
      };

      setNotifications(prev => [notification, ...prev]);

    } catch (error) {
      console.error('Trade execution failed:', error);
      
      // Add error notification
      const notification: Notification = {
        id: Date.now().toString(),
        type: 'error',
        title: 'Trade Execution Error',
        message: 'Failed to execute trade. Please try again.',
        timestamp: 'Just now',
        read: false
      };
      
      setNotifications(prev => [notification, ...prev]);
    }
  };

  const handleScreenshotUpload = (files: FileList) => {
    console.log('Uploaded files:', files);
    // Handle screenshot upload
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
    setJournalEntries(prev => prev.map(entry => 
      entry.id === entryId ? { ...entry, userReaction: reaction } : entry
    ));
    
    if (reaction === 'explain-more') {
      const entry = journalEntries.find(e => e.id === entryId);
      if (entry) {
        const explanation = await explainDecision(entry.title, {
          message: entry.message,
          symbol: entry.symbol,
          type: entry.type
        });

        if (explanation) {
          // Add detailed explanation as a new journal entry
          setJournalEntries(prev => [
            {
              id: `${entryId}-explanation`,
              timestamp: new Date().toISOString(),
              type: 'update' as const,
              title: 'Detailed Analysis',
              message: explanation,
              tradeId: entry.tradeId,
              symbol: entry.symbol,
              confidence: 'high' as const,
              userReaction: null
            },
            ...prev
          ]);
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <Header />
      
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-8">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-8">
          <div className="xl:col-span-2 space-y-4 sm:space-y-6">
            <WebContainerNotice />
            
            <NotificationCenter
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onDismiss={handleDismissNotification}
              isCollapsible={true}
            />
            
            <PromptInput 
              onSubmit={handlePromptSubmit} 
              isLoading={isProcessing}
              error={error}
            />
            
            {isProcessing && (
              <div className="bg-slate-800 rounded-xl p-6 sm:p-8 text-center border border-slate-700">
                <div className="animate-spin h-6 w-6 sm:h-8 sm:w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-slate-400 text-sm sm:text-base">Pipnosis AI is analyzing market conditions and generating strategies...</p>
                <p className="text-xs text-slate-500 mt-2">This may take 10-30 seconds</p>
              </div>
            )}

            {/* MT5 Dashboard - Now placed under AI prompt console and default to open */}
            <MT5Dashboard 
              isVisible={showMT5Dashboard}
              onToggleVisibility={() => setShowMT5Dashboard(!showMT5Dashboard)}
            />
            
            <MarketAnalysis
              marketData={marketData}
              analysisMode={analysisMode}
              isLoading={marketLoading}
              error={marketError}
              onModeChange={setAnalysisMode}
              onScreenshotUpload={handleScreenshotUpload}
              lastUpdated={lastUpdated}
              refetch={refetch}
            />
            
            {/* Risk Management Dashboard */}
            <RiskManagementEngine 
              isVisible={showRiskDashboard}
              onToggleVisibility={() => setShowRiskDashboard(!showRiskDashboard)}
            />
            
            <div ref={strategyOptionsRef}>
              <StrategyOptions 
                options={strategyOptions} 
                onSelect={handleStrategySelect}
                isExecuting={isExecuting}
              />
            </div>

            <TradingKPIs />
          </div>
          
          <div className="space-y-4 sm:space-y-6">
            <UserProfile />
            
            <TradeJournal
              entries={journalEntries}
              onReaction={handleJournalReaction}
            />
            
            <TradingLaws />
          </div>
        </div>
      </main>

      <MT5ConnectionModal
        isOpen={showMT5Modal}
        onClose={() => setShowMT5Modal(false)}
      />
    </div>
  );
};

// App Content with routing
function AppContent() {
  const { user, loading } = useAuth();

  // Check for email confirmation in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isEmailConfirmation = urlParams.get('confirmation') === 'true' || 
                               urlParams.get('type') === 'signup';
    
    if (isEmailConfirmation) {
      console.log('📧 Email confirmation detected in URL');
      // Clear the URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Enhanced loading screen with timeout protection
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading Pipnosis...</p>
          <p className="text-slate-400 text-sm mt-2">Initializing your trading dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route 
        path="/" 
        element={user ? <Dashboard /> : <WelcomeScreen />} 
      /> 
    </Routes>
  );
}

// Main App component
function App() {
  useEffect(() => {
    console.log('🚀 Pipnosis v2.0.0 - Production Ready with Database Integration');
  }, []);

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;