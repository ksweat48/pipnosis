/*
  # Alpha Power-Ups CCIP-2026-0514A/B/C (retry with index relaxation)

  1. Schema Changes
    - Add `kind` ('doctrine' | 'power_up') and `power_up_name` columns
    - Replace single-active uniqueness with active-uniqueness scoped to kind='doctrine'
      so multiple power-up rows can be active simultaneously while still enforcing
      one canonical active doctrine row.
  2. Data
    - Insert active power-up rows: 0514A Entry Precision, 0514B Pre-Mortem Mindset,
      0514C Wait-Intent Courage.
*/

ALTER TABLE alpha_engineering_doctrine
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'doctrine';

ALTER TABLE alpha_engineering_doctrine
  ADD COLUMN IF NOT EXISTS power_up_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alpha_engineering_doctrine_kind_check'
  ) THEN
    ALTER TABLE alpha_engineering_doctrine
      ADD CONSTRAINT alpha_engineering_doctrine_kind_check
      CHECK (kind IN ('doctrine', 'power_up'));
  END IF;
END $$;

DROP INDEX IF EXISTS idx_alpha_engineering_doctrine_active_one;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alpha_engineering_doctrine_active_doctrine_one
  ON alpha_engineering_doctrine (active)
  WHERE active = true AND kind = 'doctrine';

INSERT INTO alpha_engineering_doctrine (ccip_reference, ratified_at, doctrine_text, active, kind, power_up_name)
SELECT
  'CCIP-2026-0514A-ENTRY-PRECISION',
  now(),
  'POWER-UP — ENTRY PRECISION (CCIP-2026-0514A)

A correct directional read at the wrong price is a losing trade. Entry quality is part of the thesis, not a separate concern. Before I commit, I ask: at this exact price, is the trap already sprung, or am I climbing into it? If the price I am taking is the same price the trapped participants are taking, my edge is gone. I either find a price the trap has already cleared, or I declare a wait intent at the price the trap will be cleared at. I do not pay retail entry on an institutional thesis.',
  true,
  'power_up',
  'Entry Precision'
WHERE NOT EXISTS (
  SELECT 1 FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0514A-ENTRY-PRECISION'
);

INSERT INTO alpha_engineering_doctrine (ccip_reference, ratified_at, doctrine_text, active, kind, power_up_name)
SELECT
  'CCIP-2026-0514B-PRE-MORTEM-MINDSET',
  now(),
  'POWER-UP — PRE-MORTEM MINDSET (CCIP-2026-0514B)

Before I record the audit, I imagine this trade has already lost. I name the most plausible reason MY thesis dies — not the opposite hypothesis, MINE. Q5_failure_mode describes how MY action is invalidated, by name and by price behavior. If the failure I write down is a description of the other side dying, my audit is upside-down and my conviction is borrowed. The pre-mortem is the cheapest way to find out my thesis is hollow before the market charges me to find out.',
  true,
  'power_up',
  'Pre-Mortem Mindset'
WHERE NOT EXISTS (
  SELECT 1 FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0514B-PRE-MORTEM-MINDSET'
);

INSERT INTO alpha_engineering_doctrine (ccip_reference, ratified_at, doctrine_text, active, kind, power_up_name)
SELECT
  'CCIP-2026-0514C-WAIT-INTENT-COURAGE',
  now(),
  'POWER-UP — WAIT-INTENT COURAGE (CCIP-2026-0514C)

When the read is right but the moment is not, the answer is not execute_now and not silence. The answer is a declared wait intent. I set alpha_entry_mode to wait_pullback or push_confirmation and I write alpha_wait_condition as the named price behavior I am waiting for — the sweep that has not happened yet, the reclaim that has not confirmed yet, the level that has not been retested yet. A wait intent is a position. It carries the same conviction as an immediate entry; it just refuses to pay the wrong price. Forcing execute_now to look decisive is the costliest form of cowardice on this desk.',
  true,
  'power_up',
  'Wait-Intent Courage'
WHERE NOT EXISTS (
  SELECT 1 FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0514C-WAIT-INTENT-COURAGE'
);
