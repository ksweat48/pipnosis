/*
  # Fix AI Learning Pipeline - Create Missing Tables
  
  ## Summary
  This migration creates critical missing tables for the AI learning pipeline that are causing
  404 and 400 errors in the console. These tables are essential for session consistency tracking
  and skill progression validation.
  
  ## New Tables Created
  
  ### 1. ai_session_wr_tracking
  Tracks Win Rate (WR) for each backtest/trading session to validate consistency over time.
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to auth.users)
  - `session_id` (uuid, references backtest or trading session)
  - `win_rate` (numeric) - Win rate percentage for this session
  - `wins_count` (integer) - Number of winning trades
  - `total_trades` (integer) - Total trades in session
  - `backtest_type` (text) - Type: 'live', 'backtest', or 'synthetic'
  - `symbol` (text, optional) - Trading symbol if session is symbol-specific
  - `timeframe` (text, optional) - Timeframe if session is timeframe-specific
  - `strategy_name` (text, optional) - Strategy used in session
  - `session_date` (timestamptz) - When this session occurred
  - `created_at` (timestamptz)
  
  ### 2. ai_session_pf_tracking
  Tracks Profit Factor (PF) for each backtest/trading session to validate consistency.
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to auth.users)
  - `session_id` (uuid, references backtest or trading session)
  - `profit_factor` (numeric) - Profit factor for this session
  - `total_wins_value` (numeric) - Total $ value of wins
  - `total_losses_value` (numeric) - Total $ value of losses (positive number)
  - `backtest_type` (text) - Type: 'live', 'backtest', or 'synthetic'
  - `symbol` (text, optional)
  - `timeframe` (text, optional)
  - `strategy_name` (text, optional)
  - `session_date` (timestamptz)
  - `created_at` (timestamptz)
  
  ### 3. polling_health
  Tracks health status of various polling systems (price feeds, candle aggregation, etc.)
  - `id` (uuid, primary key)
  - `poller_name` (text) - Name/identifier of the polling system
  - `last_poll_time` (timestamptz) - Last successful poll
  - `last_success_time` (timestamptz) - Last successful data fetch
  - `consecutive_failures` (integer) - Number of consecutive failures
  - `total_polls_today` (integer) - Total polls attempted today
  - `successful_polls_today` (integer) - Successful polls today
  - `error_message` (text, optional) - Last error if any
  - `is_healthy` (boolean) - Overall health status
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  
  ## Columns Added to Existing Tables
  
  ### ai_skill_progression
  - `current_cycle_position` (integer) - Position in current 10-session validation cycle
  - `total_cycles_completed` (integer) - Number of complete 10-session cycles
  - `last_10_session_wr_spread` (numeric) - WR spread over last 10 sessions (for consistency)
  - `last_10_session_pf_average` (numeric) - Average PF over last 10 sessions
  - `consistency_validation_passed` (boolean) - Whether consistency check passed
  - `consistency_failure_reason` (text, optional) - Reason if validation failed
  
  ## Security
  - Enable RLS on all new tables
  - Users can only read/write their own session tracking data
  - polling_health is accessible to authenticated users for monitoring
  
  ## Indexes
  - Performance indexes on user_id, session_date for efficient queries
  - Index on poller_name for polling_health lookups
*/

-- =====================================================
-- 1. CREATE ai_session_wr_tracking TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.ai_session_wr_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  win_rate numeric NOT NULL DEFAULT 0,
  wins_count integer NOT NULL DEFAULT 0,
  total_trades integer NOT NULL DEFAULT 0,
  backtest_type text NOT NULL CHECK (backtest_type IN ('live', 'backtest', 'synthetic')),
  symbol text,
  timeframe text,
  strategy_name text,
  session_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_session_wr_tracking_user_id 
  ON public.ai_session_wr_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_session_wr_tracking_session_date 
  ON public.ai_session_wr_tracking(user_id, session_date DESC);

-- Enable RLS
ALTER TABLE public.ai_session_wr_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own WR tracking"
  ON public.ai_session_wr_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own WR tracking"
  ON public.ai_session_wr_tracking FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own WR tracking"
  ON public.ai_session_wr_tracking FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own WR tracking"
  ON public.ai_session_wr_tracking FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- 2. CREATE ai_session_pf_tracking TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.ai_session_pf_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  profit_factor numeric NOT NULL DEFAULT 0,
  total_wins_value numeric NOT NULL DEFAULT 0,
  total_losses_value numeric NOT NULL DEFAULT 0,
  backtest_type text NOT NULL CHECK (backtest_type IN ('live', 'backtest', 'synthetic')),
  symbol text,
  timeframe text,
  strategy_name text,
  session_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_session_pf_tracking_user_id 
  ON public.ai_session_pf_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_session_pf_tracking_session_date 
  ON public.ai_session_pf_tracking(user_id, session_date DESC);

