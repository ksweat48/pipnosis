/*
  # Polling and Mid-Trade Monitor Fixes - CCIP Governance Compliant

  ## Problem Statement
  1. MidTradeMonitor had function scope bug: loadGuidance() defined in useEffect but called in onClick handler (stale closure)
  2. Excessive realtime subscriptions triggering on every trade update, causing polling "jumping"
  3. EntryPriceMonitor advisory data not showing - RPC calls timing out or data not available

  ## Solution Architecture (CCIP Compliant)

  ### System Map
  - MidTradeMonitor: User clicks refresh → loadGuidance executes guidance fetch
  - Realtime subscription: Only react to meaningful trade state changes (status/SL/TP changes, not heartbeats)
  - EntryPriceMonitor: Fetch advisory data → Retry with exponential backoff if delayed

  ### Logic Contract
  - All polling changes are purely CLIENT-SIDE (no database changes)
  - Frontend ONLY refactors to fix closure and subscription issues
  - Advisory retry logic is non-blocking and follows governance principles
  - Engines validate (realtime subscription filters), Alpha decides (on data received)

  ### Dry-Run Simulation
  - MidTradeMonitor refactor: Extracted loadGuidance to component scope
  - Added smart filtering: Hash trade state before triggering refresh
  - EntryPriceMonitor: Added exponential backoff retry (1s, 2s, 3s, 4s, 5s)

  ### Compatibility Check
  - All changes backward compatible with existing data models
  - Realtime subscriptions still work, just smarter filtering
  - No RLS policy changes needed
  - No data migrations required

  ### Staged Deployment
  - Client-side only changes
  - No database schema modifications
  - No production data at risk

  ### Post-Deploy Verification
  - Monitor: "Mid-Trade Intelligence" refresh button works when clicked
  - Monitor: Guidance updates only on meaningful trade changes
  - Monitor: No excessive refreshes from heartbeats
  - Monitor: "Entry Quality Advisor" eventually shows after trade execution
  - Monitor: Retry logic with exponential backoff ensures data availability

  ## Files Modified
  1. src/components/MidTradeMonitor.tsx
     - Extracted loadGuidance to component scope (fixes closure bug)
     - Added smart trade state hashing to filter unnecessary updates
     - Parameter: loadGuidance(fromUser) to distinguish user clicks vs auto-refresh

  2. src/components/EntryPriceMonitor.tsx
     - Added exponential backoff retry logic (1s-5s)
     - Handles delayed advisory data creation gracefully
     - Maximum 5 retries before settling to "analyzing" state

  ## GOVERNANCE PRINCIPLES APPLIED
  - Non-breaking: All changes are client-side, data access patterns unchanged
  - Intelligent degradation: Retries with backoff vs silent failures
  - Transparency: Console logs track all polling decisions
  - Immutability: No state mutations outside intended update paths
  - SSOT: Still delegating to services for truth

  ## Security Impact: None
  - No authentication changes
  - No RLS policy changes
  - Client-side only refactoring

  ## Performance Impact: Positive
  - Fewer realtime events processed (smart filtering)
  - Reduced component re-renders from unnecessary updates
  - Smoother UX without polling jumps
*/

-- This migration is DECLARATIVE ONLY (no SQL execution)
-- All changes are client-side TypeScript refactoring
-- No database schema, triggers, or functions modified

SELECT 'Polling and Monitor Fixes - CCIP Governance Tracking' as migration_note;
