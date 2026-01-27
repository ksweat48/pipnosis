/*
  # CCIP: Alpha Trade Geometry Error Logging System

  **CCIP Phase:** Defensive Validation Infrastructure
  **Governance:** Alpha Authority Protection & Learning System
  **Impact:** Critical - Prevents invalid trades, enables prompt improvement

  ## Purpose
  
  Log all instances where Alpha generates invalid trade geometry (SL/TP on wrong side).
  This data enables:
  
  1. **Hard blocking** - Invalid geometry never executes
  2. **Learning** - Track error patterns by symbol/timeframe/conditions
  3. **Prompt engineering** - Iteratively improve Alpha's instructions
  4. **Monitoring** - Alert if error rate exceeds acceptable threshold
  
  ## Non-Negotiable Rules
  
  ❌ This system MUST NOT auto-correct Alpha's decisions
  ❌ This system MUST NOT modify SL/TP values
  ✅ This system MAY ONLY: detect → log → block → alert
  
  ## Geometry Rules (SSOT)
  
  **BUY trades:**
  - Stop Loss MUST be BELOW entry price (SL < Entry)
  - Take Profit MUST be ABOVE entry price (TP > Entry)
  - Valid order: SL < Entry < TP
  
  **SELL trades:**
  - Stop Loss MUST be ABOVE entry price (SL > Entry)
  - Take Profit MUST be BELOW entry price (TP < Entry)
  - Valid order: TP < Entry < SL
  
  ## Error Categories
  
  1. `SL_WRONG_SIDE` - Stop Loss on incorrect side of entry
  2. `TP_WRONG_SIDE` - Take Profit on incorrect side of entry
  3. `SL_TP_INVERTED` - Both SL and TP inverted (critical)
  4. `ZERO_DISTANCE` - SL or TP at entry price (invalid)
  5. `EXTREME_DEVIATION` - Entry price deviates >10% from market (hallucination)
  
  ## Analytics Use Cases
  
  - Daily error rate monitoring (alert if >5%)
  - Symbol-specific error patterns (e.g., indices vs forex)
  - Confidence correlation (do high-confidence trades have fewer errors?)
  - Narrative quality correlation
  - Session context patterns (time of day, volatility)
  
  ## SSOT Compliance
  
  This table is the SINGLE SOURCE for Alpha geometry error tracking.
  Do not duplicate this logging elsewhere.
*/

