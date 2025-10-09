export interface EnvironmentConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  metaApiToken?: string;
  metaApiAccountId?: string;
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
    warnings.push('VITE_METAAPI_TOKEN is not defined - running in demo mode');
  }

  if (!metaApiAccountId) {
    warnings.push('VITE_METAAPI_ACCOUNT_ID is not defined - running in demo mode');
  }

  const isValid = errors.length === 0;

  const config: EnvironmentConfig | null = isValid ? {
    supabaseUrl: supabaseUrl || '',
    supabaseAnonKey: supabaseAnonKey || '',
    metaApiToken,
    metaApiAccountId
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

  const hasMetaApi = validation.config?.metaApiToken && validation.config?.metaApiAccountId;
  return hasMetaApi ? 'Live Trading Mode' : 'Demo Mode (Cached Data Only)';
}
