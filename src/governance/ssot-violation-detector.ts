/**
 * SSOT VIOLATION DETECTOR
 *
 * PURPOSE: Runtime monitoring to detect architectural violations
 *
 * DETECTS:
 * 1. Multiple services executing the same logic (duplicate authorities)
 * 2. Services bypassing validation gateway
 * 3. Direct database access bypassing coordinators
 * 4. Inconsistent validation rules across services
 *
 * @module SSOTViolationDetector
 */

import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

export interface ViolationReport {
  type: 'duplicate_authority' | 'bypassed_gateway' | 'direct_db_access' | 'inconsistent_rules';
  severity: 'critical' | 'high' | 'medium' | 'low';
  service: string;
  responsibility: string;
  details: string;
  timestamp: Date;
  stackTrace?: string;
}

interface ExecutionLog {
  service: string;
  operation: string;
  timestamp: Date;
  inputs?: Record<string, unknown>;
  output?: unknown;
}

class SSOTViolationDetector {
  private executionLog: ExecutionLog[] = [];
  private violationLog: ViolationReport[] = [];
  private maxLogSize = 1000;

  /**
   * Log a service execution for monitoring
   * Call this from authority services to track who is executing what
   */
  logExecution(
    service: string,
    operation: string,
    inputs?: Record<string, unknown>,
    output?: unknown
  ): void {
    const log: ExecutionLog = {
      service,
      operation,
      timestamp: new Date(),
      inputs,
      output
    };

    this.executionLog.push(log);

    // Keep log size manageable
    if (this.executionLog.length > this.maxLogSize) {
      this.executionLog = this.executionLog.slice(-this.maxLogSize);
    }

    // Check for violations
    this.detectDuplicateAuthority(service, operation);
  }

  /**
   * Detect if multiple services are executing the same operation
   * This indicates duplicate authority (SSOT violation)
   */
  private detectDuplicateAuthority(service: string, operation: string): void {
    const recentWindow = Date.now() - 60000; // Last 60 seconds
    const recentExecutions = this.executionLog.filter(
      log =>
        log.operation === operation &&
        log.timestamp.getTime() > recentWindow
    );

    // Group by service
    const serviceGroups = new Map<string, number>();
    recentExecutions.forEach(log => {
      serviceGroups.set(log.service, (serviceGroups.get(log.service) || 0) + 1);
    });

    // If multiple services are doing the same thing, that's a violation
    if (serviceGroups.size > 1) {
      const services = Array.from(serviceGroups.keys());
      this.reportViolation({
        type: 'duplicate_authority',
        severity: 'high',
        service: services.join(', '),
        responsibility: operation,
        details: `Multiple services executing same operation: ${services.join(', ')}`,
        timestamp: new Date()
      });
    }
  }

  /**
   * Report a validation gateway bypass
   * Call this when a service tries to execute without validation
   */
  reportGatewayBypass(service: string, operation: string, details: string): void {
    this.reportViolation({
      type: 'bypassed_gateway',
      severity: 'critical',
      service,
      responsibility: operation,
      details: `Service attempted to bypass validation gateway: ${details}`,
      timestamp: new Date(),
      stackTrace: new Error().stack
    });
  }

  /**
   * Report direct database access
   * Call this when a service accesses DB without coordinator
   */
  reportDirectDatabaseAccess(
    service: string,
    table: string,
    operation: 'read' | 'write' | 'update' | 'delete'
  ): void {
    this.reportViolation({
      type: 'direct_db_access',
      severity: 'medium',
      service,
      responsibility: `${table} ${operation}`,
      details: `Service directly accessed ${table} table (operation: ${operation})`,
      timestamp: new Date(),
      stackTrace: new Error().stack
    });
  }

  /**
   * Report inconsistent validation rules
   * Call this when different validation thresholds are detected
   */
  reportInconsistentRules(
    service: string,
    rule: string,
    value1: unknown,
    value2: unknown
  ): void {
    this.reportViolation({
      type: 'inconsistent_rules',
      severity: 'high',
      service,
      responsibility: rule,
      details: `Inconsistent validation rule: ${rule} has values ${value1} and ${value2}`,
      timestamp: new Date()
    });
  }

