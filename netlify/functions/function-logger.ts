import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: SupabaseClient | null = null;
let loggingEnabled = false;

if (supabaseUrl && supabaseServiceKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
    loggingEnabled = true;
  } catch (err: any) {
    console.warn('Function logger: Failed to initialize Supabase client:', err.message);
  }
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  details: any;
  functionName: string;
  requestId: string;
}

export class FunctionLogger {
  private functionName: string;
  private requestId: string;
  private startTime: number;
  private logs: LogEntry[];

  constructor(functionName: string, requestId: string | null = null) {
    this.functionName = functionName;
    this.requestId = requestId || generateRequestId();
    this.startTime = Date.now();
    this.logs = [];
  }

  log(level: string, message: string, details: any = null): void {
    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      details,
      functionName: this.functionName,
      requestId: this.requestId
    };

    this.logs.push(logEntry);

    const prefix = `[${this.functionName}:${this.requestId}]`;

    switch (level) {
      case 'error':
        console.error(`${prefix} [ERROR] ${message}`, details ? details : '');
        break;
      case 'warn':
        console.warn(`${prefix} [WARN] ${message}`, details ? details : '');
        break;
      case 'info':
        console.log(`${prefix} [INFO] ${message}`, details ? details : '');
        break;
      case 'debug':
        console.log(`${prefix} [DEBUG] ${message}`, details ? details : '');
        break;
      case 'success':
        console.log(`${prefix} [OK] ${message}`, details ? details : '');
        break;
      default:
        console.log(`${prefix} ${message}`, details ? details : '');
    }
  }

  info(message: string, details: any = null): void {
    this.log('info', message, details);
  }

  error(message: string, details: any = null): void {
    this.log('error', message, details);
  }

  warn(message: string, details: any = null): void {
    this.log('warn', message, details);
  }

  debug(message: string, details: any = null): void {
    this.log('debug', message, details);
  }

  success(message: string, details: any = null): void {
    this.log('success', message, details);
  }

  metric(metricName: string, value: number, unit: string | null = null): void {
    this.log('info', `Metric: ${metricName}`, {
      metric: metricName,
      value,
      unit,
      timestamp: new Date().toISOString()
    });
  }

  async saveToDatabase(
    statusCode: number,
    executionTimeMs: number,
    params: any = null,
    result: any = null,
    error: any = null
  ): Promise<{ success: boolean; reason?: string; error?: any }> {
    if (!loggingEnabled || !supabase) {
      return { success: false, reason: 'Logging not enabled' };
    }

    try {
      const logData = {
        function_name: this.functionName,
        request_id: this.requestId,
        status_code: statusCode,
        execution_time_ms: executionTimeMs,
        params: params ? JSON.stringify(params) : null,
        result: result ? JSON.stringify(result) : null,
        error_message: error ? (error.message || String(error)) : null,
        error_details: error ? JSON.stringify(error) : null,
        logs: JSON.stringify(this.logs),
        timestamp: new Date().toISOString()
      };

      const { error: insertError } = await supabase
        .from('function_execution_logs')
        .insert([logData]);

      if (insertError) {
        console.error('Failed to save function log to database:', insertError);
        return { success: false, error: insertError };
      }

      await this.updateHealthMetrics(statusCode >= 200 && statusCode < 400);

      return { success: true };
    } catch (err: any) {
      console.error('Error saving function log:', err);
      return { success: false, error: err };
    }
  }

  private async updateHealthMetrics(success: boolean): Promise<void> {
    if (!loggingEnabled || !supabase) {
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];

      const { data: existing, error: fetchError } = await supabase
        .from('function_health_metrics')
        .select('*')
        .eq('function_name', this.functionName)
        .eq('date', today)
        .maybeSingle();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Failed to fetch health metrics:', fetchError);
        return;
      }

      const executionTime = Date.now() - this.startTime;

      if (existing) {
        const newTotalCalls = existing.total_calls + 1;
        const newSuccessCount = success ? existing.success_count + 1 : existing.success_count;
        const newFailureCount = success ? existing.failure_count : existing.failure_count + 1;
        const newAvgResponseTime = ((existing.avg_response_time_ms * existing.total_calls) + executionTime) / newTotalCalls;

        const { error: updateError } = await supabase
          .from('function_health_metrics')
          .update({
            total_calls: newTotalCalls,
            success_count: newSuccessCount,
            failure_count: newFailureCount,
            avg_response_time_ms: Math.round(newAvgResponseTime),
            last_execution_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('function_name', this.functionName)
          .eq('date', today);

        if (updateError) {
          console.error('Failed to update health metrics:', updateError);
        }
      } else {
        const { error: insertError } = await supabase
          .from('function_health_metrics')
          .insert([{
            function_name: this.functionName,
            date: today,
            total_calls: 1,
            success_count: success ? 1 : 0,
            failure_count: success ? 0 : 1,
            avg_response_time_ms: executionTime,
            last_execution_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }]);

        if (insertError) {
          console.error('Failed to insert health metrics:', insertError);
        }
      }
    } catch (err: any) {
      console.error('Error updating health metrics:', err);
    }
  }

  getExecutionTime(): number {
    return Date.now() - this.startTime;
  }
}

export function createLogger(functionName: string, requestId: string | null = null): FunctionLogger {
  return new FunctionLogger(functionName, requestId);
}

export { generateRequestId };
