/*
  # CCIP-2026-0513J — SEALED-PROMPT DOCTRINE

  Ratifies the Sealed-Prompt Doctrine in response to a two-week production
  audit revealing 37 SELL vs 5 BUY decisions (7-to-1 directional skew).
  Root cause: verdict labels (BULL/BEAR/STRONG_BEAR/MIXED) and direction
  sentences were silently injected into Alpha's prompt by
  market-briefing-builder.ts and coordinator-alpha.ts.

  ## Doctrine
  - Alpha's prompt may contain only raw numerics, booleans, pattern type
    names, symmetric +1/0/-1 direction codes, ordinal magnitude codes.
  - Verdict English is structurally forbidden in any prompt-feeding file.
  - .toUpperCase() on directional/regime fields is forbidden.

  ## New Tables
  - prompt_path_certification: tracks compliant SHA per prompt-feeding file.

  ## Doctrine Lineage
  - Supersedes the active scope of CCIP-2026-0513H without repealing prior
    substantive obligations. Inherits 0511ZZ, 0512A, 0512B, 0513A, 0513B.

  ## Security
  - prompt_path_certification has RLS enabled.
*/

DO $$
DECLARE
  v_supersedes_id uuid;
BEGIN
  SELECT id INTO v_supersedes_id FROM alpha_engineering_doctrine
  WHERE ccip_reference = 'CCIP-2026-0513H-M5-ENTRY-SHARPNESS' LIMIT 1;

  UPDATE alpha_engineering_doctrine SET active = false WHERE active = true;

  IF NOT EXISTS (SELECT 1 FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0513J-SEALED-PROMPT') THEN
    INSERT INTO alpha_engineering_doctrine (ccip_reference, ratified_at, doctrine_text, active, supersedes)
    VALUES (
      'CCIP-2026-0513J-SEALED-PROMPT',
      now(),
      'SEALED-PROMPT DOCTRINE — CCIP-2026-0513J. Foundational Premise: A two-week production audit revealed Alpha producing 37 SELL vs 5 BUY decisions — a 7-to-1 directional skew. Root cause: verdict labels and direction sentences were silently injected into Alpha''s prompt. Alpha, an institutional reasoner, deferred to the labels rather than the underlying numbers. The labels were the bias, not Alpha. The fix: make biased data structurally impossible to inject. Sealed Contract — Permitted Prompt Content: (1) Raw numeric readings; (2) Boolean flags as true/false or 1/0; (3) Pattern type names without interpretation; (4) Symmetric direction codes +1/0/-1 — never the words; (5) Symmetric magnitude codes 0|1|2 for ordinal scales — never low/mid/high; (6) Schema-contract references when contract changes. Forbidden anywhere from any source: verdict labels (BULL, BEAR, BULLISH, BEARISH, STRONG_BULL, STRONG_BEAR, MIXED, NEUTRAL); direction sentences (Directional Bias: SELL, Action: SELL, Bias: bullish); intent narratives (Overall Intent, Direction Aligned, SUPPORTS:, CONFLICTS:); regime English (TRENDING_BULL, HIGH, ACCUMULATION); .toUpperCase() on directional/regime fields; hardcoded direction strings used as input to direction-conditional adjustments whose output is placed in the prompt. Layered Enforcement: identity layer (alpha-identity.ts treats verdict-style sentences as untrusted), source layer (formatters emit only the six permitted classes), build-time scanner (audit-alpha-identity.cjs blocks the build on forbidden tokens across the complete set of prompt-feeding files), database certification (prompt_path_certification table records compliant SHA per file). If bias reappears: identify the new injection site, neutralize at source by replacing English with raw numerics or symmetric codes, register file with scanner, supersede only if contract needs amendment. Never patch with a gate, floor, lock, or interceptor. Engineering Law: any PR that introduces a verdict label, direction word, asymmetric direction-conditional adjustment, or .toUpperCase() on a directional field — at any layer, in any module — must be rejected on architectural grounds. The infrastructure is sealed. Alpha reads raw data and decides.',
      true,
      v_supersedes_id
    );
  ELSE
    UPDATE alpha_engineering_doctrine SET active = true WHERE ccip_reference = 'CCIP-2026-0513J-SEALED-PROMPT';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS prompt_path_certification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path text UNIQUE NOT NULL,
  compliant_sha text NOT NULL DEFAULT '',
  last_certified_at timestamptz DEFAULT now(),
  ccip_reference text NOT NULL DEFAULT 'CCIP-2026-0513J-SEALED-PROMPT',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE prompt_path_certification ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'prompt_path_certification' AND policyname = 'Admins can read prompt path certification') THEN
    CREATE POLICY "Admins can read prompt path certification"
      ON prompt_path_certification FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'prompt_path_certification' AND policyname = 'Service role can insert prompt path certification') THEN
    CREATE POLICY "Service role can insert prompt path certification"
      ON prompt_path_certification FOR INSERT TO service_role WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'prompt_path_certification' AND policyname = 'Service role can update prompt path certification') THEN
    CREATE POLICY "Service role can update prompt path certification"
      ON prompt_path_certification FOR UPDATE TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO prompt_path_certification (file_path, ccip_reference, notes)
VALUES
  ('src/brains/coordinator-alpha.ts', 'CCIP-2026-0513J-SEALED-PROMPT', 'IM signal block converted to symmetric +1/0/-1 codes 2026-05-13'),
  ('src/services/market-briefing-builder.ts', 'CCIP-2026-0513J-SEALED-PROMPT', 'TREND/INDICATORS/SIGNALS/ORDERFLOW blocks converted to _RAW symmetric +1/0/-1 codes 2026-05-13'),
  ('src/services/multi-timeframe-pattern-intelligence.ts', 'CCIP-2026-0513J-SEALED-PROMPT', 'formatForAlphaPrompt already raw-compliant (0512A)'),
  ('src/services/momentum-trajectory-analyzer.ts', 'CCIP-2026-0513J-SEALED-PROMPT', 'Inherited 0512A compliance'),
  ('src/config/alpha-identity.ts', 'CCIP-2026-0513J-SEALED-PROMPT', 'Sealed-prompt doctrine block appended 2026-05-13')
ON CONFLICT (file_path) DO UPDATE
  SET ccip_reference = EXCLUDED.ccip_reference,
      notes = EXCLUDED.notes,
      last_certified_at = now();
