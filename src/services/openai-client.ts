import { getMaxRetries, getRetryDelayMs, getMinInterCallMs } from '../config/concurrent-execution-config';

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
  /** @deprecated Use max_completion_tokens. This field is translated to max_completion_tokens before sending to OpenAI. */
  max_tokens?: number;
  max_completion_tokens?: number;
  requestType?: string;
  endpoint?: string;
  symbol?: string;
  /**
   * CCIP-2026-0510L: OpenAI Structured Outputs.
   * When supplied, OpenAI binds the response to the provided JSON schema at
   * the transport layer — responses missing required fields cannot be returned.
   * Requires model gpt-4o-2024-08-06 or newer.
   * SSOT: src/config/alpha-output-schema.ts.
   */
  response_format?: {
    type: 'json_schema';
    json_schema: {
      name: string;
      strict?: boolean;
      schema: Record<string, unknown>;
    };
  } | { type: 'json_object' };
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
    // CCIP-2026-0329A: OpenAI prompt caching — present when store:true is sent in request
    prompt_tokens_details?: {
      cached_tokens?: number;
      audio_tokens?: number;
    };
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
  // CCIP-2026-03-12: 500ms → 100ms. OpenAI allows 20 req/s; 100ms = 10 req/s (2x safety margin).
  // Queue budget: (5 symbols × 2 calls) × 100ms = 1s total queue wait (down from 9s at 500ms).
  // Anti-thundering-herd protection maintained: calls still cannot burst simultaneously.
  // SSOT value owned by concurrent-execution-config.ts; injected at queue construction time.
  private readonly minInterCallMs: number;

  constructor(minInterCallMs: number) {
    this.minInterCallMs = minInterCallMs;
  }

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

// CCIP-2026-03-12: minInterCallMs sourced from SSOT via getMinInterCallMs().
// Value defined in concurrent-execution-config.ts rateLimiting.minInterCallMs (100ms).
// Do NOT hardcode this value here — changes to the SSOT propagate automatically.
const llmRequestQueue = new LLMRequestQueue(getMinInterCallMs());

class OpenAIClient {
  private readonly functionUrl: string;
  // CCIP-2026-03-13e: maxRetries sourced from SSOT — getMaxRetries() returns 0 (zero retries).
  // With OPENAI_REQUEST_TIMEOUT_MS=45s a retry would push total to ~90s+overhead > 60s Netlify limit.
  // Zero retries: one clean 55s window per symbol; 504s become graceful NO_TRADE.
  // CCIP-2026-03-16 (RETRY-RESTORE): maxRetries sourced from SSOT via getMaxRetries() = 1.
  // Previous CCIP-2026-03-13e set this to 0 because a retry on an 18s request risked the 50s
  // Netlify kill wall. That constraint is resolved: OPENAI_REQUEST_TIMEOUT_MS=45s and
  // netlify.toml timeout=60s mean each invocation has a 60s window. When a 504 arrives, the
  // Netlify function is already dead. The browser retry is a NEW invocation — a fresh 60s budget.
  // No timeout compounding occurs. See concurrent-execution-config.ts resilience block for the
  // full CCIP-2026-03-16 change record and safety contract.
  // SSOT: concurrent-execution-config.ts resilience.maxRetries owns this value.
  private readonly maxRetries = getMaxRetries();
  private readonly baseDelayMs = getRetryDelayMs();
  // CCIP-2026-03-12: OMEGA-8 IS PURELY DETERMINISTIC — ONE LLM CALL PER SYMBOL ONLY.
  // Previous comments referencing "TWO sequential LLM calls (Omega-8 → Alpha)" are obsolete.
  // Omega-8 was refactored to a pure pattern sensor with zero LLM calls. Only Alpha calls the LLM.
  //
  // fetchTimeoutMs is the client-side AbortController deadline for a single Alpha LLM fetch.
  //
  // CCIP-2026-03-13e: Restored to 65s. netlify.toml has:
  //   [functions."openai-chat"]
  //     timeout = 60
  // This 60s limit IS applied to this named function. The correct budget:
  //   OPENAI_REQUEST_TIMEOUT_MS = 45s
  //   max pre-work overhead     = 8s
  //   server wall-clock worst   = 53s
  // fetchTimeoutMs must be > 53s. Set to 65s: 12s safety buffer beyond server worst-case.
  //
  // TIMEOUT BUDGET HIERARCHY (SSOT — all values must satisfy all invariants):
  //   OPENAI_REQUEST_TIMEOUT_MS (server)  = 45s  — netlify/functions/openai-chat.ts (SSOT)
  //   FUNCTION_TIMEOUT_MS (Netlify fn)    = 55s  — netlify/functions/openai-chat.ts (SSOT)
  //   netlify.toml openai-chat timeout    = 60s  — netlify.toml [functions."openai-chat"]
  //   fetchTimeoutMs (client)             = 65s  — this file (SSOT for client-side timeout)
  //   symbolTimeoutMs / sessionTimeouts   = 90s  — concurrent-execution-config.ts
  //   councilTimeoutMs                    = 300s — concurrent-execution-config.ts
  //
  // INVARIANTS (must never be violated):
  //   1. OPENAI_REQUEST_TIMEOUT_MS + max_pre_work < FUNCTION_TIMEOUT_MS
  //      (52s + 6s = 58s ≤ 58s ✓  — zero margin; FUNCTION_TIMEOUT kills first if OpenAI slow)
  //   2. FUNCTION_TIMEOUT_MS < netlify.toml openai-chat timeout
  //      (58s < 60s ✓  — 2s safety margin)
  //   3. fetchTimeoutMs >= FUNCTION_TIMEOUT_MS + network_overhead
  //      (65s >= 58s + 7s ✓  — matches server self-kill window)
  //   4. symbolTimeoutMs > pre-work_max + fetchTimeoutMs
  //      (90s > 12s + 65s = 77s ✓  — 13s safety margin)
  //
  // CCIP-2026-0511T: Server budget raised from 45s→52s to cover P99 Alpha latency (~42s
  // observed at 60k prompt tokens). See openai-chat.ts for rationale. Client fetchTimeoutMs
  // unchanged at 65s — still satisfies invariant #3 against the new 58s server ceiling.
  //
  // SSOT: OPENAI_REQUEST_TIMEOUT_MS is owned by netlify/functions/openai-chat.ts.
  //       If OPENAI_REQUEST_TIMEOUT_MS changes, recalculate all values per the invariants above.
  private readonly fetchTimeoutMs = 65000;

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

