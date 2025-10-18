import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TokenRequest {
  accountId: string;
  region?: string;
}

interface TokenResponse {
  token: string;
  expiresAt: string;
  region: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const apiKey = req.headers.get("apikey");

    if (!authHeader && !apiKey) {
      return new Response(
        JSON.stringify({ error: "Authentication required. Please provide Authorization header or apikey header." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { accountId, region = "new-york" }: TokenRequest = await req.json();

    if (!accountId) {
      return new Response(
        JSON.stringify({ error: "Missing accountId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const adminToken = Deno.env.get("METAAPI_TOKEN");
    if (!adminToken) {
      return new Response(
        JSON.stringify({ error: "MetaAPI configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Attempting to create token for account ${accountId} in region ${region}`);
    console.log(`DENO_TLS_CA_STORE: ${Deno.env.get("DENO_TLS_CA_STORE") || "not set"}`);
    console.log(`NODE_TLS_REJECT_UNAUTHORIZED: ${Deno.env.get("NODE_TLS_REJECT_UNAUTHORIZED") || "not set"}`);
    console.log(`System time: ${new Date().toISOString()}`);

    const tokenManagementUrl = `https://mt-provisioning-api-v1.${region}.metaapi.cloud/users/current/tokens`;

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
          permissions: [
            "read-only"
          ],
          accountIds: [accountId],
        }),
      });
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : "Unknown";
      const errorStack = fetchError instanceof Error ? fetchError.stack : undefined;

      const isSSLError = errorMessage.toLowerCase().includes('certificate') ||
                        errorMessage.toLowerCase().includes('ssl') ||
                        errorMessage.toLowerCase().includes('tls') ||
                        errorMessage.toLowerCase().includes('self-signed');

      console.error("Fetch error details:", {
        error: fetchError,
        message: errorMessage,
        stack: errorStack,
        isSSLError,
        url: tokenManagementUrl,
        tlsConfig: {
          denoTlsCaStore: Deno.env.get("DENO_TLS_CA_STORE") || "not set",
          nodeTlsRejectUnauthorized: Deno.env.get("NODE_TLS_REJECT_UNAUTHORIZED") || "not set",
        }
      });

      if (isSSLError) {
        throw new Error(
          `SSL Certificate Validation Failed: ${errorMessage}. ` +
          `To fix this, add DENO_TLS_CA_STORE=mozilla,system to your Supabase Edge Function secrets. ` +
          `The MetaAPI endpoint is presenting a self-signed or untrusted certificate.`
        );
      }

      throw new Error(
        `Failed to connect to MetaAPI: ${errorMessage}. ` +
        `Check network connectivity and MetaAPI service status.`
      );
    }

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("MetaAPI token creation failed:", {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText,
        region,
        accountId
      });

      return new Response(
        JSON.stringify({
          error: "Failed to generate secure token",
          message: `MetaAPI Token Management API returned ${tokenResponse.status}: ${tokenResponse.statusText}`,
          details: errorText,
          troubleshooting: [
            "Verify MetaAPI admin token is valid and not expired",
            "Check that account exists in MetaAPI dashboard",
            "Ensure account region matches the configured region",
            "If SSL errors occur, add DENO_TLS_CA_STORE=mozilla,system to Supabase Edge Function secrets",
            "Verify system time is synchronized (SSL certificates are time-sensitive)"
          ]
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenData = await tokenResponse.json();

    const response: TokenResponse = {
      token: tokenData.token,
      expiresAt: tokenData.expiresAt,
      region,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in metaapi-token function:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
