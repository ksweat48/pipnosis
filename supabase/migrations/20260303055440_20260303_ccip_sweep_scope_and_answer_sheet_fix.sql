/*
  # CCIP Governance Audit — Fix sweepContextForStop scope + Answer Sheet data pipeline

  ## Short Title
  Fix Alpha checklist (Q1-Q8) never displaying in Mid-Trade Monitor + sweepContextForStop scope crash

  ## Plain English Summary
  Two bugs are fixed and recorded in the governance change log.

  ### Bug 1 — sweepContextForStop Scope Crash
  `sweepContextForStop` was declared inside an anonymous block but referenced outside it inside the
  `sweepZoneDirective` closure — a JavaScript scope violation causing a ReferenceError for any symbol
  with a valid Omega-8 sweep context (e.g. US30, NAS100).
  Fix: Declaration moved to function scope; assignment unchanged.

  ### Bug 2 — Alpha Q1-Q8 Answer Sheet Never Displayed
  Alpha's LLM always outputs `answer_sheet` (Q1-Q8 checklist per system prompt), but `parseDecision()`
  never extracted it from `parsed`. `decision.answer_sheet` was always undefined, executor fallback
  stored plain text, service parse returned null, AlphaAnswerSheet rendered nothing.
  Fix: `answer_sheet` extracted + validated in `parseDecision()`, added to return value.

  ## Changed Files
  - src/brains/coordinator-alpha.ts

  ## Tables Affected
  - goal_session_trades.alpha_reasoning_snapshot (existing TEXT column, no schema change)

  ## SSOT / CCIP Compliance
  entity_type = 'alpha_coordinator' — the authoritative coordinator for all Alpha LLM decisions.
  operation = 'ccip_migration_applied' — standard operation for applied fixes.
  No new authorities created. All downstream owners (executor, service, UI) unchanged.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  reason,
  metadata,
  created_at
)
VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  'Fix 1: sweepContextForStop JS scope violation (ReferenceError on US30/NAS100). Fix 2: Alpha Q1-Q8 answer_sheet never extracted from parseDecision — checklist never displayed in Mid-Trade Monitor.',
  jsonb_build_object(
    'fix_1', jsonb_build_object(
      'file', 'src/brains/coordinator-alpha.ts',
      'type', 'scope_bug',
      'description', 'sweepContextForStop declaration moved from anonymous block to function scope',
      'symbols_affected', jsonb_build_array('US30', 'NAS100', 'any symbol with Omega-8 sweep context')
    ),
    'fix_2', jsonb_build_object(
      'file', 'src/brains/coordinator-alpha.ts',
      'type', 'data_pipeline_gap',
      'description', 'answer_sheet extracted and validated from parsed LLM response; returned on AlphaDecision',
      'downstream', 'alpha-trade-executor saves composite JSON; mid-trade-monitor-service parses it; AlphaAnswerSheet renders Q1-Q8'
    ),
    'ssot_compliance', 'All responsibilities remain with their existing single owners — no new authorities created',
    'rls_changes', 'none',
    'schema_changes', 'none',
    'ccip_phase', 'post-deploy-fix'
  ),
  now()
);
