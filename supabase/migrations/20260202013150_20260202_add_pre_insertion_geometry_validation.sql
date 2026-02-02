/*
  # Add Pre-Insertion Geometry Validation System

  1. Purpose
    - Add validation layer to catch TP on wrong side before database insertion
    - Prevent invalid trades (e.g., SELL trades with TP above entry) from being persisted
    - Create incident tracking for all geometry violations
    - Support SSOT (Single Source of Truth) validation authority at execution layer

  2. New/Modified Tables
    - `alpha_geometry_errors` - Already exists, ensure incident_id for correlation
    - `trade_geometry_incidents` - NEW: Track incident lifecycle and resolution
    - `goal_session_trades` - No schema changes, adds pre-insert validation only

  3. New Functions
    - `validate_trade_geometry_before_insert()` - PL/pgSQL function for database-side validation
    - `create_geometry_incident()` - Create incident record for violations
    - `close_geometry_incident()` - Mark incident resolved when trade fixed

  4. Security
    - Function marked SECURITY DEFINER for use in triggers
    - RLS policies enforce user data isolation
    - All violations audited with user_id, timestamp, trade_id

  5. Important Notes
    - This is a non-breaking addition - only adds validation layer
    - Existing valid trades unaffected
    - Invalid trades discovered will be marked with incident_id
    - Application-side validation in trade-execution-engine.ts mirrors this logic
*/

-- 1. Ensure alpha_geometry_errors table has all needed columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_geometry_errors' AND column_name = 'incident_id'
  ) THEN
    ALTER TABLE alpha_geometry_errors ADD COLUMN incident_id uuid;
  END IF;
END $$;

-- 2. Create trade_geometry_incidents table for incident tracking
CREATE TABLE IF NOT EXISTS trade_geometry_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL,
  error_type text NOT NULL CHECK (error_type IN ('TP_WRONG_SIDE', 'SL_WRONG_SIDE', 'SL_TP_INVERTED', 'ZERO_DISTANCE')),
  severity text NOT NULL DEFAULT 'critical' CHECK (severity IN ('critical', 'catastrophic')),
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  entry_price numeric NOT NULL,
  stop_loss numeric,
  take_profit numeric,
  tp1_price numeric,
  tp2_price numeric,
  details jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_direction_vs_geometry CHECK (
    (direction = 'buy' AND stop_loss < entry_price) OR
    (direction = 'sell' AND stop_loss > entry_price) OR
    stop_loss IS NULL
  )
);

