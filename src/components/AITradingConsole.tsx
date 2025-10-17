import React, { useState } from 'react';
import { Brain, CheckCircle, Sparkles } from 'lucide-react';
import { PromptInput } from './PromptInput';
import { AITradeOptionsModal } from './AITradeOptionsModal';
import { AIThoughtProcessPanel } from './AIThoughtProcessPanel';
import { useAITrading } from '@/hooks/useAITrading';
import { useAuth } from '@/hooks/useAuth';

export const AITradingConsole: React.FC = () => {
  const { user } = useAuth();
  const {
    isAnalyzing,
    isExecuting,
    analysisResult,
    error,
    currentDecisionId,
    requestTradeAnalysis,
    executeSelectedTrade,
    clearAnalysisResult
  } = useAITrading();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handlePromptSubmit = async (prompt: string) => {
    setSuccessMessage(null);
    await requestTradeAnalysis(prompt);
  };

  const handleExecuteTrade = async (optionId: string) => {
    if (!analysisResult?.decision?.id) return;

    const result = await executeSelectedTrade(optionId, analysisResult.decision.id);

    if (result?.success) {
      setSuccessMessage(`Trade executed successfully! ${result.trade?.symbol} ${result.trade?.tradeType.toUpperCase()} position opened.`);
      clearAnalysisResult();

      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    }
  };

  const handleCloseModal = () => {
    clearAnalysisResult();
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl">
            <Brain className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              AI Trading Console
              {isAnalyzing && (
                <div className="flex items-center gap-2 text-sm font-normal text-emerald-400">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Analyzing markets...
                </div>
              )}
            </h2>
            <p className="text-white/60 text-sm">
              Tell ChatGPT what you want to achieve and get trade options tailored to your account
            </p>
          </div>
        </div>

        {successMessage && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-2xl flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-green-400 text-sm font-bold">Trade Executed Successfully</p>
              <p className="text-green-300 text-xs mt-1">{successMessage}</p>
            </div>
          </div>
        )}

        <PromptInput
          onSubmit={handlePromptSubmit}
          isLoading={isAnalyzing}
          error={error}
        />
      </div>

      <AIThoughtProcessPanel
        decisionId={currentDecisionId || undefined}
        isAnalyzing={isAnalyzing}
      />

      {analysisResult && analysisResult.success && (
        <AITradeOptionsModal
          isOpen={true}
          onClose={handleCloseModal}
          decision={analysisResult.decision}
          options={analysisResult.options}
          marketSummary={analysisResult.marketSummary}
          onExecute={handleExecuteTrade}
          isExecuting={isExecuting}
        />
      )}
    </div>
  );
};
