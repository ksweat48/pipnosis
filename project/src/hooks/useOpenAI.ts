import { useState, useCallback } from 'react';
import { openAIService, MarketAnalysis, JournalEntry } from '../services/openai';

export const useOpenAI = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzePrompt = useCallback(async (
    prompt: string,
    accountBalance: number,
    marketData?: any[]
  ): Promise<MarketAnalysis | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const analysis = await openAIService.interpretPrompt(prompt, accountBalance, marketData);
      return analysis;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze prompt';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const generateJournalEntry = useCallback(async (
    eventType: 'trade_entry' | 'trade_exit' | 'modification' | 'market_update',
    tradeData: any
  ): Promise<JournalEntry | null> => {
    try {
      return await openAIService.generateJournalEntry(eventType, tradeData);
    } catch (err) {
      console.error('Failed to generate journal entry:', err);
      return null;
    }
  }, []);

  const assessFeasibility = useCallback(async (
    goal: string,
    balance: number,
    risk: string
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      const assessment = await openAIService.assessFeasibility(goal, balance, risk);
      return assessment;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to assess feasibility';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const explainDecision = useCallback(async (
    decision: string,
    context: any
  ): Promise<string | null> => {
    try {
      return await openAIService.explainDecision(decision, context);
    } catch (err) {
      console.error('Failed to explain decision:', err);
      return null;
    }
  }, []);

  return {
    isLoading,
    error,
    analyzePrompt,
    generateJournalEntry,
    assessFeasibility,
    explainDecision
  };
};