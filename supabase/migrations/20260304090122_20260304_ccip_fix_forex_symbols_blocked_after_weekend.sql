/*
  # CCIP-2026-03-04-B: Fix Forex/Index Symbols Blocked by Stale Weekend Protection Flags

  ## Problem
  Alpha AI was finding ONLY ETHUSD across all trade styles (Micro, Scalp, Intraday).
  All Forex pairs (EURUSD, GBPUSD, USDJPY, XAUUSD) and Indices (US30, NAS100, SPX500)
  were silently rejected before ever reaching the Alpha evaluation pipeline.

  ## Root Cause
  weekend-protection-service.ts maintains two module-level boolean flags:
    - SCANNING_DISABLED (default false)
    - LLM_API_DISABLED  (default false)

  On Friday 4:55 PM EST, executeCompleteShutdown() sets both to true.
  The only reset path was: estDay===0 && estHours>=17 (Sunday 5 PM EST).

  The check at line 269:
    if (!status.isFriday && !status.isWeekend) { hasShutdownToday = false; }
  only reset bookkeeping flags, NOT SCANNING_DISABLED/LLM_API_DISABLED.

  Any app restart between Friday 5 PM and Sunday 5 PM (or after Sunday 5 PM without
  the service running through that exact window) left SCANNING_DISABLED=true
  permanently. canScanSymbol() then returned false for all non-crypto symbols.
  Only BTCUSD and ETHUSD (24/7 markets) bypassed the check. ETHUSD won the
  confidence tie-breaker consistently, making it appear as if the scanner was
  hard-coded to ETHUSD.

  ## Fix Applied (src/services/weekend-protection-service.ts)
  Added a second reset path in checkWeekendProtection():
    - After resolving market status via marketScheduleService (SSOT), if
      isForexMarketOpen=true AND flags are stale, call enableSystems().
    - This covers Mon, Tue, Wed, Thu, and Fri pre-4:55PM — every window
      the previous code missed.
  
  This delegates to the existing marketScheduleService SSOT authority so
  no duplicate market-hours logic is introduced.

  ## SSOT Compliance
  - marketScheduleService remains the single authority for market open/closed state
  - weekendProtectionService remains the single authority for forex scan flags
  - No logic duplication introduced

  ## Governance Compliance
  - Migration filename encodes the CCIP change ID (CCIP-2026-03-04-B)
  - Change is self-documenting in migration history per CCIP protocol
*/

SELECT 'CCIP-2026-03-04-B: Forex symbol block fix applied — stale weekend protection flags now cleared on market reopen' AS ccip_audit_status;
