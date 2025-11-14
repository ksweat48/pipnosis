/*
  # Plateau Detection and Breakthrough System

  1. New Tables
    - `plateau_detection_log` - Tracks plateau detection events
    - `breakthrough_sessions` - Tracks breakthrough mode sessions
    - `breakthrough_results` - Stores results of breakthrough strategy tests

  2. Purpose
    - Detect when AI performance plateaus (stuck in narrow win rate range)
    - Trigger breakthrough mode to test experimental strategies
    - Track effectiveness of different breakthrough approaches
    - Enable AI to escape performance plateaus and continue progressing

  3. Security
    - Enable RLS on all tables
    - Users can only access their own records
*/

-- Plateau Detection Log
CREATE TABLE IF NOT EXISTS plateau_detection_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  is_plateaued boolean NOT NULL DEFAULT false,
  plateau_duration integer NOT NULL DEFAULT 0,
  current_win_rate numeric NOT NULL,
  win_rate_range_min numeric NOT NULL,
  win_rate_range_max numeric NOT NULL,
  consecutive_sessions_in_range integer NOT NULL DEFAULT 0,
  recommendation text,
  should_trigger_exploration boolean NOT NULL DEFAULT false,
  detected_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE plateau_detection_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own plateau detection logs"
  ON plateau_detection_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own plateau detection logs"
  ON plateau_detection_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Breakthrough Sessions
CREATE TABLE IF NOT EXISTS breakthrough_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trigger_reason text NOT NULL DEFAULT 'plateau_detected',
  baseline_win_rate numeric NOT NULL,
  plateau_duration integer NOT NULL DEFAULT 0,
  strategies_planned integer NOT NULL DEFAULT 0,
  strategies_completed integer NOT NULL DEFAULT 0,
  best_strategy_name text,
  best_improvement numeric,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE breakthrough_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own breakthrough sessions"
  ON breakthrough_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own breakthrough sessions"
  ON breakthrough_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own breakthrough sessions"
  ON breakthrough_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Breakthrough Results
CREATE TABLE IF NOT EXISTS breakthrough_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid REFERENCES breakthrough_sessions(id) ON DELETE CASCADE,
  strategy_name text NOT NULL,
  strategy_type text NOT NULL CHECK (strategy_type IN ('confidence_sweep', 'symbol_focus', 'time_filter', 'market_condition', 'contrarian', 'aggressive')),
  strategy_description text,
  win_rate numeric NOT NULL,
  profit_factor numeric NOT NULL DEFAULT 0,
  total_trades integer NOT NULL DEFAULT 0,
  improvement numeric NOT NULL DEFAULT 0,
  was_successful boolean NOT NULL DEFAULT false,
  should_adopt boolean NOT NULL DEFAULT false,
  config_used jsonb,
  tested_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE breakthrough_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own breakthrough results"
  ON breakthrough_results FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own breakthrough results"
  ON breakthrough_results FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_plateau_detection_user_detected ON plateau_detection_log(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_breakthrough_sessions_user_status ON breakthrough_sessions(user_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_breakthrough_results_user_tested ON breakthrough_results(user_id, tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_breakthrough_results_session ON breakthrough_results(session_id);

-- Add helpful views
CREATE OR REPLACE VIEW v_recent_plateau_detections AS
SELECT
  user_id,
  is_plateaued,
  plateau_duration,
  current_win_rate,
  win_rate_range_min,
  win_rate_range_max,
  recommendation,
  detected_at
FROM plateau_detection_log
ORDER BY detected_at DESC;

CREATE OR REPLACE VIEW v_active_breakthroughs AS
SELECT
  bs.id,
  bs.user_id,
  bs.baseline_win_rate,
  bs.plateau_duration,
  bs.strategies_planned,
  bs.strategies_completed,
  bs.status,
  bs.started_at,
  COUNT(br.id) as results_count,
  MAX(br.improvement) as max_improvement
FROM breakthrough_sessions bs
LEFT JOIN breakthrough_results br ON br.session_id = bs.id
WHERE bs.status = 'running'
GROUP BY bs.id, bs.user_id, bs.baseline_win_rate, bs.plateau_duration,
         bs.strategies_planned, bs.strategies_completed, bs.status, bs.started_at;

COMMENT ON TABLE plateau_detection_log IS 'Tracks performance plateau detection - when AI win rate gets stuck in narrow range';
COMMENT ON TABLE breakthrough_sessions IS 'Tracks breakthrough mode sessions - experimental strategy testing to escape plateaus';
COMMENT ON TABLE breakthrough_results IS 'Results from breakthrough strategy experiments';
