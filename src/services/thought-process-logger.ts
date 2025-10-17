import { supabase } from '@/lib/supabase';

export type ThoughtStepType =
  | 'initialization'
  | 'symbol_scan'
  | 'market_data_fetch'
  | 'technical_analysis'
  | 'fxflow_evaluation'
  | 'chatgpt_prompt'
  | 'chatgpt_response'
  | 'strategy_comparison'
  | 'risk_calculation'
  | 'option_generation'
  | 'final_decision'
  | 'error'
  | 'warning'
  | 'auto_scan_start'
  | 'auto_scan_complete'
  | 'auto_threshold_check'
  | 'auto_trade_skip'
  | 'auto_trade_execute'
  | 'auto_market_hours_check'
  | 'auto_limit_check'
  | 'auto_emergency_stop';

export interface ThoughtProcessEntry {
  userId: string;
  decisionId: string;
  stepNumber: number;
  stepType: ThoughtStepType;
  title: string;
  content: string;
  metadata?: any;
}

class ThoughtProcessLogger {
  private currentStep: number = 0;
  private isLoggingEnabled: boolean = true;
  private validStepTypes = new Set([
    'initialization',
    'symbol_scan',
    'market_data_fetch',
    'technical_analysis',
    'fxflow_evaluation',
    'chatgpt_prompt',
    'chatgpt_response',
    'strategy_comparison',
    'risk_calculation',
    'option_generation',
    'final_decision',
    'error',
    'warning',
    'auto_scan_start',
    'auto_scan_complete',
    'auto_threshold_check',
    'auto_trade_skip',
    'auto_trade_execute',
    'auto_market_hours_check',
    'auto_limit_check',
    'auto_emergency_stop'
  ]);

  async logThought(entry: ThoughtProcessEntry): Promise<string | null> {
    if (!this.isLoggingEnabled) {
      return null;
    }

    try {
      const normalizedStepType = this.normalizeStepType(entry.stepType);

      const { data, error } = await supabase
        .from('ai_thought_process')
        .insert({
          user_id: entry.userId,
          decision_id: entry.decisionId,
          step_number: entry.stepNumber,
          step_type: normalizedStepType,
          title: entry.title,
          content: entry.content,
          metadata: entry.metadata || {},
          status: 'processing'
        })
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('[ThoughtProcessLogger] Failed to log thought:', {
          stepType: entry.stepType,
          normalizedStepType,
          error: error.message,
          details: error
        });
        if (this.isLoggingEnabled) {
          this.isLoggingEnabled = false;
        }
        return null;
      }

      return data?.id || null;
    } catch (error) {
      console.error('[ThoughtProcessLogger] Exception while logging thought:', error);
      this.isLoggingEnabled = false;
      return null;
    }
  }

  private normalizeStepType(stepType: ThoughtStepType): string {
    if (this.validStepTypes.has(stepType)) {
      return stepType;
    }

    if (stepType.startsWith('auto_')) {
      return 'initialization';
    }

    return 'warning';
  }

  async completeThought(thoughtId: string, durationMs?: number): Promise<void> {
    if (!thoughtId || !this.isLoggingEnabled) {
      return;
    }

    try {
      await supabase
        .from('ai_thought_process')
        .update({
          status: 'completed',
          duration_ms: durationMs
        })
        .eq('id', thoughtId);
    } catch (error) {
    }
  }

  async errorThought(thoughtId: string, errorMessage: string): Promise<void> {
    if (!thoughtId || !this.isLoggingEnabled) {
      return;
    }

    try {
      const { data: current } = await supabase
        .from('ai_thought_process')
        .select('content')
        .eq('id', thoughtId)
        .maybeSingle();

      await supabase
        .from('ai_thought_process')
        .update({
          status: 'error',
          content: `${current?.content || ''}\n\nError: ${errorMessage}`
        })
        .eq('id', thoughtId);
    } catch (error) {
    }
  }

  resetStepCounter(): void {
    this.currentStep = 0;
  }

  getNextStepNumber(): number {
    return ++this.currentStep;
  }

  async logWithTiming<T>(
    entry: ThoughtProcessEntry,
    asyncFn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    const thoughtId = await this.logThought(entry);

    try {
      const result = await asyncFn();
      const duration = Date.now() - startTime;

      if (thoughtId) {
        await this.completeThought(thoughtId, duration);
      }

      return result;
    } catch (error) {
      if (thoughtId) {
        await this.errorThought(thoughtId, error instanceof Error ? error.message : 'Unknown error');
      }
      throw error;
    }
  }

  formatJSON(data: any, maxLength: number = 500): string {
    try {
      const json = JSON.stringify(data, null, 2);
      if (json.length > maxLength) {
        return json.substring(0, maxLength) + '\n... (truncated)';
      }
      return json;
    } catch {
      return String(data);
    }
  }

  formatMarketData(symbol: string, candles: any[], summary?: any): string {
    const lastCandle = candles[candles.length - 1];
    let content = `Symbol: ${symbol}\n`;
    content += `Candles fetched: ${candles.length}\n`;
    content += `Latest price: ${lastCandle?.close?.toFixed(5) || 'N/A'}\n`;

    if (summary) {
      content += `\nMarket Sentiment: ${summary.sentiment?.status || 'N/A'}\n`;
      content += `Confidence: ${summary.sentiment?.confidence || 0}%\n`;
      content += `RSI: ${summary.rsi?.value?.toFixed(1) || 'N/A'} (${summary.rsi?.status || 'N/A'})\n`;
      content += `Trade Signal: ${summary.tradeSignal?.status || 'N/A'}`;
    }

    return content;
  }

  formatStrategyComparison(fxflow: any, ai: any): string {
    let content = 'FxFlow Baseline Strategy:\n';
    content += `  Direction: ${fxflow.direction}\n`;
    content += `  Entry: ${fxflow.entryPrice}\n`;
    content += `  Confidence: ${fxflow.confidence}%\n`;
    content += `  Risk/Reward: ${fxflow.riskReward}\n\n`;

    content += 'AI Independent Analysis:\n';
    content += `  Direction: ${ai.direction}\n`;
    content += `  Entry: ${ai.entryPrice}\n`;
    content += `  Confidence: ${ai.confidence}%\n`;
    content += `  Risk/Reward: ${ai.riskReward}\n`;
    content += `  Strategy Type: ${ai.strategyType}\n\n`;

    if (fxflow.direction === ai.direction) {
      content += '✓ Both strategies agree on direction';
    } else {
      content += '⚠ Strategies disagree on direction';
    }

    return content;
  }
}

export const thoughtProcessLogger = new ThoughtProcessLogger();
