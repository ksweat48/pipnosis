/*
  # Platform Settings & BTC Trade Cleanup
  
  1. Platform Settings Table - Global trading control
  2. BTC Trade Cleanup - Remove faulty BTC trades and recalculate balances
  3. Security - Admin-only trading control
*/

-- =====================================================
-- PART 1: PLATFORM SETTINGS
-- =====================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value jsonb NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO platform_settings (setting_key, setting_value, description)
VALUES ('trading_enabled', 'true'::jsonb, 'Global flag to enable/disable all trading platform-wide')
ON CONFLICT (setting_key) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read platform settings" ON platform_settings;
DROP POLICY IF EXISTS "Only admins can update platform settings" ON platform_settings;

CREATE POLICY "Anyone can read platform settings"
  ON platform_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins can update platform settings"
  ON platform_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = 'admin'));

DROP FUNCTION IF EXISTS is_trading_enabled();
DROP FUNCTION IF EXISTS toggle_platform_trading(boolean);

CREATE FUNCTION is_trading_enabled()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN COALESCE((SELECT (setting_value)::text::boolean FROM platform_settings WHERE setting_key = 'trading_enabled'), true);
END;
$$;

CREATE FUNCTION toggle_platform_trading(enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  is_admin boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin') INTO is_admin;
  IF NOT is_admin THEN
    RAISE EXCEPTION 'Only admins can toggle platform trading';
  END IF;
  
  UPDATE platform_settings SET setting_value = to_jsonb(enabled), updated_at = now(), updated_by = auth.uid()
  WHERE setting_key = 'trading_enabled';
  
  RETURN jsonb_build_object('success', true, 'trading_enabled', enabled, 
    'message', CASE WHEN enabled THEN 'Trading enabled platform-wide' ELSE 'Trading disabled platform-wide' END);
END;
$$;

-- =====================================================
-- PART 2: BTC CLEANUP
-- =====================================================

DO $$
DECLARE
  btc_count integer := 0;
  user_record RECORD;
  total_pnl numeric;
BEGIN
  SELECT COUNT(*) INTO btc_count FROM goal_trades WHERE symbol ILIKE '%BTC%';
  RAISE NOTICE 'Removing % BTC trades', btc_count;
  
  -- Remove BTC trades from all relevant tables
  DELETE FROM trade_accuracy_tracking WHERE journal_entry_id IN (SELECT id FROM ai_trade_journal WHERE symbol ILIKE '%BTC%');
  DELETE FROM ai_trade_journal WHERE symbol ILIKE '%BTC%';
  DELETE FROM goal_trades WHERE symbol ILIKE '%BTC%';
  DELETE FROM ai_learning_insights WHERE symbol ILIKE '%BTC%';
  DELETE FROM ai_trade_decisions WHERE symbol ILIKE '%BTC%';
  DELETE FROM trade_records WHERE symbol ILIKE '%BTC%';
  
  -- Recalculate user balances based on remaining valid trades
  FOR user_record IN SELECT DISTINCT user_id FROM goal_trades LOOP
    SELECT COALESCE(SUM(pnl_result), 0) INTO total_pnl
    FROM goal_trades WHERE user_id = user_record.user_id AND status IN ('closed', 'stopped_out', 'take_profit');
    
    UPDATE user_token_balance SET balance = 10000 + total_pnl WHERE user_id = user_record.user_id;
    
    RAISE NOTICE 'Updated balance for user %: $%', user_record.user_id, (10000 + total_pnl);
  END LOOP;
  
  RAISE NOTICE 'BTC cleanup complete - removed % trades', btc_count;
END $$;
