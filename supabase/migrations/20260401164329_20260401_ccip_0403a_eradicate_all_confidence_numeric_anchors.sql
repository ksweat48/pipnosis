/*
  # CCIP-2026-0403A: Complete Confidence Numeric Anchor Eradication

  ## Title
  Cascading Confidence Anchor Root-Cause Fix — All Six Layers Simultaneously

  ## Problem Statement
  The confidence pipeline has been patched three times (CCIP-0326A, CCIP-0332A, CCIP-0401A),
  and each time the deterministic 45% confidence output survived in a different layer.
  This is because six independent numeric anchors existed across five files, and previous
  fixes addressed only one or two per cycle.

  This migration is the SSOT governance record for the coordinated six-layer fix applied
  in CCIP-2026-0403A. All six anchors are removed in a single atomic change.

  ## Root Cause Analysis (Six Independent Anchors)

  ### Anchor 1 — NO_TRADE Schema Range (alpha-identity.ts:901)
  The NO_TRADE schema described trade_confidence as `<integer 0-49 ...>`.
  The `0-49` ceiling range itself acted as a numeric anchor. GPT-4o read the range midpoint
  or common values within it (45) as the canonical output. FIXED: Range removed. Pure
  conviction-first language now describes the field.

  ### Anchor 2 — BUY/SELL Schema Range (alpha-identity.ts:828)
  The BUY/SELL schema described trade_confidence as `<integer 50-100 — execution floor is 50>`.
  The `50-100` range and explicit mention of `50` as the floor was a numeric anchor.
  FIXED: Range removed. Pure evidence-derivation language replaces it.

  ### Anchor 3 — CONFIDENCE FLOOR gate text (alpha-identity.ts:813)
  The block-conditions text included: "trade_confidence below 50 = the executor will not run
  the trade." This taught GPT-4o that 50 is a meaningful threshold and that values near 50
  (like 49 or 45) represent near-edge cases. FIXED: Replaced with structural conviction
  language — no numeric threshold stated.

  ### Anchor 4 — confidence_cal bucket injection (coordinator-alpha.ts:5474)
  Per-scan prompt injection: `confidence_cal: 45%: win_rate=52% (n=8), 55%: win_rate=68%...`
  This placed every historical confidence bucket number directly in the prompt text on every
  single scan. GPT-4o read "45%: win_rate=52%" and calibrated 45 as the valid low-conviction
  output. This is the PRIMARY SURVIVING anchor from all previous patches.
  FIXED: Bucket numbers stripped. Qualitative tiers (LOW_CONVICTION, MID_CONVICTION,
  HIGH_CONVICTION) replace numeric labels. Key: `conviction_performance` replaces
  `confidence_cal` to prevent any model caching of the old format.

  ### Anchor 5 — meta_insights and validated_insights confidence % (coordinator-alpha.ts:5481, 5527)
  Insight injection format: `[${insight.confidence}%] pattern: XYZ` embedded numeric confidence
  percentages in brackets within every insight line. GPT-4o saw these numbers as confidence
  reference values. FIXED: Numeric percentages stripped from brackets. `[validated]` label
  used for meta_insights; `[n=X]` count only for validated_insights.

  ### Anchor 6 — Advisory floor service numeric text (alpha-adaptive-floor-service.ts:330, 342, 347)
  The getAdvisoryContext() method returned:
    "your minimum structural floor remains 50%"
    "  45%: 52.0% WR (n=8)"
    "An ACCEPTABLE setup (50-69%)"
  All three injected numeric confidence values directly into the per-scan advisory context.
  FIXED: Bucket labels replaced with qualitative tiers. "50%" removed from floor description.
  "(50-69%)" removed from ACCEPTABLE setup reference.

  ## Files Changed (SSOT Registry)

  1. src/config/alpha-identity.ts
     - Line 828: BUY/SELL schema trade_confidence range `<integer 50-100>` → conviction language
     - Line 813: CONFIDENCE FLOOR block text numeric `50` → structural language
     - Line 901: NO_TRADE schema trade_confidence range `<integer 0-49>` → conviction language
     - Line 925: ACCEPTABLE setup `(50-69%)` → removed numeric range
     - Line 1109: ACCEPTABLE setup `(50-69% confidence)` → removed numeric range
     - Line 1150: ACCEPTABLE trades `(50-69% confidence)` → removed numeric range
     - Line 1152: `BUY or SELL requires 50+. Below 50 means...` → structural language

  2. src/brains/coordinator-alpha.ts
     - Line 3493-3496: CONFIDENCE BANDS block with explicit ranges → CONVICTION STANDARD
       (85-100), (70-84), (50-69), (<50) all removed from live prompt text
     - Line 5471-5474: confidence_cal bucket injection with numeric labels → conviction_performance
       with qualitative tier labels (LOW_CONVICTION, MID_CONVICTION, HIGH_CONVICTION)
     - Line 5489: meta_insights `[${insight.confidence}%]` → `[validated]`
     - Line 5535: validated_insights `[${insight.confidence.toFixed(0)}%,n=...]` → `[n=...]`

  3. src/services/alpha-adaptive-floor-service.ts
     - Line 330: `${b.confidence_bucket}%: ...` → qualitative tier label
     - Line 342: `"your minimum structural floor remains 50%"` → conviction-based language
     - Line 347: `"An ACCEPTABLE setup (50-69%)"` → structural language without numeric range
     - Lines 341-344: suggestedThreshold% in floorNote → direction-only (raised/relaxed)

  ## Governance Principle (SSOT Authority)
  SSOT: This migration is the definitive audit record.
  CCIP contract: No numeric confidence value may appear in ANY live prompt text — not in system
  prompts, not in user prompts, not in advisory context. Numeric thresholds are for internal
  code logic (MINIMUM_TRADE_CONFIDENCE constant) and never for prompt text.
  The MINIMUM_TRADE_CONFIDENCE constant (value: 50) remains in the codebase as an
  execution gate — it is used by the executor to hard-block trades below the floor.
  It must NEVER be injected into any GPT-4o prompt string.

  ## Security & RLS
  No tables created. No RLS changes. This is a pure governance audit record migration.
*/