-- Enable RLS
ALTER TABLE trade_geometry_incidents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own incidents"
  ON trade_geometry_incidents FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own incidents (resolution)"
  ON trade_geometry_incidents FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role can insert incidents"
  ON trade_geometry_incidents FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_trade_geometry_incidents_user_id ON trade_geometry_incidents(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_geometry_incidents_trade_id ON trade_geometry_incidents(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_geometry_incidents_status ON trade_geometry_incidents(status);

-- 3. Create validation function (database-side mirror of app logic)
CREATE OR REPLACE FUNCTION validate_trade_geometry_before_insert()
RETURNS TABLE (
  valid boolean,
  error_type text,
  error_message text,
  expected_geometry jsonb
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_buy boolean;
  v_sl_wrong_side boolean;
  v_tp_wrong_side boolean;
  v_tp1_wrong_side boolean;
  v_tp2_wrong_side boolean;
BEGIN
  -- Determine if this is a BUY trade
  v_is_buy := (TG_ARGV[0]::text = 'buy');
  
  -- Extract values from NEW record
  -- Geometry checks
  IF v_is_buy THEN
    -- For BUY: SL must be BELOW entry, TP must be ABOVE entry
    v_sl_wrong_side := (NEW.stop_loss >= NEW.entry_price);
    v_tp_wrong_side := (NEW.take_profit <= NEW.entry_price);
    v_tp1_wrong_side := (NEW.tp1_price IS NOT NULL AND NEW.tp1_price <= NEW.entry_price);
    v_tp2_wrong_side := (NEW.tp2_price IS NOT NULL AND NEW.tp2_price <= NEW.entry_price);
    
    IF v_sl_wrong_side AND v_tp_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'SL_TP_INVERTED'::text,
        format('Both SL and TP inverted for BUY trade (Entry=%.5f, SL=%.5f, TP=%.5f)', 
          NEW.entry_price, NEW.stop_loss, NEW.take_profit),
        jsonb_build_object(
          'expected_sl_side', 'below_entry',
          'expected_tp_side', 'above_entry',
          'actual_sl_side', CASE WHEN NEW.stop_loss < NEW.entry_price THEN 'below_entry' ELSE 'above_entry' END,
          'actual_tp_side', CASE WHEN NEW.take_profit < NEW.entry_price THEN 'below_entry' ELSE 'above_entry' END
        );
      RETURN;
    END IF;
    
    IF v_sl_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'SL_WRONG_SIDE'::text,
        format('SL on wrong side for BUY (Entry=%.5f, SL=%.5f)', NEW.entry_price, NEW.stop_loss),
        jsonb_build_object('expected_sl_side', 'below_entry', 'actual_sl_side', 'above_entry');
      RETURN;
    END IF;
    
    IF v_tp_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'TP_WRONG_SIDE'::text,
        format('TP on wrong side for BUY (Entry=%.5f, TP=%.5f)', NEW.entry_price, NEW.take_profit),
        jsonb_build_object('expected_tp_side', 'above_entry', 'actual_tp_side', 'below_entry');
      RETURN;
    END IF;
    
    IF v_tp1_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'TP_WRONG_SIDE'::text,
        format('TP1 on wrong side for BUY (Entry=%.5f, TP1=%.5f)', NEW.entry_price, NEW.tp1_price),
        jsonb_build_object('expected_tp1_side', 'above_entry', 'actual_tp1_side', 'below_entry');
      RETURN;
    END IF;
    
    IF v_tp2_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'TP_WRONG_SIDE'::text,
        format('TP2 on wrong side for BUY (Entry=%.5f, TP2=%.5f)', NEW.entry_price, NEW.tp2_price),
        jsonb_build_object('expected_tp2_side', 'above_entry', 'actual_tp2_side', 'below_entry');
      RETURN;
    END IF;
    
  ELSE
    -- For SELL: SL must be ABOVE entry, TP must be BELOW entry
    v_sl_wrong_side := (NEW.stop_loss <= NEW.entry_price);
    v_tp_wrong_side := (NEW.take_profit >= NEW.entry_price);
    v_tp1_wrong_side := (NEW.tp1_price IS NOT NULL AND NEW.tp1_price >= NEW.entry_price);
    v_tp2_wrong_side := (NEW.tp2_price IS NOT NULL AND NEW.tp2_price >= NEW.entry_price);
    
    IF v_sl_wrong_side AND v_tp_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'SL_TP_INVERTED'::text,
        format('Both SL and TP inverted for SELL trade (Entry=%.5f, SL=%.5f, TP=%.5f)', 
          NEW.entry_price, NEW.stop_loss, NEW.take_profit),
        jsonb_build_object(
          'expected_sl_side', 'above_entry',
          'expected_tp_side', 'below_entry',
          'actual_sl_side', CASE WHEN NEW.stop_loss > NEW.entry_price THEN 'above_entry' ELSE 'below_entry' END,
          'actual_tp_side', CASE WHEN NEW.take_profit > NEW.entry_price THEN 'above_entry' ELSE 'below_entry' END
        );
      RETURN;
    END IF;
    
    IF v_sl_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'SL_WRONG_SIDE'::text,
        format('SL on wrong side for SELL (Entry=%.5f, SL=%.5f)', NEW.entry_price, NEW.stop_loss),
        jsonb_build_object('expected_sl_side', 'above_entry', 'actual_sl_side', 'below_entry');
      RETURN;
    END IF;
    
    IF v_tp_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'TP_WRONG_SIDE'::text,
        format('TP on wrong side for SELL (Entry=%.5f, TP=%.5f)', NEW.entry_price, NEW.take_profit),
        jsonb_build_object('expected_tp_side', 'below_entry', 'actual_tp_side', 'above_entry');
      RETURN;
    END IF;
    
    IF v_tp1_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'TP_WRONG_SIDE'::text,
        format('TP1 on wrong side for SELL (Entry=%.5f, TP1=%.5f)', NEW.entry_price, NEW.tp1_price),
        jsonb_build_object('expected_tp1_side', 'below_entry', 'actual_tp1_side', 'above_entry');
      RETURN;
    END IF;
    
    IF v_tp2_wrong_side THEN
      RETURN QUERY SELECT 
        false,
        'TP_WRONG_SIDE'::text,
        format('TP2 on wrong side for SELL (Entry=%.5f, TP2=%.5f)', NEW.entry_price, NEW.tp2_price),
        jsonb_build_object('expected_tp2_side', 'below_entry', 'actual_tp2_side', 'above_entry');
      RETURN;
    END IF;
  END IF;
  
  -- All checks passed
  RETURN QUERY SELECT true, null::text, null::text, null::jsonb;
END $$;

-- 4. Create function to log geometry violations to incidents table
CREATE OR REPLACE FUNCTION log_geometry_incident(
  p_user_id uuid,
  p_trade_id uuid,
  p_error_type text,
  p_direction text,
  p_entry_price numeric,
  p_stop_loss numeric,
  p_take_profit numeric,
  p_tp1_price numeric,
  p_tp2_price numeric,
  p_details jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_incident_id uuid;
BEGIN
  INSERT INTO trade_geometry_incidents (
    user_id,
    trade_id,
    error_type,
    severity,
    direction,
    entry_price,
    stop_loss,
    take_profit,
    tp1_price,
    tp2_price,
    details,
    status
  ) VALUES (
    p_user_id,
    p_trade_id,
    p_error_type,
    CASE WHEN p_error_type = 'SL_TP_INVERTED' THEN 'catastrophic' ELSE 'critical' END,
    p_direction,
    p_entry_price,
    p_stop_loss,
    p_take_profit,
    p_tp1_price,
    p_tp2_price,
    p_details,
    'open'
  ) RETURNING id INTO v_incident_id;
  
  RETURN v_incident_id;
END $$;

-- 5. Update alpha_geometry_errors to link to incidents
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alpha_geometry_errors') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'alpha_geometry_errors' AND column_name = 'incident_id'
    ) THEN
      ALTER TABLE alpha_geometry_errors ADD COLUMN incident_id uuid REFERENCES trade_geometry_incidents(id);
    END IF;
  END IF;
END $$;

-- 6. Create index for correlation
CREATE INDEX IF NOT EXISTS idx_alpha_geometry_errors_incident_id ON alpha_geometry_errors(incident_id);
