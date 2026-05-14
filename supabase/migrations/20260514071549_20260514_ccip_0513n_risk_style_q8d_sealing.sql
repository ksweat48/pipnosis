/*
  # CCIP-2026-0513N — Risk / Style / Q8D Sealing Doctrine

  See full description in audit-alpha-identity.cjs and CLAUDE.md. This
  migration:
  1. Deactivates the prior active doctrine row (CCIP-2026-0513M).
  2. Inserts the new ratified row with active = true and supersedes pointer.
*/

DO $$
DECLARE
  v_prior_id uuid;
BEGIN
  SELECT id INTO v_prior_id
  FROM alpha_engineering_doctrine
  WHERE active = true
  LIMIT 1;

  IF v_prior_id IS NOT NULL THEN
    UPDATE alpha_engineering_doctrine
    SET active = false
    WHERE id = v_prior_id;
  END IF;

  INSERT INTO alpha_engineering_doctrine (
    ccip_reference,
    ratified_at,
    doctrine_text,
    active,
    supersedes
  )
  SELECT
    'CCIP-2026-0513N-RISK-STYLE-Q8D-SEALING',
    now(),
    'CCIP-2026-0513N RISK / STYLE / Q8D SEALING DOCTRINE

Ratified 2026-05-14. Identity-level amendment to the Sealed-Prompt Doctrine.
Inherits all obligations from CCIP-2026-0511ZZ, 0512A, 0512B, 0513A, 0513B,
0513J, 0513K, 0513L, 0513M.

FOUNDATIONAL PREMISE
User dollar risk has zero authority over Alpha''s reasoning. A $100 setup and
a $10,000 setup are traded identically — position sizing is the user''s lever,
not Alpha''s. The platform has exactly one trade style (micro_intraday), so
no dynamic style directive belongs in the prompt. Alpha receives raw D1
candles + daily narrative as raw data; he does not pre-classify the week in
an English verdict enum.

PROHIBITED PROMPT CONTENT
1. Risk: ${riskMode.toUpperCase()} interpolation in any prompt template
2. Risk Mode: ${riskMode.toUpperCase()} interpolation in any prompt template
3. TRADE STYLE: ${tradeStyle.toUpperCase()} interpolation in any prompt template
4. Any styleDirective dynamic prompt variable
5. Q8D_weekly_narrative field references (field is deleted)
6. DELIVERY_BULLISH / DELIVERY_BEARISH / REBALANCING / UNCERTAIN literals as
   weekly-narrative enum values
7. Weekly context: ${...} narrative injection in trade-journal builders
8. Q8D-vs-action conflict gates (CCIP-2026-0324D detector is retired)

PERMITTED INTERNAL USAGE
- riskMode passed as a parameter to internal feasibility resolvers and
  lot-sizing services
- riskMode rendered in console.log diagnostics for engineering observability
- tradeStyle stored on the goal session SSOT (single value: micro_intraday)

ENFORCEMENT
- Build-time scanner scripts/audit-alpha-identity.cjs blocks the 10 new
  0513N forbidden patterns in coordinator-alpha.ts (RAW_DATA_TARGETS).
- Supabase row ccip_reference = ''CCIP-2026-0513N-RISK-STYLE-Q8D-SEALING''
  with active = true is the SSOT.

SUPERSESSION
Supersedes the Q8D-related obligations of CCIP-2026-0324D and the
Q8D_weekly_narrative enum-validation entry of CCIP-2026-0404A.

ENGINEERING LAW
Any PR that re-introduces the riskMode prompt injection, tradeStyle prompt
injection, or Q8D_weekly_narrative field — at any layer, in any module —
must be rejected on architectural grounds. The infrastructure is sealed.
Alpha reads raw data and decides.',
    true,
    v_prior_id
  WHERE NOT EXISTS (
    SELECT 1 FROM alpha_engineering_doctrine
    WHERE ccip_reference = 'CCIP-2026-0513N-RISK-STYLE-Q8D-SEALING'
  );
END $$;
