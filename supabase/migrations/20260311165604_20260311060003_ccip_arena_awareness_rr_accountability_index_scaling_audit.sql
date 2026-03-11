/*
  # CCIP Governance Audit — Three Alpha Intelligence Fixes (2026-03-11)

  Records three CCIP change control entries documenting governance-compliant fixes
  to Alpha's prompting, arena intelligence, and INDEX price-tier envelope scaling.
*/

DO $$
DECLARE
  admin_id uuid := '30177afc-5b98-41ab-832a-a3e5a875e6c0';
BEGIN

  IF NOT EXISTS (
    SELECT 1 FROM ccip_change_requests
    WHERE change_title LIKE 'CCIP-2026-03-11-01%'
  ) THEN
    INSERT INTO ccip_change_requests (
      change_title, change_type, priority, requested_by, description,
      business_justification, technical_impact, risk_assessment,
      ccip_status, governance_status, deployed_at, deployment_method,
      modified_files, database_changes, breaking_changes
    ) VALUES (
      'CCIP-2026-03-11-01: Dynamic INDEX Price-Tier Envelope Scaling',
      'feature', 'high', admin_id,
      'INDEX SCALP walls were too wide at high nominal prices. US30 at $47k produced SL floor of 70 pips (0.15%) far too wide for M5 SCALP. NAS100 at $25k produced 37 pips. The percentage must scale inversely with nominal price magnitude.',
      'Fix ensures structurally meaningful SL walls at all index price levels. US30 now targets 23-61 pips SL floor (0.05%-0.13% of $47k). Self-adjusting: any future index price level handled automatically.',
      'Added INDEX_PRICE_TIERS (5 tiers) to wall-calibration-config.ts as SSOT. Added getIndexPriceTierBounds(). style-execution-envelopes.ts intercepts INDEX asset class and applies price-tier-scaled percentages.',
      'low', 'deployed', 'retrospective_review', now(), 'direct',
      ARRAY['src/config/wall-calibration-config.ts', 'src/config/style-execution-envelopes.ts'],
      false, false
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ccip_change_requests
    WHERE change_title LIKE 'CCIP-2026-03-11-02%'
  ) THEN
    INSERT INTO ccip_change_requests (
      change_title, change_type, priority, requested_by, description,
      business_justification, technical_impact, risk_assessment,
      ccip_status, governance_status, deployed_at, deployment_method,
      modified_files, database_changes, breaking_changes
    ) VALUES (
      'CCIP-2026-03-11-02: Arena Architecture Awareness in Alpha Prompts',
      'feature', 'high', admin_id,
      'Alpha received raw pip walls with no percentage context or survival floor explanation. Alpha saw 23.5 pips for US30 with no understanding that this is 0.05% of $47,239 — the minimum noise floor for that instrument.',
      'Alpha now understands walls are derived from price-tier percentages, what survival floors mean per asset class, why sub-floor SLs are guaranteed stop-out territory, and R:R break-even win rate math.',
      'omega9-constraint-provider.ts formatDualArenaForPrompt() includes ARENA INTELLIGENCE section. alpha-identity.ts includes ARENA ARCHITECTURE AWARENESS section and R:R ACCOUNTABILITY PRINCIPLE at top of all style prompts.',
      'low', 'deployed', 'retrospective_review', now(), 'direct',
      ARRAY['src/services/omega9-constraint-provider.ts', 'src/config/alpha-identity.ts'],
      false, false
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ccip_change_requests
    WHERE change_title LIKE 'CCIP-2026-03-11-03%'
  ) THEN
    INSERT INTO ccip_change_requests (
      change_title, change_type, priority, requested_by, description,
      business_justification, technical_impact, risk_assessment,
      ccip_status, governance_status, deployed_at, deployment_method,
      modified_files, database_changes, breaking_changes
    ) VALUES (
      'CCIP-2026-03-11-03: R:R Advisory Freedom With Accountability',
      'config', 'high', admin_id,
      'Three violations: formatConstraintsForPrompt said Auto-corrected to minimum but system issues WARNING not correction. alpha-identity structural fact 3 said R:R below 1.0:1 is a hard block — incorrect. Late Stage gates said must be exactly X:1 — too rigid.',
      'Alpha has full freedom to place SL/TP where structure demands. Sub-1.0:1 R:R requires explicit justification with break-even win rate stated. Preserves Alpha authority while requiring accountability.',
      'formatConstraintsForPrompt corrected to advisory-only language. alpha-identity structural fact 3 changed to advisory with mandatory justification. SCALP/MICRO/INTRADAY Late Stage gates use freedom+accountability model. coordinator-alpha.ts stopLossDirective adds % of price context.',
      'low', 'deployed', 'retrospective_review', now(), 'direct',
      ARRAY['src/services/omega9-constraint-provider.ts', 'src/config/alpha-identity.ts', 'src/brains/coordinator-alpha.ts'],
      false, false
    );
  END IF;

END $$;
