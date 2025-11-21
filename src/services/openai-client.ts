/**
 * Secure OpenAI Client Service
 *
 * This service provides a secure interface to OpenAI API through Netlify serverless functions.
 * API keys are NEVER exposed to the frontend - all calls are proxied through the backend.
 *
 * Architecture:
 * Frontend → openai-client.ts → Netlify Function → OpenAI API
 *                                  (has API key)
 *
 * Security Benefits:
 * 1. API key stored securely on server (Netlify env vars)
 * 2. No key exposure in browser/network requests
 * 3. Rate limiting and abuse prevention possible
 * 4. Usage monitoring and cost control
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
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

  constructor() {
    const netlifyUrl = import.meta.env.VITE_NETLIFY_SITE_URL || '';
    this.functionUrl = `${netlifyUrl}/.netlify/functions/openai-chat`;
  }

  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    try {
      console.log('[OpenAI Client] Calling secure proxy function');

      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages,
          model: options.model || 'gpt-4o-mini',
          temperature: options.temperature ?? 0.7,
          max_tokens: options.max_tokens ?? 2000
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `OpenAI API error: ${response.status} - ${errorData.error || 'Unknown error'}`
        );
      }

      const data: ChatCompletionResponse = await response.json();

      console.log('[OpenAI Client] Success:', {
        model: data.model,
        tokens: data.usage?.total_tokens || 0,
        finishReason: data.choices[0]?.finish_reason
      });

      return data;

    } catch (error) {
      console.error('[OpenAI Client] Error:', error);
      throw error;
    }
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
      ...options
    });
  }

  isAvailable(): boolean {
    return !!this.functionUrl && this.functionUrl.includes('/.netlify/functions/');
  }
}

export const openAIClient = new OpenAIClient();

export type { ChatMessage, ChatCompletionOptions, ChatCompletionResponse };
