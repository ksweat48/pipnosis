/*
  # Add Auto Trading Step Types to AI Thought Process

  ## Summary
  This migration fixes the AI Thought Process display issue by adding auto-trading
  specific step types to the CHECK constraint on the ai_thought_process table.

  ## Problem
  The auto-trading scanner was trying to log step types like 'auto_scan_start',
  'auto_trade_execute', etc., but these were being rejected by the database CHECK
  constraint, causing all auto-trading thought process entries to fail silently.

  ## Changes Made

  1. Drop the existing CHECK constraint on step_type
  2. Add a new CHECK constraint that includes all auto-trading step types:
     - auto_scan_start: When an automated market scan begins
     - auto_scan_complete: When a scan cycle finishes
     - auto_threshold_check: Evaluating if trade meets confidence threshold
     - auto_trade_skip: Trade rejected (low confidence or other reason)
     - auto_trade_execute: Trade is being executed automatically
     - auto_market_hours_check: Validating current time is within trading hours
     - auto_limit_check: Checking daily trade limits and P&L
     - auto_emergency_stop: Emergency stop triggered due to loss limits

  3. Security
     - No changes to RLS policies (existing policies remain in effect)
     - Users can only view/insert their own thought process entries

  ## Impact
  After this migration, auto-trading thought process entries will be successfully
  saved to the database and displayed in real-time in the UI.
*/

-- ============================================================================
-- Drop existing CHECK constraint
-- ============================================================================

ALTER TABLE ai_thought_process
  DROP CONSTRAINT IF EXISTS ai_thought_process_step_type_check;

-- ============================================================================
-- Add new CHECK constraint with all step types including auto-trading
-- ============================================================================

ALTER TABLE ai_thought_process
  ADD CONSTRAINT ai_thought_process_step_type_check
  CHECK (step_type IN (
    -- Manual trading and AI analysis step types
    'initialization',
    'symbol_scan',
    'market_data_fetch',
    'technical_analysis',
    'fxflow_evaluation',
    'chatgpt_prompt',
    'chatgpt_response',
    'strategy_comparison',
    'risk_calculation',
    'option_generation',
    'final_decision',
    'error',
    'warning',
    -- Auto-trading specific step types
    'auto_scan_start',
    'auto_scan_complete',
    'auto_threshold_check',
    'auto_trade_skip',
    'auto_trade_execute',
    'auto_market_hours_check',
    'auto_limit_check',
    'auto_emergency_stop'
  ));
