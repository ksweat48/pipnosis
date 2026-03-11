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
 * Rate Limiting (Global Singleton Queue):
 * - All LLM calls from ALL concurrent symbols pass through a single queue
 * - Enforces minimum spacing between consecutive OpenAI API requests
 * - Prevents thundering-herd where 3 symbols converge on the LLM at the same time
 * - This is the SSOT for rate limit enforcement — the orchestrator stagger is redundant
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

/**
 * Global LLM Request Queue — Singleton
 *
 * Enforces minimum spacing between consecutive OpenAI API calls,
 * regardless of how many concurrent symbol evaluations are in flight.
 *
 * Architecture: Token-bucket with minimum inter-call spacing.
 * All calls — Alpha coordinator, Omega-8, mid-trade evaluator — share this queue.
 *
 * CCIP-2026-03-04: Reduced minInterCallMs from 4000ms to 1500ms.
 * CCIP-2026-03-06: Reduced minInterCallMs from 1500ms to 1000ms.
 * Rationale: maxConcurrentSymbols increased 2→3. At 1500ms with 3 concurrent
 * symbols and 2 LLM calls per symbol, peak queue is 6 slots = 9s queue wait.
 * At 1000ms, same 6 slots = 6s queue wait — identical to 2-symbol budget at 1500ms.
 * Formula: (maxConcurrentSymbols × 2 LLM calls) × minInterCallMs ≤ available budget
 *   Old: (2 × 2) × 1500ms = 6s ✓
 *   New: (3 × 2) × 1000ms = 6s ✓
 * 1000ms still maintains anti-thundering-herd protection (OpenAI rate limit is 20 req/s,
 * we are sending max 1 req/s — well within limit).
 * Scan time improvement: 9 symbols in 3 batches of 3 vs 5 batches of 2 = ~40% faster.
 *
 * CCIP-2026-03-11: Reduced minInterCallMs from 1000ms to 500ms.
 * Rationale: Production logs showed 18 LLM calls (9 symbols × 2 calls) × 1000ms = 18s
 * of pure queue wait — the dominant contributor to 4-minute scan times.
 * Queue budget: (3 symbols × 2 calls) × 500ms = 3s queue wait (50% reduction).
 * OpenAI rate limit is 20 req/s; 500ms spacing = 2 req/s — well within the allowed rate.
 * Anti-thundering-herd protection is maintained: calls still cannot burst simultaneously.
 *   New: (3 × 2) × 500ms = 3s ✓ (vs 6s at 1000ms)
 *
 * Circuit Breaker: After CIRCUIT_TRIP_THRESHOLD consecutive insufficient_quota
 * errors, all API calls are blocked for CIRCUIT_RESET_MS to prevent cascading
 * failures from hammering the API when billing is exhausted.
 */
class LLMRequestQueue {
  private lastCallTimestampMs = 0;
  private queue: Array<() => void> = [];
  private processing = false;
  private readonly minInterCallMs = 500; // CCIP-2026-03-11: 1000ms → 500ms. Budget: (3 symbols × 2 calls) × 500ms = 3s queue wait.

  private consecutiveQuotaFailures = 0;
  private readonly CIRCUIT_TRIP_THRESHOLD = 3;
  private readonly CIRCUIT_RESET_MS = 30 * 60 * 1000; // 30 minutes
  private circuitOpenSince: number | null = null;

  isCircuitOpen(): boolean {
    if (this.circuitOpenSince === null) return false;
    const elapsed = Date.now() - this.circuitOpenSince;
    if (elapsed >= this.CIRCUIT_RESET_MS) {
      console.log('[LLM Queue] Circuit breaker auto-reset after 30 minutes.');
      this.circuitOpenSince = null;
      this.consecutiveQuotaFailures = 0;
      return false;
    }
    return true;
  }

