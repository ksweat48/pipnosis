/*
  # Fix LLM Token Usage Context Type Constraint - Complete Fix

  ## Problem
  The context_type constraint is missing the specific omega brain context types
  that are actually used by the system:
  - omega_trend_vote
  - omega_scalper_vote
  - omega_confirmation_vote
  - omega_reversal_vote
  - omega_volatility_vote
  - omega_risk_vote
  - omega_orderflow_vote

  ## Changes
  1. Drop existing context_type constraint
  2. Add updated constraint with ALL valid context types used by the system

  ## Security
  - No RLS changes needed
  - Maintains existing security policies
*/

-- Drop and recreate constraint with ALL omega vote types
ALTER TABLE llm_token_usage
  DROP CONSTRAINT IF EXISTS llm_token_usage_context_type_check;

ALTER TABLE llm_token_usage
  ADD CONSTRAINT llm_token_usage_context_type_check CHECK (context_type IN (
    -- Original types
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
    -- Alpha coordination
    'alpha_coordination',
    -- Generic omega types
    'omega_vote',
    'omega9_validation',
    -- Specific omega brain vote types (used by individual brains)
    'omega_trend_vote',
    'omega_scalper_vote',
    'omega_confirmation_vote',
    'omega_reversal_vote',
    'omega_volatility_vote',
    'omega_risk_vote',
    'omega_orderflow_vote',
    'omega_sentiment_vote',
    -- LLM health check
    'llm_health_check'
  ));