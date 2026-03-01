/*
  # Journal Display Governance — CCIP 2026-03-01

  ## Title
  Journal Display Quality Overhaul — Governance Tracking

  ## Summary
  Tracks the CCIP-compliant changes to the journal display layer. No destructive
  operations. No schema changes to existing tables. This migration documents the
  governance intent and logs the change for audit compliance.

  ## Changes Documented
  1. getJournalEntries now enriches entries with goal_sessions.trade_style and
     goal_sessions.dollar_risk via session_id join (read-only, client-side query change).
  2. Retroactive journal entries (created by GoalAchievementCoordinator when no
     pre-existing row exists) now include richer alpha-sourced narratives queried
     from goal_session_scan_results.
  3. AITradeJournal.tsx display changes:
     - Trade style badge (Scalp / Micro / Intraday) shown in card header
     - R:R label changed to "Reward : Risk" with value shown as "{rr}:1"
     - TP exit display respects per-style rules (Scalp = 1 TP, Micro/Intraday = 2 TPs)
     - Risk-taken line shows "Risked $X → Returned $Y" replacing "Goal reached"
     - Pattern cell falls back to style-based label instead of "Goal Achievement"
     - Narrative quality improved using alpha scan context

  ## SSOT Compliance
  - ai_trade_journal remains the single source of truth for journal data
  - goal_sessions remains the single source of truth for trade_style and dollar_risk
  - goal_session_scan_results remains the SSOT for alpha scan reasoning
  - No cross-table writes introduced

  ## Governance Authority
  - Journal display: AITradeJournal.tsx (UI authority)
  - Journal data fetch: LLMReasoningLogger.getJournalEntries (query authority)
  - Retroactive narrative: GoalAchievementCoordinator.stampGoalAchievementOnJournal (write authority)
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
SELECT
  'system_configuration',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"journal_display": "minimal_templates", "rr_format": "1:X", "tp_display": "single", "pattern": "Goal Achievement hardcoded", "narrative_source": "template_only"}'::jsonb,
  '{"journal_display": "enriched_alpha_context", "rr_format": "X:1", "tp_display": "per_style_scalp_1tp_micro_intraday_2tp", "pattern": "alpha_scan_derived_with_style_fallback", "narrative_source": "alpha_scan_results_enriched", "trade_style_badge": true, "risk_return_line": true}'::jsonb,
  'CCIP 2026-03-01: Journal display quality overhaul — surface trade style, fix R:R direction, TP-per-style display, richer alpha-sourced narratives, replace Goal Achievement pattern label.',
  '{"ccip_ref": "20260301_journal_display_governance", "files_changed": ["src/components/AITradeJournal.tsx", "src/services/llm-reasoning-logger.ts", "src/services/coordinators/goal-achievement-coordinator.ts"], "ssot_violations_fixed": ["pattern_identified_hardcoded_goal_achievement", "rr_direction_ambiguous", "narrative_template_no_alpha_context", "trade_style_not_surfaced_in_ui"]}'::jsonb
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'governance_change_log');
