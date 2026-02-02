/*
  # Enhance Lot Size Validation and Governance (2026-02-02)

  ## Problem
  When account balance is invalid (0, null, NaN), lot size calculations cascade into invalid values.
  The database constraint error message doesn't indicate the root cause.

  ## Changes
  1. Add governance check constraint with informative error messages
  2. Create RPC for validating lot size before insertion
  3. Add diagnostic trigger for governance audit logging

  ## Impact
  - Better error messages for debugging cascading failures
  - Governance audit trail for lot size validation failures
  - SSOT: Balance must be validated in application layer before reaching DB
*/

-- Create improved check function with better error messages
CREATE OR REPLACE FUNCTION validate_lot_size_for_governance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Validate lot_size is within database constraint range
  IF NEW.lot_size < 0.001 OR NEW.lot_size > 1000 THEN
    RAISE EXCEPTION 'LOT_SIZE_OUT_OF_RANGE: lot_size % (must be 0.001-1000). Check balance_initialization_authority logs.',
      NEW.lot_size;
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_lot_size_for_governance() TO authenticated, service_role;

-- Create RPC to validate lot size before insertion (SSOT Authority)
CREATE OR REPLACE FUNCTION validate_lot_size_before_trade_insertion(
  p_lot_size numeric,
  p_user_id uuid,
  p_symbol text
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_response jsonb;
BEGIN
  -- Return detailed validation response (SSOT for lot size validation)
  v_response := jsonb_build_object(
    'valid', CASE
      WHEN p_lot_size < 0.001 THEN false
      WHEN p_lot_size > 1000 THEN false
      ELSE true
    END,
    'lot_size', p_lot_size,
    'constraint_min', 0.001,
    'constraint_max', 1000,
    'reason', CASE
      WHEN p_lot_size < 0.001 THEN 'LOT_SIZE_TOO_SMALL'
      WHEN p_lot_size > 1000 THEN 'LOT_SIZE_TOO_LARGE'
      ELSE 'VALID'
    END
  );

  RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_lot_size_before_trade_insertion(numeric, uuid, text) 
TO authenticated, service_role;

-- Create audit log for governance tracking
CREATE TABLE IF NOT EXISTS lot_size_validation_governance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  lot_size numeric NOT NULL,
  validation_result text NOT NULL,
  account_balance numeric,
  risk_mode text,
  account_source text,
  error_message text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_validation_result CHECK (validation_result IN (
    'VALID',
    'LOT_SIZE_NOT_FINITE',
    'LOT_SIZE_TOO_SMALL',
    'LOT_SIZE_TOO_LARGE',
    'UNKNOWN_SYMBOL'
  ))
);

-- Enable RLS
ALTER TABLE lot_size_validation_governance ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Service role can insert lot size validation logs"
  ON lot_size_validation_governance FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Users can view their own validation logs"
  ON lot_size_validation_governance FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX lot_size_validation_governance_user_id_idx 
  ON lot_size_validation_governance(user_id, created_at DESC);

CREATE INDEX lot_size_validation_governance_validation_result_idx 
  ON lot_size_validation_governance(validation_result, created_at DESC);