  recordQuotaFailure(): void {
    this.consecutiveQuotaFailures++;
    if (this.consecutiveQuotaFailures >= this.CIRCUIT_TRIP_THRESHOLD && this.circuitOpenSince === null) {
      this.circuitOpenSince = Date.now();
      console.error(
        `[LLM Queue] Circuit breaker TRIPPED after ${this.consecutiveQuotaFailures} consecutive quota failures. ` +
        'All LLM calls blocked for 30 minutes. Resolve billing at platform.openai.com then call resetCircuit().'
      );
    }
  }

  recordSuccess(): void {
    if (this.consecutiveQuotaFailures > 0) {
      console.log('[LLM Queue] Success recorded — resetting quota failure counter.');
    }
    this.consecutiveQuotaFailures = 0;
  }

  resetCircuit(): void {
    this.circuitOpenSince = null;
    this.consecutiveQuotaFailures = 0;
    console.log('[LLM Queue] Circuit breaker manually reset.');
  }

  getCircuitStatus(): { open: boolean; consecutiveFailures: number; resetInMs: number | null } {
    const open = this.isCircuitOpen();
    const resetInMs = open && this.circuitOpenSince !== null
      ? Math.max(0, this.CIRCUIT_RESET_MS - (Date.now() - this.circuitOpenSince))
      : null;
    return { open, consecutiveFailures: this.consecutiveQuotaFailures, resetInMs };
  }

  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastCallTimestampMs;
      const waitMs = Math.max(0, this.minInterCallMs - elapsed);

      if (waitMs > 0) {
        console.log(`[LLM Queue] Rate-limiting: waiting ${waitMs}ms before next API call (${this.queue.length} in queue)`);
        await new Promise(r => setTimeout(r, waitMs));
      }

      const next = this.queue.shift();
      if (next) {
        this.lastCallTimestampMs = Date.now();
        next();
      }
    }
    this.processing = false;
  }

  getQueueDepth(): number {
    return this.queue.length;
  }
}

const llmRequestQueue = new LLMRequestQueue();

class OpenAIClient {
  private readonly functionUrl: string;
  private readonly maxRetries = 2;
  private readonly baseDelayMs = 500;
  // CCIP-2026-03-11: Reduced 55,000ms → 35,000ms to align with the tightened
  // OPENAI_REQUEST_TIMEOUT_MS in netlify/functions/openai-chat.ts (28,000ms).
  // Budget: 28s OpenAI timeout + 3-8s pre-call overhead = 36s maximum server
  // wall-clock. 35s client-side fetch timeout gives 1s of buffer before the
  // connection is considered dead on the browser side.
  // IMPORTANT: Keep this value in sync with OPENAI_REQUEST_TIMEOUT_MS + overhead.
  private readonly fetchTimeoutMs = 35000;

  constructor() {
    this.functionUrl = '/.netlify/functions/openai-chat';
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetryableError(status: number): boolean {
    return status === 500 || status === 502 || status === 503 || status === 504;
  }

  private isOpenAI429(errorData: Record<string, unknown>): boolean {
    return errorData.source === 'openai';
  }

  private isPermanentQuotaFailure(errorData: Record<string, unknown>): boolean {
    return errorData.source === 'openai' && errorData.errorCode === 'insufficient_quota';
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
        console.log('[OpenAI Client] Server context detected - using direct API call');
        return await this.chatServerSide(messages, options);
      }

      // BROWSER MODE: Require user authentication
      console.log('[OpenAI Client] Browser context - checking circuit breaker and LLM queue', {
        endpoint: options.endpoint || 'unknown',
        requestType: options.requestType || 'unknown',
        queueDepth: llmRequestQueue.getQueueDepth()
      });

      // Circuit breaker check — if billing quota was exhausted repeatedly, block fast
      if (llmRequestQueue.isCircuitOpen()) {
        const { resetInMs } = llmRequestQueue.getCircuitStatus();
        const resetMinutes = resetInMs !== null ? Math.ceil(resetInMs / 60000) : 30;
        throw new Error(
          `OpenAI quota exhausted — all AI calls are paused for ${resetMinutes} minute(s). ` +
          'Resolve billing at platform.openai.com. The system will resume automatically.'
        );
      }

      const authToken = await this.getAuthToken();
      if (!authToken) {
        throw new Error('Authentication required. Please log in to use AI features.');
      }

      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        // Re-acquire a queue slot for every attempt so retries are subject to
        // the same 4s minimum inter-call spacing as any other LLM call.
        // This prevents a failing call from holding its slot for 14+ seconds
        // while other concurrent symbols wait behind it.
        await llmRequestQueue.acquire();

        console.log(`[OpenAI Client] Queue slot acquired (attempt ${attempt + 1}/${this.maxRetries + 1})`, {
          endpoint: options.endpoint || 'unknown',
          requestType: options.requestType || 'unknown',
          model: options.model || 'gpt-4o-mini'
        });

        let response: Response | null = null;

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

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
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            llmRequestQueue.recordSuccess();

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
              console.warn(`[OpenAI Client] Low hourly quota: ${rateLimitHourly} requests remaining`);
            }

