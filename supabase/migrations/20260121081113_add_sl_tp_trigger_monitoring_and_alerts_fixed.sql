/*
  # Add SL/TP Trigger Monitoring and Regression Prevention

  ## Purpose
  Create monitoring and alerting systems to:
  1. Track trigger-based closures for accuracy
  2. Detect false positives (market price not truly beyond SL/TP)
  3. Alert on potential regression of the bug
  4. Provide governance oversight of automated closures

  ## Changes
  1. Create trigger accuracy tracking table
  2. Add monitoring view for suspicious closures
  3. Create alert function for governance violations
  4. Add automated test query for regression prevention

  ## Security
  - RLS enabled on monitoring tables
  - Admin-only access to violation tracking
  - All closures logged for audit trail
*/

-- 1. Create table to track trigger closure accuracy
CREATE TABLE IF NOT EXISTS trigger_closure_accuracy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  trigger_name text NOT NULL,
  close_reason text NOT NULL,
  
  -- Price information
  sl_tp_level numeric,  -- The SL or TP level that triggered
  actual_market_price numeric NOT NULL,  -- Actual market price at closure
  close_price_used numeric NOT NULL,  -- Price used for closure calculation
  
  -- Accuracy metrics
  price_difference numeric,  -- Difference between market price and SL/TP level
  slippage_pips numeric,  -- Slippage in pips
  is_favorable_slippage boolean,  -- True if slippage favored user
  
  -- Validation
  is_valid_trigger boolean NOT NULL DEFAULT true,  -- False if market never actually reached SL/TP
  validation_notes text,
  
  -- Governance tracking
  governance_logged boolean DEFAULT false,
  closure_method text,  -- 'trigger', 'manual', 'coordinator'
  
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE trigger_closure_accuracy ENABLE ROW LEVEL SECURITY;

