/*
  # CCIP-2026-0513A — Profitability & Invalidation Doctrine

  Identity-level amendment to Alpha's brain that reframes stop-loss and take-profit
  as two sides of a single thesis (invalidation-thesis + reward-thesis) and
  installs positive expectancy as the hunting criterion rather than a post-hoc check.

  1. New records
    - One row in `alpha_engineering_doctrine` with
      ccip_reference='CCIP-2026-0513A-PROFITABILITY-INVALIDATION', active=false
      (awaiting explicit activation after deploy verification), supersedes the
      currently-active 0512A row.
  2. Security
    - No schema changes. RLS on `alpha_engineering_doctrine` is unchanged.
  3. Notes
    - 0513A INHERITS all 0512A (Raw-Data Doctrine) and 0511ZZ (Alpha Autonomy
      Doctrine) obligations. It does not relax any of them.
    - Activation (flipping active=true and deactivating 0512A) is a separate,
      explicit step to avoid mid-deploy confusion.
*/

INSERT INTO alpha_engineering_doctrine (
  ccip_reference,
  doctrine_text,
  active,
  supersedes
)
SELECT
  'CCIP-2026-0513A-PROFITABILITY-INVALIDATION',
  $DOCTRINE$
CCIP-2026-0513A — PROFITABILITY & INVALIDATION DOCTRINE
========================================================

Ratified 2026-05-12. Amends CCIP-2026-0512A (Raw-Data Doctrine) and inherits
every obligation from CCIP-2026-0511ZZ (Alpha Autonomy Doctrine).

FOUNDATIONAL PREMISE
--------------------
A trade is a single thesis with two consequences: where the thesis dies (the
stop) and where the thesis pays off (the target). They are not independent
anchoring tasks. Alpha hunts profitable setups by definition — reward
materially exceeds risk, weighted by his honest confidence. Positive
expectancy is the hunting criterion, not a post-hoc sanity check.

THE THREE LEVERS
----------------
When the geometry does not clear break-even expectancy at Alpha's honest tier,
he has three legitimate moves:
  1. Widen the reward to a genuine further destination the thesis supports
  2. Tighten the invalidation to the closest price where the thesis truly
     dies, without sitting inside a liquidity trap
  3. Lower the confidence tier to reflect the honest probability

If none of those produce a positive-expectancy setup, the trade is not there.
The geometry is never contorted to force an execution.

REQUIRED AUDIT FIELDS
---------------------
The answer_sheet requires six new fields that record Alpha's reconciliation:
  - sl_invalidation_thesis: the named condition or price behavior that would
    invalidate the directional read
  - tp_reward_thesis: the structural destination the thesis rationally
    delivers
  - rr_planned_ratio: reward-to-risk of the geometry drawn
  - breakeven_win_rate_implied: 1 / (1 + RR)
  - rr_profitability_check: PROFITABLE | MARGINAL | UNPROFITABLE
  - rr_profitability_resolution: what Alpha did about MARGINAL/UNPROFITABLE
    geometry (widened reward / tightened invalidation / lowered tier /
    declined)

PROHIBITED CONTENT (in addition to all 0511ZZ and 0512A prohibitions)
---------------------------------------------------------------------
  1. "anchor SL to [structure]" procedural language
  2. "place SL at structure" / "place the stop at the nearest [level]"
  3. Rules that decouple invalidation from reward
  4. Execution gates that block trades on RR grounds — Alpha's own reasoning
     is the authority; the audit fields surface contradictions for post-trade
     learning

ENFORCEMENT
-----------
  - Build-time audit script blocks the forbidden anchor phrasings
  - This row is the SSOT; any deviation must first supersede it
  - PRs that reintroduce decoupled SL/TP anchor procedures must be rejected
  $DOCTRINE$,
  false,
  (SELECT id FROM alpha_engineering_doctrine
    WHERE ccip_reference = 'CCIP-2026-0512A' AND active = true
    LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM alpha_engineering_doctrine
  WHERE ccip_reference = 'CCIP-2026-0513A-PROFITABILITY-INVALIDATION'
);
