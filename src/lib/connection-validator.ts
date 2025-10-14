import { supabase } from './supabase';

export interface ConnectionValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  details: {
    hasUrl: boolean;
    hasKey: boolean;
    canConnect: boolean;
    tablesExist: boolean;
    rlsConfigured: boolean;
    tableAccessible: boolean;
  };
}

export interface TableInfo {
  name: string;
  exists: boolean;
  accessible: boolean;
  rowCount?: number;
  error?: string;
}

class ConnectionValidator {
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(fallbackValue), timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutHandle!);
      return result;
    } catch (error) {
      clearTimeout(timeoutHandle!);
      return fallbackValue;
    }
  }

  async validateConnection(): Promise<ConnectionValidationResult> {
    const result: ConnectionValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      details: {
        hasUrl: false,
        hasKey: false,
        canConnect: false,
        tablesExist: false,
        rlsConfigured: false,
        tableAccessible: false
      }
    };

    try {
      const urlValid = await this.validateEnvironmentVariables(result);

      if (!urlValid) {
        result.isValid = true;
        result.warnings.push('Environment variables need attention, but app will continue loading');
        return result;
      }

      const connected = await this.withTimeout(
        this.validateDatabaseConnection(result),
        5000,
        false
      );

      if (!connected) {
        result.isValid = true;
        result.warnings.push('Database connection check timed out or failed, but app will continue loading');
        console.warn('Database connection validation failed, continuing anyway');
        return result;
      }

      await this.withTimeout(
        this.validateRequiredTables(result),
        3000,
        undefined
      );

      await this.withTimeout(
        this.validateTableAccess(result),
        3000,
        undefined
      );

      if (result.errors.length > 0) {
        result.isValid = true;
        console.warn('Database validation found issues, but allowing app to load:', result.errors);
        result.warnings.push(...result.errors);
        result.errors = [];
      }

      return result;
    } catch (error) {
      console.error('Connection validation error (non-blocking):', error);
      result.isValid = true;
      result.warnings.push('Connection validation failed but app will continue');
      return result;
    }
  }

  private async validateEnvironmentVariables(result: ConnectionValidationResult): Promise<boolean> {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

    result.details.hasUrl = !!url && url.trim() !== '' && !url.includes('your-project');
    result.details.hasKey = !!key && key.trim() !== '' && key.length > 20;

    if (!result.details.hasUrl) {
      result.errors.push('VITE_SUPABASE_URL is missing or invalid in environment variables');
    }

    if (!result.details.hasKey) {
      result.errors.push('VITE_SUPABASE_ANON_KEY is missing or invalid in environment variables');
    }

    if (!url || !key) {
      result.errors.push('Environment variables not configured. Check your .env file.');
      return false;
    }

    if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
      result.errors.push('VITE_SUPABASE_URL format is invalid. Should be: https://[project-id].supabase.co');
      return false;
    }

    return true;
  }

  private async validateDatabaseConnection(result: ConnectionValidationResult): Promise<boolean> {
    try {
      const startTime = performance.now();

      const { data, error, status } = await supabase
        .from('market_data')
        .select('id', { count: 'exact', head: true })
        .limit(1);

      const latency = performance.now() - startTime;

      if (error) {
        console.warn('Database connection validation error:', { status, message: error.message });

        if (status === 404) {
          result.warnings.push('Cannot connect to database. Table "market_data" not found (404).');
        } else if (status === 401 || status === 403) {
          result.warnings.push(`Authentication failed (${status}). Check VITE_SUPABASE_ANON_KEY.`);
        } else if (status === 500) {
          result.warnings.push('Database server error (500). Database may be unavailable or have configuration issues.');
          console.error('Database 500 error - this is likely causing the loading issue:', error);
        } else {
          result.warnings.push(`Database connection error: ${error.message || 'Unknown error'}`);
        }
        result.details.canConnect = false;
        return false;
      }

      result.details.canConnect = true;

      if (latency > 3000) {
        result.warnings.push(`Database latency is high (${Math.round(latency)}ms). Connection may be slow.`);
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      console.warn(`Failed to connect to database (non-blocking): ${errorMessage}`);
      result.warnings.push(`Failed to connect to database: ${errorMessage}`);
      result.details.canConnect = false;
      return false;
    }
  }

  private async validateRequiredTables(result: ConnectionValidationResult): Promise<void> {
    const requiredTables = [
      'market_data',
      'market_data_subscriptions',
      'user_profiles',
      'trade_records',
      'journal_entries'
    ];

    let allTablesExist = true;

    for (const tableName of requiredTables) {
      const tableInfo = await this.checkTable(tableName);

      if (!tableInfo.exists) {
        result.errors.push(`Required table "${tableName}" does not exist`);
        allTablesExist = false;
      } else if (tableInfo.error) {
        result.warnings.push(`Table "${tableName}" exists but has issues: ${tableInfo.error}`);
      }
    }

    result.details.tablesExist = allTablesExist;
  }

  private async checkTable(tableName: string): Promise<TableInfo> {
    try {
      const { data, error, count, status } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true })
        .limit(1);

      if (error) {
        if (status === 404 || error.message?.includes('does not exist')) {
          return {
            name: tableName,
            exists: false,
            accessible: false,
            error: 'Table not found'
          };
        }

        return {
          name: tableName,
          exists: true,
          accessible: false,
          error: error.message
        };
      }

      return {
        name: tableName,
        exists: true,
        accessible: true,
        rowCount: count || 0
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        name: tableName,
        exists: false,
        accessible: false,
        error: errorMessage
      };
    }
  }

  private async validateTableAccess(result: ConnectionValidationResult): Promise<void> {
    try {
      const testRead = await supabase
        .from('market_data')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (testRead.error) {
        const errorMsg = testRead.error.message || 'Unknown error';

        if (errorMsg.includes('permission') || errorMsg.includes('policy') || errorMsg.includes('RLS')) {
          result.errors.push('Row Level Security (RLS) policies are blocking access to market_data table');
          result.warnings.push('You may need to update RLS policies. Check PRODUCTION_DATABASE_SETUP.md');
          result.details.rlsConfigured = false;
        } else {
          result.errors.push(`Cannot read from market_data: ${errorMsg}`);
        }
        result.details.tableAccessible = false;
        return;
      }

      const testWrite = await supabase
        .from('market_data')
        .upsert({
          symbol: '__CONNECTION_TEST__',
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
          data_source: 'connection_test',
          is_complete: true,
          completed_at: new Date().toISOString()
        }, {
          onConflict: 'symbol,timeframe,timestamp'
        });

      if (testWrite.error) {
        const errorMsg = testWrite.error.message || 'Unknown error';

        if (errorMsg.includes('permission') || errorMsg.includes('policy') || errorMsg.includes('RLS')) {
          result.errors.push('RLS policies are blocking write access to market_data table');
          result.warnings.push('You may need to update RLS policies. Check PRODUCTION_DATABASE_SETUP.md');
          result.details.rlsConfigured = false;
        } else {
          result.errors.push(`Cannot write to market_data: ${errorMsg}`);
        }
        result.details.tableAccessible = false;
        return;
      }

      await supabase
        .from('market_data')
        .delete()
        .eq('symbol', '__CONNECTION_TEST__');

      result.details.tableAccessible = true;
      result.details.rlsConfigured = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Access validation failed: ${errorMessage}`);
      result.details.tableAccessible = false;
    }
  }

  async getDetailedDiagnostics(): Promise<{
    tables: TableInfo[];
    connection: {
      latency: number;
      status: string;
    };
    environment: {
      url: string;
      keyConfigured: boolean;
    };
  }> {
    const tables = await Promise.all([
      'market_data',
      'market_data_subscriptions',
      'user_profiles',
      'trade_records',
      'journal_entries',
      'chart_preferences'
    ].map(name => this.checkTable(name)));

    const startTime = performance.now();
    const { error } = await supabase
      .from('market_data')
      .select('id')
      .limit(1)
      .maybeSingle();
    const latency = performance.now() - startTime;

    return {
      tables,
      connection: {
        latency: Math.round(latency),
        status: error ? 'error' : 'connected'
      },
      environment: {
        url: import.meta.env.VITE_SUPABASE_URL || 'NOT_SET',
        keyConfigured: !!(import.meta.env.VITE_SUPABASE_ANON_KEY)
      }
    };
  }
}

export const connectionValidator = new ConnectionValidator();
