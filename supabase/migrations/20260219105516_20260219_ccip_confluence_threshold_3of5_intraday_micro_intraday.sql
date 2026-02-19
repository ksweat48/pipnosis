/*
  # CCIP Change Record: Confluence Threshold Reduction — INTRADAY + MICRO_INTRADAY

  ## Title
  CCIP-2026-0219C: Reduce minimum confluence from 4/5 to 3/5 for INTRADAY and MICRO_INTRADAY styles

  ## Summary
  Lowers the hard minimum confluence floor for INTRADAY and MICRO_INTRADAY trade styles
  from requiring 4 of 5 core dimensions to 3 of 5 core dimensions. SCALP remains unchanged
  at 2 of 5. This change reduces over-filtering that was producing zero-trade days while
  maintaining edge discipline — 3 confirmed independent dimensions still represents a
  multi-factor, non-speculative thesis.

  ## Files Changed
  - src/config/alpha-identity.ts
      Added CONFLUENCE_REQUIREMENTS export constant (SSOT for minimum floors).
      Updated Question 8 in getAlphaSystemPromptForStyle to enforce style-aware 3/5 rule.
      SCALP unchanged at 2/5; MICRO_INTRADAY and INTRADAY lowered to 3/5.
  - src/config/omega-thresholds.ts
      Bumped OMEGA_CONFIG_VERSION from 1.0.0 to 1.1.0.
      Added MIN_CORE_DIMENSIONS_* keys to CONFLUENCE_THRESHOLDS for downstream reference.

  ## SSOT / CCIP / Governance Compliance
  - SSOT: CONFLUENCE_REQUIREMENTS in alpha-identity.ts is the single authority for all
    minimum confluence floors. No other file may hardcode a confluence floor.
  - CCIP: Change is additive — new SSOT constant + prompt update. No removal of existing
    logic. Omega deterministic engines are unaffected (they score independently).
  - No DDL changes required — all confluence logic is prompt/config layer only.
  - No RLS changes required.
  - Backward-compatible: existing trades and sessions are unaffected.
  - Breaking change: No. Lowering the floor permits more trades; it does not break
    existing high-confluence trades.
  - Rollback: Restore MIN_DIMENSIONS values in CONFLUENCE_REQUIREMENTS and revert
    Question 8 template literal in getAlphaSystemPromptForStyle.

  ## Governance Rationale
  Prior value (4/5) was causing systematic over-filtering. Active trading days were
  producing zero-trade sessions on MICRO_INTRADAY and INTRADAY because all five
  dimensions rarely align simultaneously in normal market conditions. The 3/5 floor
  preserves multi-factor discipline while permitting action when strong structural
  confirmation exists across three independent analytical dimensions.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"SCALP_MIN": 2, "MICRO_INTRADAY_MIN": 4, "INTRADAY_MIN": 4, "total_core_dimensions": 5, "omega_config_version": "1.0.0"}',
  '{"SCALP_MIN": 2, "MICRO_INTRADAY_MIN": 3, "INTRADAY_MIN": 3, "total_core_dimensions": 5, "omega_config_version": "1.1.0", "ssot_constant": "CONFLUENCE_REQUIREMENTS in alpha-identity.ts"}',
  'CCIP-2026-0219C: Reduce MICRO_INTRADAY and INTRADAY minimum confluence from 4/5 to 3/5. Removes systematic over-filtering while preserving multi-factor edge discipline.',
  '{"ccip_id": "CCIP-2026-0219C", "breaking_change": false, "rollback_safe": true, "files_changed": ["src/config/alpha-identity.ts", "src/config/omega-thresholds.ts"], "style_changes": {"SCALP": "unchanged at 2/5", "MICRO_INTRADAY": "lowered from 4/5 to 3/5", "INTRADAY": "lowered from 4/5 to 3/5"}}'
);
