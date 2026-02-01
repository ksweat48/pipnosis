/**
 * Alpha Execution Transparency Service (CCIP Compliant)
 *
 * Purpose:
 * - Non-breaking audit logging of Alpha decisions
 * - Tracks execution blocks without mutating decision logic
 * - Provides diagnostics for why trades don't execute
 * - Supports intelligent trade degradation visibility
 * - SSOT: Single source of truth for execution audit trail
 *
 * Critical Principle:
 * - THIS SERVICE LOGS DECISIONS, IT DOESN'T ALTER THEM
 * - Writes are async/non-blocking to avoid latency injection
 * - All failures are silent (write failures don't break execution)
 */

import { supabase } from '../lib/supabase';
import { supabaseAdmin } from '../lib/supabase-admin';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { TradeContext } from '../utils/tradeMath';

interface ExecutionBlockLog {
  userId: string;
  sessionId?: string;
  auditId: string;
  blockCategory:
    | 'FRESHNESS_GATE'
    | 'OMEGA_VALIDATION'
    | 'SSOT_VALIDATION'
    | 'PCVL_VALIDATION'
    | 'RISK_MANAGER'
    | 'GOVERNANCE_LIMIT'
    | 'ENTRY_COORDINATOR'
    | 'CIRCUIT_BREAKER'
    | 'GOAL_FEASIBILITY'
    | 'SAFETY_ENFORCEMENT';
  specificReason: string;
  severity: 'FATAL' | 'WARNING' | 'ADVISORY';
  blockingValue?: string;
  thresholdValue?: string;
  recoverable: boolean;
  recoveryAction?: string;
}

interface ExecutionAuditLog {
  userId: string;
  sessionId?: string;
  decisionId?: string;
  action: 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE';
  symbol?: string;
  confidence?: number;
  regimeOracleConfidence?: number;
  adversarialScore?: number;
  omegaCouncilVotes?: Record<string, any>;
  executionAttempted?: boolean;
  executionSuccess?: boolean;
  executionBlockedReason?: string;
  marketPrice?: number;
  signalPrice?: number;
  priceDriftPips?: number;
  signalTimestamp?: string;
}

interface DiagnosticSnapshot {
  userId: string;
  sessionId?: string;
  auditId: string;
  snapshotAgeSeconds?: number;
  snapshotValid?: boolean;
  priceDataFreshness?: Record<string, any>;
  omegaPipelineHealth?: Record<string, any>;
  entryIntentStatus?: string;
  entryIntentConditions?: Record<string, any>;
  concurrentTradesOpen?: number;
  concurrentTradesMax?: number;
  marginAvailable?: number;
  marginRequired?: number;
  thesisId?: string;
  thesisAgeSeconds?: number;
  thesisValid?: boolean;
  executionChain?: Array<{
    stage: string;
    passed: boolean;
    reason?: string;
    timestamp: string;
  }>;
}

/**
 * Record Alpha's decision in audit trail
 * Non-blocking, async write
 */
export async function recordAlphaDecision(
  userId: string,
  decision: AlphaDecision,
  context: {
    sessionId?: string;
    tradeContext?: TradeContext;
    marketPrice?: number;
    signalPrice?: number;
    regimeConfidence?: number;
    adversarialScore?: number;
    omegaVotes?: Record<string, any>;
  }
): Promise<string> {
  const auditId = crypto.randomUUID();

  const auditLog: ExecutionAuditLog = {
    userId,
    sessionId: context.sessionId,
    decisionId: decision.id,
    action: decision.action,
    symbol: decision.symbol,
    confidence: decision.confidence,
    regimeOracleConfidence: context.regimeConfidence,
    adversarialScore: context.adversarialScore,
    omegaCouncilVotes: context.omegaVotes,
    marketPrice: context.marketPrice,
    signalPrice: context.signalPrice,
    priceDriftPips: context.marketPrice
      ? Math.abs(context.marketPrice - (context.signalPrice || context.marketPrice)) * 10000
      : undefined,
    signalTimestamp: new Date().toISOString(),
  };

  // Fire and forget: don't await, don't block execution
  supabaseAdmin
    .from('alpha_execution_audit')
    .insert([auditLog])
    .then(() => {
      // Success - audit logged
    })
    .catch((err) => {
      // Silent failure - execution must not be affected by logging failures
      console.warn('[AlphaExecutionTransparency] Failed to log decision:', err.message);
    });

  return auditId;
}

/**
 * Record why a trade was blocked
 * Links to execution audit record
 * Non-blocking, async write
 */
export async function recordExecutionBlock(
  userId: string,
  auditId: string,
  block: ExecutionBlockLog
): Promise<void> {
  const blockLog = {
    user_id: userId,
    session_id: block.sessionId,
    audit_id: auditId,
    block_category: block.blockCategory,
    specific_reason: block.specificReason,
    severity: block.severity,
    blocking_value: block.blockingValue,
    threshold_value: block.thresholdValue,
    recoverable: block.recoverable,
    recovery_action: block.recoveryAction,
  };

  // Fire and forget
  supabaseAdmin
    .from('execution_block_reasons')
    .insert([blockLog])
    .then(() => {
      // Success
    })
    .catch((err) => {
      // Silent failure
      console.warn('[AlphaExecutionTransparency] Failed to log block:', err.message);
    });
}

/**
 * Record full diagnostic snapshot for troubleshooting
 * Captures entire execution context at moment of decision
 * Non-blocking, async write
 */