-- Users can view their own trigger accuracy
CREATE POLICY "Users can view own trigger accuracy"
  ON trigger_closure_accuracy
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role can insert for logging
CREATE POLICY "Service role can log trigger accuracy"
  ON trigger_closure_accuracy
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Admins can view all
CREATE POLICY "Admins can view all trigger accuracy"
  ON trigger_closure_accuracy
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_trigger_accuracy_user_id ON trigger_closure_accuracy(user_id);
CREATE INDEX IF NOT EXISTS idx_trigger_accuracy_trade_id ON trigger_closure_accuracy(trade_id);
CREATE INDEX IF NOT EXISTS idx_trigger_accuracy_created_at ON trigger_closure_accuracy(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_accuracy_is_valid ON trigger_closure_accuracy(is_valid_trigger);

-- 2. Create view for suspicious closures (potential regression)
CREATE OR REPLACE VIEW suspicious_trigger_closures AS
SELECT 
  t.id as trade_id,
  t.user_id,
  t.symbol,
  t.direction,
  t.close_reason,
  t.entry_price,
  t.exit_price,
  t.stop_loss,
  t.take_profit,
  t.tp1_price,
  t.tp2_price,
  t.profit_loss,
  t.closed_at,
  CASE 
    WHEN t.close_reason = 'stop_loss' AND t.exit_price = t.stop_loss THEN 'EXACT_SL_MATCH'
    WHEN t.close_reason = 'take_profit_2' AND t.exit_price = t.tp2_price THEN 'EXACT_TP2_MATCH'
    WHEN t.close_reason = 'take_profit' AND t.exit_price = t.take_profit THEN 'EXACT_TP_MATCH'
    ELSE 'NORMAL'
  END as suspicious_pattern,
  CASE 
    WHEN t.close_reason = 'stop_loss' AND t.exit_price = t.stop_loss THEN 'OLD BUG PATTERN: Exit price exactly equals SL level'
    WHEN t.close_reason = 'take_profit_2' AND t.exit_price = t.tp2_price THEN 'OLD BUG PATTERN: Exit price exactly equals TP2 level'
    WHEN t.close_reason = 'take_profit' AND t.exit_price = t.take_profit THEN 'OLD BUG PATTERN: Exit price exactly equals TP level'
    ELSE 'Normal closure with market slippage'
  END as analysis
FROM goal_session_trades t
WHERE t.status = 'closed'
  AND t.closed_at >= NOW() - INTERVAL '7 days'
  AND (
    (t.close_reason = 'stop_loss' AND t.exit_price = t.stop_loss)
    OR
    (t.close_reason = 'take_profit_2' AND t.exit_price = t.tp2_price)
    OR
    (t.close_reason = 'take_profit' AND t.exit_price = t.take_profit)
  );

-- 3. Create function to check for trigger regression
CREATE OR REPLACE FUNCTION check_trigger_closure_regression()
RETURNS TABLE (
  regression_detected boolean,
  suspicious_closures_count bigint,
  last_suspicious_closure timestamptz,
  affected_users bigint,
  details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_suspicious_count bigint;
  v_last_closure timestamptz;
  v_affected_users bigint;
BEGIN
  -- Count suspicious closures in last 24 hours
  SELECT 
    COUNT(*),
    MAX(closed_at),
    COUNT(DISTINCT user_id)
  INTO 
    v_suspicious_count,
    v_last_closure,
    v_affected_users
  FROM suspicious_trigger_closures
  WHERE closed_at >= NOW() - INTERVAL '24 hours';

  -- Return analysis
  RETURN QUERY
  SELECT 
    v_suspicious_count > 0 as regression_detected,
    v_suspicious_count,
    v_last_closure,
    v_affected_users,
    jsonb_build_object(
      'message', CASE 
        WHEN v_suspicious_count > 0 THEN 
          format('⚠️ REGRESSION DETECTED: %s trades closed at exact SL/TP level in last 24h', v_suspicious_count)
        ELSE 
          '✅ No regression detected - all closures have market slippage'
      END,
      'action_required', v_suspicious_count > 0,
      'severity', CASE 
        WHEN v_suspicious_count >= 5 THEN 'critical'
        WHEN v_suspicious_count >= 2 THEN 'high'
        WHEN v_suspicious_count >= 1 THEN 'medium'
        ELSE 'none'
      END
    ) as details;
END;
$$;

-- 4. Create function to alert on governance violations
CREATE OR REPLACE FUNCTION alert_on_trigger_governance_violation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_exact_match boolean;
  v_level_used numeric;
BEGIN
  -- Check if this is an exact match closure (old bug pattern)
  IF NEW.status = 'closed' AND OLD.status = 'open' THEN
    v_is_exact_match := false;
    v_level_used := NULL;

    -- Check for exact SL match
    IF NEW.close_reason = 'stop_loss' AND NEW.exit_price = NEW.stop_loss THEN
      v_is_exact_match := true;
      v_level_used := NEW.stop_loss;
    END IF;

    -- Check for exact TP2 match
    IF NEW.close_reason = 'take_profit_2' AND NEW.exit_price = NEW.tp2_price THEN
      v_is_exact_match := true;
      v_level_used := NEW.tp2_price;
    END IF;

    -- Check for exact TP match
    IF NEW.close_reason = 'take_profit' AND NEW.exit_price = NEW.take_profit THEN
      v_is_exact_match := true;
      v_level_used := NEW.take_profit;
    END IF;

    -- If exact match detected, log governance violation
    IF v_is_exact_match THEN
      INSERT INTO ssot_violations (
        violation_type,
        entity_type,
        entity_id,
        expected_authority,
        actual_authority,
        severity,
        details
      ) VALUES (
        'trigger_regression_detected',
        'goal_session_trade',
        NEW.id,
        'market_price',
        'sl_tp_level',
        'critical',
        jsonb_build_object(
          'alert', '🚨 TRIGGER BUG REGRESSION DETECTED',
          'issue', 'Trade closed at exact SL/TP level instead of market price',
          'trade_id', NEW.id,
          'symbol', NEW.symbol,
          'exit_price', NEW.exit_price,
          'sl_tp_level', v_level_used,
          'close_reason', NEW.close_reason,
          'user_id', NEW.user_id,
          'timestamp', now(),
          'requires_immediate_investigation', true
        )
      );

      -- Create high-priority notification for admins
      INSERT INTO goal_notifications (
        user_id,
        type,
        priority,
        title,
        message,
        metadata,
        channels
      )
      SELECT 
        up.id,
        'system_alert',
        'critical',
        '🚨 Trigger Bug Regression Detected',
        format('Trade %s closed at exact %s level. Requires immediate investigation.', 
          NEW.symbol, NEW.close_reason),
        jsonb_build_object(
          'trade_id', NEW.id,
          'exit_price', NEW.exit_price,
          'level', v_level_used,
          'requires_action', true
        ),
        ARRAY['in_app', 'push']
      FROM user_profiles up
      WHERE up.is_admin = true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Add trigger to detect regressions
DROP TRIGGER IF EXISTS trg_alert_trigger_regression ON goal_session_trades;
CREATE TRIGGER trg_alert_trigger_regression
  AFTER UPDATE OF status ON goal_session_trades
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status = 'open')
  EXECUTE FUNCTION alert_on_trigger_governance_violation();

-- 5. Create admin function to get trigger health metrics
CREATE OR REPLACE FUNCTION get_trigger_health_metrics(days_back integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_closures bigint;
  v_trigger_closures bigint;
  v_suspicious_closures bigint;
  v_accuracy_rate numeric;
BEGIN
  -- Count total trigger-based closures
  SELECT COUNT(*)
  INTO v_trigger_closures
  FROM goal_session_trades
  WHERE status = 'closed'
    AND closed_at >= NOW() - (days_back || ' days')::interval
    AND close_reason IN ('stop_loss', 'take_profit', 'take_profit_2');

  -- Count suspicious exact matches
  SELECT COUNT(*)
  INTO v_suspicious_closures
  FROM suspicious_trigger_closures
  WHERE closed_at >= NOW() - (days_back || ' days')::interval;

  -- Calculate accuracy
  v_accuracy_rate := CASE 
    WHEN v_trigger_closures > 0 THEN 
      ((v_trigger_closures - v_suspicious_closures)::numeric / v_trigger_closures::numeric) * 100
    ELSE 100
  END;

  RETURN jsonb_build_object(
    'period_days', days_back,
    'total_trigger_closures', v_trigger_closures,
    'suspicious_closures', v_suspicious_closures,
    'accuracy_rate', ROUND(v_accuracy_rate, 2),
    'health_status', CASE 
      WHEN v_suspicious_closures = 0 THEN 'healthy'
      WHEN v_suspicious_closures < 3 THEN 'warning'
      ELSE 'critical'
    END,
    'recommendation', CASE 
      WHEN v_suspicious_closures = 0 THEN 'System operating normally'
      WHEN v_suspicious_closures < 3 THEN 'Monitor closely for patterns'
      ELSE 'Immediate investigation required'
    END
  );
END;
$$;

-- Add comments for documentation
COMMENT ON TABLE trigger_closure_accuracy IS 
'Tracks accuracy of trigger-based trade closures to detect regressions and ensure market prices are used correctly';

COMMENT ON VIEW suspicious_trigger_closures IS 
'Identifies trades that closed at exact SL/TP levels, which may indicate trigger bug regression';

COMMENT ON FUNCTION check_trigger_closure_regression() IS 
'Checks for potential regression of the SL/TP trigger bug by identifying exact-match closures';

COMMENT ON FUNCTION get_trigger_health_metrics(integer) IS 
'Admin function to get overall health metrics of trigger-based closure system';
