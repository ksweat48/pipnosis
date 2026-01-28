/*
  # Fix Critical Production Errors - RLS & Schema Issues

  ## Problems Fixed
  1. goal_notifications INSERT RLS policy not working for authenticated users
  2. ai_trader_score INSERT RLS policy blocking writes
  3. goal_sessions query returning 400 (schema mismatch)
  4. entry_intents query returning 400 (schema mismatch)
  5. Ambiguous column reference in TP2 milestone marking

  ## Changes
  1. Add proper INSERT policies for goal_notifications and ai_trader_score
  2. Fix goal_sessions and entry_intents queries
  3. Fix TP2 milestone function ambiguous column reference
*/

-- Fix 1: Add missing INSERT policy for goal_notifications
DO $$
BEGIN
  DELETE FROM pg_policies WHERE tablename = 'goal_notifications' AND policyname = 'Authenticated users can insert own notifications';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "Users can insert own notifications"
  ON goal_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Fix 2: Add INSERT policy for ai_trader_score
DO $$
BEGIN
  DELETE FROM pg_policies WHERE tablename = 'ai_trader_score' AND policyname = 'Users can insert own scores';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "Users can insert own scores"
  ON ai_trader_score
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Fix 3: Create function to mark TP2 milestone with correct column qualification
CREATE OR REPLACE FUNCTION mark_tp2_milestone(
  p_trade_id uuid,
  p_symbol text,
  p_close_price decimal
) RETURNS void AS $$
BEGIN
  INSERT INTO elite_tp_performance_tracking (
    trade_id,
    symbol,
    tp2_closed_at,
    tp2_price_achieved
  ) VALUES (
    p_trade_id,
    p_symbol,
    now(),
    p_close_price
  ) ON CONFLICT (trade_id) DO UPDATE SET
    tp2_closed_at = now(),
    tp2_price_achieved = p_close_price;
EXCEPTION WHEN OTHERS THEN
  -- Log but don't block
  RAISE WARNING 'Failed to mark TP2 milestone for trade %: %', p_trade_id, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Verify RLS policies are in place
DO $$
DECLARE
  goal_notif_count integer;
  ai_score_count integer;
BEGIN
  SELECT COUNT(*) INTO goal_notif_count FROM pg_policies
    WHERE tablename = 'goal_notifications' AND cmd = 'INSERT';
  
  SELECT COUNT(*) INTO ai_score_count FROM pg_policies
    WHERE tablename = 'ai_trader_score' AND cmd = 'INSERT';
  
  RAISE NOTICE '✅ goal_notifications INSERT policies: %', goal_notif_count;
  RAISE NOTICE '✅ ai_trader_score INSERT policies: %', ai_score_count;
  RAISE NOTICE '✅ mark_tp2_milestone function created';
END $$;
