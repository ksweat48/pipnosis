/*
  # Entry Viability Lifecycle System
  
  ## Purpose
  Fixes infinite loop where abandoned entry intents get recreated by scanner.
  Introduces entry outcome taxonomy and thesis memory to distinguish between:
  - ENTRY_EXPIRED (missed execution window - do not rescan)
  - ENTRY_INVALIDATED (structure broken - rescan allowed)
  - ENTRY_PAUSED (temporary condition - rescan after condition clears)
  
  ## Changes
  
  1. Entry Intent Taxonomy
     - Add `abandonment_reason` to track why intent was abandoned
     - Add `outcome_status` to track lifecycle state
     
  2. Thesis Memory System
     - New `entry_thesis_memory` table
     - Stores fingerprint of each thesis (symbol + direction + structure)
     - Prevents recreating same thesis after ENTRY_EXPIRED
     - Auto-expires after 10 minutes (allows structure change)
     
  3. Indexes
     - Performance indexes for thesis lookup
     - Composite index on session + status
     
  4. Security
     - RLS policies for user isolation
     - Service role access for automated cleanup
*/

-- Add outcome tracking columns to entry_intents
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'entry_intents' AND column_name = 'abandonment_reason'
  ) THEN
    ALTER TABLE entry_intents 
    ADD COLUMN abandonment_reason text,
    ADD COLUMN outcome_status text DEFAULT 'ACTIVE',
    ADD COLUMN distance_from_zone_atr numeric,
    ADD COLUMN escalation_attempted boolean DEFAULT false;
  END IF;
END $$;

-- Add check constraint for outcome_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'entry_intents_outcome_status_check'
  ) THEN
    ALTER TABLE entry_intents
    ADD CONSTRAINT entry_intents_outcome_status_check
    CHECK (outcome_status IN ('ACTIVE', 'EXECUTED', 'EXPIRED', 'INVALIDATED', 'PAUSED'));
  END IF;
END $$;

-- Add check constraint for abandonment_reason
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'entry_intents_abandonment_reason_check'
  ) THEN
    ALTER TABLE entry_intents
    ADD CONSTRAINT entry_intents_abandonment_reason_check
    CHECK (abandonment_reason IS NULL OR abandonment_reason IN (
      'RUNAWAY_DETECTED',
      'STRUCTURE_INVALIDATED',
      'REGIME_SHIFT',
      'VOLATILITY_SPIKE',
      'NEWS_EVENT',
      'STOP_RUN',
      'TIMEOUT',
      'EXECUTION_COMPLETED',
      'USER_CANCELLED'
    ));
  END IF;
END $$;

-- Create entry_thesis_memory table
CREATE TABLE IF NOT EXISTS entry_thesis_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Thesis fingerprint components
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  structure_anchor numeric NOT NULL, -- entry zone center, rounded to 2 decimals
  timeframe text NOT NULL,
  
  -- Fingerprint hash for fast lookup
  thesis_fingerprint text NOT NULL,
  
  -- Lifecycle status
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'INVALIDATED', 'ESCALATED')),
  
  -- Related intent
  entry_intent_id uuid REFERENCES entry_intents(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz,
  
  -- Metadata
  alpha_confidence numeric,
  abandonment_count integer DEFAULT 0,
  
  UNIQUE(user_id, session_id, thesis_fingerprint)
);

-- Enable RLS
ALTER TABLE entry_thesis_memory ENABLE ROW LEVEL SECURITY;

