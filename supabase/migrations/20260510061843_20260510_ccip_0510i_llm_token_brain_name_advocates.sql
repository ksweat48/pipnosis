/*
  # CCIP-2026-0510I — Extend llm_token_usage brain_name CHECK for advocate brains

  1. Problem
     The dual-advocate architecture (CCIP-2026-0510A) emits two new brain_name
     values — 'Alpha-BUY-Advocate' and 'Alpha-SELL-Advocate' — from
     coordinator-alpha.ts::runAdvocate. The existing llm_token_usage_brain_name_check
     constraint does not include these values, causing 400 PostgREST errors on every
     advocate call.

  2. Change
     Drop and recreate llm_token_usage_brain_name_check with the two advocate
     brain_names added to the allowed list. No row changes.

  3. Safety
     - No data rewrite. Constraint replacement only.
     - Existing allowed values preserved verbatim.
     - Idempotent: DROP IF EXISTS + ADD.
*/

ALTER TABLE llm_token_usage
  DROP CONSTRAINT IF EXISTS llm_token_usage_brain_name_check;

ALTER TABLE llm_token_usage
  ADD CONSTRAINT llm_token_usage_brain_name_check
  CHECK (brain_name = ANY (ARRAY[
    'Alpha'::text,
    'Alpha-BUY-Advocate'::text,
    'Alpha-SELL-Advocate'::text,
    'Omega-1'::text,
    'Omega-2'::text,
    'Omega-3'::text,
    'Omega-4'::text,
    'Omega-5'::text,
    'Omega-6'::text,
    'Omega-7'::text,
    'Omega-8'::text,
    'Omega-9'::text,
    'Omega-10'::text,
    'MidTrade-Monitor'::text,
    'MidTrade-Periodic'::text,
    'MidTrade-Soft'::text,
    'MidTrade-Medium'::text,
    'MidTrade-Hard'::text,
    'MidTrade-Emergency'::text,
    'MidTrade-Analyst'::text
  ]));
