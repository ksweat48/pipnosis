// netlify/functions/get-metaapi-token.js
/* eslint-disable no-console */

// ❗️This endpoint is intentionally blocked to browsers.
// Serverless functions should read process.env.METAAPI_ADMIN_TOKEN directly.

exports.handler = async (event) => {
  // Allow preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    };
  }

  // Block all external access
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'Forbidden. Token is not exposed. Use serverless functions only.'
    })
  };
};
