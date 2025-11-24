import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

  try {
    const { data: rateLimitCheck } = await supabase.rpc('check_rate_limit', { p_user_id: userId });

    if (!rateLimitCheck?.allowed) {
      console.warn(`[OpenAI Proxy] Rate limit exceeded for user ${userId}: ${rateLimitCheck.reason}`);
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining-Hourly': String(rateLimitCheck.hourly_remaining || 0),
          'X-RateLimit-Remaining-Daily': String(rateLimitCheck.daily_remaining || 0),
          'X-RateLimit-Reset-Hourly': String(rateLimitCheck.hourly_reset_in_seconds || 0),
          'X-RateLimit-Reset-Daily': String(rateLimitCheck.daily_reset_in_seconds || 0)
        },
        body: JSON.stringify({
          error: 'Rate limit exceeded',
          message: rateLimitCheck.message,
          reason: rateLimitCheck.reason,
          resetIn: rateLimitCheck.hourly_reset_in_seconds || rateLimitCheck.daily_reset_in_seconds
        })
      };
    }

    console.log(`[OpenAI Proxy] Rate limit OK for user ${userId}: ${rateLimitCheck.hourly_remaining} hourly, ${rateLimitCheck.daily_remaining} daily remaining`);
  } catch (error) {
    console.error('[OpenAI Proxy] Rate limit check error:', error);
  }

  try {
    const body: ChatRequest = JSON.parse(event.body || '{}');

    if (!body.messages || !Array.isArray(body.messages)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid request: messages array required' })
      };
    }

    const requestPayload = {
      model: body.model || 'gpt-4o-mini',
      messages: body.messages,
      temperature: body.temperature ?? 0.7,
      max_tokens: body.max_tokens ?? 2000,
      stream: false
    };

    console.log(`[OpenAI Proxy] Calling OpenAI API: ${requestPayload.model}, ${body.messages.length} messages`);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestPayload)
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[OpenAI Proxy] OpenAI API error: ${response.status}`, errorText);

      await supabase.rpc('log_openai_usage', {
        p_user_id: userId,
        p_model: requestPayload.model,
        p_prompt_tokens: 0,
        p_completion_tokens: 0,
        p_total_tokens: 0,
        p_cost_usd: 0,
        p_endpoint: body.endpoint || 'unknown',
        p_request_type: body.requestType || 'unknown',
        p_success: false,
        p_error_message: errorText.substring(0, 500),
        p_latency_ms: latency
      });

      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: 'OpenAI API error',
          details: errorText,
          status: response.status
        })
      };
    }

    const data = await response.json();
    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const cost = calculateCost(requestPayload.model, usage.prompt_tokens, usage.completion_tokens);

    console.log(`[OpenAI Proxy] Success: ${usage.total_tokens} tokens, $${cost.toFixed(6)} cost, ${latency}ms latency`);

    await supabase.rpc('increment_rate_limit', { p_user_id: userId });

    await supabase.rpc('log_openai_usage', {
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
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining-Hourly': String(await getRemainingQuota(userId, 'hourly')),
        'X-RateLimit-Remaining-Daily': String(await getRemainingQuota(userId, 'daily'))
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error('[OpenAI Proxy] Error:', error);
    const latency = Date.now() - startTime;

    try {
      await supabase.rpc('log_openai_usage', {
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
      });
    } catch (logError) {
      console.error('[OpenAI Proxy] Failed to log error:', logError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

async function getRemainingQuota(userId: string, type: 'hourly' | 'daily'): Promise<number> {
  try {
    const { data } = await supabase.rpc('check_rate_limit', { p_user_id: userId });
    return type === 'hourly' ? (data?.hourly_remaining || 0) : (data?.daily_remaining || 0);
  } catch {
    return 0;
  }
}
