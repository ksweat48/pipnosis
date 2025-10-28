/**
 * ENVIRONMENT VARIABLE DIAGNOSTIC ENDPOINT
 *
 * This function checks which environment variables are available to Netlify functions
 * and provides guidance on configuration issues.
 *
 * Purpose: Help diagnose environment variable configuration issues in production
 */

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    console.log('[ENV-DIAGNOSTIC] Checking environment variables...');

    // Helper function to mask sensitive values
    const maskValue = (value) => {
      if (!value) return null;
      if (value.length <= 8) return '***';
      return `${value.substring(0, 4)}...${value.substring(value.length - 4)} (${value.length} chars)`;
    };

    // Check MetaAPI-related variables
    const metaApiVars = {
      // Backend variables (what Netlify functions can access)
      backend: {
        METAAPI_ADMIN_TOKEN: {
          present: !!process.env.METAAPI_ADMIN_TOKEN,
          value: maskValue(process.env.METAAPI_ADMIN_TOKEN),
          required: true,
          purpose: 'Admin token for generating temporary MetaAPI tokens (backend only)'
        },
        METAAPI_ACCOUNT_ID: {
          present: !!process.env.METAAPI_ACCOUNT_ID,
          value: process.env.METAAPI_ACCOUNT_ID || null,
          required: true,
          purpose: 'MetaAPI account ID for API calls (backend)'
        },
        METAAPI_REGION: {
          present: !!process.env.METAAPI_REGION,
          value: process.env.METAAPI_REGION || null,
          required: true,
          purpose: 'MetaAPI server region (backend)'
        }
      },
      // Frontend variables (compiled into build, not runtime accessible by functions)
      frontend: {
        VITE_METAAPI_ACCOUNT_ID: {
          present: !!process.env.VITE_METAAPI_ACCOUNT_ID,
          value: process.env.VITE_METAAPI_ACCOUNT_ID || null,
          required: false,
          purpose: 'MetaAPI account ID for frontend (build-time only, NOT accessible by functions at runtime)'
        },
        VITE_METAAPI_REGION: {
          present: !!process.env.VITE_METAAPI_REGION,
          value: process.env.VITE_METAAPI_REGION || null,
          required: false,
          purpose: 'MetaAPI region for frontend (build-time only)'
        }
      }
    };

    // Check Supabase variables
    const supabaseVars = {
      VITE_SUPABASE_URL: {
        present: !!process.env.VITE_SUPABASE_URL,
        value: process.env.VITE_SUPABASE_URL || null,
        required: true
      },
      VITE_SUPABASE_ANON_KEY: {
        present: !!process.env.VITE_SUPABASE_ANON_KEY,
        value: maskValue(process.env.VITE_SUPABASE_ANON_KEY),
        required: true
      },
      SUPABASE_SERVICE_ROLE_KEY: {
        present: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        value: maskValue(process.env.SUPABASE_SERVICE_ROLE_KEY),
        required: true
      }
    };

    // Analyze configuration
    const backendMetaApiMissing = [];
    const backendMetaApiPresent = [];

    Object.entries(metaApiVars.backend).forEach(([key, info]) => {
      if (info.required && !info.present) {
        backendMetaApiMissing.push(key);
      } else if (info.present) {
        backendMetaApiPresent.push(key);
      }
    });

    const isFullyConfigured = backendMetaApiMissing.length === 0;

    // Check if using fallback pattern
    const usingFallback = !process.env.METAAPI_ACCOUNT_ID && process.env.VITE_METAAPI_ACCOUNT_ID;

    // Generate recommendations
    const recommendations = [];

    if (backendMetaApiMissing.length > 0) {
      recommendations.push({
        severity: 'critical',
        issue: 'Missing backend environment variables',
        variables: backendMetaApiMissing,
        solution: 'Add these variables in Netlify Dashboard → Site Settings → Environment Variables',
        details: 'Netlify functions cannot access VITE_ prefixed variables at runtime. You need non-prefixed versions.'
      });
    }

    if (usingFallback) {
      recommendations.push({
        severity: 'warning',
        issue: 'Using fallback pattern',
        details: 'Functions are falling back to VITE_ prefixed variables. This works but is not recommended.',
        solution: 'Add METAAPI_ACCOUNT_ID and METAAPI_REGION to Netlify environment variables for better reliability.'
      });
    }

    if (!process.env.METAAPI_ADMIN_TOKEN) {
      recommendations.push({
        severity: 'critical',
        issue: 'METAAPI_ADMIN_TOKEN missing',
        solution: 'This is required for the token service to work. Add it to Netlify environment variables.',
        securityNote: 'Never commit this token to git. Only set it in Netlify dashboard.'
      });
    }

    console.log('[ENV-DIAGNOSTIC] Analysis complete');
    console.log(`Backend MetaAPI vars present: ${backendMetaApiPresent.length}`);
    console.log(`Backend MetaAPI vars missing: ${backendMetaApiMissing.length}`);
    console.log(`Fully configured: ${isFullyConfigured}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        environment: process.env.CONTEXT || 'unknown',
        status: {
          fullyConfigured: isFullyConfigured,
          usingFallback: usingFallback,
          criticalIssues: recommendations.filter(r => r.severity === 'critical').length
        },
        variables: {
          metaapi: metaApiVars,
          supabase: supabaseVars
        },
        recommendations: recommendations,
        guide: {
          title: 'Understanding Environment Variables',
          sections: [
            {
              heading: 'VITE_ Prefixed Variables',
              explanation: 'Variables with VITE_ prefix are only available during build time and are compiled into your frontend code. Netlify functions CANNOT access these at runtime.',
              examples: ['VITE_METAAPI_ACCOUNT_ID', 'VITE_METAAPI_REGION', 'VITE_SUPABASE_URL']
            },
            {
              heading: 'Non-Prefixed Variables',
              explanation: 'Variables without VITE_ prefix are available to Netlify functions at runtime. These are what your backend needs.',
              examples: ['METAAPI_ADMIN_TOKEN', 'METAAPI_ACCOUNT_ID', 'METAAPI_REGION']
            },
            {
              heading: 'Best Practice',
              explanation: 'Set both versions in Netlify: VITE_ versions for frontend, non-prefixed for backend functions.',
              action: 'Go to Netlify Dashboard → Site Settings → Environment Variables'
            }
          ]
        }
      })
    };

  } catch (error) {
    console.error('[ENV-DIAGNOSTIC] Error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};
