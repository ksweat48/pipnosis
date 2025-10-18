export interface EnvironmentConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  metaApiToken: string;
  metaApiAccountId: string;
  metaApiRegion: string;
}

export interface EnvironmentValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  config: EnvironmentConfig | null;
}

export function validateEnvironment(): EnvironmentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const metaApiToken = import.meta.env.VITE_METAAPI_TOKEN;
  const metaApiAccountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
  const metaApiRegion = import.meta.env.VITE_METAAPI_REGION || 'new-york';

  if (!supabaseUrl) {
    errors.push('VITE_SUPABASE_URL is not defined');
  } else if (supabaseUrl === 'https://placeholder.supabase.co') {
    errors.push('VITE_SUPABASE_URL is set to placeholder value');
  } else if (!supabaseUrl.includes('supabase.co')) {
    warnings.push('VITE_SUPABASE_URL does not appear to be a valid Supabase URL');
  }

  if (!supabaseAnonKey) {
    errors.push('VITE_SUPABASE_ANON_KEY is not defined');
  } else if (supabaseAnonKey === 'placeholder-key') {
    errors.push('VITE_SUPABASE_ANON_KEY is set to placeholder value');
  } else if (supabaseAnonKey.length < 100) {
    warnings.push('VITE_SUPABASE_ANON_KEY appears to be invalid (too short)');
  }

  if (!metaApiToken) {
    errors.push('VITE_METAAPI_TOKEN is required for live trading');
  } else if (metaApiToken.length < 20) {
    errors.push('VITE_METAAPI_TOKEN appears to be invalid (too short)');
  }

  if (!metaApiAccountId) {
    errors.push('VITE_METAAPI_ACCOUNT_ID is required for live trading');
  } else if (!metaApiAccountId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    warnings.push('VITE_METAAPI_ACCOUNT_ID does not appear to be a valid UUID');
  }

  const validRegions = ['new-york', 'london', 'singapore'];
  if (metaApiRegion && !validRegions.includes(metaApiRegion)) {
    warnings.push(`VITE_METAAPI_REGION '${metaApiRegion}' is not a known region. Valid options: ${validRegions.join(', ')}`);
  }

  const isValid = errors.length === 0;

  const config: EnvironmentConfig | null = isValid ? {
    supabaseUrl: supabaseUrl || '',
    supabaseAnonKey: supabaseAnonKey || '',
    metaApiToken: metaApiToken || '',
    metaApiAccountId: metaApiAccountId || '',
    metaApiRegion: metaApiRegion
  } : null;

  return {
    isValid,
    errors,
    warnings,
    config
  };
}

export function logEnvironmentStatus(): void {
  const validation = validateEnvironment();

  console.group('🔧 Environment Configuration');
  console.log('Mode:', import.meta.env.MODE);
  console.log('Production:', import.meta.env.PROD);
  console.log('Development:', import.meta.env.DEV);

  if (validation.isValid) {
    console.log('✅ Environment validation: PASSED');
    console.log('Supabase URL:', validation.config?.supabaseUrl);
    console.log('Supabase Key:', validation.config?.supabaseAnonKey ? '✓ Present' : '✗ Missing');
    console.log('MetaAPI Token:', validation.config?.metaApiToken ? '✓ Present' : '✗ Missing');
    console.log('MetaAPI Account:', validation.config?.metaApiAccountId ? '✓ Present' : '✗ Missing');
  } else {
    console.error('❌ Environment validation: FAILED');
    validation.errors.forEach(error => console.error('  ERROR:', error));
  }

  if (validation.warnings.length > 0) {
    validation.warnings.forEach(warning => console.warn('  WARNING:', warning));
  }

  console.groupEnd();
}

export function getEnvironmentSummary(): string {
  const validation = validateEnvironment();

  if (!validation.isValid) {
    return `Configuration Error: ${validation.errors.join(', ')}`;
  }

  return `Live Trading Mode (${validation.config?.metaApiRegion || 'new-york'})`;
}

export function checkCredentialsConfigured(): {
  configured: boolean;
  missing: {
    token: boolean;
    accountId: boolean;
    region: boolean;
  };
} {
  const metaApiToken = import.meta.env.VITE_METAAPI_TOKEN;
  const metaApiAccountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
  const metaApiRegion = import.meta.env.VITE_METAAPI_REGION;

  const missing = {
    token: !metaApiToken,
    accountId: !metaApiAccountId,
    region: !metaApiRegion
  };

  return {
    configured: !missing.token && !missing.accountId,
    missing
  };
}
