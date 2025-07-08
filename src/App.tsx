import React, { useState, useRef, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from './components/Header';
import { PromptInput } from './components/PromptInput';
import { StrategyOptions } from './components/StrategyOptions';
import { TradingDashboard } from './components/TradingDashboard';
import { MarketAnalysis } from './components/MarketAnalysis';
import { NotificationCenter } from './components/NotificationCenter';
import { TradeJournal } from './components/TradeJournal';
import { TradingKPIs } from './components/TradingKPIs';
import { TradingLaws } from './components/TradingLaws';
import { MT5Dashboard } from './components/MT5Dashboard';
import { WebContainerNotice } from './components/WebContainerNotice';
import { MT5ConnectionModal } from './components/MT5ConnectionModal';
import { useBackendPromptAnalysis, useBackendTradeExecution } from './hooks/useBackendAPI';
import { useOpenAI } from './hooks/useOpenAI'; 
import { usePipnosisAI } from './hooks/usePipnosisAI';
import { useMarketData } from './hooks/useMarketData';


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
  
  const accountBalance = 10000;
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
); // 👈 This was missing: Close the App's return block

function AppContent() {
  if (isEmailConfirmation) {
    console.log('📧 Email confirmation detected in URL');
    // Clear the URL parameters
  }
}

export default App;