/*
  # Create 5-Layer LLM System Tables

  1. New Tables
    - `avoid_pattern_enforcement_log` - Logs all HARD GATE pattern blocking events
    - `llm_layer_decision_log` - Logs each LLM layer decision for debugging
    - `llm_pipeline_execution_log` - Tracks full pipeline execution metrics
    - `developer_mode_settings` - Controls developer mode logging

  2. Security
    - Enable RLS on all new tables
    - Add policies for authenticated users to read their own data
*/

-- Avoid Pattern Enforcement Log
CREATE TABLE IF NOT EXISTS avoid_pattern_enforcement_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  trigger_type text NOT NULL,
  was_blocked boolean NOT NULL,
  block_reason text,
  matched_patterns_count integer DEFAULT 0,
  matched_pattern_ids uuid[],
  highest_similarity_score numeric DEFAULT 0,
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avoid_enforcement_user ON avoid_pattern_enforcement_log(user_id);
CREATE INDEX IF NOT EXISTS idx_avoid_enforcement_symbol ON avoid_pattern_enforcement_log(symbol);
CREATE INDEX IF NOT EXISTS idx_avoid_enforcement_timestamp ON avoid_pattern_enforcement_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_avoid_enforcement_blocked ON avoid_pattern_enforcement_log(was_blocked);

ALTER TABLE avoid_pattern_enforcement_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own enforcement logs"
  ON avoid_pattern_enforcement_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own enforcement logs"
  ON avoid_pattern_enforcement_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- LLM Layer Decision Log (for debugging)
CREATE TABLE IF NOT EXISTS llm_layer_decision_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid,
  symbol text NOT NULL,
  layer_number integer NOT NULL,
  layer_name text NOT NULL,
  layer_decision text NOT NULL,
  layer_output jsonb,
  processing_time_ms integer,
  tokens_used integer,
  passed_to_next_layer boolean NOT NULL,
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_layer_user ON llm_layer_decision_log(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_layer_session ON llm_layer_decision_log(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_layer_timestamp ON llm_layer_decision_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_llm_layer_number ON llm_layer_decision_log(layer_number);

ALTER TABLE llm_layer_decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own layer logs"
  ON llm_layer_decision_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own layer logs"
  ON llm_layer_decision_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- LLM Pipeline Execution Log
CREATE TABLE IF NOT EXISTS llm_pipeline_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid,
  symbol text NOT NULL,
  trigger_type text NOT NULL,
  hard_gate_result text NOT NULL,
  layer_1_passed boolean,
  layer_2_passed boolean,
  layer_3_passed boolean,
  layer_4_completed boolean,
  layer_5_executed boolean,
  final_decision text NOT NULL,
  final_confidence numeric,
  calibrated_confidence numeric,
  total_processing_time_ms integer,
  total_tokens_used integer,
  layers_executed integer,
  abort_layer integer,
  abort_reason text,
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_user ON llm_pipeline_execution_log(user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_session ON llm_pipeline_execution_log(session_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_timestamp ON llm_pipeline_execution_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_symbol ON llm_pipeline_execution_log(symbol);

ALTER TABLE llm_pipeline_execution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pipeline logs"
  ON llm_pipeline_execution_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pipeline logs"
  ON llm_pipeline_execution_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Developer Mode Settings
CREATE TABLE IF NOT EXISTS developer_mode_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  enabled boolean DEFAULT false,
  log_all_layers boolean DEFAULT true,
  log_avoid_patterns boolean DEFAULT true,
  log_continuous_learning boolean DEFAULT true,
  log_smart_goal_llm boolean DEFAULT true,
  log_to_console boolean DEFAULT true,
  log_to_database boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE developer_mode_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dev settings"
  ON developer_mode_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own dev settings"
  ON developer_mode_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own dev settings"
  ON developer_mode_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);