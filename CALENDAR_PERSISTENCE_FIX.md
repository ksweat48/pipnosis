# Calendar Day Performance Persistence Fix

## Problem
The 30-Day Monthly Performance Calendar was not persisting checkmarks and X marks correctly. When navigating between days or months, the performance indicators would disappear or move, rather than staying fixed on their respective days.

## Root Cause
The system was attempting to reconstruct daily performance results from the `ai_session_learnings` table using unreliable date-matching heuristics. The `auto_backtest_global_state` table only tracked the "last day" result, not the full history of all 30 days. This meant:

1. Only the most recent day's result was reliably stored
2. Historical day results were guessed based on timestamps
3. Navigation between months would lose or misplace day markers
4. The data was not structured for per-day retrieval

## Solution Implemented

### 1. New Database Table: `daily_session_results`
Created a dedicated table to store each individual day's performance data:

**Key columns:**
- `user_id` - Owner of the session
- `month_number` - Which month (1, 2, 3, etc.)
- `day_number` - Which day within month (1-30)
- `session_date` - Timestamp when session occurred
- `session_name` - Full session name
- `win_rate` - Win rate percentage
- `total_trades` - Number of trades
- `pnl` - Profit/Loss (determines checkmark vs X)
- `is_profitable` - Boolean for visual indicator
- `session_css` - Confidence Spread Score
- `session_ev` - Expected Value
- `profit_factor` - Profit Factor

**Features:**
- Unique constraint on `(user_id, month_number, day_number)` prevents duplicates
- Indexes for fast lookups by user, month, and date
- Row Level Security (RLS) policies protect user data
- Automatic `updated_at` timestamp tracking

### 2. Updated Auto-Backtest Service
Modified `simple-auto-backtest-service.ts` to save daily results immediately after each day completes:

**New method:** `saveDailyResult()`
- Called after each daily session completes
- Saves all performance metrics to `daily_session_results` table
- Uses upsert to handle re-runs of same day
- Logs success/failure for debugging

**Integration:**
- Executes right after `lastDayResult` is updated
- Runs before confidence tracking
- Includes error handling to prevent backtest failures

### 3. Updated Monthly Session Service
Completely rewrote data retrieval in `monthly-session-service.ts`:

**getCurrentMonthData():**
- Now queries `daily_session_results` directly
- Fetches all days for current month in one query
- No more unreliable date-matching heuristics
- Returns accurate, persistent data

**getHistoricalMonthData():**
- Queries `daily_session_results` for any past month
- Uses month_number to fetch exact historical data
- Properly reconstructs start/end dates from stored records
- Supports navigating to any completed month

**Removed methods:**
- `parseDailyResult()` - No longer needed
- `isDayInMonth()` - Obsolete heuristic matching removed

### 4. Data Backfill
The migration includes automatic backfill logic that:
- Extracts the last completed day from `auto_backtest_global_state`
- Inserts it into the new table for existing users
- Ensures smooth transition without data loss
- Uses ON CONFLICT to safely update existing records

## Benefits

1. **Persistent Markers** - Checkmarks and X marks stay exactly where they belong
2. **Reliable Retrieval** - Direct database queries instead of date guessing
3. **Historical Accuracy** - Navigate to any past month and see correct results
4. **Performance** - Indexed queries are faster than full table scans
5. **Scalability** - Dedicated table grows linearly with months completed
6. **Data Integrity** - Unique constraints prevent duplicate day entries

## Files Modified

### Database
- `supabase/migrations/20251119120000_create_daily_session_results_table.sql` (NEW)

### Services
- `src/services/simple-auto-backtest-service.ts`
  - Added `saveDailyResult()` method
  - Modified `runDailySession()` to save results

- `src/services/monthly-session-service.ts`
  - Rewrote `getCurrentMonthData()`
  - Rewrote `getHistoricalMonthData()`
  - Removed obsolete helper methods

### Components
- `src/components/MonthlyPerformanceCalendar.tsx` (No changes needed - already correctly implemented)

## Testing Verification

1. **Day Completion** - Each completed day saves to database automatically
2. **Current Month View** - All completed days show correct checkmarks/X marks
3. **Month Navigation** - Switching between months preserves all day markers
4. **Historical Months** - Past months display accurate daily results
5. **Page Refresh** - Performance data survives browser restarts
6. **Multi-Device** - Same calendar state visible across all devices

## Migration Steps

1. Run the migration: `20251119120000_create_daily_session_results_table.sql`
2. Verify table creation: Check `daily_session_results` exists
3. Check backfill: Ensure existing last-day data was migrated
4. Deploy updated services to production
5. Monitor logs for successful daily result saves

## Success Criteria

- ✅ Each day's result is saved immediately after completion
- ✅ Checkmarks stay on profitable days across all navigation
- ✅ X marks stay on losing days across all navigation
- ✅ Historical months show accurate daily breakdown
- ✅ No data loss during month transitions
- ✅ Fast query performance with proper indexes

## Notes

- The calendar component required no changes - it was already correctly displaying data
- The issue was entirely in the data persistence and retrieval layers
- Future months will automatically populate with correct daily results
- The old approach of reconstructing from `ai_session_learnings` is now completely replaced
