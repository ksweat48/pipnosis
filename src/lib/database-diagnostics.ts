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
  // Log diagnostics silently for developers only - no user-facing warnings
  if (diagnostics.errors.length > 0) {
    console.log('[Dev Info] Diagnostics Errors:', diagnostics.errors);
  }
  if (diagnostics.warnings.length > 0) {
    console.log('[Dev Info] Diagnostics Warnings:', diagnostics.warnings);
  }
  if (diagnostics.info.length > 0) {
    console.log('[Dev Info] Diagnostics Info:', diagnostics.info);
  }
}
