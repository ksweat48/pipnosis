import { useState, useCallback } from 'react';
import { openAIService } from '../services/openai';
import { saveAIJournalEntry } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface JournalEntry {
  id: string;
  timestamp: string;
  type: 'entry' | 'modification' | 'exit' | 'update' | 'pause';
  title: string;
  message: string;
  tradeId?: string;
  symbol?: string;
  pnl?: number;
  confidence?: 'high' | 'medium' | 'low';
}

export const useOpenAI = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const analyzePrompt = useCallback(async (
    prompt: string,
    accountBalance: number,
    marketData?: any[]
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      console.log('🤖 Analyzing prompt with OpenAI:', prompt);
      const analysis = await openAIService.interpretPrompt(prompt, accountBalance, marketData);
      return analysis;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze prompt';
      setError(errorMessage);
      console.error('❌ OpenAI analysis error:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const generateJournalEntry = useCallback(async (
    eventType: string,
    tradeData: any
  ): Promise<JournalEntry | null> => {
    try {
      console.log('🤖 Generating journal entry with OpenAI:', eventType, tradeData);
      const journalEntry = await openAIService.generateJournalEntry(eventType, tradeData);
      
      // Save to database if user is logged in
      if (user && journalEntry) {
        try {
          await saveAIJournalEntry({
            user_id: user.id,
            trade_id: tradeData.tradeId,
            entry_type: eventType,
            title: journalEntry.title,
            content: journalEntry.message,
            confidence_level: journalEntry.confidence
          });
          console.log('✅ Journal entry saved to database');
        } catch (error) {
          console.error('❌ Failed to save journal entry to database:', error);
        }
      }
      
      return journalEntry;
    } catch (err) {
      console.error('❌ Journal entry generation error:', err);
      return null;
    }
  }, [user]);

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
      throw err;
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
      console.error('❌ Decision explanation error:', err);
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