    const resolvedBudget = options.max_completion_tokens ?? options.max_tokens ?? 2000;
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
        max_completion_tokens: resolvedBudget,
        store: false,
        // CCIP-2026-0510L: Structured Outputs binding. Forwarded when caller
        // supplies a json_schema contract (e.g. Alpha arbiter) so OpenAI
        // refuses responses missing required fields.
        ...(options.response_format ? { response_format: options.response_format } : {})
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      // CCIP-2026-0510M: Surface OpenAI error type + message on server-side path so
      // strict-schema rejections are diagnosable rather than "Unknown".
      const errMsg = errorData.error?.message || errorData.error || 'Unknown';
      const errType = errorData.error?.type || errorData.error?.code || '';
      console.error(`[OpenAI Client] Server-side ${response.status} — type=${errType} msg="${String(errMsg).slice(0, 400)}"`);
      throw new Error(`OpenAI API error: ${response.status} - ${errType ? `[${errType}] ` : ''}${errMsg}`);
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

  /**
   * CCIP-CACHE-BUST-TRANSPORT-2026-04-15: Platform-wide cache bust at the transport layer.
   *
   * CCIP-2026-0511H: RELOCATED fingerprint from first system message -> tail of last user
   * message to RESTORE OpenAI KV-prefix caching for the stable identity block.
   *
   * OpenAI's automatic KV-prefix caching is permanently on. It keys on the PREFIX of the
   * messages array. When the first system message changes on every request (previous behaviour),
   * every call is a cache miss — the full 50-60k identity tokens are re-processed from scratch
   * for every symbol, blowing the Netlify 60s window.
   *
   * By keeping the system prompt BYTE-IDENTICAL across all symbols in a scan (and across
   * scans until alpha-identity.ts changes) and moving per-request uniqueness to the END of
   * the LAST user message, we get both:
   *   1) high cache-hit percentage (50-90%) on symbols 2+ in a scan -> dramatically lower
   *      input-token cost and TTFB
   *   2) per-request uniqueness that still defeats the "identical-completion" degeneracy bug
   *      that would otherwise produce abbreviated 230-token responses
   *
   * The tail fingerprint does NOT break uniqueness because the model still sees distinct
   * input content for every call — the nonce+timestamp sits in the user turn where the
   * model conditions generation, not in the shared identity prefix.
   *
   * COST: ~6 tokens per call — negligible.
   */
  private injectCacheBustFingerprint(messages: ChatMessage[], options: ChatCompletionOptions): ChatMessage[] {
    const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
    const fingerprint = `[REQ:${Date.now()}|${nonce}]`;
    // Find the LAST user message; append fingerprint to its content.
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) {
      // No user message — fall back to appending to the last message regardless of role
      // so uniqueness is preserved. This preserves the system prefix for caching.
      if (messages.length === 0) return messages;
      const patched = messages.slice();
      const last = patched[patched.length - 1];
      patched[patched.length - 1] = { ...last, content: `${last.content}\n${fingerprint}` };
      return patched;
    }
    const patched = messages.map((m, i) => {
      if (i !== lastUserIdx) return m;
      return { ...m, content: `${m.content}\n${fingerprint}` };
    });
    if (options.requestType === 'alpha_coordination') {
      console.log(`[OpenAI Client] Cache-preserving fingerprint appended for ${options.symbol ?? 'unknown'}: ${fingerprint}`);
    }
    return patched;
  }

  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    try {
      // Check weekend shutdown — crypto symbols (24/7 markets) are exempt
      const { weekendProtectionService } = await import('./weekend-protection-service');
      if (weekendProtectionService.isLLMDisabled()) {
        const { is24HourSymbol } = await import('../utils/marketHours');
        const isCrypto = options.symbol ? is24HourSymbol(options.symbol) : false;
        if (!isCrypto) {
          throw new Error('LLM APIs are disabled for weekend shutdown. Market reopens Sunday 5 PM EST.');
        }
      }

      // CONTEXT-AWARE ROUTING: Detect server vs browser
      if (this.isServerContext()) {
        console.log('[OpenAI Client] Server context detected - using direct API call');
        return await this.chatServerSide(this.injectCacheBustFingerprint(messages, options), options);
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

        const resolvedMaxTokens = options.max_completion_tokens ?? options.max_tokens ?? 2000;
        console.log(`[OpenAI Client] Queue slot acquired (attempt ${attempt + 1}/${this.maxRetries + 1})`, {
          endpoint: options.endpoint || 'unknown',
          requestType: options.requestType || 'unknown',
          model: options.model || 'gpt-4o-mini',
          max_tokens_sent_to_proxy: resolvedMaxTokens
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
              messages: this.injectCacheBustFingerprint(messages, options),
              model: options.model || 'gpt-4o-mini',
              temperature: options.temperature ?? 0.7,
              // CCIP-2026-04-15: Default raised back to 2000. The 500-token cap was the root
              // cause of degenerate 252-token Alpha scans. A full Alpha answer sheet with
              // reasoning, trader statement, and all structured fields requires 800-1500 tokens.
              // Callers that need a shorter response (e.g. omega brains) pass max_completion_tokens
              // or max_tokens explicitly and that explicit value is honoured.
              // The Netlify proxy translates this field to max_completion_tokens for OpenAI.
              max_tokens: resolvedMaxTokens,
              requestType: options.requestType,
              endpoint: options.endpoint,
              // CCIP-2026-0510L: Forward structured-outputs schema to Netlify proxy.
              ...(options.response_format ? { response_format: options.response_format } : {})
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            llmRequestQueue.recordSuccess();

            const rateLimitHourly = response.headers.get('X-RateLimit-Remaining-Hourly');
            const rateLimitDaily = response.headers.get('X-RateLimit-Remaining-Daily');

            const data: ChatCompletionResponse = await response.json();

            // CCIP-2026-0329A: Log cached_tokens for cache hit rate monitoring
            // CCIP-CACHE-BUST-2026-04-14: Elevated to warn when cache hit >10% on alpha_coordination
            // requests — indicates the scan fingerprint may not be defeating the cache, which is
            // the leading indicator of degenerate abbreviated completions.
            const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
            const totalPrompt = data.usage?.prompt_tokens ?? 0;
            const cacheHitPct = totalPrompt > 0 ? Math.round((cachedTokens / totalPrompt) * 100) : 0;
            console.log('[OpenAI Client] Success:', {
              model: data.model,
              tokens: data.usage?.total_tokens || 0,
              cachedTokens,
              cacheHitPct: `${cacheHitPct}%`,
              cost: this.estimateCost(data.model, data.usage?.total_tokens || 0),
              rateLimitHourly,
              rateLimitDaily,
              finishReason: data.choices[0]?.finish_reason
            });

            // CCIP-2026-0511H: Inverted warning. We now WANT cache hits on the stable identity
            // prefix. Warn only if cache hit is <40% for alpha_coordination, which indicates
            // the fingerprint is leaking into the prefix (e.g. via a refactor to system message).
            if (
              options.requestType === 'alpha_coordination' &&
              totalPrompt > 1024 &&
              cacheHitPct < 40
            ) {
              console.warn(
                `[OpenAI Client] CCIP-2026-0511H WARNING: Alpha scan cache hit=${cacheHitPct}% ` +
                `(${cachedTokens}/${totalPrompt} cached prompt tokens) for endpoint=${options.endpoint ?? 'unknown'} symbol=${options.symbol ?? 'unknown'}. ` +
                `Cache hit <40% suggests the identity-block prefix is not stable across calls. ` +
                `Verify injectCacheBustFingerprint appends to the last USER message, not the system block.`
              );
            }

            if (rateLimitHourly && parseInt(rateLimitHourly) < 10) {
              console.warn(`[OpenAI Client] Low hourly quota: ${rateLimitHourly} requests remaining`);
            }

            return data;
          }

          if (this.isRetryableError(response.status) && attempt < this.maxRetries) {
            // CCIP-2026-0511M: Jittered exponential backoff on 5xx retries.
            // Deterministic backoff (2s, 4s, 8s) causes simultaneous retries across
            // concurrent symbols to hit OpenAI at the same millisecond, amplifying
            // the 504 condition. Adding 0-750ms of jitter spreads the herd.
            // Also pulls the server-side errorCode (set by netlify/functions/openai-chat.ts
            // on upstream 504s) so the console shows WHY the call failed, not just
            // "HTTP 504".
            const backoff = this.baseDelayMs * Math.pow(2, attempt);
            const jitter = Math.floor(Math.random() * 750);
            const delay = backoff + jitter;
            let errorCode = 'unknown';
            let details = '';
            try {
              const clone = response.clone();
              const errorData = (await clone.json().catch(() => ({}))) as {
                errorCode?: string;
                details?: string;
                error?: string;
              };
              errorCode = errorData.errorCode || errorData.error || 'unknown';
              details = (errorData.details || '').split('\n')[0].slice(0, 200);
            } catch {
              // non-JSON body on 5xx is normal (e.g. Netlify CDN HTML page)
            }
            console.warn(
              `[OpenAI Client] CCIP-2026-0511M retryable ${response.status} ` +
              `errorCode=${errorCode} details="${details}" ` +
              `symbol=${options.symbol ?? 'unknown'} requestType=${options.requestType ?? 'unknown'} ` +
              `retrying in ${delay}ms (${backoff}ms base + ${jitter}ms jitter, attempt ${attempt + 1}/${this.maxRetries})`
            );
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

          const errorData = await response.json().catch(() => ({} as Record<string, unknown>));

          // CCIP-2026-0510M: Surface OpenAI errorCode + first line of details on 400s.
          // The proxy (netlify/functions/openai-chat.ts) forwards `errorCode` and
          // `details` from OpenAI on non-2xx responses. Without this, schema drift
          // (e.g. strict-mode keyword rejections) surfaces as "Unknown error" in the
          // browser, masking the root cause. Now a single console line identifies it.
          if (response.status === 400) {
            const errorCode = (errorData as { errorCode?: string }).errorCode || 'unknown';
            const details = (errorData as { details?: string }).details || '';
            const firstLine = details.split('\n')[0].slice(0, 400);
            console.error(
              `[OpenAI Client] 400 from OpenAI — errorCode=${errorCode} details="${firstLine}"`
            );
            throw new Error(
              `OpenAI 400 (${errorCode}): ${firstLine || (errorData as { error?: string }).error || 'Bad request'}`
            );
          }

          throw new Error(
            `OpenAI API error: ${response.status} - ${(errorData as { error?: string }).error || (errorData as { message?: string }).message || 'Unknown error'}`
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
