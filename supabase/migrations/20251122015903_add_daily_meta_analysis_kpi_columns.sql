/*
  # Add Daily Meta-Analysis KPI Columns

  ## Overview
  Add tracking columns to continuous_learning_kpis table for daily meta-analysis metrics.

  ## Changes
  - Add daily_meta_analysis_generated column
  - Add strategic_recommendations_count column

  ## Purpose
  Track daily meta-analysis generation in the KPI system for Learning Center display.
*/

-- Add new columns to track daily meta-analysis
ALTER TABLE continuous_learning_kpis
ADD COLUMN IF NOT EXISTS daily_meta_analysis_generated integer DEFAULT 0;

ALTER TABLE continuous_learning_kpis
ADD COLUMN IF NOT EXISTS strategic_recommendations_count integer DEFAULT 0;

-- Add comments
COMMENT ON COLUMN continuous_learning_kpis.daily_meta_analysis_generated IS
'Number of daily meta-analyses generated (0 or 1 per day)';

COMMENT ON COLUMN continuous_learning_kpis.strategic_recommendations_count IS
'Count of strategic recommendations from daily meta-analysis';
