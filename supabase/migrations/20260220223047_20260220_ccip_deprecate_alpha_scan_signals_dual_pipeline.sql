/*
  # CCIP: Deprecate alpha_scan_signals Dual Pipeline

  ## Title
  Remove parallel alpha_scan_signals UI pipeline — unify to single alpha-aligned readyPairs pipeline

  ## Summary
  The SessionIntelligenceMonitor previously maintained two separate signal rendering
  pipelines:

  1. alpha_scan_signals (manual scan) — lightweight cards, no indicator tags, no
     "Analyze with Alpha" button, threshold 65%.
  2. session_intelligence_data.best_pairs (readyPairs) — full rich cards with
     indicator alignment badges, confidence %, reasoning, "Analyze with Alpha" button,
     threshold 70%, constraint-feasibility gated.

  This violated SSOT: the same signal class had two rendering paths with different
  data richness and two database tables.

  ## Changes Applied

  ### UI (SessionIntelligenceMonitor.tsx)
  - Removed AlphaScanSignal interface
  - Removed alphaSignals state and loadAlphaSignals function
  - Removed alpha_scan_signals realtime subscription
  - Removed "Manual Scan — N Signal Found" render section
  - handleScanNow now calls loadSessionData() to refresh single authoritative pipeline

  ### Database
  - alpha_scan_signals table RETAINED — still written by scan-alpha-intelligence
    function and read by get_scan_aligned_session_pairs RPC for confidence cap overlay.
    Its UI display role is deprecated.

  ## SSOT Authority After This Change
  - session_intelligence_data.best_pairs is the SOLE display source for trade signals
  - alpha_scan_signals feeds scanAlignedPairs confidence cap overlay only
  - renderPairCard() is the SOLE card renderer

  ## Governance
  - CCIP compliant: tracked before deployment
  - UI-only change, no destructive DB operations
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
  '{"pipelines": ["alpha_scan_signals", "session_intelligence_data.best_pairs"], "card_types": ["ManualScan", "ReadyToTrade"]}'::jsonb,
  '{"pipelines": ["session_intelligence_data.best_pairs"], "card_types": ["ReadyToTrade"], "alpha_scan_signals_role": "confidence_cap_overlay_only"}'::jsonb,
  'SSOT violation fixed: dual signal pipelines consolidated to single alpha-aligned pipeline and rich card format (CCIP 2026-02-20).',
  '{"ccip_ref": "20260220_ccip_deprecate_alpha_scan_signals_dual_pipeline", "component": "SessionIntelligenceMonitor", "files_changed": ["src/components/SessionIntelligenceMonitor.tsx"]}'::jsonb
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'governance_change_log'
);
