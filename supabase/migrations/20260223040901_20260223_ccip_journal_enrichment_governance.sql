/*
  # CCIP Journal Enrichment — Governance Audit Record

  ## Title
  Journal Enrichment: Surface Stored Trade Data in UI

  ## Summary
  This migration records the CCIP governance entry for the journal enrichment
  change set. No DDL changes are required — all data being surfaced already
  exists in ai_trade_journal (entry_price, stop_loss, take_profit, exit_price,
  exit_time, omega8_* columns, omega9_* columns). The change is purely
  presentational and narrative-text quality improvements.

  ## Changes Made
  1. **AITradeJournal.tsx** — Renderer upgraded to display:
     - Trade details row: entry price, stop loss, take profit, calculated R:R
     - Exit details row: exit price, pips moved, hold duration
     - Omega Council section: Omega8 bias + confidence, Omega9 pass/fail
     - Session derived from entry_time UTC hour (Tokyo/London/New York)
  2. **position-service.ts** — Fallback narrative text enriched:
     - llmReasoning fallback: includes direction, pattern, conviction %, session
     - marketRead fallback: includes entry price, derived session name
     - expectedOutcome fallback: includes pip distances and R:R ratio
  3. **post-trade-analyzer.ts** — Progressive narrative enriched:
     - "What Actually Happened" now includes pips moved and hold duration
     - Session name appended to execution quality log

  ## SSOT Compliance
  - ONE place generates fallback text: position-service.ts (logTradeEntry call)
  - ONE place generates retroactive fallback: post-trade-analyzer.ts
    (createRetroactiveJournalEntry)
  - ONE place renders journal UI: AITradeJournal.tsx
  - No business logic moved between files
  - No new DB columns — uses only pre-existing stored fields

  ## Files Modified
  - src/services/position-service.ts
  - src/services/post-trade-analyzer.ts
  - src/components/AITradeJournal.tsx

  ## Affected Responsibility Owners
  - Journal display: AITradeJournal.tsx (display-only, no logic)
  - Narrative generation at open: position-service.ts openPosition()
  - Narrative generation at close: post-trade-analyzer.ts buildProgressiveNarrative()
  - Retroactive entry creation: post-trade-analyzer.ts createRetroactiveJournalEntry()

  ## Verification Criteria
  1. Journal cards show entry/exit price, R:R, and hold time when available
  2. Omega Council section visible on cards that have omega8_confidence > 0
  3. Fallback text no longer reads "Entry conditions were not captured at open time"
  4. Build passes with zero type errors
*/

INSERT INTO governance_change_log (
  id,
  entity_type,
  entity_id,
  operation,
  reason,
  metadata,
  created_at
) VALUES (
  gen_random_uuid(),
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  'Journal displayed only 3 metadata fields (Pattern, Conviction, Rank) while ai_trade_journal already stores entry_price, stop_loss, take_profit, exit_price, exit_time, omega8_* and omega9_* fields. Generic fallback strings ("Entry conditions were not captured at open time", "Target levels not recorded") provided zero trader value. This change surfaces existing stored data and replaces fallback strings with computed deterministic text from always-available trade parameters. Zero DB schema changes — display layer and narrative text only.',
  jsonb_build_object(
    'title', 'Journal Enrichment: Surface Stored Trade Data in UI',
    'ccip_tracking_id', 'CCIP-2026-02-23-JOURNAL-ENRICHMENT',
    'date', '2026-02-23',
    'severity', 'medium',
    'ssot_compliance', true,
    'db_schema_changes', false,
    'files_modified', jsonb_build_array(
      'src/services/position-service.ts',
      'src/services/post-trade-analyzer.ts',
      'src/components/AITradeJournal.tsx'
    ),
    'responsibility_owners', jsonb_build_object(
      'journal_display', 'src/components/AITradeJournal.tsx',
      'narrative_at_open', 'src/services/position-service.ts openPosition()',
      'narrative_at_close', 'src/services/post-trade-analyzer.ts buildProgressiveNarrative()',
      'retroactive_entry', 'src/services/post-trade-analyzer.ts createRetroactiveJournalEntry()'
    ),
    'anti_regression', 'All existing journal fields continue to render. Omega section only renders when omega8_confidence is present. Exit details section only renders when exit_time is set. No data removed from display.',
    'verification', jsonb_build_array(
      'Journal cards show entry/exit price, R:R, hold time when available',
      'Omega Council section visible when omega8_confidence > 0',
      'Fallback text no longer reads generic placeholder strings',
      'Build passes with zero type errors'
    )
  ),
  now()
);