            return data;
          }

          if (this.isRetryableError(response.status) && attempt < this.maxRetries) {
            const delay = this.baseDelayMs * Math.pow(2, attempt);
            console.warn(`[OpenAI Client] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
            await this.sleep(delay);
            continue;
          }

          if (response.status === 429) {
            const errorData = await response.json().catch(() => ({}) as Record<string, unknown>);

            if (this.isPermanentQuotaFailure(errorData)) {
              llmRequestQueue.recordQuotaFailure();
              const { open } = llmRequestQueue.getCircuitStatus();
              const circuitMsg = open ? ' Circuit breaker now OPEN — further AI calls paused for 30 minutes.' : '';
              throw new Error(
                'OpenAI billing quota is exhausted. Add credits at platform.openai.com to restore AI features.' + circuitMsg
              );
            }

            if (this.isOpenAI429(errorData)) {
              const retryAfterMs = typeof errorData.retryAfterMs === 'number' ? errorData.retryAfterMs : 3000;
              if (attempt < this.maxRetries) {
                const baseCap = Math.min(retryAfterMs, 5000);
                const jitter = Math.floor(Math.random() * 2000);
                const waitMs = baseCap + jitter;
                console.warn(`[OpenAI Client] OpenAI transient 429 — retrying in ${waitMs}ms (attempt ${attempt + 1}/${this.maxRetries})`);
                await this.sleep(waitMs);
                continue;
              }
              throw new Error('OpenAI is temporarily busy. Please try again in a moment.');
            }

            const resetIn = typeof errorData.resetIn === 'number' ? errorData.resetIn as number : 3600;
            const resetMinutes = Math.ceil(resetIn / 60);
            const reason = (errorData.reason as string) || 'rate_limit_exceeded';
            const isHourly = reason === 'hourly_limit_exceeded';
            const limitType = isHourly ? 'hourly' : 'daily';
            throw new Error(
              `Rate limit exceeded (${limitType}). Resets in ${resetMinutes} minute${resetMinutes !== 1 ? 's' : ''}.`
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
          const isNonRetryable = lastError.message.includes('Rate limit exceeded (')
            || lastError.message.includes('Authentication')
            || lastError.message.includes('quota is exhausted')
            || lastError.message.includes('paused for');
          if (attempt < this.maxRetries && !isNonRetryable) {
            const delay = this.baseDelayMs * Math.pow(2, attempt);
            console.warn(`[OpenAI Client] Fetch error, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries}):`, lastError.message);
            await this.sleep(delay);
            continue;
          }
          throw lastError;
        }
      }

      throw lastError || new Error('Failed to get response after retries');

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

export function resetLLMCircuitBreaker(): void {
  llmRequestQueue.resetCircuit();
}

export function getLLMCircuitStatus(): { open: boolean; consecutiveFailures: number; resetInMs: number | null } {
  return llmRequestQueue.getCircuitStatus();
}

export type { ChatMessage, ChatCompletionOptions, ChatCompletionResponse };
