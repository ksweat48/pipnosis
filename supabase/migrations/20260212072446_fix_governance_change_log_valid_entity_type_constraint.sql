/*
  # Fix governance_change_log valid_entity_type Constraint

  ## Problem
  The `valid_entity_type` check constraint on `governance_change_log` is missing
  two entity types that are actively used by database functions:
  - `ai_trader_score` (used by `create_ai_trader_score` RPC)
  - `timeout_governance_config` (used by `log_timeout_event` RPC)

  This causes a constraint violation (error 23514) when `create_ai_trader_score`
  is called during session startup via `RewardEngine.loadTraderScore`, which
  blocks the entire session lifecycle -- preventing scanning and trade execution.

  ## CCIP Compliance
  - System Map: `governance_change_log` is the SSOT audit trail for all governance operations
  - Logic Contract: The constraint must enumerate ALL entity types that governance-tracked
    functions are authorized to log
  - Compatibility: Additive change only -- existing allowed values are preserved
  - No business logic changes -- only the constraint enumeration is expanded

  ## Changes
  1. Modified Constraints
    - `valid_entity_type` on `governance_change_log`: Added `ai_trader_score` and
      `timeout_governance_config` to the allowed entity_type values
    - All 9 previously allowed values are preserved unchanged

  ## SSOT Authority
  - This constraint is the single source of truth for which entity types may appear
    in the governance audit log
  - Functions `create_ai_trader_score` and `log_timeout_event` are the authoritative
    producers of these two entity types

  ## Verification
  - After applying: `create_ai_trader_score` RPC will succeed, unblocking session startup
  - After applying: `log_timeout_event` RPC will succeed when timeout events occur
*/

-- Drop the existing constraint
ALTER TABLE governance_change_log
  DROP CONSTRAINT IF EXISTS valid_entity_type;

-- Recreate with the complete set of authorized entity types
ALTER TABLE governance_change_log
  ADD CONSTRAINT valid_entity_type CHECK (
    entity_type = ANY (ARRAY[
      'goal_sessions'::text,
      'goal_session_trades'::text,
      'entry_intents'::text,
      'user_profiles'::text,
      'pending_user_modals'::text,
      'trade_processing_lock'::text,
      'database_migration'::text,
      'system_configuration'::text,
      'club_token_balances'::text,
      'ai_trader_score'::text,
      'timeout_governance_config'::text
    ])
  );