DO $$
BEGIN
  -- Insert governance record into ccip_governance_audit_log if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ccip_governance_audit_log'
  ) THEN
    INSERT INTO ccip_governance_audit_log (
      ccip_id,
      title,
      category,
      severity,
      files_changed,
      description,
      applied_at
    ) VALUES (
      'CCIP-2026-0403A',
      'Complete Confidence Numeric Anchor Eradication — All Six Layers',
      'confidence_anchor_fix',
      'critical',
      ARRAY[
        'src/config/alpha-identity.ts',
        'src/brains/coordinator-alpha.ts',
        'src/services/alpha-adaptive-floor-service.ts'
      ],
      'Removed all six independent numeric confidence anchors from the prompt pipeline. Previous patches (0326A, 0332A, 0401A) each fixed one or two anchors per cycle, allowing the deterministic 45% output to survive. This change removes all six simultaneously: (1) NO_TRADE schema 0-49 range, (2) BUY/SELL schema 50-100 range, (3) CONFIDENCE FLOOR 50 text, (4) confidence_cal bucket label injection, (5) meta/validated insight confidence% brackets, (6) advisory floor service numeric bucket labels and 50% floor text.',
      NOW()
    )
    ON CONFLICT (ccip_id) DO UPDATE SET
      applied_at = NOW(),
      description = EXCLUDED.description;
  END IF;

  -- Insert into tier7_ccip_tracking if it exists (alternative governance table)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tier7_ccip_tracking'
  ) THEN
    INSERT INTO tier7_ccip_tracking (
      ccip_id,
      change_type,
      change_description,
      files_affected,
      applied_at
    ) VALUES (
      'CCIP-2026-0403A',
      'confidence_anchor_eradication',
      'Six-layer confidence numeric anchor removal. Anchors: (1) NO_TRADE schema integer range 0-49, (2) BUY/SELL schema integer range 50-100, (3) CONFIDENCE FLOOR "below 50" text, (4) confidence_cal bucket numeric labels in prompt, (5) insight confidence% in prompt brackets, (6) advisory floor service numeric bucket/floor text. All replaced with qualitative conviction-first language.',
      ARRAY['src/config/alpha-identity.ts', 'src/brains/coordinator-alpha.ts', 'src/services/alpha-adaptive-floor-service.ts'],
      NOW()
    )
    ON CONFLICT (ccip_id) DO UPDATE SET
      applied_at = NOW(),
      change_description = EXCLUDED.change_description;
  END IF;
END $$;
