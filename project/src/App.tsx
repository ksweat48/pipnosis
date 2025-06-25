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
import { LandingPage } from './components/LandingPage';
import { usePromptAnalysis, useMarketData, useTradeExecution } from './hooks/useAPI';
import { useOpenAI } from './hooks/useOpenAI';

// Mock data for demonstration
const mockTrades = [
  {
    id: '1',
    symbol: 'EURUSD',
    type: 'buy' as const,
    lotSize: 0.5,
    entry: 1.1410,
    current: 1.1425,
    stopLoss: 1.1360,
    takeProfit: 1.1510,
    pnl: 75.00,
    status: 'open' as const,
    openTime: '2 hours ago'
  },
  {
    id: '2',
    symbol: 'GBPUSD',
    type: 'sell' as const,
    lotSize: 0.3,
    entry: 1.2750,
    current: 1.2735,
    stopLoss: 1.2800,
    takeProfit: 1.2650,
    pnl: 45.00,
    status: 'open' as const,
    openTime: '4 hours ago'
  }
];

const mockNotifications = [
  {
    id: '1',
    type: 'success' as const,
    title: 'Trade Executed',
    message: 'EURUSD buy order executed at 1.1410',
    timestamp: '2 hours ago',
    read: false
  },
  {
    id: '2',
    type: 'info' as const,
    title: 'Weekly Target Progress',
    message: 'You are 24% towards your $500 weekly target',
    timestamp: '1 day ago',
    read: false
  },
  {
    id: '3',
    type: 'warning' as const,
    title: 'Risk Alert',
    message: 'Position size approaching 15% of account equity',
    timestamp: '2 days ago',
    read: true
  }
];

const mockJournalEntries = [
  {
    id: '1',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    type: 'entry' as const,
    title: 'EURUSD Long Position Opened',
    message: 'Entered EURUSD long at 1.1425 — trend and volume confirm upside breakout. Risk is controlled with tight stop loss at 1.1360.',
    tradeId: 'TRD-001',
    symbol: 'EURUSD',
    confidence: 'high' as const,
    userReaction: null
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    type: 'entry' as const,
    title: 'GBPUSD Short Position Opened',
    message: 'Entered GBPUSD short at 1.2750 — bearish momentum building with strong resistance rejection. Targeting 1.2650 support level.',
    tradeId: 'TRD-002',
    symbol: 'GBPUSD',
    confidence: 'medium' as const,
    userReaction: 'thumbs-up'
  }
];

// Dashboard Component
const Dashboard: React.FC = () => {
  const [strategyOptions, setStrategyOptions] = useState<any[]>([]);
  const [analysisMode, setAnalysisMode] = useState<'api' | 'screenshot'>('api');
  const [notifications, setNotifications] = useState(mockNotifications);
  const [journalEntries, setJournalEntries] = useState(mockJournalEntries);
  
  // Ref for strategy options section
  const strategyOptionsRef = useRef<HTMLDivElement>(null);
  
  // API Hooks
  const { analyzePrompt, isAnalyzing, error: analysisError } = usePromptAnalysis();
  const { marketData, isLoading: marketLoading, error: marketError } = useMarketData();
  const { executeTrade, isExecuting } = useTradeExecution();
  
  // OpenAI hooks for journal entries
  const { generateJournalEntry, explainDecision } = useOpenAI();

  const accountBalance = 12547.83;

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
      // Use backend API for analysis
      const analysis = await analyzePrompt(prompt, accountBalance, marketData);
      
      if (analysis && analysis.strategies.length > 0) {
        // Transform API strategies to match our component format
        const transformedStrategies = analysis.strategies.map((strategy, index) => ({
          id: strategy.id || `api-${index}`,
          name: strategy.name,
          risk: strategy.risk,
          tradeType: strategy.tradeType,
          entry: Number(strategy.entry).toFixed(5),
          stopLoss: Number(strategy.stopLoss).toFixed(5),
          takeProfit: Number(strategy.takeProfit).toFixed(5),
          lotSize: strategy.lotSize,
          estimatedGain: strategy.estimatedGain,
          feasible: strategy.feasible,
          reasoning: strategy.reasoning
        }));
        
        setStrategyOptions(transformedStrategies);

        // Generate AI journal entry for the analysis
        const journalEntry = await generateJournalEntry('market_update', {
          prompt,
          strategies: transformedStrategies.length,
          confidence: analysis.confidence
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
      }
    } catch (err) {
      console.error('Failed to process prompt:', err);
    }
  };

  const handleStrategySelect = async (option: any) => {
    console.log('Executing strategy:', option);
    
    try {
      // Execute trade via backend API
      const result = await executeTrade({
        id: option.id,
        name: option.name,
        risk: option.risk,
        tradeType: option.tradeType,
        entry: parseFloat(option.entry),
        stopLoss: parseFloat(option.stopLoss),
        takeProfit: parseFloat(option.takeProfit),
        lotSize: option.lotSize,
        estimatedGain: option.estimatedGain,
        feasible: option.feasible,
        reasoning: option.reasoning
      });

      // Generate AI journal entry for strategy execution
      const journalEntry = await generateJournalEntry('trade_entry', {
        symbol: option.tradeType.split(' ')[0],
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
            symbol: option.tradeType.split(' ')[0],
            userReaction: null
          },
          ...prev
        ]);
      }

      // Add notification for trade execution
      const notification = {
        id: Date.now().toString(),
        type: result.success ? 'success' as const : 'error' as const,
        title: result.success ? 'Trade Executed' : 'Trade Failed',
        message: result.message,
        timestamp: 'Just now',
        read: false
      };

      setNotifications(prev => [notification, ...prev]);

    } catch (error) {
      console.error('Trade execution failed:', error);
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
            {/* Notifications moved to top */}
            <NotificationCenter
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onDismiss={handleDismissNotification}
              isCollapsible={true}
            />
            
            <MarketAnalysis
              marketData={marketData}
              analysisMode={analysisMode}
              onModeChange={setAnalysisMode}
              onScreenshotUpload={handleScreenshotUpload}
              isLoading={marketLoading}
              error={marketError}
            />
            
            <PromptInput 
              onSubmit={handlePromptSubmit} 
              isLoading={isAnalyzing}
              error={analysisError}
            />
            
            {isAnalyzing && (
              <div className="bg-slate-800 rounded-xl p-6 sm:p-8 text-center border border-slate-700">
                <div className="animate-spin h-6 w-6 sm:h-8 sm:w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-slate-400 text-sm sm:text-base">Backend AI is analyzing market conditions and generating strategies...</p>
                <p className="text-xs text-slate-500 mt-2">This may take 10-30 seconds</p>
              </div>
            )}
            
            {/* Strategy Options with ref for auto-scroll */}
            <div ref={strategyOptionsRef}>
              <StrategyOptions 
                options={strategyOptions} 
                onSelect={handleStrategySelect}
                isExecuting={isExecuting}
              />
            </div>
            
            <TradingDashboard
              trades={mockTrades}
              todayPnL={120.00}
              weeklyPnL={385.50}
              totalBalance={accountBalance}
            />

            {/* AI Performance section moved here - right after Trading Dashboard */}
            <TradingKPIs />
          </div>
          
          <div className="space-y-4 sm:space-y-6">
            <TradeJournal
              entries={journalEntries}
              onReaction={handleJournalReaction}
            />
            
            {/* Trading Laws section added under Trade Journal */}
            <TradingLaws />
          </div>
        </div>
      </main>
    </div>
  );
};

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/waitlist" element={<LandingPage />} />
    </Routes>
  );
}

export default App;