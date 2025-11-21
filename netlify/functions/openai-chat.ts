import type { Handler } from '@netlify/functions';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
}

export const handler: Handler = async (event, context) => {
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[OpenAI Proxy] OpenAI API error: ${response.status}`, errorText);

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

    console.log(`[OpenAI Proxy] Success: ${data.usage?.total_tokens || 0} tokens used`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error('[OpenAI Proxy] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
