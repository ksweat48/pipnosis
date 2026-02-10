/*
  # Consolidate Entry Monitors - CCIP Audit Trail

  1. Change Summary
    - Consolidated two entry monitors (SimpleEntryMonitor + EntryPriceMonitor) into one unified real-time entry advisory
    - Removed deprecated "Enter Trade Now at Market Price" button
    - Fixed entry zone calculation: zones now anchored to Alpha's actual execution price
    - New monitor compares live market price against Alpha's actual entry to advise manual traders

  2. Architecture Changes
    - REMOVED: SimpleEntryMonitor component
    - MODIFIED: EntryPriceMonitor -> real-time entry advisory (ENTER_NOW / AT_ALPHA / WAIT_PULLBACK)
    - MODIFIED: createPostExecutionEntryIntent recenters zone around actual execution price

  3. SSOT Compliance
    - Entry advisory SSOT: entry_intents.actual_entry_price
    - Live price SSOT: realtime_prices table
    - Style tolerances: SCALP (1.5 pip), MICRO_INTRADAY (3 pip), INTRADAY (5 pip)

  4. Governance
    - Purely advisory and non-blocking
    - No database schema changes
*/

-- No schema changes needed. This migration is a CCIP governance audit record only.
-- The changes are application-level (TypeScript/React component consolidation).
SELECT 1;
