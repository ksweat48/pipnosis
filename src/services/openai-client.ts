/**
 * Secure OpenAI Client Service (Context-Aware)
 *
 * SSOT for OpenAI API integration across browser and server contexts.
 *
 * Architecture (DUAL-MODE):
 *
 * BROWSER MODE:
 *   Frontend → openai-client.ts → Netlify Function → OpenAI API
 *                                  (has API key, user auth required)
 *
 * SERVER MODE (Scheduled Functions):
 *   Scheduled Function → openai-client.ts → OpenAI API (direct)
 *                                           (service API key, no user auth)
 *
 * Context Detection:
 * - Automatically detects runtime environment (typeof window === 'undefined')
 * - Browser: Requires user authentication, proxies through Netlify function
 * - Server: Uses service API key, calls OpenAI directly (autonomous trading)
 *
 * Security Benefits:
 * 1. API key stored securely on server (Netlify env vars)
 * 2. No key exposure in browser/network requests
 * 3. Rate limiting and abuse prevention possible
 * 4. Usage monitoring and cost control
 * 5. Enables autonomous trading without user session
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  requestType?: string;
  endpoint?: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class OpenAIClient {
  private readonly functionUrl: string;
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000;

  constructor() {
    this.functionUrl = '/.netlify/functions/openai-chat';
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetryableError(status: number): boolean {
    return status === 500 || status === 502 || status === 503 || status === 504;
  }

  /**
   * Detect if running in server context (Node.js) vs browser
   * Server: Scheduled functions, Netlify functions
   * Browser: Frontend React app
   */
  private isServerContext(): boolean {
    return typeof window === 'undefined' && typeof process !== 'undefined';
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      const { createClient } = await import('../lib/supabase');
      const { supabase } = await import('../lib/supabase');
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch (error) {
      console.error('[OpenAI Client] Failed to get auth token:', error);
      return null;
    }
  }

  /**
   * Server-side direct OpenAI API call
   * Used by scheduled functions (autonomous trading) that run without user context
   */
  private async chatServerSide(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('[OpenAI Client] OPENAI_API_KEY not configured for server-side execution');
    }

    console.log('[OpenAI Client] Server-side direct call to OpenAI API', {
      endpoint: options.endpoint || 'unknown',
      requestType: options.requestType || 'unknown',
      model: options.model || 'gpt-4o-mini'
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: options.model || 'gpt-4o-mini',
        messages: messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 2000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown'}`);
    }

    const data: ChatCompletionResponse = await response.json();

    console.log('[OpenAI Client] Server-side success:', {
      model: data.model,
      tokens: data.usage?.total_tokens || 0,
      cost: this.estimateCost(data.model, data.usage?.total_tokens || 0),
      finishReason: data.choices[0]?.finish_reason
    });

    return data;
  }

  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    try {
      // Check weekend shutdown
      const { weekendProtectionService } = await import('./weekend-protection-service');
      if (weekendProtectionService.isLLMDisabled()) {
        throw new Error('LLM APIs are disabled for weekend shutdown. Market reopens Sunday 5 PM EST.');
      }

      // CONTEXT-AWARE ROUTING: Detect server vs browser
      if (this.isServerContext()) {
        console.log('[OpenAI Client] 🖥️  Server context detected - using direct API call');
        return await this.chatServerSide(messages, options);
      }

      // BROWSER MODE: Require user authentication
      console.log('[OpenAI Client] 🌐 Browser context detected - using proxy with user auth');

      const authToken = await this.getAuthToken();
      if (!authToken) {
        throw new Error('Authentication required. Please log in to use AI features.');
      }

      console.log('[OpenAI Client] Calling secure proxy function', {
        endpoint: options.endpoint || 'unknown',
        requestType: options.requestType || 'unknown',
        model: options.model || 'gpt-4o-mini'
      });

      let lastError: Error | null = null;
      let response: Response | null = null;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          response = await fetch(this.functionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
              messages,
              model: options.model || 'gpt-4o-mini',
              temperature: options.temperature ?? 0.7,
              max_tokens: options.max_tokens ?? 2000,
              requestType: options.requestType,
              endpoint: options.endpoint
            })
          });

          if (response.ok) {
            break;
          }

          if (this.isRetryableError(response.status) && attempt < this.maxRetries) {
            const delay = this.baseDelayMs * Math.pow(2, attempt);
            console.warn(`[OpenAI Client] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
            await this.sleep(delay);
            continue;
          }

          if (response.status === 429) {
            const errorData = await response.json().catch(() => ({}));
            const resetIn = errorData.resetIn || 3600;
            const resetMinutes = Math.ceil(resetIn / 60);
            throw new Error(
              `Rate limit exceeded. ${errorData.message || 'Too many requests'}. Resets in ${resetMinutes} minute${resetMinutes !== 1 ? 's' : ''}.`
            );
          }

          if (response.status === 401) {
            throw new Error('Authentication expired. Please log in again to continue using AI features.');
          }

          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `OpenAI API error: ${response.status} - ${errorData.error || errorData.message || 'Unknown error'}`
          );
        } catch (fetchError) {
          lastError = fetchError as Error;
          if (attempt < this.maxRetries && !lastError.message.includes('Rate limit') && !lastError.message.includes('Authentication')) {
            const delay = this.baseDelayMs * Math.pow(2, attempt);
            console.warn(`[OpenAI Client] Fetch error, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries}):`, lastError.message);
            await this.sleep(delay);
            continue;
          }
          throw lastError;
        }
      }

      if (!response || !response.ok) {
        throw lastError || new Error('Failed to get response after retries');
      }

      const rateLimitHourly = response.headers.get('X-RateLimit-Remaining-Hourly');
      const rateLimitDaily = response.headers.get('X-RateLimit-Remaining-Daily');

      const data: ChatCompletionResponse = await response.json();

      console.log('[OpenAI Client] Success:', {
        model: data.model,
        tokens: data.usage?.total_tokens || 0,
        cost: this.estimateCost(data.model, data.usage?.total_tokens || 0),
        rateLimitHourly,
        rateLimitDaily,
        finishReason: data.choices[0]?.finish_reason
      });

      if (rateLimitHourly && parseInt(rateLimitHourly) < 10) {
        console.warn(`[OpenAI Client] ⚠️ Low hourly quota: ${rateLimitHourly} requests remaining`);
      }

      return data;

    } catch (error) {
      console.error('[OpenAI Client] Error:', error);
      throw error;
    }
  }

  private estimateCost(model: string, tokens: number): string {
    const pricing: Record<string, number> = {
      'gpt-4o': 0.005,
      'gpt-4o-mini': 0.0003,
      'gpt-4-turbo': 0.02,
      'gpt-4': 0.045
    };
    const avgCostPer1k = pricing[model] || pricing['gpt-4o-mini'];
    const cost = (tokens / 1000) * avgCostPer1k;
    return `$${cost.toFixed(6)}`;
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await this.chat(messages, options);
    return response.choices[0]?.message?.content || '';
  }

  async analyzeMarket(
    marketData: any,
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    const systemPrompt = `You are an expert forex and indices trading analyst. Analyze the provided market data and provide actionable trading insights.`;

    const userPrompt = `Analyze this market data and provide trading recommendations:\n\n${JSON.stringify(marketData, null, 2)}`;

    return this.complete(systemPrompt, userPrompt, {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 1000,
      requestType: 'market_analysis',
      endpoint: 'openai-client',
      ...options
    });
  }

  async evaluateTrade(
    tradeSetup: any,
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    const systemPrompt = `You are a professional trading risk analyst. Evaluate trade setups for risk/reward ratio, probability of success, and potential pitfalls.`;

    const userPrompt = `Evaluate this trade setup:\n\n${JSON.stringify(tradeSetup, null, 2)}`;

    return this.complete(systemPrompt, userPrompt, {
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 800,
      requestType: 'trade_evaluation',
      endpoint: 'openai-client',
      ...options
    });
  }

  async generateTradeInsights(
    historicalTrades: any[],
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    const systemPrompt = `You are a trading performance analyst. Analyze historical trading data to identify patterns, strengths, weaknesses, and improvement opportunities.`;

    const userPrompt = `Analyze these ${historicalTrades.length} historical trades and provide insights:\n\n${JSON.stringify(historicalTrades, null, 2)}`;

    return this.complete(systemPrompt, userPrompt, {
      model: 'gpt-4o',
      temperature: 0.4,
      max_tokens: 2000,
      requestType: 'trade_insights',
      endpoint: 'openai-client',
      ...options
    });
  }

  isAvailable(): boolean {
    return !!this.functionUrl && this.functionUrl.includes('/.netlify/functions/');
  }
}

export const openAIClient = new OpenAIClient();

export type { ChatMessage, ChatCompletionOptions, ChatCompletionResponse };
