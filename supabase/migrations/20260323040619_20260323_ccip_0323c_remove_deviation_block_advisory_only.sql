/*
  # CCIP-2026-0323C: Entry Deviation — Advisory-Only (Permanent)

  ## Summary
  Removes the hard-cancel ENTRY_DEVIATION_BLOCK from Alpha's trade execution path.
  The max_entry_deviation_pips field is now advisory-only: observed and audited but
  NEVER used to cancel a trade.

  ## What Changed
  - alpha-trade-executor.ts: Removed the `if (deviationReasoningPips > maxAllowedPips)` 
    hard-cancel block. All deviations now result in SL/TP shift only (action_taken = 'SHIFTED').
  - alpha-identity.ts: Updated max_entry_deviation_pips JSDoc and prompt schema language 
    from "this is law: NO trade is placed" to "advisory — system will NOT cancel the trade."
  - CCIP change log updated in alpha-identity.ts.

  ## Rationale
  The SL/TP shift already preserves Alpha's structural validity at the actual fill price.
  The hard cancel was redundant — it blocked valid Alpha setups without providing any 
  additional protection. Alpha has sole execution authority. Deviation governance belongs
  in the answer_sheet audit trail, not as an execution cancellation gate.

  ## Governance
  - SSOT owner: alpha-identity.ts
  - Enforcement owner: alpha-trade-executor.ts
  - Audit table: entry_price_deviation_events (action_taken is always 'SHIFTED' now)
  - No hard blocks — only SL/TP geometry preservation
*/

INSERT INTO ccip_governance_audit (
  change_id,
  change_date,
  category,
  title,
  description,
  files_modified,
  ssot_owner
)
VALUES (
  'CCIP-2026-0323C',
  now()::date,
  'alpha_execution_governance',
  'Entry Deviation — Advisory-Only (Permanent)',
  'Removed ENTRY_DEVIATION_BLOCK hard cancel from alpha-trade-executor.ts. max_entry_deviation_pips is now advisory-only: observed, audited in entry_price_deviation_events, but NEVER a trade cancellation gate. SL/TP shift preserves Alpha risk geometry at actual fill. Prompt schema updated: field is advisory, system will NOT cancel the trade. CCIP change log updated in alpha-identity.ts. Rationale: SL/TP shift already solves structural validity. Hard cancel was redundant and blocked valid Alpha setups. Alpha has sole execution authority.',
  ARRAY['src/services/alpha-trade-executor.ts', 'src/config/alpha-identity.ts'],
  'alpha-identity.ts'
)
ON CONFLICT (change_id) DO UPDATE SET
  change_date = EXCLUDED.change_date,
  description = EXCLUDED.description,
  files_modified = EXCLUDED.files_modified;
