/*
  # CCIP Fix: Alpha JSON Output Schema Completion — All Trade Styles

  ## Problem
  coordinator-alpha.ts built a prompt with a JSON output schema template that was
  missing required fields that governance validation gates then checked for.
  This created a permanent NO_TRADE loop:

  - MICRO_INTRADAY: m15_structural_confirmation was absent from the JSON template
    → governance gate at line 3044 always overrode to NO_TRADE
  - INTRADAY: trade_management was absent from the JSON template
    → governance gate at line 3067 always overrode to NO_TRADE
  - ALL STYLES: answer_sheet was absent from all templates
    → Q1-Q8 audit checklist was always empty, Mid-Trade Monitor rendered nothing
  - max_tokens was 900 — too low for a full structured response including all required
    fields, causing JSON truncation that silently dropped fields

  ## Fix Applied (coordinator-alpha.ts)
  1. Split non-SCALP template into MICRO_INTRADAY and INTRADAY templates
  2. MICRO_INTRADAY template: added m15_structural_confirmation + trade_management + answer_sheet
  3. INTRADAY template: added trade_management + answer_sheet
  4. SCALP template: added answer_sheet
  5. max_tokens: 900 → 1400
  6. MICRO_INTRADAY override block: now also sets parsed.action and appends governance note
     (parity with INTRADAY override block)

  ## Expected Completion Rate After Fix
  - SCALP: was ~100% functional (no hard field gates) → remains ~100%
  - MICRO_INTRADAY: was 0% (permanent NO_TRADE loop) → expected ~normal confidence-gated rate
  - INTRADAY: was 0% (permanent NO_TRADE loop) → expected ~normal confidence-gated rate
*/

INSERT INTO ccip_alpha_prompt_deployments (
  change_type,
  affected_file,
  affected_function,
  change_description,
  governance_notes,
  fix_count
) VALUES (
  'schema_fix',
  'src/brains/coordinator-alpha.ts',
  'parseDecision / prompt builder (lines 2345-2379)',
  'Added m15_structural_confirmation + trade_management to MICRO_INTRADAY JSON output template. Added trade_management to INTRADAY template. Added answer_sheet to all three style templates. Increased max_tokens from 900 to 1400. Aligned MICRO_INTRADAY governance override with INTRADAY pattern (sets parsed.action + appends governance note).',
  'Root cause: governance validation gates checked for fields not present in the JSON schema example given to Alpha LLM. Alpha followed the template and omitted the fields, triggering hard NO_TRADE overrides for 100% of MICRO_INTRADAY and INTRADAY trades. CCIP 2026-03-04.',
  5
);
