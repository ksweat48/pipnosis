import { supabase } from '../lib/supabase';
import { logger, LogCategory, LogLevel } from '@/lib/logger';

logger.setCategoryLevel(LogCategory.AI_TRADING, LogLevel.ERROR);

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIProxyRequest {
  messages: OpenAIMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  requestType?: string;
  endpoint?: string;
}

export interface OpenAIProxyResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

class OpenAIProxyClient {
  private endpoint = '/.netlify/functions/openai-chat';
  private callCount = 0;

  async chat(request: OpenAIProxyRequest): Promise<OpenAIProxyResponse> {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session) {
        throw new Error('No active session. User must be authenticated to use LLM.');
      }

      const startTime = Date.now();

      logger.debug(LogCategory.AI_TRADING, `Calling ${request.requestType || 'unknown'} via ${this.endpoint}`);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          messages: request.messages,
          model: request.model || 'gpt-4o',
          temperature: request.temperature ?? 0.7,
          max_tokens: request.max_tokens ?? 2000,
          requestType: request.requestType || 'unknown',
          endpoint: request.endpoint || 'pipnosis'
        })
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        logger.error(LogCategory.AI_TRADING, `Error ${response.status}:`, errorData);
        throw new Error(`OpenAI Proxy Error: ${errorData.error || response.statusText}`);
      }

      const data: OpenAIProxyResponse = await response.json();

      this.callCount++;

      logger.debug(LogCategory.AI_TRADING, `✅ Success: ${data.usage?.total_tokens || 0} tokens, ${duration}ms`);

      return data;
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, 'Request failed:', error);
      throw error;
    }
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetCallCount(): void {
    this.callCount = 0;
  }
}

export const openaiProxyClient = new OpenAIProxyClient();
