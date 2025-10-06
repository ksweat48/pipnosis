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
import { WebContainerNotice } from './components/WebContainerNotice';
import { LandingPage } from './components/LandingPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { AuthPage } from './pages/AuthPage';
import { ActivePositions } from './components/ActivePositions';
import { TradeConfirmationModal } from './components/TradeConfirmationModal';
import { usePromptAnalysis, useMarketData } from './hooks/useAPI';
import { simulatedTradingService } from './services/simulated-trading';

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

  const strategyOptionsRef = useRef<HTMLDivElement>(null);

  const { analyzePrompt, isAnalyzing, error: aiError } = usePromptAnalysis();
  const { balance: accountBalance, totalPnL, openPositionsCount, refreshBalance, refreshPositions } = useUserBalance(user?.id || null);
  const { marketData, isLoading: marketLoading, error: marketError, lastUpdated, refetch } = useMarketData();

  useEffect(() => {
    if (strategyOptions.length > 0 && strategyOptionsRef.current) {
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
      const analysis = await analyzePrompt(prompt, accountBalance, marketData);
      
      if (analysis && analysis.strategies.length > 0) {
        const transformedStrategies = analysis.strategies.map((strategy: any, index: number) => ({
          id: strategy.id || `ai-${index}`,
          name: strategy.name,
          risk: strategy.risk,
          symbol: strategy.symbol,
          action: strategy.action,
          entry: strategy.entry.toFixed(strategy.symbol.includes('JPY') ? 2 : 5),
          stopLoss: strategy.stopLoss.toFixed(strategy.symbol.includes('JPY') ? 2 : 5),
          takeProfit: strategy.takeProfit.toFixed(strategy.symbol.includes('JPY') ? 2 : 5),
          lotSize: strategy.lotSize,
          estimatedGain: strategy.estimatedGain,
          riskRewardRatio: strategy.riskRewardRatio,
          feasible: strategy.feasible,
          reasoning: strategy.reasoning,
          confidence: strategy.confidence
        }));
        
        setStrategyOptions(transformedStrategies);

        if (transformedStrategies.length > 0) {
          const firstStrategy = transformedStrategies[0];
          setActiveTradeLines({
            entry: parseFloat(firstStrategy.entry),
            stopLoss: parseFloat(firstStrategy.stopLoss),
            takeProfit: parseFloat(firstStrategy.takeProfit)
          });
          
          setSelectedSymbol(firstStrategy.symbol);
        }

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
    // Mock reaction handling - no backend to update
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <Header />
      
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Hero Section */}
        <div className="text-center mb-8 sm:mb-12 lg:mb-16">
          <div className="space-y-6">
            <div className="inline-flex items-center space-x-2 sm:space-x-3 px-4 sm:px-6 py-2 sm:py-3 glass-card">
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg overflow-hidden">
                <img 
                  src="/Pipnosis icon.png" 
                  alt="Pipnosis Logo" 
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-sm sm:text-base text-emerald-400 font-medium">AI Trading Assistant</span>
            </div>
            
            <div className="space-y-4">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold bg-gradient-to-r from-emerald-400 via-green-500 to-lime-400 bg-clip-text text-transparent leading-tight px-4">
                Pipnosis AI Trading
              </h1>
              <p className="text-lg sm:text-xl lg:text-2xl text-white/80 max-w-2xl mx-auto leading-relaxed font-light px-4">
                Tell me your goal. I'll handle the trading.
              </p>
            </div>
          </div>
        </div>
        
        {/* Main Trading Interface */}
        <div className="space-y-6 sm:space-y-8 lg:space-y-12">
          {/* Market Chart Section */}
          <div className="glass-card p-4 sm:p-6 lg:p-8">
            <MarketChart
              symbol={selectedSymbol}
              onSymbolChange={handleSymbolChange}
              tradeLines={activeTradeLines}
            />
          </div>
          
          {/* Prompt Input Section */}
          <div className="glass-card p-4 sm:p-6 lg:p-8">
            <PromptInput 
              onSubmit={handlePromptSubmit} 
              isLoading={isAnalyzing}
              error={aiError}
            />
          </div>
          
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
            <WebContainerNotice />

            <ActivePositions />

            <NotificationCenter
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onDismiss={handleDismissNotification}
              isCollapsible={true}
            />

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

export default function App() {
  return (
    <div>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/waitlist" element={<LandingPage />} />
        <Route path="/admin/dashboard" element={
          <ProtectedRoute>
            <AdminDashboard />
          </ProtectedRoute>
        } />
      </Routes>
    </div>
  );
}