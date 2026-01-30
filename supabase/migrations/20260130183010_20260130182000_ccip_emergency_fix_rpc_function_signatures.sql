/*
  # CCIP Emergency Fix: RPC Function Signature Mismatches

  ## Root Cause
  1. create_ai_trader_score expects session_id but ai_trader_score table has no such column
  2. create_goal_ai_conversation doesn't accept metadata parameter
  3. Application code and database functions are out of sync

  ## Issues Found
  - Error: column "session_id" of relation "ai_trader_score" does not exist
  - Error: 404 on create_goal_ai_conversation with wrong parameters
  
  ## Resolution
  - Drop and recreate functions with correct signatures
  - Match application code expectations
  - Add metadata support to goal_ai_conversations
*/

-- Drop existing functions
DROP FUNCTION IF EXISTS create_ai_trader_score(uuid, uuid, integer, numeric, numeric, numeric, jsonb);
DROP FUNCTION IF EXISTS create_goal_ai_conversation(uuid, uuid, text, text, integer, text);

-- Recreate create_ai_trader_score WITHOUT session_id (table doesn't have it)
CREATE OR REPLACE FUNCTION create_ai_trader_score(
  p_user_id uuid,
  p_trade_count integer DEFAULT 0,
  p_win_rate numeric DEFAULT 0,
  p_avg_rr numeric DEFAULT 0,
  p_consistency_score numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score_id uuid;
BEGIN
  -- Insert into ai_trader_score (no session_id column)
  INSERT INTO ai_trader_score (
    user_id,
    total_trades,
    win_rate,
    avg_rr,
    current_score
  ) VALUES (
    p_user_id,
    p_trade_count,
    p_win_rate,
    p_avg_rr,
    GREATEST(LEAST(p_consistency_score, 100), 0) -- Clamp to 0-100
  )
  RETURNING id INTO v_score_id;

  -- Log to governance
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    new_value,
    reason
  ) VALUES (
    'ai_trader_score',
    v_score_id,
    'field_update',
    jsonb_build_object(
      'user_id', p_user_id,
      'trade_count', p_trade_count,
      'win_rate', p_win_rate,
      'avg_rr', p_avg_rr
    ),
    'Initial trader score created via RPC'
  );

  RETURN v_score_id;
END;
$$;

-- Recreate create_goal_ai_conversation WITH metadata support
CREATE OR REPLACE FUNCTION create_goal_ai_conversation(
  p_user_id uuid,
  p_goal_session_id uuid,
  p_role text,
  p_content text,
  p_tokens_used integer DEFAULT 0,
  p_model text DEFAULT 'gpt-4',
  p_metadata jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  -- Validate role
  IF p_role NOT IN ('user', 'ai', 'system') THEN
    RAISE EXCEPTION 'Invalid role: %. Must be user, ai, or system', p_role;
  END IF;

  -- Insert into goal_ai_conversations
  INSERT INTO goal_ai_conversations (
    user_id,
    goal_session_id,
    role,
    content,
    tokens_used,
    model,
    metadata
  ) VALUES (
    p_user_id,
    p_goal_session_id,
    p_role,
    p_content,
    p_tokens_used,
    p_model,
    p_metadata
  )
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION create_ai_trader_score TO authenticated;
GRANT EXECUTE ON FUNCTION create_ai_trader_score TO service_role;

GRANT EXECUTE ON FUNCTION create_goal_ai_conversation TO authenticated;
GRANT EXECUTE ON FUNCTION create_goal_ai_conversation TO service_role;

-- Update governance registry
UPDATE governance_authority_registry
SET description = 'SSOT ENFORCEMENT: Fixed function signatures. create_ai_trader_score no longer requires session_id (table does not have this column). create_goal_ai_conversation now accepts metadata parameter. CCIP Date: 2026-01-30, Emergency Fix.'
WHERE authority_name = 'GoalAIConversationAuthority';

-- Add comment
COMMENT ON FUNCTION create_goal_ai_conversation IS 
'SSOT: Creates goal AI conversation with metadata support. All writes must use SystemTableRPCWrapper.createGoalAIConversation()';

COMMENT ON FUNCTION create_ai_trader_score IS
'SSOT: Creates AI trader score. Note: ai_trader_score table does NOT have session_id column, so this function does not accept it.';
