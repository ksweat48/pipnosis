/*
  # Periodic Wellness Check System

  ## Overview
  Adds 15-minute periodic wellness checks for continuous trade monitoring and user peace of mind.

  ## Changes

  1. New Table: `periodic_wellness_checks`
     - Tracks all periodic wellness check results
     - Stores Alpha's assessment and confidence
     - Links to trades and goal sessions
     - Enables post-trade analysis of check accuracy

  2. Updated Columns
     - Adds 'periodic_wellness' conversation type support
     - Enables tracking wellness status over time

  3. Security
     - RLS enabled with authenticated user policies
     - Users can only see their own wellness checks

  ## Benefits
  - Early issue detection (before drawdown triggers)
  - Continuous user confidence
  - Negligible cost (~$0.02/day per trade)
  - Post-trade learning from wellness assessments
*/

-- Create periodic wellness checks table
CREATE TABLE IF NOT EXISTS periodic_wellness_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,

  -- Check timing
  checked_at timestamptz NOT NULL DEFAULT now(),
  trade_age_minutes integer NOT NULL,
  minutes_since_last_check integer,

  -- Market snapshot
  current_price numeric(10, 5) NOT NULL,
  current_pnl numeric(10, 2),
  risk_ratio numeric(6, 3), -- Current position relative to risk (e.g., +0.50R, -0.30R)

  -- Alpha's assessment
  status text NOT NULL CHECK (status IN ('EXCELLENT', 'GOOD', 'FAIR', 'CONCERNING', 'EXIT_NOW')),
  recommendation text NOT NULL CHECK (recommendation IN ('HOLD', 'TRAIL_SL', 'REDUCE_RISK', 'CLOSE')),
  confidence integer NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  assessment_note text NOT NULL,

  -- LLM tracking
  llm_model text NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_tokens integer DEFAULT 0,
  completion_tokens integer DEFAULT 0,
  total_cost_usd numeric(10, 6) DEFAULT 0,

  -- Metadata
  market_conditions jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_periodic_wellness_user_id ON periodic_wellness_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_periodic_wellness_trade_id ON periodic_wellness_checks(trade_id);
CREATE INDEX IF NOT EXISTS idx_periodic_wellness_session_id ON periodic_wellness_checks(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_periodic_wellness_checked_at ON periodic_wellness_checks(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_periodic_wellness_status ON periodic_wellness_checks(status) WHERE status IN ('CONCERNING', 'EXIT_NOW');

-- Enable RLS
ALTER TABLE periodic_wellness_checks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own wellness checks"
  ON periodic_wellness_checks
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert wellness checks"
  ON periodic_wellness_checks
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Add periodic_wellness to conversation_type enum if not exists
DO $$
BEGIN
  -- Check if the constraint exists and alter it
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'goal_ai_conversations_conversation_type_check'
    AND table_name = 'goal_ai_conversations'
  ) THEN
    -- Drop the old constraint
    ALTER TABLE goal_ai_conversations DROP CONSTRAINT goal_ai_conversations_conversation_type_check;

    -- Add new constraint with periodic_wellness
    ALTER TABLE goal_ai_conversations ADD CONSTRAINT goal_ai_conversations_conversation_type_check
      CHECK (conversation_type IN (
        'setup', 'analysis', 'trade_entry', 'trade_exit', 'recommendation',
        'mid_trade_alert', 'goal_progress', 'learning', 'meta_learning',
        'periodic_wellness'
      ));
  END IF;
END $$;

-- Create view for latest wellness status per trade
CREATE OR REPLACE VIEW latest_trade_wellness AS
SELECT DISTINCT ON (trade_id)
  trade_id,
  status,
  recommendation,
  confidence,
  assessment_note,
  checked_at,
  trade_age_minutes
FROM periodic_wellness_checks
ORDER BY trade_id, checked_at DESC;

-- Grant access to view
GRANT SELECT ON latest_trade_wellness TO authenticated;

-- Create helper function to get wellness summary
CREATE OR REPLACE FUNCTION get_trade_wellness_summary(p_trade_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'latest_status', w.status,
    'latest_recommendation', w.recommendation,
    'latest_confidence', w.confidence,
    'latest_note', w.assessment_note,
    'last_checked_at', w.checked_at,
    'minutes_since_check', EXTRACT(EPOCH FROM (now() - w.checked_at)) / 60,
    'total_checks', COUNT(*),
    'concerning_checks', COUNT(*) FILTER (WHERE w.status IN ('CONCERNING', 'EXIT_NOW')),
    'average_confidence', AVG(w.confidence)::integer
  )
  INTO v_result
  FROM periodic_wellness_checks w
  WHERE w.trade_id = p_trade_id
  GROUP BY w.status, w.recommendation, w.confidence, w.assessment_note, w.checked_at
  ORDER BY w.checked_at DESC
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- Add comment
COMMENT ON TABLE periodic_wellness_checks IS 'Tracks 15-minute periodic wellness checks for continuous trade monitoring and user peace of mind';
COMMENT ON FUNCTION get_trade_wellness_summary IS 'Returns wellness check summary for a specific trade';