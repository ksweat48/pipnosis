/*
  # Create Freshness Gate Analytics System

  1. New Tables
    - `freshness_block_logs`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `session_id` (uuid, nullable, foreign key to goal_sessions)
      - `category` (text) - block reason category
      - `symbol` (text)
      - `timeframe` (text)
      - `metadata` (jsonb) - additional context
      - `auto_refresh_attempted` (boolean)
      - `auto_refresh_success` (boolean)
      - `created_at` (timestamptz)
    
    - `freshness_gate_analytics`
      - `id` (uuid, primary key)
      - `date` (date) - aggregation date
      - `category` (text)
      - `symbol` (text, nullable)
      - `total_blocks` (integer)
      - `auto_refresh_attempts` (integer)
      - `auto_refresh_successes` (integer)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Users can read their own logs
    - Admin can read all logs
    - Service role can write

  3. Indexes
    - Performance indexes for common queries
*/

-- Create freshness_block_logs table
CREATE TABLE IF NOT EXISTS freshness_block_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  category text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  auto_refresh_attempted boolean DEFAULT false,
  auto_refresh_success boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create freshness_gate_analytics table (aggregated view)
CREATE TABLE IF NOT EXISTS freshness_gate_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL,
  symbol text,
  total_blocks integer DEFAULT 0,
  auto_refresh_attempts integer DEFAULT 0,
  auto_refresh_successes integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(date, category, symbol)
);

-- Enable RLS
ALTER TABLE freshness_block_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE freshness_gate_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for freshness_block_logs
CREATE POLICY "Users can read own freshness blocks"
  ON freshness_block_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert freshness blocks"
  ON freshness_block_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

-- RLS Policies for freshness_gate_analytics
CREATE POLICY "Users can read freshness analytics"
  ON freshness_gate_analytics FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage freshness analytics"
  ON freshness_gate_analytics FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_freshness_block_logs_user_created 
  ON freshness_block_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_freshness_block_logs_category 
  ON freshness_block_logs(category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_freshness_block_logs_symbol 
  ON freshness_block_logs(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_freshness_gate_analytics_date 
  ON freshness_gate_analytics(date DESC);

-- Function to update aggregated analytics
CREATE OR REPLACE FUNCTION update_freshness_analytics()
RETURNS trigger AS $$
BEGIN
  INSERT INTO freshness_gate_analytics (date, category, symbol, total_blocks, auto_refresh_attempts, auto_refresh_successes)
  VALUES (
    CURRENT_DATE,
    NEW.category,
    NEW.symbol,
    1,
    CASE WHEN NEW.auto_refresh_attempted THEN 1 ELSE 0 END,
    CASE WHEN NEW.auto_refresh_success THEN 1 ELSE 0 END
  )
  ON CONFLICT (date, category, symbol)
  DO UPDATE SET
    total_blocks = freshness_gate_analytics.total_blocks + 1,
    auto_refresh_attempts = freshness_gate_analytics.auto_refresh_attempts + CASE WHEN NEW.auto_refresh_attempted THEN 1 ELSE 0 END,
    auto_refresh_successes = freshness_gate_analytics.auto_refresh_successes + CASE WHEN NEW.auto_refresh_success THEN 1 ELSE 0 END,
    updated_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-update analytics
CREATE TRIGGER update_freshness_analytics_trigger
  AFTER INSERT ON freshness_block_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_freshness_analytics();
