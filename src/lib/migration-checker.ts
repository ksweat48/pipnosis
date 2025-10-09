import { supabase } from './supabase';

export interface MigrationStatus {
  isComplete: boolean;
  missingTables: string[];
  errors: string[];
  warnings: string[];
}

const REQUIRED_TABLES = [
  'market_data',
  'market_data_subscriptions',
  'user_profiles',
  'trading_prompts',
  'trade_records',
  'journal_entries',
  'trading_sessions'
];

const REQUIRED_COLUMNS = {
  market_data: [
    'id',
    'symbol',
    'timeframe',
    'timestamp',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'tick_volume',
    'spread',
    'broker_time',
    'data_source',
    'is_complete',
    'completed_at',
    'created_at',
    'updated_at'
  ]
};

export async function checkMigrationStatus(): Promise<MigrationStatus> {
  const status: MigrationStatus = {
    isComplete: true,
    missingTables: [],
    errors: [],
    warnings: []
  };

  for (const table of REQUIRED_TABLES) {
    try {
      const { error, status: httpStatus } = await supabase
        .from(table)
        .select('id')
        .limit(1);

      if (error) {
        if (httpStatus === 404 || error.message?.includes('does not exist')) {
          status.missingTables.push(table);
          status.errors.push(`Table '${table}' does not exist`);
          status.isComplete = false;
        } else if (httpStatus === 403 || httpStatus === 401) {
          status.warnings.push(`Permission denied for table '${table}'. Check RLS policies.`);
        } else {
          status.warnings.push(`Error checking table '${table}': ${error.message}`);
        }
      }
    } catch (err) {
      status.errors.push(`Exception checking table '${table}': ${err instanceof Error ? err.message : 'Unknown error'}`);
      status.isComplete = false;
    }
  }

  if (status.missingTables.length > 0) {
    status.errors.push(
      'CRITICAL: Database migrations have not been applied. ' +
      'See PRODUCTION_DATABASE_SETUP.md for instructions.'
    );
  }

  return status;
}

export async function checkMarketDataSchema(): Promise<boolean> {
  try {
    const testRow = {
      symbol: '__SCHEMA_CHECK__',
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
      data_source: 'schema_check',
      is_complete: true,
      completed_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('market_data')
      .insert(testRow);

    if (!error) {
      await supabase
        .from('market_data')
        .delete()
        .eq('symbol', '__SCHEMA_CHECK__');
      return true;
    }

    if (error.message?.includes('column') && error.message?.includes('does not exist')) {
      console.error('Schema mismatch:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error checking market_data schema:', err);
    return false;
  }
}

export function getMigrationInstructions(status: MigrationStatus): string {
  if (status.isComplete) {
    return 'All required database tables are present.';
  }

  let instructions = '📋 Database Setup Required\n\n';
  instructions += 'Your production database is missing required tables:\n';

  status.missingTables.forEach(table => {
    instructions += `  - ${table}\n`;
  });

  instructions += '\n🔧 Quick Fix:\n';
  instructions += '1. Open Supabase Dashboard: https://app.supabase.com\n';
  instructions += '2. Navigate to SQL Editor\n';
  instructions += '3. Run the migrations from PRODUCTION_DATABASE_SETUP.md\n';
  instructions += '4. Refresh this page\n';

  return instructions;
}

export async function verifyDatabaseSetup(): Promise<void> {
  console.log('🔍 Verifying database setup...');

  const status = await checkMigrationStatus();

  if (!status.isComplete) {
    console.error('❌ Database setup is incomplete');
    console.error(getMigrationInstructions(status));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pipnosis:migration-check-failed', {
        detail: status
      }));
    }
  } else {
    console.log('✅ Database setup is complete');

    const schemaValid = await checkMarketDataSchema();
    if (!schemaValid) {
      console.warn('⚠️ market_data schema may be outdated. Consider re-running migrations.');
    }
  }
}
