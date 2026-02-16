/*
  # CCIP: Fix Single-Symbol No-Trade Dialog and Realtime Prices RLS

  ## Change Control Summary
  - **CCIP Tracking ID**: CCIP-20260216-001
  - **Category**: Bug Fix + RLS Security Fix
  - **Risk Level**: Low
  - **Affected Systems**: Goal Session Live Engine, Alpha Thought Stream, Browser Price Poller

  ## Changes

  ### 1. Frontend Fix: "undefined" Symbol Display in Alpha Thoughts
  - **File**: `src/services/event-based-llm-engine.ts` (line 312)
  - **Root Cause**: `this.symbol` referenced on EventBasedLLMEngine class which has no `symbol` property
  - **Fix**: Changed to `config.symbol` (the correct SSOT reference passed via method parameter)
  - **SSOT Compliance**: `config.symbol` is the single source of truth for symbol in the engine config
  - **Impact**: Alpha Thinking feed now shows "XAUUSD: 1/5 conditions met" instead of "undefined: 1/5 conditions met"

  ### 2. Frontend Fix: Single-Symbol Path Missing NoTradesFoundDialog
  - **File**: `src/services/goal-session-live-engine.ts` (single-symbol processCandleAutonomous path)
  - **Root Cause**: The multi-symbol path correctly called `emitNoTradeEvent()` when no trade found,
    but the single-symbol path silently continued polling forever with no user feedback
  - **Fix**: Added `emitNoTradeEvent()` call in single-symbol path after first full scan with no trade
  - **SSOT Compliance**: `emitNoTradeEvent()` is the single authority for emitting no-trade events
    (now used by both multi-symbol and single-symbol paths). The `NoTradesFoundDialog` component
    is the single authority for presenting no-trade UI to the user.
  - **Behavior**: After Alpha plans strategy + checks conditions + finds no qualifying trade,
    the system stops polling and shows the NoTradesFoundDialog with 60-second countdown

  ### 3. Frontend Fix: NoTradesFoundDialog Missing Countdown Timer
  - **File**: `src/components/NoTradesFoundDialog.tsx`
  - **Root Cause**: Dialog had no auto-close mechanism, requiring manual user interaction
  - **Fix**: Added 60-second countdown timer with visual progress bar. Session auto-closes when
    countdown reaches zero. User can also manually close at any time.

  ### 4. RLS Fix: realtime_prices Browser INSERT 403 Error
  - **Root Cause**: `tick-buffer-service.ts` performs INSERT on `realtime_prices` using
    authenticated user session, but RLS only allows `service_role` to insert
  - **Fix**: Add INSERT policy for authenticated users on `realtime_prices`
  - **Security**: INSERT-only (no UPDATE/DELETE for authenticated users). Price data is
    non-sensitive market data. Browser writes complement server-side price collection.
  - **SSOT Compliance**: `realtime_prices` is the single authority for live price data.
    Both browser polling and server-side cron write to this single table.

  ## Governance Audit Trail
  - No re-planning mechanism added (by design - Alpha scans once per session)
  - Trade style is never overridden (Alpha honors user's selected style)
  - Session stops cleanly after no-trade dialog closes
*/

-- 4. Fix realtime_prices RLS: Allow authenticated users to INSERT price data
-- This fixes the 403 Forbidden error when browser-side polling writes prices
CREATE POLICY "Authenticated users can insert prices"
  ON realtime_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
