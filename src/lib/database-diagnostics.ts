import { supabase } from './supabase';

export interface DiagnosticResult {
  errors: string[];
  warnings: string[];
  info: string[];
}

export async function runDatabaseDiagnostics(): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    errors: [],
    warnings: [],
    info: []
  };

  try {
    const { data, error } = await supabase.from('user_profiles').select('count').limit(1);

    if (error) {
      result.warnings.push(`Database connection issue: ${error.message}`);
    } else {
      result.info.push('Database connection successful');
    }
  } catch (err) {
    result.errors.push(`Database diagnostic failed: ${err}`);
  }

  return result;
}

export function logDiagnostics(diagnostics: DiagnosticResult): void {
  if (diagnostics.errors.length > 0) {
    console.error('Diagnostics Errors:', diagnostics.errors);
  }
  if (diagnostics.warnings.length > 0) {
    console.warn('Diagnostics Warnings:', diagnostics.warnings);
  }
  if (diagnostics.info.length > 0) {
    console.info('Diagnostics Info:', diagnostics.info);
  }
}
