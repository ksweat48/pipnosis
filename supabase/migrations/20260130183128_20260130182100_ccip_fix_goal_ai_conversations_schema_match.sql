/*
  # CCIP Fix: goal_ai_conversations Schema Alignment

  ## Issue
  RPC function expects tokens_used and model columns, but table doesn't have them.
  Table has both message and content columns - need to consolidate.

  ## Resolution
  - Add tokens_used and model columns to goal_ai_conversations
  - Update RPC function to populate content from p_content parameter
  - Keep message for backwards compatibility but populate from content
*/

-- Add missing columns to goal_ai_conversations
ALTER TABLE goal_ai_conversations
ADD COLUMN IF NOT EXISTS tokens_used integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS model text DEFAULT 'system';

-- Update the RPC function to properly map to existing schema
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
  -- Map to existing schema: content AND message (backwards compat)
  INSERT INTO goal_ai_conversations (
    user_id,
    goal_session_id,
    role,
    content,
    message,
    tokens_used,
    model,
    metadata
  ) VALUES (
    p_user_id,
    p_goal_session_id,
    p_role,
    p_content,
    p_content, -- Also populate message for backwards compatibility
    p_tokens_used,
    p_model,
    p_metadata
  )
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION create_goal_ai_conversation TO authenticated;
GRANT EXECUTE ON FUNCTION create_goal_ai_conversation TO service_role;

COMMENT ON FUNCTION create_goal_ai_conversation IS 
'SSOT: Creates goal AI conversation. Maps p_content to both content and message columns for backwards compatibility. CCIP Fixed: 2026-01-30';

-- Update governance registry with resolution
UPDATE governance_authority_registry
SET description = description || ' | SCHEMA FIXED: Added tokens_used and model columns. Function now properly maps to table schema.'
WHERE authority_name = 'GoalAIConversationAuthority';