  /**
   * Record violation and optionally persist to database
   */
  private reportViolation(violation: ViolationReport): void {
    this.violationLog.push(violation);

    // Log to console based on severity
    const logLevel = violation.severity === 'critical' ? 'error' :
                     violation.severity === 'high' ? 'warn' : 'info';

    logger[logLevel]('[SSOT Violation Detector] Architectural violation detected', {
      type: violation.type,
      severity: violation.severity,
      service: violation.service,
      responsibility: violation.responsibility,
      details: violation.details
    });

    // Persist critical violations to database
    if (violation.severity === 'critical' || violation.severity === 'high') {
      this.persistViolation(violation).catch(err => {
        logger.error('[SSOT Violation Detector] Failed to persist violation', { error: err });
      });
    }

    // Keep violation log manageable
    if (this.violationLog.length > this.maxLogSize) {
      this.violationLog = this.violationLog.slice(-this.maxLogSize);
    }
  }

  /**
   * Persist violation to database for analysis
   */
  private async persistViolation(violation: ViolationReport): Promise<void> {
    try {
      const { error } = await supabase
        .from('ssot_violations')
        .insert({
          violation_type: violation.type,
          severity: violation.severity,
          service_name: violation.service,
          responsibility: violation.responsibility,
          details: violation.details,
          stack_trace: violation.stackTrace,
          detected_at: violation.timestamp.toISOString()
        });

      if (error) {
        logger.error('[SSOT Violation Detector] Failed to insert violation', { error });
      }
    } catch (err) {
      logger.error('[SSOT Violation Detector] Exception persisting violation', { error: err });
    }
  }

  /**
   * Get recent violations for monitoring dashboard
   */
  getRecentViolations(limit = 50): ViolationReport[] {
    return this.violationLog.slice(-limit);
  }

  /**
   * Get violations by type
   */
  getViolationsByType(type: ViolationReport['type']): ViolationReport[] {
    return this.violationLog.filter(v => v.type === type);
  }

  /**
   * Get violations by service
   */
  getViolationsByService(service: string): ViolationReport[] {
    return this.violationLog.filter(v => v.service.includes(service));
  }

  /**
   * Get violation summary statistics
   */
  getViolationSummary(): {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    byService: Record<string, number>;
  } {
    const summary = {
      total: this.violationLog.length,
      byType: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      byService: {} as Record<string, number>
    };

    this.violationLog.forEach(v => {
      summary.byType[v.type] = (summary.byType[v.type] || 0) + 1;
      summary.bySeverity[v.severity] = (summary.bySeverity[v.severity] || 0) + 1;
      summary.byService[v.service] = (summary.byService[v.service] || 0) + 1;
    });

    return summary;
  }

  /**
   * Clear violation log (for testing)
   */
  clearLog(): void {
    this.violationLog = [];
    this.executionLog = [];
  }

  /**
   * Check if a service is calling the correct authority
   * Returns true if calling through proper channels
   */
  async validateServiceCall(
    callingService: string,
    operation: string,
    expectedAuthority: string
  ): Promise<boolean> {
    // Check execution log to see if authority was called
    const recentWindow = Date.now() - 5000; // Last 5 seconds
    const recentAuthorityCalls = this.executionLog.filter(
      log =>
        log.service === expectedAuthority &&
        log.operation === operation &&
        log.timestamp.getTime() > recentWindow
    );

    if (recentAuthorityCalls.length === 0) {
      this.reportGatewayBypass(
        callingService,
        operation,
        `Expected authority ${expectedAuthority} was not called`
      );
      return false;
    }

    return true;
  }
}

// Export singleton instance
export const ssotViolationDetector = new SSOTViolationDetector();

// Export class for testing
export { SSOTViolationDetector };
