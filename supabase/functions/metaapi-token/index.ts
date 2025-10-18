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

    const tokenManagementUrl = `https://mt-provisioning-api-v1.${region}.metaapi.cloud/users/current/tokens`;
    
    const tokenResponse = await fetch(tokenManagementUrl, {
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

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("MetaAPI token creation failed:", errorText);
      
      return new Response(
        JSON.stringify({
          token: adminToken,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          region,
          isAdminToken: true,
          warning: "Using admin token as fallback - Token Management API unavailable"
        } as TokenResponse),
        {
          status: 200,
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