-- RLS Policies for entry_thesis_memory
CREATE POLICY "Users can view own thesis memory"
  ON entry_thesis_memory FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own thesis memory"
  ON entry_thesis_memory FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own thesis memory"
  ON entry_thesis_memory FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role has full access to thesis memory"
  ON entry_thesis_memory FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_entry_thesis_memory_user_session 
  ON entry_thesis_memory(user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_entry_thesis_memory_fingerprint 
  ON entry_thesis_memory(thesis_fingerprint);

CREATE INDEX IF NOT EXISTS idx_entry_thesis_memory_status 
  ON entry_thesis_memory(status) WHERE status = 'EXPIRED';

CREATE INDEX IF NOT EXISTS idx_entry_thesis_memory_expires_at 
  ON entry_thesis_memory(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entry_intents_outcome_status
  ON entry_intents(outcome_status, session_id);

-- Function to generate thesis fingerprint
CREATE OR REPLACE FUNCTION generate_thesis_fingerprint(
  p_symbol text,
  p_direction text,
  p_structure_anchor numeric,
  p_timeframe text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN lower(
    p_symbol || '_' || 
    p_direction || '_' || 
    round(p_structure_anchor::numeric, 2)::text || '_' ||
    p_timeframe
  );
END;
$$;

-- Function to check if thesis is expired
CREATE OR REPLACE FUNCTION is_thesis_expired(
  p_user_id uuid,
  p_session_id uuid,
  p_thesis_fingerprint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_memory_status text;
  v_expires_at timestamptz;
BEGIN
  SELECT status, expires_at 
  INTO v_memory_status, v_expires_at
  FROM entry_thesis_memory
  WHERE user_id = p_user_id
    AND session_id = p_session_id
    AND thesis_fingerprint = p_thesis_fingerprint
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Not found = not expired
  IF v_memory_status IS NULL THEN
    RETURN false;
  END IF;
  
  -- Check if expired and still within expiration window
  IF v_memory_status = 'EXPIRED' THEN
    IF v_expires_at IS NULL OR v_expires_at > now() THEN
      RETURN true;
    END IF;
  END IF;
  
  -- All other cases = not expired
  RETURN false;
END;
$$;

-- Function to mark thesis as expired
CREATE OR REPLACE FUNCTION mark_thesis_expired(
  p_entry_intent_id uuid,
  p_abandonment_reason text,
  p_expiration_duration interval DEFAULT interval '10 minutes'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_session_id uuid;
  v_symbol text;
  v_direction text;
  v_structure_anchor numeric;
  v_timeframe text;
  v_fingerprint text;
BEGIN
  -- Get intent details
  SELECT user_id, session_id, symbol, direction, entry_price, timeframe
  INTO v_user_id, v_session_id, v_symbol, v_direction, v_structure_anchor, v_timeframe
  FROM entry_intents
  WHERE id = p_entry_intent_id;
  
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Generate fingerprint
  v_fingerprint := generate_thesis_fingerprint(
    v_symbol, v_direction, v_structure_anchor, v_timeframe
  );
  
  -- Update entry intent
  UPDATE entry_intents
  SET 
    outcome_status = CASE 
      WHEN p_abandonment_reason IN ('RUNAWAY_DETECTED', 'TIMEOUT') THEN 'EXPIRED'
      WHEN p_abandonment_reason IN ('STRUCTURE_INVALIDATED', 'STOP_RUN') THEN 'INVALIDATED'
      WHEN p_abandonment_reason IN ('REGIME_SHIFT', 'VOLATILITY_SPIKE', 'NEWS_EVENT') THEN 'PAUSED'
      ELSE 'EXPIRED'
    END,
    abandonment_reason = p_abandonment_reason,
    updated_at = now()
  WHERE id = p_entry_intent_id;
  
  -- Insert or update thesis memory
  INSERT INTO entry_thesis_memory (
    user_id,
    session_id,
    symbol,
    direction,
    structure_anchor,
    timeframe,
    thesis_fingerprint,
    status,
    entry_intent_id,
    expires_at,
    abandonment_count
  )
  VALUES (
    v_user_id,
    v_session_id,
    v_symbol,
    v_direction,
    v_structure_anchor,
    v_timeframe,
    v_fingerprint,
    CASE 
      WHEN p_abandonment_reason IN ('RUNAWAY_DETECTED', 'TIMEOUT') THEN 'EXPIRED'
      WHEN p_abandonment_reason IN ('STRUCTURE_INVALIDATED', 'STOP_RUN') THEN 'INVALIDATED'
      ELSE 'EXPIRED'
    END,
    p_entry_intent_id,
    CASE 
      WHEN p_abandonment_reason IN ('RUNAWAY_DETECTED', 'TIMEOUT') THEN now() + p_expiration_duration
      ELSE NULL
    END,
    1
  )
  ON CONFLICT (user_id, session_id, thesis_fingerprint)
  DO UPDATE SET
    status = EXCLUDED.status,
    expires_at = EXCLUDED.expires_at,
    abandonment_count = entry_thesis_memory.abandonment_count + 1,
    entry_intent_id = EXCLUDED.entry_intent_id;
END;
$$;

-- Function to clean up expired thesis memory (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_thesis_memory()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM entry_thesis_memory
  WHERE expires_at IS NOT NULL 
    AND expires_at < now();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION generate_thesis_fingerprint TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_thesis_expired TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_thesis_expired TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_thesis_memory TO service_role;

-- Enable realtime for thesis memory (for live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE entry_thesis_memory;
