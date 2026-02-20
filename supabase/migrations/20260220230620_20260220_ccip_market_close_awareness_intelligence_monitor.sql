/*
  # CCIP Market Close Awareness — Intelligence Monitor

  ## Summary
  Documents the architectural decision to make the Intelligence Monitor
  and Scan Now function market-close aware.

  ## Behavioral Contract
  - Forex/Index market is CLOSED Friday 5pm EST – Sunday 5pm EST
  - When closed, Intelligence Monitor MUST NOT display Forex/Index pairs
  - Only 24/7 crypto pairs (BTCUSD, ETHUSD) are shown when forex is closed
  - Scan Now restricts to crypto-only when forex market is closed (server-enforced)
  - XAUUSD follows standard Forex weekend schedule (not treated as 24/7)
  - Server (scan-alpha-intelligence) is the enforcement authority
  - Client (SessionIntelligenceMonitor) mirrors this for UI-layer filtering

  ## SSOT Authorities
  - Market hours: src/utils/marketHours.ts
  - Symbol schedule: src/config/symbol-registry.ts
  - Server-side crypto check: netlify/functions/_shared/crypto-symbol-checker.ts
  - Scan execution: netlify/functions/scan-alpha-intelligence.ts

  ## Schema Change
  - Adds 'realtime_intelligence_calculator' to valid_entity_type constraint if not present
    (it already exists per constraint definition)
  - Governance record inserted for audit trail using allowed entity type
*/

INSERT INTO governance_change_log (
  operation,
  entity_type,
  entity_id,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'configuration_change',
  'realtime_intelligence_calculator',
  gen_random_uuid(),
  '{"market_close_aware": false, "forex_pairs_shown_on_weekend": true, "scan_now_filters_crypto_only": false}'::jsonb,
  '{"market_close_aware": true, "forex_pairs_shown_on_weekend": false, "scan_now_filters_crypto_only": true, "xauusd_schedule": "forex", "crypto_symbols": ["BTCUSD", "ETHUSD"]}'::jsonb,
  'Intelligence Monitor must not show untradeable pairs on weekends. Scan Now restricts to crypto-only when forex market is closed. Server enforces independently of client.',
  '{"ccip_ref": "20260220_market_close_awareness", "authority": "scan-alpha-intelligence.ts + SessionIntelligenceMonitor.tsx", "ssot": "marketHours.ts + symbol-registry.ts", "files_changed": ["netlify/functions/scan-alpha-intelligence.ts", "src/components/SessionIntelligenceMonitor.tsx"]}'::jsonb
);
