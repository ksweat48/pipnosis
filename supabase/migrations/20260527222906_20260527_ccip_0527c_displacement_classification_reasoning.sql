/*
  # CCIP-2026-0527C: Displacement Classification Reasoning

  1. Changes
    - Inserts doctrine record for CCIP-2026-0527C into `alpha_engineering_doctrine`
    - Documents the Displacement Classification amendment to Alpha's identity
    - Type: power_up (reasoning quality improvement)

  2. Purpose
    - Gives Alpha the cognitive framework to distinguish REVERSAL displacements
      from CONTINUATION displacements after a liquidity sweep
    - Both types are tradeable — the sweep is the setup, reclaim quality is the direction selector
    - Addresses counter-trend displacement success rate concern by ensuring Alpha
      does not blindly treat every sweep as a reversal setup

  3. Doctrine Compliance
    - Amends CCIP-2026-0527B (Displacement Hunter)
    - Compliant with Raw-Data Doctrine (0512A) — no new verdict labels or interpretations
    - Compliant with Alpha Autonomy Doctrine (0511ZZ) — improves reasoning, does not constrain
    - Compliant with Sealed-Prompt Doctrine (0513J) — no directional prescriptions
*/

INSERT INTO alpha_engineering_doctrine (
  id,
  ccip_reference,
  kind,
  power_up_name,
  ratified_at,
  active,
  doctrine_text
)
SELECT
  gen_random_uuid(),
  'CCIP-2026-0527C',
  'power_up',
  'Displacement Classification — Reversal vs Continuation',
  now(),
  true,
  'Every sweep is a displacement setup. Reclaim quality determines direction. REVERSAL DISPLACEMENT: BOS in reclaim direction + elevated volume + strong bodies = trapped participants fuel sprint back. CONTINUATION DISPLACEMENT: No BOS in reclaim direction + normal volume + FVG unfilled in original direction = fresh fuel acquired, price resumes. sweep_reversal_confirmed=true with a single weak candle is NOT genuine reclaim — genuine reclaim requires structural proof. Both types produce 30-120 minute sprints. The sweep is the setup — reclaim quality is the direction selector. Amends CCIP-2026-0527B.'
WHERE NOT EXISTS (
  SELECT 1 FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0527C'
);
