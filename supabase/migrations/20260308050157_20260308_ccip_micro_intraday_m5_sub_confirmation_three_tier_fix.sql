/*
  # CCIP 2026-03-08: MICRO_INTRADAY Three-Tier Confluence Architecture Fix

  ## Summary
  Closes the architectural gap where MICRO_INTRADAY sessions had a system prompt
  requiring M5 candle close confirmation (alpha-identity.ts line 685) but the
  coordinator (coordinator-alpha.ts) never fetched or passed M5 candle data to
  the LLM. The LLM was confabulating M5 structure using only M15 primary candles.

  ## Root Cause
  The three-tier confluence design was correct in the system prompt but incomplete
  in the data pipeline:
  - SCALP:          M5 (primary) + M1 (sub-conf) + M15/H1 (advisory) — COMPLETE
  - MICRO_INTRADAY: M15 (primary) + M5 (sub-conf) + H1 (controlling) — INCOMPLETE (M5 missing)
  - INTRADAY:       H1 (primary) + M15 (sub-conf) + H4 (controlling) — COMPLETE

  ## Fix Applied
  Added m5SubConfirmationPrompt block in coordinator-alpha.ts:
  - Fetches 10 M5 candles for MICRO_INTRADAY sessions only
  - Computes M5 BOS and sweep-wick structural evidence (mirrors HTF pattern)
  - Injects labeled M5 candle data into LLM prompt between HTF block and M15 reference
  - Non-blocking: unavailable M5 data shows governance warning, forces wait_pullback

  ## SSOT Compliance
  - Single data-fetch authority: MarketDataService (unchanged)
  - Single prompt-assembly authority: coordinator-alpha.ts (unchanged)
  - No system prompt changes needed (alpha-identity.ts already correct)
  - No new database tables required

  ## Three-Tier Architecture Now Complete
  All three styles have proper primary + sub-confirmation + controlling TF data.
*/

DO $$
BEGIN
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    reason,
    metadata
  )
  VALUES (
    'alpha_coordinator',
    gen_random_uuid(),
    'ccip_migration_applied',
    'MICRO_INTRADAY three-tier confluence: added M5 sub-confirmation candle block (10 candles) to LLM prompt. Closes gap where system prompt required M5 close confirmation but no M5 data was fetched.',
    jsonb_build_object(
      'ccip_id', 'CCIP-2026-03-08-MICRO-INTRADAY-M5-SUB-CONF',
      'affected_style', 'MICRO_INTRADAY',
      'data_added', 'M5 candles (10) + BOS/sweep-wick evidence',
      'prompt_position', 'after htfCandlePrompt (H1), before m15ReferencePrompt (SCALP-only)',
      'blocking', false,
      'ssot_authority', 'MarketDataService + coordinator-alpha.ts',
      'system_prompt_changed', false,
      'three_tier_now_complete', true,
      'styles_status', jsonb_build_object(
        'SCALP', 'COMPLETE: M5 primary + M1 sub-conf + M15/H1 advisory',
        'MICRO_INTRADAY', 'NOW COMPLETE: M15 primary + M5 sub-conf + H1 controlling',
        'INTRADAY', 'COMPLETE: H1 primary + M15 sub-conf + H4 controlling'
      )
    )
  );
END $$;
