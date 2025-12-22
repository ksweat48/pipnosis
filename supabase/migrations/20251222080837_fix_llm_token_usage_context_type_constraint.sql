/*
  # Fix LLM Token Usage Context Type Constraint

  ## Problem
  The context_type constraint is missing 'alpha_coordination' which is used by the Alpha Coordinator brain.
  This causes 400 errors when logging token usage.

  ## Changes
  1. Drop existing context_type constraint
  2. Add updated constraint with all valid context types including 'alpha_coordination'

  ## Security
  - No RLS changes needed
  - Maintains existing security policies
*/

-- Update context_type constraint to include alpha_coordination
ALTER TABLE llm_token_usage
  DROP CONSTRAINT IF EXISTS llm_token_usage_context_type_check;

ALTER TABLE llm_token_usage
  ADD CONSTRAINT llm_token_usage_context_type_check CHECK (context_type IN (
    'vote',
    'fusion',
    'sentiment',
    'meta_reasoning',
    'mid_trade',
    'strategy_planning',
    'execution',
    'periodic_wellness',
    'drawdown_check',
    'profit_milestone',
    'alpha_coordination',
    'omega_vote',
    'omega9_validation'
  ));
