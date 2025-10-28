const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}

class MetaAPIError extends Error {
  constructor(message, details = null, statusCode = 500) {
    super(message);
    this.name = 'MetaAPIError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

class DatabaseError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'DatabaseError';
    this.statusCode = 500;
    this.details = details;
  }
}

class TimeoutError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'TimeoutError';
    this.statusCode = 504;
    this.details = details;
  }
}

class AuthenticationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
    this.details = details;
  }
}

function formatErrorResponse(error, logger = null) {
  let statusCode = 500;
  let errorType = 'InternalServerError';
  let message = 'An unexpected error occurred';
  let details = null;

  if (error instanceof ValidationError) {
    statusCode = error.statusCode;
    errorType = error.name;
    message = error.message;
    details = error.details;
  } else if (error instanceof MetaAPIError) {
    statusCode = error.statusCode;
    errorType = error.name;
    message = error.message;
    details = error.details;
  } else if (error instanceof DatabaseError) {
    statusCode = error.statusCode;
    errorType = error.name;
    message = error.message;
    details = error.details;
  } else if (error instanceof TimeoutError) {
    statusCode = error.statusCode;
    errorType = error.name;
    message = error.message;
    details = error.details;
  } else if (error instanceof AuthenticationError) {
    statusCode = error.statusCode;
    errorType = error.name;
    message = error.message;
    details = error.details;
  } else if (error instanceof Error) {
    message = error.message;
    details = {
      stack: error.stack,
      name: error.name
    };
  }

  if (logger) {
    logger.error(message, {
      errorType,
      statusCode,
      details,
      stack: error.stack
    });
  }

  return {
    statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      error: message,
      errorType,
      details: process.env.NODE_ENV === 'development' ? details : undefined,
      timestamp: new Date().toISOString()
    })
  };
}

function validateRequiredEnvVars(vars, logger = null) {
  const missing = [];

  for (const varName of vars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;

    if (logger) {
      logger.error(message, {
        missing,
        hint: 'Set these in Netlify Dashboard > Site settings > Environment variables'
      });
    }

    throw new ValidationError(message, {
      missing,
      hint: 'Configure these variables in Netlify Dashboard > Site settings > Environment variables'
    });
  }
}

function validateMetaAPIRegion(region, logger = null) {
  const validRegions = ['new-york', 'london', 'singapore', 'tokyo'];
  const isCloudRegion = region && region.startsWith('cloud-');

  if (!validRegions.includes(region) && !isCloudRegion) {
    const message = `Invalid MetaAPI region: ${region}`;

    if (logger) {
      logger.error(message, {
        provided: region,
        valid: validRegions
      });
    }

    throw new ValidationError(message, {
      provided: region,
      valid: validRegions,
      hint: 'Region must be one of: new-york, london, singapore, tokyo'
    });
  }
}

function validateMetaAPIToken(token, logger = null) {
  if (!token || typeof token !== 'string') {
    const message = 'Invalid MetaAPI token: token is required and must be a string';

    if (logger) {
      logger.error(message);
    }

    throw new ValidationError(message);
  }

  if (token.length < 10) {
    const message = 'Invalid MetaAPI token: token is too short';

    if (logger) {
      logger.error(message, { length: token.length });
    }

    throw new ValidationError(message, {
      hint: 'Token must be at least 10 characters long'
    });
  }
}

function createTimeoutPromise(timeoutMs, message = 'Operation timed out') {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(message, { timeoutMs }));
    }, timeoutMs);
  });
}

async function withTimeout(promise, timeoutMs, message = 'Operation timed out') {
  return Promise.race([
    promise,
    createTimeoutPromise(timeoutMs, message)
  ]);
}

function handleCorsPreFlight() {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: ''
  };
}

function createSuccessResponse(data, statusCode = 200) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      success: true,
      data,
      timestamp: new Date().toISOString()
    })
  };
}

module.exports = {
  ValidationError,
  MetaAPIError,
  DatabaseError,
  TimeoutError,
  AuthenticationError,
  formatErrorResponse,
  validateRequiredEnvVars,
  validateMetaAPIRegion,
  validateMetaAPIToken,
  withTimeout,
  handleCorsPreFlight,
  createSuccessResponse,
  corsHeaders
};
