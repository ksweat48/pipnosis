/*
  # CCIP-2026-03-04: LLM Queue & Session Timeout Fix

  ## Problem
  Alpha AI was returning NO_TRADE for all 9 symbols on every scan.

  ## Root Cause
  The global LLM queue (openai-client.ts) enforced 4000ms minimum inter-call spacing.
  With maxConcurrentSymbols=3 and up to 2 LLM calls per symbol (Omega-8 + Alpha),
  the queue serialised 6 consecutive LLM calls = 20s+ of pure queue wait alone.
  London session timeout was 70s. With queue wait (20s) + API latency (10s) +
  snapshot build (5s) = 35s plus retries, symbols consistently hit the 70s limit
  BEFORE the Alpha LLM call completed.
  Timeout handler returns confidence=0 → fails Gate #5 CONFIDENCE_THRESHOLD
  in best-symbol-selector.ts → ALL 9 symbols rejected → NO_TRADE every scan.

  ## Fix (frontend code changes)
  1. src/services/openai-client.ts
     - minInterCallMs: 4000ms → 1500ms
     Still prevents thundering-herd 429 errors. At 1500ms, 6 queued calls complete
     in ~9s vs 20s at 4000ms.

  2. src/config/concurrent-execution-config.ts
     - maxConcurrentSymbols: 3 → 2
     Reduces peak queue depth from 6 to 4 LLM slots per batch.
     Queue wait for 4 calls at 1500ms = 6s (down from 20s).
     - Session timeouts extended:
       asian: 60000ms → 90000ms
       london: 70000ms → 100000ms  (NAS100/US30 were logging prod timeouts)
       nyse: 80000ms → 110000ms
       overlap: 90000ms → 120000ms
       off_hours: 50000ms → 75000ms
     - symbolTimeoutMs: 60000ms → 90000ms
     - batchTimeoutMs: 180000ms → 360000ms

  ## SSOT Compliance
  - openai-client.ts is the single authority for LLM queue behaviour
  - concurrent-execution-config.ts is the SSOT for all concurrency parameters
  - No other files reference or duplicate these values

  ## Governance Compliance
  - This migration file IS the audit trail per CCIP protocol
  - Config changes are versioned in source control
  - Migration filename encodes the CCIP change ID and date
*/

SELECT 'CCIP-2026-03-04: LLM queue timeout fix applied — audit record in migration history' AS ccip_audit_status;
