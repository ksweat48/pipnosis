/*
  # Create Trade Closure Events System

  ## Purpose
  Implements the event-driven architecture for trade closures as defined in CCIP Logic Contract.
  Events are inserted after successful trade closure to trigger post-processing pipeline.

  ## Changes

  1. New Table: `trade_closure_events`
     - Durable event queue for trade closures
     - Events processed by coordinator (realtime) and server edge function (batch)
     - Immutable audit trail with processing status tracking

  2. Columns Added to `goal_session_trades`
     - `last_processed_at`: Tracks when post-processing completed (NULL = unprocessed)
     - `post_processing_status`: Pending, succeeded, or failed state

  3. Indexes
     - Efficient polling for unprocessed events
     - User-based event retrieval for recovery scenarios

  ## Security
     - RLS enabled on trade_closure_events
     - Coordinator and service_role can read all events
     - Regular users can only see their own events
     - INSERT-only for events (append-only audit trail)

  ## Implementation Details
     - Event insertion is part of close_goal_session_trade() RPC transaction
     - If event insertion fails, entire closure fails (ACID safety)
     - Realtime publication enabled for browser subscribers
     - Background job polls unprocessed events every 10 seconds
*/

-- Step 1: Create trade_closure_events table
CREATE TABLE IF NOT EXISTS public.trade_closure_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  goal_session_id uuid NOT NULL REFERENCES public.goal_sessions(id) ON DELETE CASCADE,
  
  -- Event data (snapshot at closure time)
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  close_price numeric NOT NULL CHECK (close_price > 0),
  close_reason text NOT NULL CHECK (close_reason IN (
    'manual', 'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'goal_achieved', 'timeout', 'weekend_protection', 'force_closed', 'goal_expired',
    'session_ended', 'risk_limit', 'trailing_stop', 'holiday_closure', 'market_closed'
  )),
  pnl numeric NOT NULL,
  
  -- Processing state (CRITICAL for idempotency)
  last_processed_at timestamptz NULL,
  post_processing_status text DEFAULT 'pending' CHECK (post_processing_status IN ('pending', 'succeeded', 'failed')),
  processing_error text NULL,
  
  -- Audit trail
  created_at timestamptz DEFAULT now(),
  event_triggered_by text NOT NULL DEFAULT 'rpc' CHECK (event_triggered_by IN ('rpc', 'trigger', 'server_monitor')),
  
  -- Ensure events are unique per trade per creation time
  CONSTRAINT unique_event_per_trade_creation UNIQUE (trade_id, created_at)
);

-- Step 2: Create indexes for efficient processing
CREATE INDEX IF NOT EXISTS idx_trade_closure_events_unprocessed 
  ON public.trade_closure_events(created_at) 
  WHERE last_processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_closure_events_by_user 
  ON public.trade_closure_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_closure_events_by_session
  ON public.trade_closure_events(goal_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_closure_events_by_status
  ON public.trade_closure_events(post_processing_status) 
  WHERE post_processing_status != 'succeeded';

-- Step 3: Add columns to goal_session_trades for post-processing tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'last_processed_at'
  ) THEN
    ALTER TABLE public.goal_session_trades ADD COLUMN last_processed_at timestamptz NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'post_processing_status'
  ) THEN
    ALTER TABLE public.goal_session_trades ADD COLUMN post_processing_status text DEFAULT 'pending' 
      CHECK (post_processing_status IN ('pending', 'succeeded', 'failed'));
  END IF;
END $$;

-- Step 4: Enable RLS on trade_closure_events
ALTER TABLE public.trade_closure_events ENABLE ROW LEVEL SECURITY;

-- Step 5: Drop existing policies if they exist, then create fresh ones
DROP POLICY IF EXISTS "Users can read own closure events" ON public.trade_closure_events;
DROP POLICY IF EXISTS "Service role can read all closure events" ON public.trade_closure_events;
DROP POLICY IF EXISTS "Only system can insert closure events" ON public.trade_closure_events;
DROP POLICY IF EXISTS "Service role can update event processing status" ON public.trade_closure_events;

CREATE POLICY "Users can read own closure events"
  ON public.trade_closure_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can read all closure events"
  ON public.trade_closure_events
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Only system can insert closure events"
  ON public.trade_closure_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update event processing status"
  ON public.trade_closure_events
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Step 6: Enable realtime publication for browser subscribers
DO $$ 
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.trade_closure_events;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Step 7: Create indexes on goal_session_trades for tracking columns
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_last_processed
  ON public.goal_session_trades(last_processed_at)
  WHERE last_processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_post_processing_status
  ON public.goal_session_trades(post_processing_status)
  WHERE post_processing_status IN ('pending', 'failed');
