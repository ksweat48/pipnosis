/*
  # CCIP: Thought Monitor Condition Starvation Fix

  ## Problem
  The Alpha scanning thought monitor consistently showed only 2/5 conditions met
  regardless of market volatility or regime. Three conditions (vol_high, trend=bull,
  rsi>50) would rarely or never register as met.

  ## Root Causes

  ### 1. vol_high — Wrong evaluation path for synthetic-volume instruments
  - vol_high evaluated exclusively via sensors.vol_r === 'high'
  - Indices (SPX500, NAS100, US30) have NO real volume → synthetic vol ratio ~1.0 → always 'mid'
  - Fix: vol_high now checks sensors.vol_r === 'high' OR state.volatility === 'high' (ATR-based)

  ### 2. LLM generates bull-only conditions regardless of market direction
  - Prompt example hardcoded bull conditions, no directional guidance given
  - Fix: DIRECTIONAL AWARENESS directive added to prompt

  ### 3. Hardcoded bull fallback on LLM parse failure
  - Always returned ['p>e50', 'rsi>50', 'trend=bull']
  - Fix: buildDirectionalFallback() uses detected trend direction

  ## CCIP Tier 3 — Logic Behaviour Change
  Affected services: condition-monitor, llm-strategy-brain
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'database_migration',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"service": "condition-monitor", "issue": "vol_high only evaluated via sensors.vol_r — always mid for synthetic-volume instruments"}'::jsonb,
  '{"service": "condition-monitor", "fix": "vol_high dual-path: sensors.vol_r === high OR state.volatility === high (ATR-based)"}'::jsonb,
  'CCIP thought-monitor condition starvation fix: vol_high and vol_low now use ATR-based volatility as authoritative fallback for synthetic-volume instruments.',
  '{"ccip_tier": 3, "ticket": "thought-monitor-condition-starvation-20260218", "affected": ["condition-monitor", "llm-strategy-brain"]}'::jsonb
),
(
  'database_migration',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"service": "llm-strategy-brain", "issue": "prompt hardcoded bull example and parse-error fallback always returned bull-only conditions"}'::jsonb,
  '{"service": "llm-strategy-brain", "fix": "DIRECTIONAL AWARENESS directive + buildDirectionalFallback() replaces hardcoded bull fallback"}'::jsonb,
  'CCIP thought-monitor condition starvation fix: LLM now generates regime-matched conditions. Bearish markets get bear conditions, sideways gets neutral/range conditions.',
  '{"ccip_tier": 3, "ticket": "thought-monitor-condition-starvation-20260218", "affected": ["llm-strategy-brain"]}'::jsonb
);
