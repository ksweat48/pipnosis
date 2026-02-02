/*
  # Close Invalid ETHUSD Sell Trade with Geometry Incident

  1. Purpose
    - Close the invalid ETHUSD SELL trade due to geometry validation failure
    - TP1 and TP2 placed on WRONG side of entry for SELL direction
    - Create incident record for audit trail

  2. Trade Details
    - Trade ID: da3cbc21-5714-4a16-bed4-47123f0ea49a
    - Symbol: ETHUSD, Direction: SELL
    - Entry: 2252.77, TP1: 2257.82 (should be below), TP2: 2288.86 (should be below)
*/

DO $$
DECLARE
  v_user_id uuid;
  v_incident_id uuid;
  v_trade_id uuid := 'da3cbc21-5714-4a16-bed4-47123f0ea49a'::uuid;
BEGIN
  -- Get trade user
  SELECT user_id INTO v_user_id
  FROM goal_session_trades
  WHERE id = v_trade_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Trade not found';
  END IF;

  -- Create incident
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
    status,
    resolution_notes
  ) VALUES (
    v_user_id,
    v_trade_id,
    'TP_WRONG_SIDE',
    'critical',
    'sell',
    2252.771581571841,
    2307.835,
    2288.8602272727276,
    2257.82,
    2288.8602272727276,
    jsonb_build_object(
      'reason', 'SELL trade TP placement invalid: TP1 and TP2 above entry'
    ),
    'resolved',
    'Trade closed due to geometry validation failure'
  ) RETURNING id INTO v_incident_id;

  -- Close trade
  UPDATE goal_session_trades
  SET
    status = 'closed',
    close_reason = 'force_closed',
    current_pnl = 0,
    closed_at = now(),
    updated_at = now()
  WHERE id = v_trade_id;

  RAISE NOTICE 'Closed trade % with incident %', v_trade_id, v_incident_id;
END $$;
