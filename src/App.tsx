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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <Header 
        onOpenAuth={() => setShowAuthModal(true)}
        onOpenProfile={() => setShowUserProfile(true)}
        user={user}
        profile={profile}
      />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="space-y-8 mb-12">
          <div className="text-center space-y-6">
            <div className="space-y-4">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-blue-400 via-purple-500 to-emerald-400 bg-clip-text text-transparent">
                Pipnosis AI Trading
              </h1>
              <p className="text-xl sm:text-2xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
                Tell me your trading goal and I'll handle the rest
              </p>
            </div>
            
            <div className="max-w-4xl mx-auto">
              <PromptInput 
                onSubmit={handlePromptSubmit} 
                isLoading={isAnalyzing}
                error={aiError}
              />
            </div>
          </div>
          
          <div className="max-w-6xl mx-auto">
            <MarketChart
              symbol={selectedSymbol}
              onSymbolChange={handleSymbolChange}
              tradeLines={activeTradeLines}
              className="shadow-2xl"
            />
          </div>
          
          {isAnalyzing && (
            <div className="max-w-4xl mx-auto bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-2xl p-8 text-center backdrop-blur-sm">
              <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <h3 className="text-xl font-semibold text-white mb-2">Pipnosis AI Analyzing...</h3>
              <p className="text-slate-300">Evaluating market conditions and generating optimal trading strategies</p>
              <p className="text-sm text-slate-400 mt-2">This may take 10-30 seconds</p>
            </div>
          )}
          
          <div ref={strategyOptionsRef} className="max-w-6xl mx-auto">
            <StrategyOptions 
              options={strategyOptions} 
              onSelect={handleStrategySelect}
              isExecuting={isExecuting}
            />
          </div>
        </div>
        
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 sm:gap-8">
          <div className="xl:col-span-2 space-y-4 sm:space-y-6">
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
          
          <div className="space-y-4 sm:space-y-6">
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 rounded-xl overflow-hidden mx-auto mb-6 ring-4 ring-blue-500/20">
            <img 
              src="/Pipnosis icon.png" 
              alt="Pipnosis Logo" 
              className="w-full h-full object-cover"
            />
          </div>
          <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold text-white mb-2">Loading Pipnosis</h2>
          <p className="text-slate-400">Initializing AI Trading Assistant...</p>
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