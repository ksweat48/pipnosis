/*
  # CCIP Alpha Prompt Governance — 5-Fix Package (2026-02-27)

  ## Summary
  Records the deployment of five prompt governance fixes to Alpha's decision framework
  in getAlphaSystemPromptForStyle (alpha-identity.ts). These fixes address root causes
  identified from two consecutive NAS100 stop-loss trades where Alpha produced incomplete
  reasoning and violated its own sub-mode rules.

  ## Changes Applied

  ### Fix 1: Three-Decision Framework Clarification
  Added an explicit "THE THREE DECISIONS" block at the top of all three style prompts.
  Defines EXECUTE_NOW, WAIT_PULLBACK, and NO_TRADE with exact behavioural contracts.
  WAIT_PULLBACK = confident trade with a timing preference, NOT a diplomatic middle ground.
  NO_TRADE = thesis unsound or environment undermines the trade itself.

  ### Fix 2: Dead Zone Rule — Style-Differentiated Hard Enforcement
  SCALP: Dead zone (20:00–07:00 UTC) = NO_TRADE unless exceptional justification named.
  WAIT_PULLBACK explicitly prohibited for dead zone scalps.
  MICRO_INTRADAY: Trades maturing into London permitted with confidence discount.
  INTRADAY: Mild liquidity discount only — WAIT_PULLBACK must be structural not session-based.

  ### Fix 3: Sub-Mode to Entry_Mode Hard Lock
  SUB-MODE B (PULLBACK_ENTRY) requires all 3 completion signals before execute_now:
  candle deceleration, pause at level, resumption candle/M1 BOS.
  execute_now while diagnosing PULLBACK_ENTRY with unconfirmed completion = self-contradiction.

  ### Fix 4: SL Structural Evidence — Named Level Mandatory
  Mandatory format: "SL at [price] — behind [TF] swing [high/low] at [reference]. Invalidates because [reason]."
  Prohibits: "noise floor", "recent high", "absorb volatility" as SL descriptions.
  Special note for NAS100/US30 wide-range instruments.

  ### Fix 5: Pre-Output Checklist Expanded to 10 Items
  New mandatory items: session phase with dead zone ruling, ATR phase with numeric estimate,
  move stage with entry position %, SL structural evidence.
  All items reframed as governance requirements.

  ## Governance
  - SSOT: alpha-identity.ts getAlphaSystemPromptForStyle() is the single authority
  - No schema changes — prompt-only governance update
*/

CREATE TABLE IF NOT EXISTS ccip_alpha_prompt_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployed_at timestamptz DEFAULT now() NOT NULL,
  change_type text NOT NULL,
  affected_file text NOT NULL,
  affected_function text NOT NULL,
  change_description text NOT NULL,
  governance_notes text,
  fix_count integer DEFAULT 1
);

ALTER TABLE ccip_alpha_prompt_deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read prompt deployments"
  ON ccip_alpha_prompt_deployments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can insert prompt deployments"
  ON ccip_alpha_prompt_deployments FOR INSERT
  TO service_role
  WITH CHECK (true);

INSERT INTO ccip_alpha_prompt_deployments (
  change_type,
  affected_file,
  affected_function,
  change_description,
  governance_notes,
  fix_count
) VALUES (
  'PROMPT_GOVERNANCE',
  'src/config/alpha-identity.ts',
  'getAlphaSystemPromptForStyle',
  '5-fix Alpha prompt governance package: (1) Three-Decision Framework block, (2) Dead zone NO_TRADE enforcement style-differentiated, (3) Sub-mode to entry_mode hard lock for PULLBACK_ENTRY, (4) SL named structural evidence requirement, (5) Pre-output checklist 10 mandatory items',
  'All three styles affected (SCALP, MICRO_INTRADAY, INTRADAY). Dead zone rule is style-differentiated. Root cause: NAS100 SL losses 2026-02-26/27 from incomplete reasoning and sub-mode rule violation.',
  5
);
