import { supabase } from '../lib/supabase';
import TinyEmitter from 'tiny-emitter';

export type DatabaseHealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';

export interface DatabaseHealthMetrics {
  status: DatabaseHealthStatus;
  connectivity: boolean;
  latency: number | null;
  lastSuccessfulWrite: Date | null;
  lastSuccessfulRead: Date | null;
  consecutiveFailures: number;
  errorRate: number;
  lastError: string | null;
  errorCode: string | null;
  errorType: 'network' | 'permission' | 'not_found' | 'server' | 'unknown' | null;
  checkedAt: Date;
}

interface HealthCheckResult {
  success: boolean;
  latency: number;
  error?: string;
  errorCode?: string;
  errorType?: 'network' | 'permission' | 'not_found' | 'server' | 'unknown';
}

class DatabaseHealthMonitor extends TinyEmitter {
  private metrics: DatabaseHealthMetrics = {
    status: 'unknown',
    connectivity: false,
    latency: null,
    lastSuccessfulWrite: null,
    lastSuccessfulRead: null,
    consecutiveFailures: 0,
    errorRate: 0,
    lastError: null,
    errorCode: null,
    errorType: null,
    checkedAt: new Date()
  };

  private checkInterval: number | null = null;
  private readonly CHECK_INTERVAL_MS = 30000;
  private readonly ERROR_RATE_WINDOW = 100;
  private recentOperations: boolean[] = [];
  private isMonitoring = false;

  startMonitoring(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    console.log('🔍 Starting database health monitoring...');

    this.performHealthCheck();

    this.checkInterval = window.setInterval(() => {
      this.performHealthCheck();
    }, this.CHECK_INTERVAL_MS);
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isMonitoring = false;
    console.log('🛑 Stopped database health monitoring');
  }

  getMetrics(): DatabaseHealthMetrics {
    return { ...this.metrics };
  }

  private async performHealthCheck(): Promise<void> {
    const readResult = await this.checkRead();
    const writeResult = await this.checkWrite();

    const overallSuccess = readResult.success && writeResult.success;
    this.recordOperation(overallSuccess);

    if (overallSuccess) {
      this.metrics.consecutiveFailures = 0;
      this.metrics.lastSuccessfulRead = new Date();
      this.metrics.lastSuccessfulWrite = new Date();
      this.metrics.connectivity = true;
      this.metrics.latency = (readResult.latency + writeResult.latency) / 2;
      this.metrics.lastError = null;
      this.metrics.errorCode = null;
      this.metrics.errorType = null;
    } else {
      this.metrics.consecutiveFailures++;
      this.metrics.connectivity = false;
      const failedResult = !readResult.success ? readResult : writeResult;
      this.metrics.lastError = failedResult.error || 'Unknown error';
      this.metrics.errorCode = failedResult.errorCode || null;
      this.metrics.errorType = failedResult.errorType || 'unknown';
    }

    this.metrics.errorRate = this.calculateErrorRate();
    this.metrics.status = this.determineHealthStatus();
    this.metrics.checkedAt = new Date();

    this.emit('health-update', this.metrics);

    if (this.metrics.status === 'critical') {
      this.emit('health-critical', this.metrics);
      console.error('🚨 Database health CRITICAL:', this.metrics);
    } else if (this.metrics.status === 'degraded') {
      this.emit('health-degraded', this.metrics);
      console.warn('⚠️ Database health DEGRADED:', this.metrics);
    } else if (this.metrics.status === 'healthy') {
      console.log('✅ Database health check passed');
    }
  }

