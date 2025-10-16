/*
  # Create Market Analysis Table

  ## Overview
  This migration creates a table for storing AI-powered technical analysis results
  for forex pairs. The analysis includes RSI, VWAP, volume trends, ATR, candle patterns,
  structure analysis, sentiment scores, and trade signals.

  ## Table Structure
  - `market_analysis` - Stores comprehensive technical analysis for each symbol/timeframe
  - Unique constraint on (symbol, timeframe) to ensure one analysis per pair
  - Optimized indexes for fast querying by symbol, timeframe, and timestamp
  - JSON columns for complex analysis data structures

  ## Security
  - RLS enabled for data protection
  - Public read access for market analysis data
  - Authenticated write access only
*/

-- Create market_analysis table
CREATE TABLE IF NOT EXISTS market_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,

  -- RSI Analysis
  rsi_value numeric(10, 2),
  rsi_status text CHECK (rsi_status IN ('OVERBOUGHT', 'OVERSOLD', 'NEUTRAL')),

  -- VWAP Analysis
  vwap_value numeric(20, 8),
  vwap_position text CHECK (vwap_position IN ('Above VWAP', 'Below VWAP', 'Near VWAP')),

  -- Volume Analysis
  volume_status text CHECK (volume_status IN ('LOW', 'STABLE', 'HIGH')),
  volume_delta text,
  current_volume numeric(20, 2),
  average_volume numeric(20, 2),

  -- ATR (Average True Range)
  atr_value numeric(20, 8),
  atr_status text CHECK (atr_status IN ('Low', 'Normal', 'Elevated')),

  -- Candle Signal Detection
  candle_signal_type text,
  candle_signal_strength text CHECK (candle_signal_strength IN ('Weak', 'Moderate', 'Strong')),

  -- Market Structure
  structure_type text,
  structure_recent boolean DEFAULT false,

  -- Sentiment Analysis
  sentiment_status text CHECK (sentiment_status IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
  sentiment_confidence numeric(5, 2),

  -- Trade Signal
  trade_signal_status text CHECK (trade_signal_status IN ('VALID', 'INVALID')),
  trade_signal_direction text CHECK (trade_signal_direction IN ('BUY', 'SELL')),
  trade_signal_confidence numeric(5, 2),
  trade_signal_reason text,

  -- Metadata
  analyzed_at timestamptz DEFAULT now(),
  candles_analyzed integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(symbol, timeframe)
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol
  ON market_analysis(symbol);

CREATE INDEX IF NOT EXISTS idx_market_analysis_timeframe
  ON market_analysis(timeframe);

CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol_timeframe
  ON market_analysis(symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_market_analysis_analyzed_at
  ON market_analysis(analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_analysis_trade_signal_status
  ON market_analysis(trade_signal_status) WHERE trade_signal_status = 'VALID';

-- Enable RLS
ALTER TABLE market_analysis ENABLE ROW LEVEL SECURITY;

-- Anyone can read market analysis (market data is public)
CREATE POLICY "Anyone can read market analysis"
  ON market_analysis FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only authenticated users can insert/update
CREATE POLICY "Authenticated users can insert market analysis"
  ON market_analysis FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update market analysis"
  ON market_analysis FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_market_analysis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS market_analysis_updated_at ON market_analysis;
CREATE TRIGGER market_analysis_updated_at
  BEFORE UPDATE ON market_analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_market_analysis_updated_at();

-- Function to get latest analysis for a symbol/timeframe
CREATE OR REPLACE FUNCTION get_latest_market_analysis(
  p_symbol text,
  p_timeframe text
)
RETURNS TABLE (
  id uuid,
  symbol text,
  timeframe text,
  rsi_value numeric,
  rsi_status text,
  vwap_value numeric,
  vwap_position text,
  volume_status text,
  volume_delta text,
  atr_value numeric,
  atr_status text,
  candle_signal_type text,
  candle_signal_strength text,
  structure_type text,
  structure_recent boolean,
  sentiment_status text,
  sentiment_confidence numeric,
  trade_signal_status text,
  trade_signal_direction text,
  trade_signal_confidence numeric,
  trade_signal_reason text,
  analyzed_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ma.id,
    ma.symbol,
    ma.timeframe,
    ma.rsi_value,
    ma.rsi_status,
    ma.vwap_value,
    ma.vwap_position,
    ma.volume_status,
    ma.volume_delta,
    ma.atr_value,
    ma.atr_status,
    ma.candle_signal_type,
    ma.candle_signal_strength,
    ma.structure_type,
    ma.structure_recent,
    ma.sentiment_status,
    ma.sentiment_confidence,
    ma.trade_signal_status,
    ma.trade_signal_direction,
    ma.trade_signal_confidence,
    ma.trade_signal_reason,
    ma.analyzed_at
  FROM market_analysis ma
  WHERE
    ma.symbol = p_symbol
    AND ma.timeframe = p_timeframe
  ORDER BY ma.analyzed_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get all valid trade signals
CREATE OR REPLACE FUNCTION get_valid_trade_signals()
RETURNS TABLE (
  symbol text,
  timeframe text,
  direction text,
  confidence numeric,
  reason text,
  sentiment_status text,
  analyzed_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ma.symbol,
    ma.timeframe,
    ma.trade_signal_direction as direction,
    ma.trade_signal_confidence as confidence,
    ma.trade_signal_reason as reason,
    ma.sentiment_status,
    ma.analyzed_at
  FROM market_analysis ma
  WHERE
    ma.trade_signal_status = 'VALID'
    AND ma.analyzed_at > now() - interval '1 hour'
  ORDER BY ma.trade_signal_confidence DESC, ma.analyzed_at DESC;
END;
$$ LANGUAGE plpgsql;
