import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = getSupabaseAdmin();

// Timeout configuration
// CCIP-TIMEOUT-FIX-2026-03-08:
// Pre-call overhead (Supabase auth + rate-limit check) consumes ~3-8 seconds.
// With OPENAI_REQUEST_TIMEOUT_MS at 45 s, the total wall-clock budget was
// 45 s + 8 s overhead = 53 s — exceeding the 50 s FUNCTION_TIMEOUT_MS and
// letting Netlify's infrastructure kill the connection mid-response (hard 504).
//
// Fix: lower OPENAI_REQUEST_TIMEOUT_MS to 38 s so the OpenAI AbortController
// fires before FUNCTION_TIMEOUT_MS. The function then returns a clean 504 JSON
// body that the client can retry, rather than an infrastructure-level TCP drop.
// Net budget: 38 s OpenAI + 8 s overhead = 46 s — 4 s clear of the 50 s limit.
//
// CCIP-TIMEOUT-FIX-2026-03-11:
// Production logs showed persistent 504 Gateway Timeout errors under load.
// Root cause: at 38 s OpenAI timeout, calls that started just under the limit were
// completing at 38 s + 8 s overhead = 46 s — inside the 50 s limit technically, but
// with zero margin for any additional Netlify infrastructure latency (TLS, cold start).
// Any transient overhead spike caused the Netlify platform to kill the connection mid-stream.
//
// Fix: reduce OPENAI_REQUEST_TIMEOUT_MS to 28 s.
// New budget: 28 s OpenAI + 8 s overhead = 36 s — 14 s clear of the 50 s limit.
//
// CCIP-TIMEOUT-FIX-2026-03-12b (ALL SYMBOLS TIMEOUT FIX):
// Production: every symbol in every scan was timing out. Root cause confirmed:
//   With OPENAI_REQUEST_TIMEOUT_MS=28s and maxRetries=1 (now 0), the retry path consumed:
//   28s (first call) + 500ms (backoff) + 28s (retry) = 56.5s — 6.5s OVER the 50s Netlify limit.
//   Netlify hard-kills the TCP connection before the retry response arrives. The client
//   receives an infrastructure drop (not a clean 504), so the orchestrator symbol timeout
//   (90-120s) never fires. All symbols cascade to timeout → NO_TRADE.
//
// Fix: reduce OPENAI_REQUEST_TIMEOUT_MS to 18 s.
// New budget: 18s OpenAI + 4s overhead (Supabase auth + rate-limit RPC + TLS) = 22s.
// 22s is 28s clear of the 50s Netlify limit. Even with infrastructure jitter the function
// always returns a clean 504 JSON before Netlify kills the connection.
// maxRetries is also set to 0 in concurrent-execution-config.ts SSOT — no retry attempt
// is made, so the 22s budget is the total per-symbol cost.
// IMPORTANT: openai-client.ts fetchTimeoutMs MUST be > OPENAI_REQUEST_TIMEOUT_MS (18s)
// so the server-side abort fires before the browser-side timeout cancels the request.
// fetchTimeoutMs is set to 22s (= 18s + 4s overhead margin).
// CCIP-2026-03-13b (FUNCTION-TIMEOUT-RACE-FIX): Raised 50s → 58s.
// ROOT CAUSE: netlify.toml sets the Netlify platform timeout to 60s (updated CCIP-2026-03-12c).
// The function's self-imposed FUNCTION_TIMEOUT_MS at 50s was set when the platform limit was 50s.
// Now the function's own kill fires at 50s while Netlify allows 60s, creating a race condition:
//   Pre-call overhead (Supabase auth + rate-limit RPC): 1-8s (up to 8s under cold start)
//   OPENAI_REQUEST_TIMEOUT_MS: 18s
//   Post-call fire-and-forget logging RPCs: 1-3s
//   Total under cold start: 8s + 18s + 3s = 29s — well within 50s in theory.
// BUT: The 50s self-imposed timer runs from function start, not from when the OpenAI call begins.
// Under sustained load with a cold-start pre-call overhead of 5-8s, the OpenAI call starts at 8s
// and the timer fires at 50s — leaving only 42s for OpenAI. The OpenAI AbortController fires
// cleanly at 18s, but the post-call Supabase logging can stall under DB congestion, and the
// response serialization + Netlify infrastructure adds another 1-3s. On back-to-back scans
// with 5 concurrent slots, function cold starts compound. Some second-wave symbols (GBPUSD,
// USDJPY) were hitting the 50s wall mid-response and receiving hard 504s.
// FIX: Raise to 58s. Budget: 60s Netlify platform limit - 2s clean exit margin = 58s.
// The OpenAI call (18s) + maximum realistic overhead (8s pre + 3s post = 11s) = 29s total.
// 58s gives 29s of headroom even under worst-case cold start. The self-imposed timer fires
// before Netlify's platform kill, returning a clean 504 JSON instead of a TCP drop.
//
// CCIP-2026-03-12: OMEGA-8 IS PURELY DETERMINISTIC — ONE LLM CALL PER SYMBOL ONLY.
// Omega-8 was refactored to a pure pattern sensor (no LLM) as of CCIP-2026-03-12.
// The previous comments referencing "TWO sequential LLM calls: Omega-8 first, then Alpha"
// are now obsolete. Only Alpha makes an LLM call. Omega-8 returns computed facts deterministically.
//
// SINGLE-CALL BUDGET PER SYMBOL:
//   Pre-work (data fetch, Supabase queries, Omega-8 deterministic scan): ~5-12s
//   Alpha LLM call (OPENAI_REQUEST_TIMEOUT_MS): 25s max
//   Post-call logging (Supabase RPCs): ~1-3s
//   Total worst-case: 12s + 25s + 3s = 40s — well within the 60s Netlify platform limit.
//
// INVARIANTS:
//   OPENAI_REQUEST_TIMEOUT_MS (25s) + max overhead (8s) = 33s < FUNCTION_TIMEOUT_MS (58s)
//   fetchTimeoutMs in openai-client.ts MUST remain >= OPENAI_REQUEST_TIMEOUT_MS + 8s
//   fetchTimeoutMs is set to 30s (= 25s + 5s overhead margin). See openai-client.ts.
//
// CCIP-2026-03-12-REVERT: Reverted 85s/45s → 58s/25s.
// 25s OPENAI_REQUEST_TIMEOUT_MS is proven working in production.
// Budget: 25s OpenAI + 8s overhead (Supabase auth + rate-limit RPC + TLS + cold start) = 33s.
// 33s is well under the 60s Netlify plan limit. Even with cold start spikes there is margin.
// The concurrent pool is reduced to 3 symbols to halve cold-start cascade pressure.
// See concurrent-execution-config.ts for maxConcurrentSymbols change.
//
// CCIP-2026-03-13c (THIRD-CONCURRENT-SYMBOL-TIMEOUT-FIX):
// ROOT CAUSE: When 3 symbols are evaluated concurrently, all 3 Alpha LLM calls are
// dispatched within 200ms of each other (100ms LLM queue spacing). OpenAI processes
// requests serially on their end during the Asian session low-traffic window. However,
// under moderate model load the third queued request can take longer to begin execution.
// With OPENAI_REQUEST_TIMEOUT_MS=25s, the third symbol's request would time out at 25s
// before OpenAI returned a response — producing a clean 504 and degrading that symbol to
// NO_TRADE. The trade still executes (the selector picks from the two successful symbols),
// but the 504 console error is unnecessary noise and reduces scan coverage.
//
// CCIP-2026-03-13e: ROLLBACK of CCIP-2026-03-13d. Restoring correct timeout values.
//
// ROOT CAUSE OF REGRESSION (CCIP-2026-03-13d was wrong):
//   CCIP-2026-03-13d incorrectly assumed Netlify's `timeout = 60` in netlify.toml applies ONLY
//   to background functions. This is FALSE. The netlify.toml explicitly configures:
//     [functions."openai-chat"]
//       timeout = 60
//   This named function config applies the 60s timeout to the synchronous openai-chat function.
//   Netlify's per-function timeout override IS honoured for named functions regardless of type.
//   The "26s CDN wall for synchronous functions" assumption was incorrect for Netlify Pro/Business
//   plans where named function timeouts up to 900s are supported.
//
// ACTUAL ROOT CAUSE OF 504s (confirmed from production logs):
//   OPENAI_REQUEST_TIMEOUT_MS was set to 20s. gpt-4o-mini generating 1500 tokens (the amount
//   coordinator-alpha.ts requests) takes 18-25s under normal OpenAI load. The AbortController
//   was reliably firing on EVERY request — not as an edge case but as the normal execution path.
//   This caused ALL 9 symbols to get NO_TRADE: coordination failed, preventing any trades.
//
// CORRECT TIMEOUT BUDGET (SSOT, all invariants verified):
//   netlify.toml timeout for openai-chat:          60s (hard platform limit)
//   Pre-work overhead (auth, rate-limit, TLS):     max 8s
//   OPENAI_REQUEST_TIMEOUT_MS:                     45s
//   Post-call logging (non-blocking):              0s
//   Total worst-case:                  8s+45s+0s = 53s
//   Headroom before FUNCTION_TIMEOUT_MS (55s):     2s ✓
//   Headroom before Netlify 60s limit:             7s ✓
//
// INVARIANTS (verified, must never be violated):
//   1. OPENAI_REQUEST_TIMEOUT_MS + max_pre_work < FUNCTION_TIMEOUT_MS
//      (45s + 8s = 53s < 55s ✓  — 2s safety margin)
//   2. FUNCTION_TIMEOUT_MS < netlify.toml timeout for openai-chat
//      (55s < 60s ✓  — 5s safety margin)
//   3. fetchTimeoutMs in openai-client.ts MUST be >= OPENAI_REQUEST_TIMEOUT_MS + max_pre_work
//      = 45s + 8s = 53s minimum → set to 65s (12s safety buffer). See openai-client.ts.
//   4. symbolTimeoutMs (90s) > pre-work_max (12s) + fetchTimeoutMs (65s) = 77s ✓
//
// gpt-4o-mini token generation speed: ~60-90 tokens/sec. For 1500 tokens: 17-25s.
// For 500 tokens (max_tokens default from openai-client.ts): 6-9s.
// coordinator-alpha.ts explicitly passes max_tokens: 1500 — this is the binding budget.
// At 45s, even a 1500-token slow response (25s generation + 8s overhead = 33s) completes safely.
const FUNCTION_TIMEOUT_MS = 55000; // CCIP-2026-03-13e: Self-kill at 55s, 5s before Netlify 60s hard limit.
const OPENAI_REQUEST_TIMEOUT_MS = 45000; // CCIP-2026-03-13e: Restored to 45s — 20s was too short for 1500-token responses.
const RATE_LIMIT_CHECK_TIMEOUT_MS = 2000; // 2 seconds for rate limit check

