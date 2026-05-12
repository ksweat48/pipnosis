/*
  # CCIP-2026-0513B — Trap-Aware Geometry Doctrine

  Inserts the ratified 0513B row, superseding 0513A (which supersedes 0512A).
  Table's single-active unique index requires flipping 0512A off before
  inserting a new active row. 0513A remains inactive in the supersedes chain
  so its obligations are inherited through 0513B.

  1. Deactivate 0512A
  2. Insert 0513B with active=true, supersedes=0513A
*/

UPDATE alpha_engineering_doctrine
SET active = false
WHERE id = 'b5a52385-d535-4c42-8978-558cda4a4b3c';

INSERT INTO alpha_engineering_doctrine (
  ccip_reference,
  ratified_at,
  doctrine_text,
  active,
  supersedes
) VALUES (
  'CCIP-2026-0513B-TRAP-AWARE-GEOMETRY',
  now(),
  'TRAP-AWARE GEOMETRY DOCTRINE — CCIP-2026-0513B

Ratified 2026-05-12. Identity-level amendment to the Profitability & Invalidation Doctrine (CCIP-2026-0513A). Inherits all obligations from CCIP-2026-0511ZZ, CCIP-2026-0512A, and CCIP-2026-0513A.

FOUNDATIONAL PREMISE
Every price has liquidity pools on both sides: resting stops, equal highs/lows, session boundaries, prior-day levels. Market makers hunt those pools. A thesis that places invalidation at the near edge of an obvious pool — without acknowledging the sweep risk — is not a thesis, it is an invitation. A thesis that places reward short of a reward-side pool leaves profit on the table that the move will likely take anyway. Alpha maps liquidity on every scan, for both directions, and reconciles entry, stop-loss, and take-profit against that map. This applies symmetrically to BUY and SELL hypotheses.

REQUIRED AUDIT FIELDS
- trap_map_invalidation_side — named pool(s) on the invalidation side
- trap_map_reward_side — named pool(s) on the reward side
- sl_sweep_risk_acknowledged — explicit statement of whether the SL sits inside, at the edge of, or beyond any invalidation-side pool
- entry_sweep_alignment — waits_for_sweep | executes_before_sweep | no_sweep_expected
- tp_sweep_alignment — at_reward_sweep | beyond_reward_sweep | before_reward_sweep | no_reward_sweep
- trap_reconciliation_complete — boolean confirming all three legs (entry/SL/TP) were reconciled against the trap map

Mandatory on every scan, for both hypothesis_buy and hypothesis_sell.

THE SYMMETRIC RULE
The trap map is not a SELL-trade concern or a BUY-trade concern — it is a market-structure concern. For BUY theses, the invalidation side is below price (equal lows, session lows, prior-day lows); for SELL theses, the invalidation side is above price (equal highs, session highs, prior-day highs). Alpha reasons both sides on every scan.

PROHIBITED
1. Anchor-to-structure SL language ("above the recent swing high", "below the recent swing low") that masks trap-awareness
2. "Structural breathing room" framing that decouples SL placement from sweep reasoning
3. Any SL-placement phrasing that does not also name the liquidity pool adjacent to it

ENFORCEMENT
- Build-time audit script scripts/audit-alpha-identity.cjs blocks forbidden anchor-to-structure tokens (symmetric buy/sell)
- Six audit fields are schema-required; responses missing them are rejected at the transport layer by OpenAI Structured Outputs strict mode
- PRs that reintroduce decoupled SL/TP anchor procedures must be rejected on architectural grounds',
  true,
  '3e2d7a20-ebe0-46eb-b435-0525946c0c29'
);
