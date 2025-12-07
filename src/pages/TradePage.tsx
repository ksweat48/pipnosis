import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';
import { NavigationMenu } from '@/components/NavigationMenu';
import { MarketChart } from '@/components/MarketChart';
import { NotificationCenter } from '@/components/NotificationCenter';
// SearchStatusPanel removed - using simple status
import { StrategyOptions } from '@/components/StrategyOptions';
import { TradeConfirmationModal } from '@/components/TradeConfirmationModal';
import { positionMonitorService } from '@/services/position-monitor';
import { usePromptAnalysis } from '@/hooks/useAPI';
import { simulatedTradingService } from '@/services/simulated-trading';
import { promptValidationService } from '@/services/prompt-validation';
import { extendedSearchService } from '@/services/extended-search';
import { multiSymbolScanner } from '@/strategies/core/multiSymbolScanner';
import { StrategyOption, Notification } from '@/types/strategy';
import { pageContext } from '@/services/page-context';

export function TradePage() {
  const { user } = useAuth();

  // Set page context on mount
  useEffect(() => {
    pageContext.setPage('trade');
    return () => pageContext.setPage('other');
  }, []);
  const [strategyOptions, setStrategyOptions] = useState<StrategyOption[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [activeTradeLines, setActiveTradeLines] = useState<{
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  }>({});
  const [currentPositionForSymbol, setCurrentPositionForSymbol] = useState<any>(null);
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

  const { isAnalyzing } = usePromptAnalysis();
  const { balance: accountBalance, refreshBalance, refreshPositions } = useUserBalance(user?.id || null);

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

  useEffect(() => {
    positionMonitorService.start();
    return () => positionMonitorService.stop();
  }, []);

  useEffect(() => {
    const fetchActivePositionForSymbol = async () => {
      if (!user) return;

      try {
        const positions = await simulatedTradingService.getOpenPositions(user.id);
        const positionForSymbol = positions.find(p => p.symbol === selectedSymbol);

        if (positionForSymbol) {
          setCurrentPositionForSymbol(positionForSymbol);
          setActiveTradeLines({
            entry: positionForSymbol.entry_price || undefined,
            stopLoss: positionForSymbol.stop_loss,
            takeProfit: positionForSymbol.take_profit
          });
        } else {
          setCurrentPositionForSymbol(null);
          if (!strategyOptions.length) {
            setActiveTradeLines({});
          }
        }
      } catch (error) {
        console.error('Failed to fetch active position:', error);
      }
    };

    fetchActivePositionForSymbol();
    const interval = setInterval(fetchActivePositionForSymbol, 3000);

    return () => clearInterval(interval);
  }, [selectedSymbol, user, strategyOptions.length]);

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

        const riskLevel = (promptAnalysis.riskTolerance === 'low' || promptAnalysis.riskTolerance === 'medium' || promptAnalysis.riskTolerance === 'high')
          ? promptAnalysis.riskTolerance
          : 'medium';

        const transformedStrategy: StrategyOption = {
          id: `opportunity-${Date.now()}`,
          name: `${bestOpportunity.signal.symbol} ${bestOpportunity.signal.direction} Trade`,
          risk: riskLevel as 'low' | 'medium' | 'high',
          symbol: bestOpportunity.signal.symbol,
          action: bestOpportunity.signal.direction.toLowerCase() as 'buy' | 'sell',
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
    if (!currentPositionForSymbol) {
      setActiveTradeLines({});
    }
  };

  const handleMarkAsRead = (id: string) => {
    setNotifications(notifications.map(n =>
      n.id === id ? { ...n, read: true } : n
    ));
  };

  const handleDismissNotification = (id: string) => {
    setNotifications(notifications.filter(n => n.id !== id));
  };

  const handleSearchComplete = async (opportunity: any) => {
    if (!opportunity) return;

    const transformedStrategy = {
      id: `extended-search-${Date.now()}`,
      name: `${opportunity.symbol} ${opportunity.signal.direction} Trade`,
      risk: 'medium',
      symbol: opportunity.symbol,
      action: opportunity.signal.direction.toLowerCase() as 'buy' | 'sell',
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
    <div className="fixed inset-0 w-full h-screen overflow-hidden bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex flex-col" style={{ height: '100dvh' }}>
      <NavigationMenu
        currentPrice={currentPrice}
        priceChange={priceChange}
        symbol={selectedSymbol}
      />

      <main className="flex-1 flex flex-col overflow-hidden relative z-0" style={{ touchAction: 'none' }}>
        {/* Notification Center - Overlay */}
        <div className="absolute top-4 right-4 z-50 max-w-md">
          <NotificationCenter
            notifications={notifications}
            onMarkAsRead={handleMarkAsRead}
            onDismiss={handleDismissNotification}
            isCollapsible={true}
          />
        </div>

        {/* Main Chart Area - Full Height */}
        <div className="flex-1 flex flex-col overflow-hidden px-4 sm:px-6">
          <MarketChart
            symbol={selectedSymbol}
            onSymbolChange={handleSymbolChange}
            tradeLines={activeTradeLines}
            onTradeExecuted={() => {
              refreshBalance();
              refreshPositions();
            }}
            onPriceUpdate={(price, change) => {
              setCurrentPrice(price);
              setPriceChange(change);
            }}
          />
        </div>

        {/* Strategy Options Panel - Slide-up Overlay */}
        {(strategyOptions.length > 0 || isAnalyzing || (activeSearchSessionId && isSearching)) && (
          <div className="absolute bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-lg border-t border-white/10 max-h-[40vh] overflow-y-auto z-40 mobile-panel-scroll">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
              {activeSearchSessionId && isSearching && (
                <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 text-blue-200 mb-4">
                  <div className="animate-pulse">Searching for trading opportunities...</div>
                </div>
              )}

              {isAnalyzing && (
                <div className="text-center py-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-full blur-xl"></div>
                    <div className="relative animate-spin h-10 w-10 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-4"></div>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">AI Analyzing Market Conditions</h3>
                  <p className="text-white/70 text-sm">Generating optimal trading strategies...</p>
                  <p className="text-white/50 text-xs mt-2">This may take 10-30 seconds</p>
                </div>
              )}

              <div ref={strategyOptionsRef}>
                <StrategyOptions
                  options={strategyOptions}
                  onSelect={handleStrategySelect}
                  isExecuting={isExecuting}
                />
              </div>
            </div>
          </div>
        )}

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
}
