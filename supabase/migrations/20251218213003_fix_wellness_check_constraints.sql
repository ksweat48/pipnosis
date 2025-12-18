/*
  # Fix Wellness Check System Constraints

  ## Changes
  1. Update llm_token_usage brain_name constraint to include 'MidTrade-Periodic'
  2. Update llm_token_usage context_type constraint to include 'periodic_wellness'
  3. No breaking changes - adds new allowed values

  ## Security
  - No RLS changes needed
  - Maintains existing security policies
*/

-- =====================================================
-- Update brain_name constraint
-- =====================================================

ALTER TABLE llm_token_usage
  DROP CONSTRAINT IF EXISTS llm_token_usage_brain_name_check;

ALTER TABLE llm_token_usage
  ADD CONSTRAINT llm_token_usage_brain_name_check CHECK (brain_name IN (
    'Alpha',
    'Omega-1', 'Omega-2', 'Omega-3', 'Omega-4', 'Omega-5',
    'Omega-6', 'Omega-7', 'Omega-8', 'Omega-9', 'Omega-10',
    'MidTrade-Periodic',  -- NEW: For periodic wellness checks
    'MidTrade-Soft',      -- NEW: For soft drawdown checks
    'MidTrade-Medium',    -- NEW: For medium drawdown checks
    'MidTrade-Hard',      -- NEW: For hard drawdown checks
    'MidTrade-Emergency'  -- NEW: For emergency checks
  ));

-- =====================================================
-- Update context_type constraint
-- =====================================================

ALTER TABLE llm_token_usage
  DROP CONSTRAINT IF EXISTS llm_token_usage_context_type_check;

ALTER TABLE llm_token_usage
  ADD CONSTRAINT llm_token_usage_context_type_check CHECK (context_type IN (
    'vote', 'fusion', 'sentiment', 'meta_reasoning',
    'mid_trade', 'strategy_planning', 'execution',
    'periodic_wellness',  -- NEW: For 15-minute wellness checks
    'drawdown_check',     -- NEW: For drawdown-triggered evaluations
    'profit_milestone'    -- NEW: For profit milestone evaluations
  ));