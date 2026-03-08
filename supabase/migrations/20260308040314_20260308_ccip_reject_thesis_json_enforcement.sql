/*
  # CCIP-REJECT-THESIS-2026-03-08: Thesis Validation JSON Enforcement

  ## Summary
  Fixes a production bug where Alpha's LLM returns REJECT_THESIS as plain text instead
  of JSON when invalidating a cached market thesis. This caused sanitizeAndParse to throw
  "No valid JSON found", both symbols returning NO_TRADE @ 0% from system errors (not
  market analysis), and the governance infrastructure error rate spiking to 100%.

  ## Root Cause
  The cached thesis prompt instructed Alpha to "say REJECT_THESIS: [reason]" as free-form
  text. The LLM followed the instructions, but the response is processed by sanitizeAndParse
  which expects JSON. This is a prompt compliance gap.

  ## Fixes Applied (coordinator-alpha.ts)
  1. Prompt updated — Alpha MUST return JSON with thesis_status field (ACCEPTED_THESIS | REJECT_THESIS)
  2. Pre-check guard added before sanitizeAndParse — rewrites plain-text responses as valid JSON NO_TRADE
  3. Defensive guard added in parseDecision entry point as last-resort fallback

  All thesis rejection responses now carry confidence=15 and count as reasoned NO_TRADE (not infra errors).
*/

INSERT INTO ccip_change_requests (
  change_title,
  change_type,
  priority,
  requested_by,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  approved_by,
  approved_at,
  deployed_at,
  deployment_method,
  modified_files,
  database_changes,
  breaking_changes,
  related_migration
) VALUES (
  'Fix REJECT_THESIS plain-text LLM response causing 100% infra error rate',
  'bugfix',
  'critical',
  '30177afc-5b98-41ab-832a-a3e5a875e6c0',
  'Alpha LLM was returning REJECT_THESIS as plain text when invalidating cached thesis. sanitizeAndParse threw No valid JSON found, causing both symbols to return NO_TRADE @ 0% from system errors (not market decisions). Governance infra error rate spiked to 100%. Fixed by updating prompt to always return JSON with thesis_status field, adding pre-check guard before sanitizeAndParse, and adding defensive guard in parseDecision.',
  'Prevents false infrastructure error rate spikes from expected LLM thesis validation behavior. Ensures NO_TRADE from thesis rejection is counted as reasoned (confidence >= 10), not system failure.',
  'coordinator-alpha.ts modified: cached thesis prompt updated, pre-check guard added before sanitizeAndParse, defensive guard added at parseDecision entry. No other files changed. No database schema changes.',
  'Low risk — changes are additive guards and prompt clarification. The primary code path (JSON response) is unchanged. Pre-check only activates on non-JSON responses that would have caused errors anyway.',
  'deployed',
  'approved',
  '30177afc-5b98-41ab-832a-a3e5a875e6c0',
  now(),
  now(),
  'migration',
  ARRAY['src/brains/coordinator-alpha.ts'],
  false,
  false,
  '20260308_ccip_reject_thesis_json_enforcement'
);