  private async checkRead(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      const { data, error, status, statusText } = await supabase
        .from('market_data')
        .select('id')
        .limit(1)
        .maybeSingle();

      const latency = performance.now() - startTime;

      if (error) {
        const errorType = this.categorizeError(error.message, status);
        const errorCode = error.code || `HTTP_${status}`;
        console.error('Database read check failed:', {
          message: error.message,
          code: errorCode,
          status,
          statusText,
          type: errorType
        });
        return {
          success: false,
          latency,
          error: error.message,
          errorCode,
          errorType
        };
      }

      return { success: true, latency };
    } catch (error) {
      const latency = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown read error';
      const errorType = this.categorizeError(message, 0);
      console.error('Database read check exception:', error);
      return {
        success: false,
        latency,
        error: message,
        errorCode: 'EXCEPTION',
        errorType
      };
    }
  }

  private async checkWrite(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      const testRow = {
        symbol: '__HEALTH_CHECK__',
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
        data_source: 'health_check',
        is_complete: true,
        completed_at: new Date().toISOString()
      };

      const { error, status, statusText } = await supabase
        .from('market_data')
        .upsert(testRow, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      const latency = performance.now() - startTime;

      if (error) {
        const errorType = this.categorizeError(error.message, status);
        const errorCode = error.code || `HTTP_${status}`;
        console.error('Database write check failed:', {
          message: error.message,
          code: errorCode,
          status,
          statusText,
          type: errorType
        });
        return {
          success: false,
          latency,
          error: error.message,
          errorCode,
          errorType
        };
      }

      await this.cleanupHealthCheck();

      return { success: true, latency };
    } catch (error) {
      const latency = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown write error';
      const errorType = this.categorizeError(message, 0);
      console.error('Database write check exception:', error);
      return {
        success: false,
        latency,
        error: message,
        errorCode: 'EXCEPTION',
        errorType
      };
    }
  }

  private async cleanupHealthCheck(): Promise<void> {
    try {
      await supabase
        .from('market_data')
        .delete()
        .eq('symbol', '__HEALTH_CHECK__');
    } catch (error) {
      console.warn('Failed to cleanup health check data:', error);
    }
  }

  private recordOperation(success: boolean): void {
    this.recentOperations.push(success);
    if (this.recentOperations.length > this.ERROR_RATE_WINDOW) {
      this.recentOperations.shift();
    }
  }

  private calculateErrorRate(): number {
    if (this.recentOperations.length === 0) return 0;

    const failures = this.recentOperations.filter(success => !success).length;
    return (failures / this.recentOperations.length) * 100;
  }

  private determineHealthStatus(): DatabaseHealthStatus {
    if (!this.metrics.connectivity) {
      return 'critical';
    }

    if (this.metrics.consecutiveFailures >= 3) {
      return 'critical';
    }

    if (this.metrics.errorRate > 50) {
      return 'critical';
    }

    if (this.metrics.errorRate > 20 || this.metrics.consecutiveFailures > 0) {
      return 'degraded';
    }

    if (this.metrics.latency && this.metrics.latency > 2000) {
      return 'degraded';
    }

    if (this.metrics.lastSuccessfulWrite && this.metrics.lastSuccessfulRead) {
      return 'healthy';
    }

    return 'unknown';
  }

  recordExternalWriteSuccess(): void {
    this.recordOperation(true);
    this.metrics.lastSuccessfulWrite = new Date();
    this.metrics.consecutiveFailures = 0;
    this.metrics.errorRate = this.calculateErrorRate();
    this.metrics.status = this.determineHealthStatus();
    this.emit('health-update', this.metrics);
  }

  recordExternalWriteFailure(error: string): void {
    this.recordOperation(false);
    this.metrics.consecutiveFailures++;
    this.metrics.lastError = error;
    this.metrics.errorType = this.categorizeError(error, 0);
    this.metrics.errorRate = this.calculateErrorRate();
    this.metrics.status = this.determineHealthStatus();
    this.emit('health-update', this.metrics);
  }

  private categorizeError(errorMessage: string, statusCode?: number): 'network' | 'permission' | 'not_found' | 'server' | 'unknown' {
    const msg = errorMessage.toLowerCase();

    if (statusCode === 404 || msg.includes('not found') || msg.includes('does not exist') || msg.includes('relation') && msg.includes('does not exist')) {
      return 'not_found';
    }

    if (statusCode === 403 || statusCode === 401 || msg.includes('permission') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('rls') || msg.includes('policy')) {
      return 'permission';
    }

    if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('connection') || msg.includes('econnrefused') || msg.includes('cors')) {
      return 'network';
    }

    if (statusCode && statusCode >= 500) {
      return 'server';
    }

    return 'unknown';
  }

  getDetailedErrorMessage(): string {
    if (!this.metrics.lastError) {
      return 'No errors detected';
    }

    const errorType = this.metrics.errorType || 'unknown';
    const errorCode = this.metrics.errorCode || 'UNKNOWN';

    switch (errorType) {
      case 'not_found':
        return `CRITICAL: Database table not found (${errorCode}). Run migrations in Supabase Dashboard → SQL Editor. See PRODUCTION_DATABASE_SETUP.md for detailed instructions.`;
      case 'permission':
        return `Permission denied (${errorCode}). RLS policies may be blocking access. Re-run migration 3 from PRODUCTION_DATABASE_SETUP.md to fix policies.`;
      case 'network':
        return `Network error (${errorCode}). Unable to reach database. Check Supabase project status and internet connection.`;
      case 'server':
        return `Server error (${errorCode}). Supabase database is experiencing issues. Check Supabase status page.`;
      default:
        return `${this.metrics.lastError} (${errorCode})`;
    }
  }

  getActionableMessage(): string {
    if (!this.metrics.lastError) {
      return '';
    }

    const errorType = this.metrics.errorType || 'unknown';

    switch (errorType) {
      case 'not_found':
        return '🔧 Quick Fix: Open Supabase Dashboard → SQL Editor and run the migrations from PRODUCTION_DATABASE_SETUP.md';
      case 'permission':
        return '🔧 Quick Fix: Run migration 3 from PRODUCTION_DATABASE_SETUP.md to update RLS policies';
      case 'network':
        return '🔧 Quick Fix: Verify your Supabase project is active and you have internet connectivity';
      case 'server':
        return '⏳ Wait: Supabase is experiencing issues. Try again in a few minutes.';
      default:
        return '📖 See PRODUCTION_DATABASE_SETUP.md for troubleshooting steps';
    }
  }
}

export const dbHealthMonitor = new DatabaseHealthMonitor();
