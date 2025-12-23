/*
  # Add All Missing LLM Context Types

  1. Problem
    - TypeScript code defines many context_type values that are not in the database constraint
    - This causes constraint violations when logging token usage

  2. Solution
    - Add all context types defined in src/services/llm-token-tracker.ts
    - Ensures TypeScript and database stay in sync

  3. New Context Types Added
    - Trading execution and analysis types
    - Market analysis types
    - System operations types
    - Generic 'other' type for unknown contexts
*/

-- Drop existing constraint
ALTER TABLE llm_token_usage
  DROP CONSTRAINT IF EXISTS llm_token_usage_context_type_check;

-- Add constraint with ALL context types from TypeScript code
ALTER TABLE llm_token_usage
  ADD CONSTRAINT llm_token_usage_context_type_check CHECK (context_type IN (
    -- Omega brain vote types
    'omega_sentiment_analysis',
    'omega_trend_vote',
    'omega_scalper_vote',
    'omega_confirmation_vote',
    'omega_reversal_vote',
    'omega_volatility_vote',
    'omega_risk_vote',
    'omega8_hybrid_refinement',
    'omega_orderflow_vote',
    'omega_sentiment_vote',
    'omega_vote',
    'omega9_validation',

    -- Alpha and core strategy
    'alpha_coordination',
    'pipnosis_strategy',
    'llm_health_check',

    -- Trading execution and analysis
    'trade_execution_analysis',
    'ai_goal_session',
    'stop_loss_analysis',
    'take_profit_analysis',
    'position_sizing',
    'execution',
    'strategy_planning',
    'mid_trade',

    -- Market analysis
    'market_sentiment',
    'technical_analysis',
    'risk_assessment',
    'trade_monitoring',
    'performance_analysis',
    'sentiment',
    'meta_reasoning',

    -- Wellness and monitoring
    'periodic_wellness',
    'drawdown_check',
    'profit_milestone',

    -- System operations
    'backtesting',
    'optimization',
    'reporting',
    'debugging',
    'testing',
    'vote',
    'fusion',

    -- Catch-all
    'other'
  ));
