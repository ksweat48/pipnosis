/*
  # Add Real-Time Prices Table for MetaAPI Streaming

  1. New Tables
    - `realtime_prices`
      - `id` (uuid, primary key) - Unique identifier for each price update
      - `symbol` (text) - Trading pair symbol (e.g., EURUSD)
      - `bid` (numeric) - Bid price
      - `ask` (numeric) - Ask price
      - `mid` (numeric) - Mid price (calculated as (bid + ask) / 2)
      - `spread` (numeric) - Spread (calculated as ask - bid)
      - `broker_time` (timestamptz) - Time from MetaAPI broker
      - `received_at` (timestamptz) - When the price was received by our backend
      - `source` (text) - Source of the price data (e.g., 'metaapi-ws', 'metaapi-rest', 'fallback')
      - `created_at` (timestamptz) - Record creation timestamp

    - `metaapi_connection_health`
      - `id` (uuid, primary key) - Unique identifier
      - `connection_status` (text) - Current connection status (connected, disconnected, reconnecting)
      - `last_message_at` (timestamptz) - Timestamp of last received message
      - `reconnect_count` (integer) - Number of reconnection attempts
      - `error_message` (text, nullable) - Last error message if any
      - `region` (text) - MetaAPI region
      - `account_id` (text) - MetaAPI account ID
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  2. Indexes
    - Index on `symbol` and `created_at` for fast price queries
    - Index on `symbol` and `broker_time` for time-based queries
    - Unique index on connection_health to ensure single status record

  3. Security
    - Enable RLS on both tables
    - Authenticated users can read real-time prices
    - Only service role can write prices (backend only)
    - Connection health readable by authenticated users

  4. Realtime
    - Enable realtime for `realtime_prices` table for live price broadcasting
    - Frontend can subscribe to price updates via Supabase realtime

  5. Data Retention
    - Add automatic cleanup function to delete prices older than 1 hour
    - Keeps table size manageable while maintaining recent history
*/

-- Create realtime_prices table
CREATE TABLE IF NOT EXISTS realtime_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  bid numeric(10, 5) NOT NULL,
  ask numeric(10, 5) NOT NULL,
  mid numeric(10, 5) NOT NULL,
  spread numeric(10, 5) NOT NULL,
  broker_time timestamptz NOT NULL,
  received_at timestamptz DEFAULT now(),
  source text DEFAULT 'metaapi-ws',
  created_at timestamptz DEFAULT now()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_created 
  ON realtime_prices(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_broker_time 
  ON realtime_prices(symbol, broker_time DESC);

-- Create connection health table
CREATE TABLE IF NOT EXISTS metaapi_connection_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_status text NOT NULL DEFAULT 'disconnected',
  last_message_at timestamptz,
  reconnect_count integer DEFAULT 0,
  error_message text,
  region text NOT NULL,
  account_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure only one health record exists (singleton pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_metaapi_connection_health_singleton 
  ON metaapi_connection_health((1));

-- Enable Row Level Security
ALTER TABLE realtime_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE metaapi_connection_health ENABLE ROW LEVEL SECURITY;

-- RLS Policies for realtime_prices
CREATE POLICY "Authenticated users can read realtime prices"
  ON realtime_prices
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert realtime prices"
  ON realtime_prices
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can delete old realtime prices"
  ON realtime_prices
  FOR DELETE
  TO service_role
  USING (true);

-- RLS Policies for connection_health
CREATE POLICY "Authenticated users can read connection health"
  ON metaapi_connection_health
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage connection health"
  ON metaapi_connection_health
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Enable realtime for live price broadcasting
ALTER PUBLICATION supabase_realtime ADD TABLE realtime_prices;

-- Function to clean up old prices (keeps last hour only)
CREATE OR REPLACE FUNCTION cleanup_old_realtime_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM realtime_prices
  WHERE created_at < now() - interval '1 hour';
END;
$$;

-- Function to update connection health
CREATE OR REPLACE FUNCTION update_connection_health(
  p_status text,
  p_last_message_at timestamptz DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_region text DEFAULT 'london',
  p_account_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reconnect_count integer;
BEGIN
  -- Get current reconnect count if status is reconnecting
  IF p_status = 'reconnecting' THEN
    SELECT COALESCE(reconnect_count, 0) + 1 INTO v_reconnect_count
    FROM metaapi_connection_health
    WHERE id IS NOT NULL
    LIMIT 1;
  ELSE
    v_reconnect_count := 0;
  END IF;

  -- Upsert connection health record
  INSERT INTO metaapi_connection_health (
    connection_status,
    last_message_at,
    reconnect_count,
    error_message,
    region,
    account_id,
    updated_at
  ) VALUES (
    p_status,
    COALESCE(p_last_message_at, now()),
    v_reconnect_count,
    p_error_message,
    p_region,
    COALESCE(p_account_id, '')
  )
  ON CONFLICT ((1))
  DO UPDATE SET
    connection_status = EXCLUDED.connection_status,
    last_message_at = COALESCE(EXCLUDED.last_message_at, metaapi_connection_health.last_message_at),
    reconnect_count = EXCLUDED.reconnect_count,
    error_message = EXCLUDED.error_message,
    region = EXCLUDED.region,
    account_id = EXCLUDED.account_id,
    updated_at = now();
END;
$$;