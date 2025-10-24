const { createClient } = require('@supabase/supabase-js');
const MetaApi = require('metaapi.cloud-sdk').default;
const { createLogger } = require('./function-logger');
const {
  formatErrorResponse,
  validateRequiredEnvVars,
  validateMetaAPIRegion,
  handleCorsPreFlight,
  createSuccessResponse,
  MetaAPIError,
  DatabaseError,
  withTimeout
} = require('./error-handler');

const FUNCTION_NAME = 'get-metaapi-token';
const TOKEN_TIMEOUT_MS = 20000;

async function handler(event, context) {
  const logger = createLogger(FUNCTION_NAME);

  logger.info('MetaAPI token generation request received');

  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreFlight();
  }

  let params = {};

  try {
    validateRequiredEnvVars([
      'METAAPI_ADMIN_TOKEN',
      'METAAPI_ACCOUNT_ID',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY'
    ], logger);

    const adminToken = process.env.METAAPI_ADMIN_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    const region = process.env.METAAPI_REGION || 'new-york';
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    params = { accountId, region };

    validateMetaAPIRegion(region, logger);

    logger.info('Environment validated', { accountId, region });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    logger.info('Checking token cache...');

    const { data: cachedToken, error: cacheError } = await supabase
      .from('metaapi_token_cache')
      .select('token, expires_at, use_count')
      .eq('account_id', accountId)
      .eq('region', region)
      .eq('is_valid', true)
      .maybeSingle();

    if (cacheError && cacheError.code !== 'PGRST116') {
      logger.warn('Cache lookup failed, will generate new token', { error: cacheError.message });
    }

    if (cachedToken) {
      const expiresAt = new Date(cachedToken.expires_at);
      const now = new Date();
      const timeUntilExpiry = expiresAt - now;

      if (timeUntilExpiry > 5 * 60 * 1000) {
        logger.success('Using cached token', {
          expiresAt: cachedToken.expires_at,
          useCount: cachedToken.use_count,
          timeUntilExpiryMinutes: Math.round(timeUntilExpiry / 60000)
        });

        await supabase
          .from('metaapi_token_cache')
          .update({
            use_count: cachedToken.use_count + 1,
            last_used_at: new Date().toISOString()
          })
          .eq('account_id', accountId)
          .eq('region', region);

        logger.metric('cache_hit', 1);

        const result = { token: cachedToken.token, cached: true };
        await logger.saveToDatabase(200, logger.getExecutionTime(), params, result);

        return createSuccessResponse(result);
      } else {
        logger.info('Cached token expires soon, generating new token', {
          timeUntilExpiryMinutes: Math.round(timeUntilExpiry / 60000)
        });
      }
    } else {
      logger.info('No cached token found, generating new token');
      logger.metric('cache_miss', 1);
    }

    logger.info('Initializing MetaAPI SDK...');

    const metaApi = new MetaApi(adminToken, {
      application: 'Pipnosis',
      region: region,
      requestTimeout: 15000,
      connectTimeout: 8000
    });

    if (!metaApi.tokenManagementApi) {
      throw new MetaAPIError('MetaAPI SDK initialization failed: tokenManagementApi not available');
    }

    logger.info('Generating narrowed token via SDK...', { accountId, region });

    const tokenGenStartTime = Date.now();

    const tokenResult = await withTimeout(
      metaApi.tokenManagementApi.narrowDownTokenResources({ accountId }),
      TOKEN_TIMEOUT_MS,
      'MetaAPI token generation timed out'
    );

    const generationTimeMs = Date.now() - tokenGenStartTime;

    if (!tokenResult || !tokenResult.token) {
      throw new MetaAPIError('MetaAPI returned empty token response');
    }

    const generatedToken = tokenResult.token;

    logger.success('Token generated successfully', {
      tokenLength: generatedToken.length,
      generationTimeMs,
      method: 'SDK narrowDownTokenResources'
    });

    logger.metric('token_generation_time_ms', generationTimeMs, 'ms');

    logger.info('Caching token in Supabase...');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

    const { error: upsertError } = await supabase
      .from('metaapi_token_cache')
      .upsert({
        account_id: accountId,
        region: region,
        token: generatedToken,
        expires_at: expiresAt.toISOString(),
        is_valid: true,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        generation_time_ms: generationTimeMs,
        source_region: region,
        use_count: 1,
        last_used_at: now.toISOString()
      }, {
        onConflict: 'account_id,region'
      });

    if (upsertError) {
      logger.warn('Failed to cache token', { error: upsertError.message });
    } else {
      logger.success('Token cached successfully', { expiresAt: expiresAt.toISOString() });
    }

    const result = {
      token: generatedToken,
      cached: false,
      generationTimeMs
    };

    await logger.saveToDatabase(200, logger.getExecutionTime(), params, result);

    return createSuccessResponse(result);

  } catch (error) {
    logger.error('Token generation failed', {
      error: error.message,
      stack: error.stack,
      type: error.name
    });

    await logger.saveToDatabase(
      error.statusCode || 500,
      logger.getExecutionTime(),
      params,
      null,
      error
    );

    return formatErrorResponse(error, logger);
  }
}

module.exports = { handler };