const MODEL_PRICING = {
  'gpt-4o': { input: 0.0025, output: 0.010 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 }
} as const;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  requestType?: string;
  endpoint?: string;
}

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING] || MODEL_PRICING['gpt-4o-mini'];
  const inputCost = (promptTokens / 1000) * pricing.input;
  const outputCost = (completionTokens / 1000) * pricing.output;
  return inputCost + outputCost;
}

export const handler: Handler = async (event, context) => {
  const startTime = Date.now();

  // Set up timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Function timeout exceeded')), FUNCTION_TIMEOUT_MS);
  });

  // Race between actual handler and timeout
  try {
    return await Promise.race([
      handleRequest(event, startTime),
      timeoutPromise
    ]) as any;
  } catch (error) {
    console.error('[OpenAI Proxy] Timeout or fatal error:', error);
    return {
      statusCode: 504,
      body: JSON.stringify({
        error: 'Gateway Timeout',
        message: 'Request took too long to process. Try again.',
        duration: Date.now() - startTime
      })
    };
  }
};

async function handleRequest(event: any, startTime: number) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!OPENAI_API_KEY) {
    console.error('[OpenAI Proxy] OPENAI_API_KEY not configured');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'OpenAI API key not configured' })
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[OpenAI Proxy] Missing or invalid authorization header');
    return {
      statusCode: 401,
      body: JSON.stringify({
        error: 'Unauthorized',
        message: 'Valid authorization token required'
      })
    };
  }

  const token = authHeader.replace('Bearer ', '');

  let userId: string;
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('[OpenAI Proxy] Invalid token:', authError);
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Invalid or expired token'
        })
      };
    }

    userId = user.id;
    console.log(`[OpenAI Proxy] Authenticated user: ${userId}`);
  } catch (error) {
    console.error('[OpenAI Proxy] Authentication error:', error);
    return {
      statusCode: 401,
      body: JSON.stringify({
        error: 'Unauthorized',
        message: 'Authentication failed'
      })
    };
  }

  // Fast-fail rate limit check with timeout
  try {
    const rateLimitCheckPromise = supabase.rpc('check_rate_limit', { p_user_id: userId });
    const rateLimitTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Rate limit check timeout')), RATE_LIMIT_CHECK_TIMEOUT_MS)
    );

    const { data: rateLimitCheck } = await Promise.race([
      rateLimitCheckPromise,
      rateLimitTimeout
    ]) as any;

    if (rateLimitCheck && !rateLimitCheck.allowed) {
      console.warn(`[OpenAI Proxy] Rate limit exceeded for user ${userId}: ${rateLimitCheck.reason}`);
      const resetAt = rateLimitCheck.reset_at ? new Date(rateLimitCheck.reset_at).getTime() : Date.now() + 3600000;
      const resetInSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining-Hourly': String(rateLimitCheck.hourly_remaining || 0),
          'X-RateLimit-Remaining-Daily': String(rateLimitCheck.daily_remaining || 0),
          'X-RateLimit-Reset': String(Math.floor(resetAt / 1000))
        },
        body: JSON.stringify({
          error: 'Rate limit exceeded',
          source: 'internal',
          message: rateLimitCheck.message,
          reason: rateLimitCheck.reason,
          resetIn: resetInSeconds,
          resetAt: new Date(resetAt).toISOString()
        })
      };
    }

    if (rateLimitCheck) {
      console.log(`[OpenAI Proxy] Rate limit OK: ${rateLimitCheck.hourly_remaining} hourly, ${rateLimitCheck.daily_remaining} daily remaining`);
    }
  } catch (error: any) {
    // If rate limit check times out or fails, log but continue
    // Don't block the request - better to allow it than fail completely
    console.warn('[OpenAI Proxy] Rate limit check failed (continuing anyway):', error.message);
  }

  try {
    const body: ChatRequest = JSON.parse(event.body || '{}');

    if (!body.messages || !Array.isArray(body.messages)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid request: messages array required' })
      };
    }

    // VALIDATE MESSAGE CONTENT
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (msg.content === null || msg.content === undefined) {
        console.error(`[OpenAI Proxy] ERROR - messages[${i}].content is ${msg.content}`);
        console.error(`[OpenAI Proxy] Full message:`, JSON.stringify(msg));
        console.error(`[OpenAI Proxy] RequestType: ${body.requestType}`);
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'Invalid request: message content cannot be null or undefined',
            messageIndex: i,
            requestType: body.requestType
          })
        };
      }
      if (typeof msg.content !== 'string') {
        console.error(`[OpenAI Proxy] ERROR - messages[${i}].content is type ${typeof msg.content}, not string`);
        console.error(`[OpenAI Proxy] Content value:`, msg.content);
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'Invalid request: message content must be a string',
            messageIndex: i,
            contentType: typeof msg.content
          })
        };
      }
    }

    // CCIP-DEGENERATE-FIX-2026-04-14: Use max_completion_tokens ONLY (not max_tokens).
    // The `max_tokens` parameter is deprecated for gpt-4o and o-series models.
    // OpenAI silently ignores or under-honours `max_tokens` for these models,
    // causing the model to stop at ~225-247 tokens regardless of the requested limit.
    // `max_completion_tokens` is the correct, supported field for gpt-4o.
    // CRITICAL: Do NOT send both fields simultaneously — OpenAI returns HTTP 400 if both are present.
    const tokenBudget = body.max_tokens ?? 2000;
    const requestPayload: Record<string, unknown> = {
      model: body.model || 'gpt-4o-mini',
      messages: body.messages,
      temperature: body.temperature ?? 0.7,
      max_completion_tokens: tokenBudget,
      stream: false
    };

    console.log(`[OpenAI Proxy] Calling OpenAI API: ${requestPayload.model}, ${body.messages.length} messages, max_completion_tokens=${tokenBudget}`);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenAI Proxy] OpenAI API error: ${response.status}`, errorText);

        // Parse the OpenAI error body to extract the error code
        let openAiErrorCode: string | null = null;
        let openAiErrorMessage: string | null = null;
        try {
          const parsed = JSON.parse(errorText);
          openAiErrorCode = parsed?.error?.code || null;
          openAiErrorMessage = parsed?.error?.message || null;
        } catch {
          // errorText is not JSON — leave codes null
        }

        const errorLogMessage = openAiErrorMessage
          ? `${openAiErrorCode || 'unknown'}: ${openAiErrorMessage}`.substring(0, 500)
          : errorText.substring(0, 500);

        supabase.from('openai_usage_log').insert({
          user_id: userId,
          model: requestPayload.model,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          endpoint: body.endpoint || 'unknown',
          request_type: body.requestType || 'unknown',
          success: false,
          error_message: errorLogMessage,
          error_code: openAiErrorCode,
          latency_ms: latency
        }).then(result => {
          if (result.error) {
            // Fall back to RPC if direct insert fails (schema mismatch during rollout)
            supabase.rpc('log_openai_usage', {
              p_user_id: userId,
              p_model: requestPayload.model,
              p_prompt_tokens: 0,
              p_completion_tokens: 0,
              p_total_tokens: 0,
              p_cost_usd: 0,
              p_endpoint: body.endpoint || 'unknown',
              p_request_type: body.requestType || 'unknown',
              p_success: false,
              p_error_message: errorLogMessage,
              p_latency_ms: latency
            }).then(rpcResult => {
              if (rpcResult.error) console.error('[OpenAI Proxy] Logging failed:', rpcResult.error);
            });
          }
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after') || response.headers.get('Retry-After');
          const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 3000;

          const isPermanentQuotaFailure = openAiErrorCode === 'insufficient_quota';

          if (isPermanentQuotaFailure) {
            console.error('[OpenAI Proxy] BILLING QUOTA EXHAUSTED — retries will not help. Check OpenAI billing at platform.openai.com');
            return {
              statusCode: 429,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                error: 'OpenAI quota exhausted',
                source: 'openai',
                errorCode: 'insufficient_quota',
                retryAfterMs: 0,
                message: 'OpenAI billing quota is exhausted. Add credits at platform.openai.com to restore service.'
              })
            };
          }

          return {
            statusCode: 429,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error: 'OpenAI service temporarily busy',
              source: 'openai',
              errorCode: openAiErrorCode || 'rate_limit_exceeded',
              retryAfterMs,
              message: 'OpenAI is temporarily rate limiting requests. The system will retry automatically.'
            })
          };
        }

        return {
          statusCode: response.status,
          body: JSON.stringify({
            error: 'OpenAI API error',
            source: 'openai',
            errorCode: openAiErrorCode,
            details: errorText,
            status: response.status
          })
        };
      }

      const data = await response.json();
      const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const cost = calculateCost(requestPayload.model, usage.prompt_tokens, usage.completion_tokens);

      console.log(`[OpenAI Proxy] Success: ${usage.total_tokens} tokens, $${cost.toFixed(6)}, ${latency}ms`);

      // Fire and forget - don't wait for these to complete
      supabase.rpc('increment_rate_limit', { p_user_id: userId })
        .then(result => {
          if (result.error) console.error('[OpenAI Proxy] Rate limit increment failed:', result.error);
        });

      supabase.rpc('log_openai_usage', {
        p_user_id: userId,
        p_model: requestPayload.model,
        p_prompt_tokens: usage.prompt_tokens,
        p_completion_tokens: usage.completion_tokens,
        p_total_tokens: usage.total_tokens,
        p_cost_usd: cost,
        p_endpoint: body.endpoint || 'unknown',
        p_request_type: body.requestType || 'unknown',
        p_success: true,
        p_error_message: null,
        p_latency_ms: latency
      }).then(result => {
        if (result.error) console.error('[OpenAI Proxy] Usage logging failed:', result.error);
      });

      // Return immediately without waiting for logging
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      };

    } catch (fetchError: any) {
      clearTimeout(timeoutId);

      if (fetchError.name === 'AbortError') {
        console.error('[OpenAI Proxy] ⏱️ OpenAI request timeout after', OPENAI_REQUEST_TIMEOUT_MS, 'ms');
        return {
          statusCode: 504,
          body: JSON.stringify({
            error: 'OpenAI request timeout',
            message: 'OpenAI API did not respond in time. Please try again.'
          })
        };
      }

      throw fetchError;
    }

  } catch (error) {
    console.error('[OpenAI Proxy] ❌ Error:', error);
    const latency = Date.now() - startTime;

    // Try to log error but don't wait
    try {
      supabase.rpc('log_openai_usage', {
        p_user_id: userId,
        p_model: 'unknown',
        p_prompt_tokens: 0,
        p_completion_tokens: 0,
        p_total_tokens: 0,
        p_cost_usd: 0,
        p_endpoint: 'unknown',
        p_request_type: 'unknown',
        p_success: false,
        p_error_message: error instanceof Error ? error.message.substring(0, 500) : 'Unknown error',
        p_latency_ms: latency
      }).then(result => {
        if (result.error) console.error('[OpenAI Proxy] Failed to log error:', result.error);
      });
    } catch {
      // Ignore logging failures
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}
