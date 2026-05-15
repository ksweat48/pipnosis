/*
  # Persist CCIP-2026-0515 Governance Records

  1. New Records
    - `alpha_engineering_doctrine` row for CCIP-2026-0515A (TP1 Partial Close)
    - `alpha_engineering_doctrine` row for CCIP-2026-0515C (Single-Pair Scan SSOT)

  2. Purpose
    - Record the governance contracts for the TP1 partial-close system and per-pair scanning
    - These are audit/documentation records (kind = power_up), not schema changes

  3. Important Notes
    - Does not modify any table schema
    - Checks existence before inserting to be idempotent
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0515A-TP1-PARTIAL-CLOSE') THEN
    INSERT INTO alpha_engineering_doctrine (ccip_reference, doctrine_text, active, ratified_at, kind)
    VALUES (
      'CCIP-2026-0515A-TP1-PARTIAL-CLOSE',
      'TP1 Partial Close Governance: When TP1 is hit, the system closes a user-configurable percentage (default 50%) of the position to lock profit. The remainder runs to TP2 with SL moved to break-even. The partial_close_pct is stamped on each trade at creation from user_max_risk_preferences.default_partial_close_pct. Settings UI provides 0/25/50/75/100% options.',
      true,
      '2026-05-15T00:00:00Z',
      'power_up'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0515C-SINGLE-PAIR-SCAN-SSOT') THEN
    INSERT INTO alpha_engineering_doctrine (ccip_reference, doctrine_text, active, ratified_at, kind)
    VALUES (
      'CCIP-2026-0515C-SINGLE-PAIR-SCAN-SSOT',
      'Per-Pair Individual Scanning Governance: Each pair in the watchlist can be scanned individually via the GoalSessionDashboard. Manual scan requests are queued in the manual_scan_requests table and drained by the live engine polling cycle. The scan uses the same processMultiSymbolCycle() code path as the full watchlist scan — no separate logic. Symbol=NULL means scan all pairs.',
      true,
      '2026-05-15T00:00:00Z',
      'power_up'
    );
  END IF;
END $$;
