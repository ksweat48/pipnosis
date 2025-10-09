import { supabase } from './supabase';

export interface DatabaseDiagnostics {
  canConnect: boolean;
  tableExists: boolean;
  canRead: boolean;
  canWrite: boolean;
  errors: string[];
  warnings: string[];
}

export async function runDatabaseDiagnostics(): Promise<DatabaseDiagnostics> {
  const diagnostics: DatabaseDiagnostics = {
    canConnect: false,
    tableExists: false,
    canRead: false,
    canWrite: false,
    errors: [],
    warnings: []
  };

  try {
    const { data: healthCheck, error: healthError } = await supabase
      .from('market_data')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (healthError) {
      if (healthError.message.includes('does not exist') || healthError.code === 'PGRST204') {
        diagnostics.errors.push('Table "market_data" does not exist in database');
        diagnostics.tableExists = false;
      } else if (healthError.message.includes('permission') || healthError.code === '42501') {
        diagnostics.errors.push('Permission denied - RLS policies may be blocking access');
        diagnostics.tableExists = true;
      } else if (healthError.message.includes('network') || healthError.message.includes('fetch')) {
        diagnostics.errors.push('Network error - cannot reach Supabase database');
      } else {
        diagnostics.errors.push(`Database error: ${healthError.message}`);
      }
      diagnostics.canConnect = false;
      diagnostics.canRead = false;
    } else {
      diagnostics.canConnect = true;
      diagnostics.tableExists = true;
      diagnostics.canRead = true;
    }
  } catch (error) {
    diagnostics.canConnect = false;
    diagnostics.errors.push(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  if (diagnostics.canRead) {
    try {
      const testRow = {
        symbol: '__DIAGNOSTIC_TEST__',
        timeframe: 'M1',
        timestamp: new Date().toISOString(),
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 0,
        tick_volume: 0,
        spread: 0,
        broker_time: new Date().toISOString(),
        data_source: 'diagnostic',
        is_complete: true,
        completed_at: new Date().toISOString()
      };

      const { error: writeError } = await supabase
        .from('market_data')
        .upsert(testRow, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (writeError) {
        diagnostics.errors.push(`Write test failed: ${writeError.message}`);
        diagnostics.canWrite = false;
      } else {
        diagnostics.canWrite = true;

        await supabase
          .from('market_data')
          .delete()
          .eq('symbol', '__DIAGNOSTIC_TEST__');
      }
    } catch (error) {
      diagnostics.errors.push(`Write test exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
      diagnostics.canWrite = false;
    }
  }

  if (!import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL === 'https://placeholder.supabase.co') {
    diagnostics.warnings.push('Supabase URL not configured properly');
  }

  if (!import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY === 'placeholder-key') {
    diagnostics.warnings.push('Supabase anon key not configured properly');
  }

  return diagnostics;
}

export function logDiagnostics(diagnostics: DatabaseDiagnostics): void {
  console.group('🔬 Database Diagnostics');

  console.log('Connection:', diagnostics.canConnect ? '✅ OK' : '❌ Failed');
  console.log('Table Exists:', diagnostics.tableExists ? '✅ Yes' : '❌ No');
  console.log('Read Access:', diagnostics.canRead ? '✅ OK' : '❌ Failed');
  console.log('Write Access:', diagnostics.canWrite ? '✅ OK' : '❌ Failed');

  if (diagnostics.errors.length > 0) {
    console.group('❌ Errors');
    diagnostics.errors.forEach(error => console.error(error));
    console.groupEnd();
  }

  if (diagnostics.warnings.length > 0) {
    console.group('⚠️ Warnings');
    diagnostics.warnings.forEach(warning => console.warn(warning));
    console.groupEnd();
  }

  if (diagnostics.canConnect && diagnostics.canRead && diagnostics.canWrite) {
    console.log('✅ All database checks passed');
  } else {
    console.error('❌ Database diagnostics failed - check errors above');
  }

  console.groupEnd();
}
