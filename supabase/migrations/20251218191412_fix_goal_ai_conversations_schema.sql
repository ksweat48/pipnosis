/*
  # Fix Goal AI Conversations Schema

  ## Problem
  The `goal_ai_conversations` table is missing critical columns causing 400 errors:
  - `conversation_type` column doesn't exist (causing the 400 error)
  - `trade_id` column missing
  - `metadata` column missing
  - Role constraint only allows 'ai'/'user' but code uses 'system'/'assistant'

  ## Solution
  Add all missing columns and fix constraints to match code expectations

  ## Changes
  1. Add `conversation_type` column with proper check constraint
  2. Add `trade_id` column
  3. Add `metadata` column
  4. Add `content` column (alias for message for backwards compatibility)
  5. Update role constraint to allow 'system' and 'assistant'

  ## Safety
  - Uses IF NOT EXISTS patterns
  - Non-destructive - all existing data preserved
  - Adds sensible defaults
*/

-- Add conversation_type column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'goal_ai_conversations'
    AND column_name = 'conversation_type'
  ) THEN
    ALTER TABLE goal_ai_conversations
    ADD COLUMN conversation_type text;

    -- Add check constraint
    ALTER TABLE goal_ai_conversations
    ADD CONSTRAINT goal_ai_conversations_conversation_type_check
    CHECK (conversation_type IN (
      'setup', 'analysis', 'trade_entry', 'trade_exit', 'recommendation',
      'mid_trade_alert', 'goal_progress', 'learning', 'meta_learning',
      'periodic_wellness', 'trade_closure'
    ));

    RAISE NOTICE 'Added conversation_type column to goal_ai_conversations';
  END IF;
END $$;

-- Add trade_id column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'goal_ai_conversations'
    AND column_name = 'trade_id'
  ) THEN
    ALTER TABLE goal_ai_conversations
    ADD COLUMN trade_id uuid REFERENCES goal_session_trades(id) ON DELETE CASCADE;

    CREATE INDEX IF NOT EXISTS idx_goal_ai_conversations_trade_id 
    ON goal_ai_conversations(trade_id);

    RAISE NOTICE 'Added trade_id column to goal_ai_conversations';
  END IF;
END $$;

-- Add metadata column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'goal_ai_conversations'
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE goal_ai_conversations
    ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;

    RAISE NOTICE 'Added metadata column to goal_ai_conversations';
  END IF;
END $$;

-- Add content column as alias for message (for backwards compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'goal_ai_conversations'
    AND column_name = 'content'
  ) THEN
    ALTER TABLE goal_ai_conversations
    ADD COLUMN content text;

    RAISE NOTICE 'Added content column to goal_ai_conversations';
  END IF;
END $$;

-- Update role constraint to allow 'system' and 'assistant'
DO $$
BEGIN
  -- Drop old constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'goal_ai_conversations_role_check'
    AND table_name = 'goal_ai_conversations'
  ) THEN
    ALTER TABLE goal_ai_conversations DROP CONSTRAINT goal_ai_conversations_role_check;
    RAISE NOTICE 'Dropped old role constraint';
  END IF;

  -- Add new constraint with all allowed roles
  ALTER TABLE goal_ai_conversations
  ADD CONSTRAINT goal_ai_conversations_role_check
  CHECK (role IN ('ai', 'user', 'system', 'assistant'));

  RAISE NOTICE 'Added updated role constraint';
END $$;

-- Create trigger to sync content and message columns
CREATE OR REPLACE FUNCTION sync_goal_ai_conversations_content()
RETURNS TRIGGER AS $$
BEGIN
  -- If content is provided, copy to message
  IF NEW.content IS NOT NULL AND NEW.message IS NULL THEN
    NEW.message = NEW.content;
  END IF;
  
  -- If message is provided, copy to content
  IF NEW.message IS NOT NULL AND NEW.content IS NULL THEN
    NEW.content = NEW.message;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_content_message ON goal_ai_conversations;
CREATE TRIGGER sync_content_message
  BEFORE INSERT OR UPDATE ON goal_ai_conversations
  FOR EACH ROW
  EXECUTE FUNCTION sync_goal_ai_conversations_content();

-- Add helpful comments
COMMENT ON COLUMN goal_ai_conversations.conversation_type IS 
  'Type of conversation: periodic_wellness, mid_trade_alert, trade_closure, etc.';

COMMENT ON COLUMN goal_ai_conversations.trade_id IS 
  'Optional reference to the trade this conversation is about';

COMMENT ON COLUMN goal_ai_conversations.metadata IS 
  'Additional structured data for the conversation (trigger info, prices, etc.)';

COMMENT ON COLUMN goal_ai_conversations.content IS 
  'Alias for message column - both can be used interchangeably';