-- Enable RLS
ALTER TABLE public.ai_session_pf_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own PF tracking"
  ON public.ai_session_pf_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own PF tracking"
  ON public.ai_session_pf_tracking FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own PF tracking"
  ON public.ai_session_pf_tracking FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own PF tracking"
  ON public.ai_session_pf_tracking FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- 3. CREATE polling_health TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.polling_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poller_name text NOT NULL UNIQUE,
  last_poll_time timestamptz,
  last_success_time timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  total_polls_today integer NOT NULL DEFAULT 0,
  successful_polls_today integer NOT NULL DEFAULT 0,
  error_message text,
  is_healthy boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_polling_health_poller_name 
  ON public.polling_health(poller_name);

-- Enable RLS
ALTER TABLE public.polling_health ENABLE ROW LEVEL SECURITY;

-- RLS Policies (readable by all authenticated users for monitoring)
CREATE POLICY "Authenticated users can view polling health"
  ON public.polling_health FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can update polling health"
  ON public.polling_health FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update polling health records"
  ON public.polling_health FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 4. ADD MISSING COLUMNS TO ai_skill_progression
-- =====================================================
DO $$
BEGIN
  -- Add current_cycle_position if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_skill_progression' 
    AND column_name = 'current_cycle_position'
  ) THEN
    ALTER TABLE public.ai_skill_progression 
    ADD COLUMN current_cycle_position integer DEFAULT 0;
  END IF;

  -- Add total_cycles_completed if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_skill_progression' 
    AND column_name = 'total_cycles_completed'
  ) THEN
    ALTER TABLE public.ai_skill_progression 
    ADD COLUMN total_cycles_completed integer DEFAULT 0;
  END IF;

  -- Add last_10_session_wr_spread if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_skill_progression' 
    AND column_name = 'last_10_session_wr_spread'
  ) THEN
    ALTER TABLE public.ai_skill_progression 
    ADD COLUMN last_10_session_wr_spread numeric DEFAULT 0;
  END IF;

  -- Add last_10_session_pf_average if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_skill_progression' 
    AND column_name = 'last_10_session_pf_average'
  ) THEN
    ALTER TABLE public.ai_skill_progression 
    ADD COLUMN last_10_session_pf_average numeric DEFAULT 0;
  END IF;

  -- Add consistency_validation_passed if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_skill_progression' 
    AND column_name = 'consistency_validation_passed'
  ) THEN
    ALTER TABLE public.ai_skill_progression 
    ADD COLUMN consistency_validation_passed boolean DEFAULT true;
  END IF;

  -- Add consistency_failure_reason if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_skill_progression' 
    AND column_name = 'consistency_failure_reason'
  ) THEN
    ALTER TABLE public.ai_skill_progression 
    ADD COLUMN consistency_failure_reason text;
  END IF;
END $$;

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================
COMMENT ON TABLE public.ai_session_wr_tracking IS 
  'Tracks win rate for each trading/backtest session to validate consistency over time. Used for skill level advancement validation.';

COMMENT ON TABLE public.ai_session_pf_tracking IS 
  'Tracks profit factor for each trading/backtest session. Used with WR tracking to ensure AI demonstrates consistent performance.';

COMMENT ON TABLE public.polling_health IS 
  'Monitors health status of various polling systems (price feeds, candle aggregation, etc.) to detect outages and failures.';

COMMENT ON COLUMN public.ai_skill_progression.current_cycle_position IS 
  'Position (0-9) in current 10-session validation cycle for consistency tracking';

COMMENT ON COLUMN public.ai_skill_progression.total_cycles_completed IS 
  'Number of complete 10-session validation cycles completed';

COMMENT ON COLUMN public.ai_skill_progression.last_10_session_wr_spread IS 
  'Win rate spread (max - min) over last 10 sessions. Must be ≤10% for level advancement';

COMMENT ON COLUMN public.ai_skill_progression.last_10_session_pf_average IS 
  'Average profit factor over last 10 sessions. Must meet level-specific requirements';

COMMENT ON COLUMN public.ai_skill_progression.consistency_validation_passed IS 
  'Whether the last consistency validation check passed for skill level advancement';

COMMENT ON COLUMN public.ai_skill_progression.consistency_failure_reason IS 
  'Reason why consistency validation failed, if applicable';
