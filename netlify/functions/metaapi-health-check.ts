import type { Handler } from '@netlify/functions';
import { getAccountHealth, resetToPrimary, hasFallback } from '../../src/services/metaapi-account-manager';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const params = new URLSearchParams(event.rawUrl?.split('?')[1] || '');
    const action = params.get('action');

    // Handle reset action
    if (action === 'reset' && event.httpMethod === 'POST') {
      resetToPrimary();
      console.log('[MetaAPI-HealthCheck] Manual reset to primary account requested');

      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ok: true,
          message: 'Successfully reset to primary account',
          timestamp: new Date().toISOString()
        })
      };
    }

    // Get health status
    const health = getAccountHealth();
    const hasFallbackAccount = hasFallback();

    // Calculate health status strings
    const primaryStatus = calculateHealthStatus(health.primary);
    const fallbackStatus = calculateHealthStatus(health.fallback);

    // Calculate success rates
    const primarySuccessRate = health.primary.totalRequests > 0
      ? Math.round((health.primary.successfulRequests / health.primary.totalRequests) * 100)
      : null;

    const fallbackSuccessRate = health.fallback.totalRequests > 0
      ? Math.round((health.fallback.successfulRequests / health.fallback.totalRequests) * 100)
      : null;

    const response = {
      ok: true,
      hasFallback: hasFallbackAccount,
      currentActive: health.currentActive,
      lastSwitch: health.lastSwitch ? new Date(health.lastSwitch).toISOString() : null,
      timeSinceSwitch: health.lastSwitch ? Date.now() - health.lastSwitch : null,
      primary: {
        accountId: health.primary.accountId,
        status: primaryStatus,
        lastSuccess: health.primary.lastSuccess ? new Date(health.primary.lastSuccess).toISOString() : null,
        lastFailure: health.primary.lastFailure ? new Date(health.primary.lastFailure).toISOString() : null,
        lastError: health.primary.lastErrorMessage,
        consecutiveFailures: health.primary.consecutiveFailures,
        totalRequests: health.primary.totalRequests,
        successfulRequests: health.primary.successfulRequests,
        successRate: primarySuccessRate,
        timeSinceSuccess: health.primary.lastSuccess ? Date.now() - health.primary.lastSuccess : null,
        timeSinceFailure: health.primary.lastFailure ? Date.now() - health.primary.lastFailure : null
      },
      fallback: {
        accountId: health.fallback.accountId,
        status: fallbackStatus,
        lastSuccess: health.fallback.lastSuccess ? new Date(health.fallback.lastSuccess).toISOString() : null,
        lastFailure: health.fallback.lastFailure ? new Date(health.fallback.lastFailure).toISOString() : null,
        lastError: health.fallback.lastErrorMessage,
        consecutiveFailures: health.fallback.consecutiveFailures,
        totalRequests: health.fallback.totalRequests,
        successfulRequests: health.fallback.successfulRequests,
        successRate: fallbackSuccessRate,
        timeSinceSuccess: health.fallback.lastSuccess ? Date.now() - health.fallback.lastSuccess : null,
        timeSinceFailure: health.fallback.lastFailure ? Date.now() - health.fallback.lastFailure : null
      },
      timestamp: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('[MetaAPI-HealthCheck] Error:', error);

    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};

function calculateHealthStatus(account: {
  lastSuccess: number | null;
  lastFailure: number | null;
  consecutiveFailures: number;
  totalRequests: number;
}): 'healthy' | 'degraded' | 'failing' | 'unknown' {
  // No requests yet
  if (account.totalRequests === 0) {
    return 'unknown';
  }

  // Has consecutive failures
  if (account.consecutiveFailures >= 2) {
    return 'failing';
  }

  if (account.consecutiveFailures === 1) {
    return 'degraded';
  }

  // Check last success time
  if (account.lastSuccess) {
    const timeSinceSuccess = Date.now() - account.lastSuccess;
    // If last success was recent (< 2 minutes), consider healthy
    if (timeSinceSuccess < 120000) {
      return 'healthy';
    }
  }

  // Check if there's a recent failure
  if (account.lastFailure) {
    const timeSinceFailure = Date.now() - account.lastFailure;
    // Recent failure (< 2 minutes) without recovery
    if (timeSinceFailure < 120000) {
      return 'degraded';
    }
  }

  // Default to unknown if we can't determine
  return 'unknown';
}
