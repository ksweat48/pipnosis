const { verifyAccount } = require('./metaapi-utils');
const { createLogger } = require('./function-logger');
const {
  formatErrorResponse,
  handleCorsPreFlight,
  createSuccessResponse,
  ValidationError,
  withTimeout
} = require('./error-handler');

const FUNCTION_NAME = 'verify-metaapi-account';
const VERIFY_TIMEOUT_MS = 15000;

exports.handler = async (event) => {
  const logger = createLogger(FUNCTION_NAME);

  logger.info('Account verification request received');

  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreFlight();
  }

  if (event.httpMethod !== 'POST') {
    logger.warn('Invalid HTTP method', { method: event.httpMethod });
    return formatErrorResponse(
      new ValidationError('Method not allowed. Use POST.'),
      logger
    );
  }

  let params = {};

  try {
    const body = JSON.parse(event.body || '{}');
    const { token, accountId, region } = body;

    params = { accountId, region: region || 'new-york' };

    if (!token || !accountId) {
      throw new ValidationError('Missing required parameters: token and accountId', {
        hasToken: !!token,
        hasAccountId: !!accountId
      });
    }

    logger.info('Verifying account', params);

    const accountInfo = await withTimeout(
      verifyAccount(token, accountId, region || 'new-york'),
      VERIFY_TIMEOUT_MS,
      'Account verification timed out'
    );

    logger.success('Account verified successfully', {
      accountName: accountInfo.name,
      accountState: accountInfo.state,
      platform: accountInfo.platform
    });

    const result = {
      success: true,
      account: accountInfo
    };

    await logger.saveToDatabase(200, logger.getExecutionTime(), params, result);

    return createSuccessResponse(result);

  } catch (error) {
    logger.error('Account verification failed', {
      error: error.message,
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
};
