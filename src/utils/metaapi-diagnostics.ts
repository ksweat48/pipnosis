import { metaApiTokenManager } from '@/services/metaapi-token-manager';
import { supabase } from '@/lib/supabase';

export interface DiagnosticResult {
  success: boolean;
  timestamp: string;
  results: {
    tokenManager: any;
    edgeFunction?: any;
    metaApiConnectivity?: any;
  };
  errors: string[];
  warnings: string[];
}

class MetaApiDiagnostics {
  async runFullDiagnostics(): Promise<DiagnosticResult> {
    const result: DiagnosticResult = {
      success: true,
      timestamp: new Date().toISOString(),
      results: {
        tokenManager: null,
      },
      errors: [],
      warnings: [],
    };

    console.log('🔍 Running MetaAPI diagnostics...');

    result.results.tokenManager = metaApiTokenManager.getTokenInfo();

    const accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
    const region = import.meta.env.VITE_METAAPI_REGION || 'new-york';

    if (!accountId) {
      result.errors.push('VITE_METAAPI_ACCOUNT_ID not configured');
      result.success = false;
    }

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const testUrl = `${supabaseUrl}/functions/v1/test-metaapi-token?testConnectivity=true&region=${region}`;

      const { data: { session } } = await supabase.auth.getSession();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': anonKey,
      };

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      console.log('📡 Testing edge function...');
      const response = await fetch(testUrl, {
        method: 'GET',
        headers,
      });

      if (response.ok) {
        result.results.edgeFunction = await response.json();
        console.log('✅ Edge function test successful');
      } else {
        const errorText = await response.text();
        result.errors.push(`Edge function test failed: ${errorText}`);
        result.success = false;
      }
    } catch (error) {
      result.errors.push(`Edge function error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.success = false;
    }

    if (accountId) {
      try {
        console.log('🧪 Validating token availability...');
        const tokenInfo = metaApiTokenManager.getTokenInfo();
        result.results.metaApiConnectivity = {
          success: tokenInfo.hasToken && tokenInfo.isValid,
          tokenInfo: tokenInfo
        };

        if (!tokenInfo.hasToken) {
          result.errors.push('No MetaAPI token available');
        } else if (!tokenInfo.isValid) {
          result.warnings.push('Token may be expired or invalid');
        }
      } catch (error) {
        result.errors.push(`Token validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('📊 Diagnostic results:', result);
    return result;
  }

  getTokenInfo() {
    return metaApiTokenManager.getTokenInfo();
  }

  clearTokenCache() {
    console.log('🗑️ Clearing token cache...');
    metaApiTokenManager.clearToken();
    console.log('✅ Token cache cleared');
  }

  async testEdgeFunction(testConnectivity: boolean = false) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const region = import.meta.env.VITE_METAAPI_REGION || 'new-york';
    const testUrl = `${supabaseUrl}/functions/v1/test-metaapi-token?testConnectivity=${testConnectivity}&region=${region}`;

    console.log(`🧪 Testing edge function (connectivity: ${testConnectivity})...`);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': anonKey,
      };

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(testUrl, { headers });
      const data = await response.json();
      console.log('📊 Edge function response:', data);
      return data;
    } catch (error) {
      console.error('❌ Edge function test failed:', error);
      throw error;
    }
  }

  validateTokenFormat(token?: string): { valid: boolean; format: string; warnings: string[] } {
    const envToken = token || import.meta.env.VITE_METAAPI_TOKEN;

    if (!envToken) {
      return {
        valid: false,
        format: 'missing',
        warnings: ['No token configured'],
      };
    }

    const warnings: string[] = [];
    const isJWT = envToken.startsWith('eyJ');

    if (!isJWT) {
      warnings.push('Token does not start with "eyJ" - may not be a valid JWT');
    }

    if (envToken.length < 100) {
      warnings.push('Token appears too short to be a valid MetaAPI token');
    }

    if (isJWT) {
      try {
        const parts = envToken.split('.');
        if (parts.length !== 3) {
          warnings.push('JWT does not have 3 parts (header.payload.signature)');
        } else {
          const payload = JSON.parse(atob(parts[1]));
          if (!payload._id || !payload.accessRules) {
            warnings.push('JWT payload missing expected MetaAPI fields');
          }
        }
      } catch (e) {
        warnings.push('Failed to decode JWT payload');
      }
    }

    return {
      valid: isJWT && warnings.length === 0,
      format: isJWT ? 'JWT' : 'unknown',
      warnings,
    };
  }
}

export const metaApiDiagnostics = new MetaApiDiagnostics();

if (typeof window !== 'undefined') {
  (window as any).testMetaAPIConnection = async () => {
    console.log('🚀 Running MetaAPI connection test...');
    const result = await metaApiDiagnostics.runFullDiagnostics();
    console.log(result.success ? '✅ All tests passed!' : '❌ Some tests failed');
    return result;
  };

  (window as any).getTokenInfo = () => {
    const info = metaApiDiagnostics.getTokenInfo();
    console.table(info);
    return info;
  };

  (window as any).clearTokenCache = () => {
    metaApiDiagnostics.clearTokenCache();
  };

  (window as any).testEdgeFunction = async (testConnectivity: boolean = false) => {
    return await metaApiDiagnostics.testEdgeFunction(testConnectivity);
  };

  (window as any).getMetaAPIHealth = async () => {
    console.log('🏥 Running health check...');
    const diagnostics = await metaApiDiagnostics.runFullDiagnostics();
    const tokenValidation = metaApiDiagnostics.validateTokenFormat();

    const health = {
      status: diagnostics.success ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      diagnostics,
      tokenValidation,
    };

    console.log('📊 Health check results:', health);
    return health;
  };

  (window as any).validateTokenFormat = (token?: string) => {
    const result = metaApiDiagnostics.validateTokenFormat(token);
    console.log('🔍 Token validation:', result);
    if (result.warnings.length > 0) {
      console.warn('⚠️ Warnings:', result.warnings);
    }
    return result;
  };

  console.log('🛠️ MetaAPI diagnostic tools loaded. Available commands:');
  console.log('  - window.testMetaAPIConnection() - Run full diagnostics');
  console.log('  - window.getTokenInfo() - Show current token details');
  console.log('  - window.clearTokenCache() - Clear cached token');
  console.log('  - window.testEdgeFunction(testConnectivity) - Test edge function');
  console.log('  - window.getMetaAPIHealth() - Get comprehensive health status');
  console.log('  - window.validateTokenFormat(token?) - Validate token format');
}
