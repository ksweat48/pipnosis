import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface DiagnosticResponse {
  status: string;
  timestamp: string;
  checks: {
    tokenConfigured: boolean;
    tokenFormat: string;
    tokenPrefix: string;
    tokenSuffix: string;
    canDecodeJWT: boolean;
    jwtPayload?: any;
    metaApiConnectivity?: {
      success: boolean;
      region: string;
      responseTime: number;
      error?: string;
    };
  };
  warnings: string[];
  errors: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const response: DiagnosticResponse = {
      status: "running",
      timestamp: new Date().toISOString(),
      checks: {
        tokenConfigured: false,
        tokenFormat: "unknown",
        tokenPrefix: "",
        tokenSuffix: "",
        canDecodeJWT: false,
      },
      warnings: [],
      errors: [],
    };

    const adminToken = Deno.env.get("METAAPI_TOKEN");

    if (!adminToken) {
      response.status = "error";
      response.errors.push("METAAPI_TOKEN environment variable is not set");
      return new Response(JSON.stringify(response), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    response.checks.tokenConfigured = true;
    response.checks.tokenPrefix = adminToken.substring(0, 8);
    response.checks.tokenSuffix = adminToken.substring(adminToken.length - 8);

    if (adminToken.startsWith("eyJ")) {
      response.checks.tokenFormat = "JWT";

      try {
        const parts = adminToken.split(".");
        if (parts.length === 3) {
          response.checks.canDecodeJWT = true;
          const payload = JSON.parse(atob(parts[1]));
          response.checks.jwtPayload = {
            tokenId: payload.tokenId,
            userId: payload._id?.substring(0, 8) + "...",
            hasAccessRules: Array.isArray(payload.accessRules),
            accessRulesCount: Array.isArray(payload.accessRules) ? payload.accessRules.length : 0,
            issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : undefined,
          };
        } else {
          response.warnings.push("JWT has unexpected number of parts");
        }
      } catch (e) {
        response.warnings.push(`Failed to decode JWT: ${e.message}`);
      }
    } else {
      response.checks.tokenFormat = "non-JWT";
      response.warnings.push("Token does not appear to be a JWT (does not start with 'eyJ')");
    }

    const url = new URL(req.url);
    const testConnectivity = url.searchParams.get("testConnectivity") === "true";
    const region = url.searchParams.get("region") || "new-york";

    if (testConnectivity) {
      const startTime = Date.now();

      try {
        const tokenManagementUrl = `https://mt-provisioning-api-v1.${region}.metaapi.cloud/users/current/tokens`;

        const metaApiResponse = await fetch(tokenManagementUrl, {
          method: "GET",
          headers: {
            "auth-token": adminToken,
          },
        });

        const responseTime = Date.now() - startTime;

        if (metaApiResponse.ok) {
          response.checks.metaApiConnectivity = {
            success: true,
            region,
            responseTime,
          };
          response.status = "healthy";
        } else {
          const errorText = await metaApiResponse.text();
          response.checks.metaApiConnectivity = {
            success: false,
            region,
            responseTime,
            error: `HTTP ${metaApiResponse.status}: ${errorText}`,
          };
          response.warnings.push("MetaAPI connectivity test failed");
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        response.checks.metaApiConnectivity = {
          success: false,
          region,
          responseTime,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        response.errors.push(`MetaAPI connectivity error: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } else {
      response.status = "healthy";
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in test-metaapi-token function:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});