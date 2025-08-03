import React, { useState, useRef, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { AuthModal } from './components/Auth/AuthModal';
import { UserProfile } from './components/UserProfile';
import { Header } from './components/Header';
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
import { usePromptAnalysis, useTradeExecution, useMarketData } from './hooks/useAPI';

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

interface JournalEntry {
  id: string;
  timestamp: string;
  type: 'trade_entry' | 'trade_exit' | 'market_update' | 'ai_decision' | 'modification';
  title: string;
  message: string;
  tradeId?: string;
  symbol?: string;
  confidence: 'high' | 'medium' | 'low';
  userReaction: 'thumbs-up' | 'explain-more' | null;
}

const Dashboard: React.FC = () => {
  const { user, profile, loading } = useAuth();
  const [strategyOptions, setStrategyOptions] = useState<StrategyOption[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [activeTradeLines, setActiveTradeLines] = useState<{
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  }>({});
  
  const strategyOptionsRef = useRef<HTMLDivElement>(null);

  const { analyzePrompt, isAnalyzing, error: aiError } = usePromptAnalysis();
  const { executeTrade, isExecuting } = useTradeExecution();
  
  const accountBalance = profile?.account_balance || 10000;
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

  const handleStrategySelect = async (option: StrategyOption) => {
    try {
      console.log('🚀 Executing strategy:', option);
      
      const result = await executeTrade(option);

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
    setJournalEntries(prev => prev.map(entry => 
      entry.id === entryId ? { ...entry, userReaction: reaction } : entry
    ));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <Header 
        onOpenAuth={() => setShowAuthModal(true)}
        onOpenProfile={() => setShowUserProfile(true)}
        user={user}
        profile={profile}
      />
      
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="space-y-6">
            <div className="inline-flex items-center space-x-3 px-6 py-3 glass-card">
              <div className="w-8 h-8 rounded-lg overflow-hidden">
                <img 
                  src="/Pipnosis icon.png" 
                  alt="Pipnosis Logo" 
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-emerald-400 font-medium">AI Trading Assistant</span>
            </div>
            
            <div className="space-y-4">
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold bg-gradient-to-r from-emerald-400 via-green-500 to-lime-400 bg-clip-text text-transparent leading-tight">
                Pipnosis AI Trading
              </h1>
              <p className="text-xl sm:text-2xl text-white/80 max-w-2xl mx-auto leading-relaxed font-light">
                Tell me your goal. I'll handle the trading.
              </p>
            </div>
          </div>
        </div>
        
        {/* Main Trading Interface */}
        <div className="space-y-12">
          {/* Market Chart Section */}
          <div className="glass-card p-8">
            <MarketChart
              symbol={selectedSymbol}
              onSymbolChange={handleSymbolChange}
              tradeLines={activeTradeLines}
            />
          </div>
          
          {/* Prompt Input Section */}
          <div className="glass-card p-8">
            <PromptInput 
              onSubmit={handlePromptSubmit} 
              isLoading={isAnalyzing}
              error={aiError}
            />
          </div>
          
          {/* AI Analysis Loading State */}
          {isAnalyzing && (
            <div className="glass-card p-12 text-center">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-full blur-xl"></div>
                <div className="relative animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-6"></div>
              </div>
              <h3 className="text-2xl font-semibold text-white mb-3">AI Analyzing Market Conditions</h3>
              <p className="text-white/70 text-lg">Generating optimal trading strategies...</p>
              <p className="text-white/50 text-sm mt-3">This may take 10-30 seconds</p>
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
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 mt-16">
          <div className="xl:col-span-2 space-y-8">
            <WebContainerNotice />
            
            <NotificationCenter
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onDismiss={handleDismissNotification}
              isCollapsible={true}
            />
            
            <TradingDashboard
              todayPnL={0}
              weeklyPnL={0}
              totalBalance={accountBalance}
            />
            
            <TradingKPIs />
          </div>
          
          <div className="space-y-8">
            <TradeJournal onReaction={handleJournalReaction} />
            <TradingLaws />
          </div>
        </div>
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />

      <UserProfile
        isOpen={showUserProfile}
        onClose={() => setShowUserProfile(false)}
      />
    </div>
  );
};

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-24 h-24 rounded-2xl overflow-hidden mx-auto mb-8 ring-4 ring-emerald-500/20">
            <img 
              src="/Pipnosis icon.png" 
              alt="Pipnosis Logo" 
              className="w-full h-full object-cover"
            />
          </div>
          <div className="relative mb-8">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-full blur-xl"></div>
            <div className="relative animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto"></div>
          </div>
          <h2 className="text-3xl font-bold text-white mb-3">Loading Pipnosis</h2>
          <p className="text-white/60 text-lg">Initializing AI Trading Assistant...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/waitlist" element={<LandingPage />} />
      </Routes>
    </div>
  );
}