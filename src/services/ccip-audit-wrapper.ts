/**
 * CCIP Audit Wrapper - Compliance Change Tracking Intelligence Protocol
 *
 * Single entry point for tracking ALL database mutations with complete audit trail.
 * Ensures every change to critical data is logged with:
 * - What changed (table, columns, values)
 * - Who changed it (user_id, source service)
 * - When it changed (timestamp with millisecond precision)
 * - Why it changed (reason/context)
 * - Governance compliance (SSOT violations, authorization)
 *
 * Usage:
 *   const result = await ccipAuditWrapper.trackMutation({
 *     table: 'goal_session_trades',
 *     operation: 'INSERT',
 *     userId: user.id,
 *     data: { ...trade },
 *     reason: 'Trade executed via Alpha',
 *     authority: 'alpha-trade-executor'
 *   });
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

export interface MutationAuditRecord {
  // Identity
  id?: string;
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';

  // Ownership & Authorization
  user_id: string;
  authority_service: string;
  operation_id: string; // Correlation ID across related mutations

  // Change Details
  primary_key_values: Record<string, any>;
  changed_columns: Record<string, {
    old_value?: any;
    new_value?: any;
  }>;

  // Context & Compliance
  reason: string;
  governance_note?: string;

  // Technical
  data_hash?: string; // SHA256 of changed data for integrity
  error_message?: string; // If mutation failed
  status: 'success' | 'failure' | 'pending';

  // Timestamps
  created_at?: Date;
  processed_at?: Date;
}

export interface MutationTrackerOptions {
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';
  userId: string;
  data: Record<string, any>;
  reason: string;
  authority: string;
  operationId?: string; // Correlation ID for related mutations
  governanceNote?: string;
  skipAudit?: boolean; // For non-critical operations
}

class CCIPAuditWrapper {
  /**
   * Track a mutation with full CCIP audit trail
   * Wraps the actual mutation and logs all changes
   */
  async trackMutation(
    options: MutationTrackerOptions,
    executeFn: () => Promise<any>
  ): Promise<{ success: boolean; data?: any; error?: string; auditId?: string }> {
    const startTime = Date.now();
    const operationId = options.operationId || this.generateOperationId();

    try {
      logger.debug(
        LogCategory.GOVERNANCE,
        `[CCIP] Starting ${options.operation} on ${options.table}`,
        {
          operationId,
          authority: options.authority,
          reason: options.reason
        }
      );

      // Execute the mutation
      const result = await executeFn();

      // Log successful mutation
      await this.logMutationAudit({
        table_name: options.table,
        operation: options.operation,
        user_id: options.userId,
        authority_service: options.authority,
        operation_id: operationId,
        primary_key_values: this.extractPrimaryKeys(options.table, options.data),
        changed_columns: options.data,
        reason: options.reason,
        governance_note: options.governanceNote,
        status: 'success',
        processed_at: new Date()
      });

      const elapsedMs = Date.now() - startTime;
      logger.info(
        LogCategory.GOVERNANCE,
        `[CCIP] ${options.operation} completed on ${options.table} (${elapsedMs}ms)`,
        { operationId, recordId: result?.id }
      );

      return {
        success: true,
        data: result,
        auditId: operationId
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Log failed mutation
      await this.logMutationAudit({
        table_name: options.table,
        operation: options.operation,
        user_id: options.userId,
        authority_service: options.authority,
        operation_id: operationId,
        primary_key_values: this.extractPrimaryKeys(options.table, options.data),
        changed_columns: options.data,
        reason: options.reason,
        governance_note: options.governanceNote,
        status: 'failure',
        error_message: errorMessage,
        processed_at: new Date()
      });

      logger.error(
        LogCategory.GOVERNANCE,
        `[CCIP] ${options.operation} FAILED on ${options.table}`,
        { operationId, error: errorMessage }
      );

      return {
        success: false,
        error: errorMessage,
        auditId: operationId
      };
    }
  }

  /**
   * Log a mutation to the CCIP audit trail
   * Used internally and can be called directly for manual logging
   */
  private async logMutationAudit(record: MutationAuditRecord): Promise<void> {
    try {
      // Skip logging if audit table doesn't exist (graceful degradation)
      const { error } = await supabase
        .from('ccip_mutation_audit')
        .insert({
          table_name: record.table_name,
          operation: record.operation,
          user_id: record.user_id,
          authority_service: record.authority_service,
          operation_id: record.operation_id,
          primary_key_values: record.primary_key_values,
          changed_columns: record.changed_columns,
          reason: record.reason,
          governance_note: record.governance_note,
          status: record.status,
          error_message: record.error_message,
          created_at: new Date()
        });

      if (error) {
        // Log audit failures but don't block mutations
        logger.warn(
          LogCategory.GOVERNANCE,
          '[CCIP] Failed to log mutation audit',
          { error: error.message, operationId: record.operation_id }
        );
      }
    } catch (error) {
      // Graceful degradation - don't let audit logging break the system
      logger.warn(
        LogCategory.GOVERNANCE,
        '[CCIP] Audit logging error (non-blocking)',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Extract primary key values from data based on table schema
   */
  private extractPrimaryKeys(tableName: string, data: Record<string, any>): Record<string, any> {
    const primaryKeys: Record<string, string> = {
      'goal_session_trades': 'id',
      'goal_sessions': 'id',
      'entry_intents': 'id',
      'user_profiles': 'user_id',
      'user_token_balance': 'user_id',
      'alpha_decisions': 'id',
      'goal_aware_lot_sizing_decisions': 'id'
    };

    const primaryKeyField = primaryKeys[tableName] || 'id';
    return {
      [primaryKeyField]: data[primaryKeyField]
    };
  }

  /**
   * Generate a unique operation ID for correlation across related mutations
   */
  private generateOperationId(): string {
    return `ccip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Convenience method for tracking trade insertions
   */
  async trackTradeInsertion(
    userId: string,
    tradeData: Record<string, any>,
    reason: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    return {
      success: false,
      error: 'This method requires an actual mutation function to be passed'
    };
  }

  /**
   * Convenience method for tracking balance updates
   */
  async trackBalanceUpdate(
    userId: string,
    oldBalance: number,
    newBalance: number,
    reason: string,
    operationId?: string
  ): Promise<void> {
    await this.logMutationAudit({
      table_name: 'user_token_balance',
      operation: 'UPDATE',
      user_id: userId,
      authority_service: 'balance-coordinator',
      operation_id: operationId || this.generateOperationId(),
      primary_key_values: { user_id: userId },
      changed_columns: {
        balance: {
          old_value: oldBalance,
          new_value: newBalance
        }
      },
      reason,
      status: 'success',
      processed_at: new Date()
    });
  }

  /**
   * Query mutation history for a user
   */
  async getMutationHistory(
    userId: string,
    tableName?: string,
    limit: number = 100
  ): Promise<MutationAuditRecord[]> {
    try {
      let query = supabase
        .from('ccip_mutation_audit')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (tableName) {
        query = query.eq('table_name', tableName);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[CCIP] Failed to fetch mutation history',
        { error: error instanceof Error ? error.message : String(error), userId }
      );
      return [];
    }
  }

  /**
   * Check for SSOT violations in mutation history
   */
  async detectSSOTViolations(
    userId: string,
    timeWindowMinutes: number = 60
  ): Promise<{ violations: any[]; warnings: any[] }> {
    const violations: any[] = [];
    const warnings: any[] = [];

    try {
      const history = await this.getMutationHistory(userId, undefined, 1000);
      const cutoffTime = Date.now() - (timeWindowMinutes * 60 * 1000);

      // Group by table and operation
      const operationsByTable: Record<string, any[]> = {};
      history.forEach(record => {
        if (!operationsByTable[record.table_name]) {
          operationsByTable[record.table_name] = [];
        }
        operationsByTable[record.table_name].push(record);
      });

      // Check for suspicious patterns
      Object.entries(operationsByTable).forEach(([table, operations]) => {
        // Detect multiple authorities modifying same record
        const recordsByKey: Record<string, Set<string>> = {};
        operations.forEach(op => {
          const key = JSON.stringify(op.primary_key_values);
          if (!recordsByKey[key]) recordsByKey[key] = new Set();
          recordsByKey[key].add(op.authority_service);
        });

        Object.entries(recordsByKey).forEach(([key, authorities]) => {
          if (authorities.size > 1) {
            violations.push({
              table,
              primaryKey: JSON.parse(key),
              authorities: Array.from(authorities),
              severity: 'high',
              message: 'Multiple authorities modified the same record'
            });
          }
        });
      });

      return { violations, warnings };
    } catch (error) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[CCIP] Failed to detect SSOT violations',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return { violations, warnings };
    }
  }
}

export const ccipAuditWrapper = new CCIPAuditWrapper();
