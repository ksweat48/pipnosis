/*
  # Autonomous Server-Side Price Polling System

  ## Problem Statement
  Client-side polling every 60 seconds cannot maintain 30-second freshness requirement.
  Solution: Autonomous server polling keeps realtime_prices table fresh independently.

  ## Changes

  ### 1. Server Polling Control Table
  Tracks which symbols need autonomous polling and system health

  ### 2. Price Update Queue
  Efficiently batches price updates from server functions

  ### 3. Governance Tracking
  CCIP compliance: Track all price freshness blocks and system health

  ## Architecture
  - Server Edge Function polls prices every 5-10 seconds
  - Updates realtime_prices table (SSOT for price data)
  - Client reads from table at any interval (freshness maintained by server)
  - Independent of client polling interval or page state
*/

-- 1. Server polling control (tracks autonomous polling configuration)
CREATE TABLE IF NOT EXISTS server_polling_control (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  enabled boolean DEFAULT true,
  polling_interval_ms integer DEFAULT 8000, -- 8 seconds
  last_poll_time timestamptz,
  last_successful_poll timestamptz,
  poll_failure_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol)
);

ALTER TABLE server_polling_control ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage polling
CREATE POLICY "service_role_manage_polling"
  ON server_polling_control
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Initialize all watchlist symbols for autonomous polling
INSERT INTO server_polling_control (symbol, enabled, polling_interval_ms)
VALUES 
  ('BTCUSD', true, 8000),
  ('ETHUSD', true, 8000),
  ('EURUSD', true, 10000),
  ('GBPUSD', true, 10000),
  ('XAUUSD', true, 10000),
  ('US30', true, 10000),
  ('NZDJPY', true, 10000),
  ('AUDNZD', true, 10000),
  ('AUDUSD', true, 10000),
  ('LTCUSD', true, 8000)
ON CONFLICT (symbol) DO UPDATE SET enabled = true;

-- 3. Price update queue for batching
CREATE TABLE IF NOT EXISTS price_update_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  price numeric NOT NULL,
  source text NOT NULL, -- 'server_poll', 'websocket', etc
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE price_update_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_queue_prices"
  ON price_update_queue
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 4. Create RPC to record a successful poll (server calls this)
CREATE OR REPLACE FUNCTION record_server_poll_success(p_symbol text)
RETURNS void AS $$
BEGIN
  UPDATE server_polling_control
  SET 
    last_successful_poll = now(),
    last_poll_time = now(),
    poll_failure_count = 0,
    updated_at = now()
  WHERE symbol = p_symbol;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create RPC to record a poll failure
CREATE OR REPLACE FUNCTION record_server_poll_failure(p_symbol text)
RETURNS void AS $$
BEGIN
  UPDATE server_polling_control
  SET 
    last_poll_time = now(),
    poll_failure_count = poll_failure_count + 1,
    updated_at = now()
  WHERE symbol = p_symbol;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. CCIP Governance: Log price freshness system status
CREATE TABLE IF NOT EXISTS price_freshness_governance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL, -- 'polling_started', 'polling_failed', 'price_updated', 'freshness_block'
  symbol text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  severity text DEFAULT 'INFO', -- INFO, WARNING, CRITICAL
  created_at timestamptz DEFAULT now()
);

ALTER TABLE price_freshness_governance_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_price_governance"
  ON price_freshness_governance_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 7. Add realtime_prices update trigger with governance logging
CREATE OR REPLACE FUNCTION log_realtime_price_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Log price update
  INSERT INTO price_freshness_governance_log (event_type, symbol, details, severity)
  VALUES (
    'price_updated',
    NEW.symbol,
    jsonb_build_object(
      'price', NEW.mid,
      'source', 'server_poll',
      'age_ms', EXTRACT(EPOCH FROM (now() - NEW.created_at))::bigint
    ),
    'INFO'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS price_update_governance_log ON realtime_prices;
CREATE TRIGGER price_update_governance_log
AFTER INSERT ON realtime_prices
FOR EACH ROW
EXECUTE FUNCTION log_realtime_price_update();

-- 8. Add critical indexes for performance
CREATE INDEX IF NOT EXISTS idx_server_polling_enabled ON server_polling_control(enabled, last_successful_poll);
CREATE INDEX IF NOT EXISTS idx_price_freshness_symbol_time ON price_freshness_governance_log(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_latest ON realtime_prices(symbol, created_at DESC);

COMMENT ON TABLE server_polling_control IS 'SSOT: Controls which symbols get server-side autonomous polling and polling frequency';
COMMENT ON TABLE price_freshness_governance_log IS 'CCIP: Governance audit trail for price freshness system health';
COMMENT ON FUNCTION record_server_poll_success IS 'Called by server polling function when price update successful';
COMMENT ON FUNCTION record_server_poll_failure IS 'Called by server polling function when price fetch fails';
