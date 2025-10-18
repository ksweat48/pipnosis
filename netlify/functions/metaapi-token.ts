import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

/**
 * Netlify Function to generate MetaAPI tokens
 *
 * This function creates temporary tokens for accessing MetaAPI accounts.
 * Uses Node.js runtime to avoid SSL certificate validation issues present
 * in Deno-based Supabase Edge Functions.
 *
 * Request Body:
 * - accountId: MetaAPI account ID (required)
 * - region: MetaAPI region (optional, defaults to "new-york")
 *
 * Response:
 * - token: Generated temporary token
 * - expiresAt: ISO timestamp when token expires
 * - region: Region used for token generation
 *
 * Example:
 * POST /.netlify/functions/metaapi-token
 * Body: { "accountId": "c9991ce7-f9ab-49fd-bc67-12839e567e8f", "region": "new-york" }
 */

interface TokenRequest {
  accountId: string;
  region?: string;
}

interface TokenResponse {
  token: string;
  expiresAt: string;
  region: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed. Use POST." }),
    };
  }

  try {
    // Check authentication
    const authHeader = event.headers["authorization"];
    const apiKey = event.headers["apikey"];

    if (!authHeader && !apiKey) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Authentication required. Please provide Authorization header or apikey header.",
        }),
      };
    }

    // Parse request body
    let requestData: TokenRequest;
    try {
      requestData = JSON.parse(event.body || "{}");
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Invalid JSON in request body",
        }),
      };
    }

    const { accountId, region = "new-york" } = requestData;

    // Validate accountId
    if (!accountId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Missing accountId",
          hint: "Provide accountId in request body",
        }),
      };
    }

    // Get MetaAPI admin token from environment
    const adminToken = process.env.METAAPI_TOKEN;
    if (!adminToken) {
      console.error("METAAPI_TOKEN not configured in Netlify environment variables");
      return {
        statusCode: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "MetaAPI configuration error",
          message: "Server not properly configured. Contact administrator.",
        }),
      };
    }

    console.log(`Generating token for account ${accountId} in region ${region}`);

    // Construct MetaAPI Token Management API URL
    const tokenManagementUrl = `https://mt-provisioning-api-v1.${region}.metaapi.cloud/users/current/tokens`;

    // Make request to MetaAPI
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(tokenManagementUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "auth-token": adminToken,
        },
        body: JSON.stringify({
          name: `temp-token-${Date.now()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          permissions: ["read-only"],
          accountIds: [accountId],
        }),
      });
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : "Unknown error";
      console.error("Failed to connect to MetaAPI:", {
        error: errorMessage,
        url: tokenManagementUrl,
        region,
      });

      return {
        statusCode: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Failed to connect to MetaAPI",
          message: errorMessage,
          troubleshooting: [
            "Check network connectivity",
            "Verify MetaAPI service status",
            "Ensure region is correct (new-york, london, singapore)",
          ],
        }),
      };
    }

    // Check if request was successful
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("MetaAPI token creation failed:", {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText,
        region,
        accountId,
      });

      return {
        statusCode: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Failed to generate secure token",
          message: `MetaAPI Token Management API returned ${tokenResponse.status}: ${tokenResponse.statusText}`,
          details: errorText,
          troubleshooting: [
            "Verify MetaAPI admin token is valid and not expired",
            "Check that account exists in MetaAPI dashboard",
            "Ensure account region matches the configured region",
            "Verify account ID is correct",
          ],
        }),
      };
    }

    // Parse successful response
    const tokenData = await tokenResponse.json();

    const response: TokenResponse = {
      token: tokenData.token,
      expiresAt: tokenData.expiresAt,
      region,
    };

    console.log(`Successfully generated token for account ${accountId}`);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Error in metaapi-token function:", error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

export { handler };