export async function recordDiagnosticSnapshot(
  userId: string,
  diagnostic: DiagnosticSnapshot
): Promise<void> {
  const snapshot = {
    user_id: userId,
    session_id: diagnostic.sessionId,
    audit_id: diagnostic.auditId,
    snapshot_age_seconds: diagnostic.snapshotAgeSeconds,
    snapshot_valid: diagnostic.snapshotValid,
    price_data_freshness: diagnostic.priceDataFreshness,
    omega_pipeline_health: diagnostic.omegaPipelineHealth,
    entry_intent_status: diagnostic.entryIntentStatus,
    entry_intent_conditions: diagnostic.entryIntentConditions,
    concurrent_trades_open: diagnostic.concurrentTradesOpen,
    concurrent_trades_max: diagnostic.concurrentTradesMax,
    margin_available: diagnostic.marginAvailable,
    margin_required: diagnostic.marginRequired,
    thesis_id: diagnostic.thesisId,
    thesis_age_seconds: diagnostic.thesisAgeSeconds,
    thesis_valid: diagnostic.thesisValid,
    execution_chain: diagnostic.executionChain,
  };

  // Fire and forget
  supabaseAdmin
    .from('alpha_decision_diagnostics')
    .insert([snapshot])
    .then(() => {
      // Success
    })
    .catch((err) => {
      // Silent failure
      console.warn('[AlphaExecutionTransparency] Failed to log diagnostics:', err.message);
    });
}

/**
 * Query execution audit for diagnostics
 * Provides visibility into decision flow without breaking execution
 */
export async function getExecutionAudit(
  userId: string,
  sessionId: string,
  limit: number = 50
): Promise<
  Array<{
    id: string;
    action: string;
    symbol: string;
    confidence: number;
    blocked: boolean;
    blockReasons: ExecutionBlockLog[];
    createdAt: string;
  }>
> {
  try {
    const { data: audits, error: auditError } = await supabase
      .from('alpha_execution_audit')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (auditError) throw auditError;

    // Get block reasons for each audit
    const auditWithBlocks = await Promise.all(
      (audits || []).map(async (audit) => {
        const { data: blocks } = await supabase
          .from('execution_block_reasons')
          .select('*')
          .eq('audit_id', audit.id);

        return {
          id: audit.id,
          action: audit.action,
          symbol: audit.symbol,
          confidence: audit.confidence,
          blocked: (blocks || []).length > 0,
          blockReasons: blocks || [],
          createdAt: audit.created_at,
        };
      })
    );

    return auditWithBlocks;
  } catch (err) {
    console.error('[AlphaExecutionTransparency] Failed to query audit:', err);
    return [];
  }
}

/**
 * Get diagnostic snapshot for latest failed execution
 * Provides root cause analysis
 */
export async function getDiagnosticSnapshot(
  userId: string,
  sessionId: string
): Promise<DiagnosticSnapshot | null> {
  try {
    const { data, error } = await supabase
      .from('alpha_decision_diagnostics')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[AlphaExecutionTransparency] Failed to get diagnostic:', err);
    return null;
  }
}

/**
 * Summary: Why aren't trades executing?
 * Non-invasive diagnosis of the execution pipeline
 */
export async function getExecutionBlockSummary(
  userId: string,
  sessionId: string
): Promise<{
  totalDecisions: number;
  successfulExecutions: number;
  blockedDecisions: number;
  topBlockReasons: Array<{ reason: string; count: number; severity: string }>;
  recoverable: number;
  lastBlockedAt: string | null;
}> {
  try {
    // Get all audits for this session
    const { data: audits } = await supabase
      .from('alpha_execution_audit')
      .select('id, created_at, execution_success')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!audits || audits.length === 0) {
      return {
        totalDecisions: 0,
        successfulExecutions: 0,
        blockedDecisions: 0,
        topBlockReasons: [],
        recoverable: 0,
        lastBlockedAt: null,
      };
    }

    // Get all blocks
    const auditIds = audits.map((a) => a.id);
    const { data: blocks } = await supabase
      .from('execution_block_reasons')
      .select('specific_reason, severity, recoverable')
      .in('audit_id', auditIds);

    const blockCounts: Record<string, { count: number; severity: string; recoverable: number }> = {};
    let totalRecoverable = 0;

    (blocks || []).forEach((block) => {
      if (!blockCounts[block.specific_reason]) {
        blockCounts[block.specific_reason] = { count: 0, severity: block.severity, recoverable: 0 };
      }
      blockCounts[block.specific_reason].count++;
      if (block.recoverable) {
        blockCounts[block.specific_reason].recoverable++;
        totalRecoverable++;
      }
    });

    const topReasons = Object.entries(blockCounts)
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        severity: data.severity,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const lastBlocked = audits.find((a) => a.execution_success === false);

    return {
      totalDecisions: audits.length,
      successfulExecutions: audits.filter((a) => a.execution_success === true).length,
      blockedDecisions: (blocks || []).length,
      topBlockReasons: topReasons,
      recoverable: totalRecoverable,
      lastBlockedAt: lastBlocked?.created_at || null,
    };
  } catch (err) {
    console.error('[AlphaExecutionTransparency] Failed to get summary:', err);
    return {
      totalDecisions: 0,
      successfulExecutions: 0,
      blockedDecisions: 0,
      topBlockReasons: [],
      recoverable: 0,
      lastBlockedAt: null,
    };
  }
}