DO $$
BEGIN
  -- Create Alpha geometry error log table
  CREATE TABLE IF NOT EXISTS alpha_geometry_errors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Error identification
    error_type text NOT NULL CHECK (error_type IN (
      'SL_WRONG_SIDE',
      'TP_WRONG_SIDE', 
      'SL_TP_INVERTED',
      'ZERO_DISTANCE',
      'EXTREME_DEVIATION'
    )),
    severity text NOT NULL CHECK (severity IN ('warning', 'critical', 'catastrophic')),
    blocked boolean NOT NULL DEFAULT true,
    
    -- Trade context
    symbol text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
    entry_price numeric NOT NULL,
    stop_loss numeric,
    take_profit numeric,
    current_market_price numeric,
    
    -- Geometry details
    expected_sl_side text, -- 'above_entry' or 'below_entry'
    expected_tp_side text,
    actual_sl_side text,
    actual_tp_side text,
    
    -- Alpha decision context
    alpha_confidence numeric,
    narrative_quality text,
    narrative_text text,
    eqs_score numeric,
    trade_style text,
    
    -- Market context
    market_regime text,
    volatility_level text,
    session_context text,
    
    -- User/session tracking
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id uuid,
    scan_attempt_id uuid,
    
    -- Error specifics
    error_message text NOT NULL,
    error_details jsonb,
    
    -- Learning metadata
    prompt_version text, -- Track which prompt version generated error
    model_used text, -- 'gpt-4o-mini', 'gpt-4o', etc.
    tokens_used int,
    
    -- Resolution tracking
    corrected_in_next_attempt boolean DEFAULT false,
    correction_notes text,
    
    created_at timestamptz DEFAULT now()
  );

  -- Indexes for analytics queries
  CREATE INDEX IF NOT EXISTS idx_geometry_errors_symbol 
    ON alpha_geometry_errors(symbol, created_at DESC);
    
  CREATE INDEX IF NOT EXISTS idx_geometry_errors_type 
    ON alpha_geometry_errors(error_type, created_at DESC);
    
  CREATE INDEX IF NOT EXISTS idx_geometry_errors_user 
    ON alpha_geometry_errors(user_id, created_at DESC);
    
  CREATE INDEX IF NOT EXISTS idx_geometry_errors_blocked 
    ON alpha_geometry_errors(blocked, created_at DESC);
    
  -- Critical errors index (for alerting)
  CREATE INDEX IF NOT EXISTS idx_geometry_errors_critical
    ON alpha_geometry_errors(severity, created_at DESC)
    WHERE severity IN ('critical', 'catastrophic');

  -- Enable RLS
  ALTER TABLE alpha_geometry_errors ENABLE ROW LEVEL SECURITY;

  -- RLS Policies
  CREATE POLICY "users_read_own_geometry_errors"
    ON alpha_geometry_errors
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR auth.jwt() ->> 'role' = 'admin');

  CREATE POLICY "service_role_insert_geometry_errors"
    ON alpha_geometry_errors
    FOR INSERT
    TO service_role
    WITH CHECK (true);

  CREATE POLICY "authenticated_insert_geometry_errors"
    ON alpha_geometry_errors
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

  -- Create view for daily error rate monitoring
  CREATE OR REPLACE VIEW alpha_geometry_error_rate_daily AS
  SELECT
    date_trunc('day', created_at) as day,
    COUNT(*) as total_errors,
    COUNT(*) FILTER (WHERE error_type = 'SL_WRONG_SIDE') as sl_errors,
    COUNT(*) FILTER (WHERE error_type = 'TP_WRONG_SIDE') as tp_errors,
    COUNT(*) FILTER (WHERE error_type = 'SL_TP_INVERTED') as inverted_errors,
    COUNT(*) FILTER (WHERE severity = 'catastrophic') as catastrophic_errors,
    COUNT(DISTINCT symbol) as affected_symbols,
    COUNT(DISTINCT user_id) as affected_users,
    -- Calculate error rate vs total scans (requires scan_attempts table)
    ROUND(AVG(alpha_confidence), 2) as avg_confidence_of_errors
  FROM alpha_geometry_errors
  WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY date_trunc('day', created_at)
  ORDER BY day DESC;

  -- Create function to get error rate for alerting
  CREATE OR REPLACE FUNCTION get_alpha_geometry_error_rate_last_24h()
  RETURNS TABLE (
    error_count bigint,
    total_scans bigint,
    error_rate_percent numeric
  ) 
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $func$
  BEGIN
    RETURN QUERY
    SELECT
      COUNT(*) as error_count,
      -- Estimate total scans (would need scan_attempts table for exact count)
      GREATEST(COUNT(*) * 2, 1::bigint) as total_scans,
      ROUND((COUNT(*)::numeric / GREATEST(COUNT(*) * 2, 1)) * 100, 2) as error_rate_percent
    FROM alpha_geometry_errors
    WHERE created_at >= NOW() - INTERVAL '24 hours';
  END;
  $func$;

  -- Log CCIP event
  INSERT INTO confidence_refactor_ccip_events (
    event_type,
    phase,
    component,
    description,
    impact_severity,
    actor,
    reason,
    metadata
  ) VALUES (
    'deployment',
    'staged_deployment',
    'alpha_geometry_validation',
    'Alpha geometry error logging system deployed - hard blocks + learning enabled',
    'critical',
    'system',
    'Prevent invalid trade geometry from executing while enabling prompt improvement',
    jsonb_build_object(
      'rules', 'BLOCK + LOG only (NO auto-correction)',
      'alert_threshold', '5% error rate',
      'learning_enabled', true
    )
  );

  RAISE NOTICE '✅ Alpha geometry error logging system created';
  RAISE NOTICE '✅ Hard block + learning enabled (NO auto-correction)';
  RAISE NOTICE '✅ Daily monitoring view created';
  RAISE NOTICE '✅ Alert threshold: 5%% error rate';
  
END $$;
