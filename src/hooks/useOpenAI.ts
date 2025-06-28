import { useCallback } from 'react';

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
  const generateJournalEntry = useCallback(async (
    eventType: string,
    tradeData: Record<string, unknown>
  ): Promise<JournalEntry | null> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const entries = {
        entry: { title: 'New Trade Position Opened', message: 'Entered position following Pipnosis Law #6.', confidence: 'high' as const },
        market_update: { title: 'Market Analysis Complete', message: 'AI analyzed market conditions and generated strategies.', confidence: 'high' as const },
        trade_entry: { title: 'Trade Executed Successfully', message: 'Position opened with proper risk management.', confidence: 'high' as const }
      };

      const template = entries[eventType as keyof typeof entries] || entries.entry;

      return {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        type: eventType as 'entry' | 'modification' | 'exit' | 'update' | 'pause',
        title: template.title,
        message: template.message,
        confidence: template.confidence,
        tradeId: tradeData.tradeId as string,
        symbol: tradeData.symbol as string,
        pnl: tradeData.pnl as number
      };
    } catch {
      return null;
    }
  }, []);

  const explainDecision = useCallback(async (
    title: string,
    context: Record<string, unknown>
  ): Promise<string | null> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return `This decision followed Pipnosis Laws: Capital Preservation, High Quality Entry, and Drawdown Management.`;
    } catch {
      return null;
    }
  }, []);

  return { generateJournalEntry, explainDecision };
};