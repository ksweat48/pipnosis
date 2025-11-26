/*
  # Remove Old KPI System and Legacy Learning Tables

  1. Tables Removed (11 total)

    **Old KPI System Tables (9 tables):**
    - `llm_layer_kpis` - Not populated by synthetic backtests
    - `avoid_pattern_kpis` - Not populated by synthetic backtests
    - `continuous_learning_kpis` - Replaced by improvement_tracking
    - `strategy_evolution_kpis` - Not populated by current system
    - `smart_goal_kpis` - Feature not implemented
    - `ai_mastery_kpis` - Generic metrics, not core
    - `kpi_anomalies` - Part of old KPI system
    - `kpi_cache` - Part of old KPI system
    - `daily_meta_analysis` - Replaced by daily_session_results.llm_deep_analysis

    **Legacy Learning Tables (2 tables):**
    - `ai_learning_insights` - Old insight storage (replaced by ai_trade_analysis)
    - `llm_session_analysis` - Old LLM analysis storage (replaced by daily_session_results)

  2. Tables Kept (Core Intelligence System)
    - `ai_trade_analysis` - Enhanced with layer decisions
    - `daily_session_results` - Enhanced with llm_deep_analysis
    - `improvement_tracking` - New hypothesis validation system

  3. Impact
    - Removes ~3,200 lines of dead code
    - Eliminates fake KPI metric generation
    - Focuses on real learning intelligence
*/

-- ============================================================================
-- Drop Old KPI System Tables (9 tables)
-- ============================================================================

DROP TABLE IF EXISTS kpi_cache CASCADE;
DROP TABLE IF EXISTS kpi_anomalies CASCADE;
DROP TABLE IF EXISTS ai_mastery_kpis CASCADE;
DROP TABLE IF EXISTS smart_goal_kpis CASCADE;
DROP TABLE IF EXISTS strategy_evolution_kpis CASCADE;
DROP TABLE IF EXISTS continuous_learning_kpis CASCADE;
DROP TABLE IF EXISTS avoid_pattern_kpis CASCADE;
DROP TABLE IF EXISTS llm_layer_kpis CASCADE;
DROP TABLE IF EXISTS daily_meta_analysis CASCADE;

-- ============================================================================
-- Drop Legacy Learning Tables (2 tables)
-- ============================================================================

DROP TABLE IF EXISTS ai_learning_insights CASCADE;
DROP TABLE IF EXISTS llm_session_analysis CASCADE;