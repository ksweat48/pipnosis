/*
  # AI Thought Process Tracking Migration

  This migration adds the ability to track and display the AI's reasoning process
  in real-time during trade analysis.

  ## What This Creates

  1. New Table: ai_thought_process
     - Stores each step of the AI's analysis process
     - Links to ai_trade_decisions for historical reference
     - Supports real-time streaming via Supabase subscriptions
     - Tracks timestamps, step types, content, and status

  2. Security
     - Enable RLS on ai_thought_process table
     - Users can only view their own thought process entries
     - Users can insert thought process entries for their decisions

  3. Indexes
     - Optimized for real-time queries by decision_id
     - Ordered by created_at for chronological display
*/

-- Create ai_thought_process table
CREATE TABLE IF NOT EXISTS ai_thought_process (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  decision_id uuid REFERENCES ai_trade_decisions(id) ON DELETE CASCADE NOT NULL,
  step_number integer NOT NULL,
  step_type text NOT NULL CHECK (step_type IN (
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
    'warning'
  )),
  title text NOT NULL,
  content text NOT NULL,
  metadata jsonb DEFAULT '{}',
  status text DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'error')),
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_thought_process_decision
  ON ai_thought_process(decision_id, created_at);

CREATE INDEX IF NOT EXISTS idx_thought_process_user
  ON ai_thought_process(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_thought_process_step_type
  ON ai_thought_process(step_type);

-- Row Level Security Policies
ALTER TABLE ai_thought_process ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own thought process" ON ai_thought_process;
CREATE POLICY "Users can view own thought process"
  ON ai_thought_process
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own thought process" ON ai_thought_process;
CREATE POLICY "Users can insert own thought process"
  ON ai_thought_process
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to thought process" ON ai_thought_process;
CREATE POLICY "Service role full access to thought process"
  ON ai_thought_process
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Helper function to add thought process entry
CREATE OR REPLACE FUNCTION add_thought_process_entry(
  p_user_id uuid,
  p_decision_id uuid,
  p_step_number integer,
  p_step_type text,
  p_title text,
  p_content text,
  p_metadata jsonb DEFAULT '{}'
) RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO ai_thought_process (
    user_id,
    decision_id,
    step_number,
    step_type,
    title,
    content,
    metadata,
    status
  ) VALUES (
    p_user_id,
    p_decision_id,
    p_step_number,
    p_step_type,
    p_title,
    p_content,
    p_metadata,
    'processing'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to complete thought process entry
CREATE OR REPLACE FUNCTION complete_thought_process_entry(
  p_id uuid,
  p_duration_ms integer DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE ai_thought_process
  SET
    status = 'completed',
    duration_ms = p_duration_ms
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to mark thought process entry as error
CREATE OR REPLACE FUNCTION error_thought_process_entry(
  p_id uuid,
  p_error_message text
) RETURNS void AS $$
BEGIN
  UPDATE ai_thought_process
  SET
    status = 'error',
    content = content || E'\n\nError: ' || p_error_message
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;