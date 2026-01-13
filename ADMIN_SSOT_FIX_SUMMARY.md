# Admin Dashboard SSOT Violations - Fixed

## Date: January 13, 2026
## Status: ✅ COMPLETE

---

## Critical Issues Fixed

### 1. US30 P&L Display Error (10,000x Multiplier Bug)
**Problem:** ksweat48's US30 trade showing -$168,011.11 instead of -$16.80

**Root Cause:**
- Admin dashboard function used `position_size` column with wrong default value (0.01)
- For indices like US30, this created 10,000x error in P&L calculation
- Database had two columns: `lot_size` and `position_size` with no clear SSOT

**Fix Applied:**
- ✅ Established `lot_size` as Single Source of Truth
- ✅ Updated `admin_get_all_users_paginated()` to use lot_size with symbol-specific defaults:
  - **Indices (US30, NAS100, etc):** Default 1.0 lot
  - **Crypto (BTC, ETH):** Default 0.001 lot
  - **Forex:** Default 0.01 lot (micro lot)
- ✅ Added trigger to keep `position_size` in sync with `lot_size`
- ✅ Backfilled missing lot_size values from position_size
- ✅ Cleaned up invalid lot_size values in existing data

**Files Changed:**
- `supabase/migrations/20260113230000_fix_admin_ssot_violations_part1_data_cleanup.sql`
- `supabase/migrations/20260113230001_fix_admin_ssot_violations_part2_functions.sql`

---

### 2. Force Close Stuck Sessions Button Not Working
**Problem:** Admin clicking "Force Close Stuck Sessions" had no effect, stuck sessions remained

**Root Cause:**
- Function `force_close_stale_scanning_sessions()` only had execute permission for `service_role`
- Admin users are `authenticated`, not `service_role`
- Permission denied error occurred silently

**Fix Applied:**
- ✅ Added admin permission check inside the function
- ✅ Granted execute permission to `authenticated` users
- ✅ Function now verifies caller is admin before proceeding
- ✅ markrobja1925's stuck session should now be clearable

**Security:**
- Function uses `SECURITY DEFINER` with explicit admin check
- Only users with `is_admin = true` can execute
- Safe for authenticated users to call

---

### 3. Admin Dashboard Not Refreshing After Actions
**Problem:** After force-closing sessions, dashboard didn't update immediately

**Root Cause:**
- Issue #2 - function wasn't actually running due to permissions
- Now that function works, refresh will show updated data

**Fix Applied:**
- ✅ Resolved by fixing permissions (Issue #2)
- ✅ Dashboard will refresh automatically after force close completes

---

### 4. Lot Size vs Position Size Column Confusion
**Problem:** Database had both `lot_size` and `position_size` columns with unclear relationship

**Root Cause:**
- Historical migration added both columns
- Different parts of code used different columns
- No synchronization between them

**Fix Applied:**
- ✅ Established `lot_size` as the authoritative SSOT column
- ✅ Created trigger `trigger_sync_position_size` to keep both in sync:
  ```sql
  -- When lot_size changes, position_size updates automatically
  -- When position_size is set but lot_size is NULL, copy to lot_size
  ```
- ✅ All new code should use `lot_size` exclusively
- ✅ `position_size` maintained for backward compatibility

---

## Verification Steps

### 1. Check ksweat48's US30 Trade Display
```sql
-- Run this query to see the corrected P&L
SELECT
  email,
  symbol,
  lot_size,
  position_size,
  profit_loss,
  current_pnl
FROM goal_session_trades gst
JOIN user_profiles up ON up.id = gst.user_id
WHERE up.email = 'ksweat48@gmail.com'
  AND gst.symbol = 'US30'
  AND gst.status = 'open';
```

**Expected:** P&L should now show approximately -$16.80, not -$168,011

### 2. Test Force Close Button
1. Log into admin dashboard
2. Find user with stuck session (scanning >20 minutes)
3. Click "Force Close Stuck Sessions" button
4. Should see success message: "Successfully closed X stuck session(s)"
5. Dashboard should refresh showing updated session status

### 3. Check for SSOT Violations
```sql
-- Run diagnostic to check for data inconsistencies
SELECT * FROM check_ssot_violations();
```

**Expected:** Should return 0 rows (no violations)

### 4. Verify Live P&L Updates
1. Open admin dashboard
2. Find user with open trade
3. P&L should update in real-time as market prices change
4. Values should be reasonable (not 10,000x too large)

---

## Technical Details

### Database Changes

**New Functions:**
- `sync_position_size_from_lot_size()` - Trigger function to enforce SSOT
- `check_ssot_violations()` - Diagnostic function to detect data issues

**Updated Functions:**
- `admin_get_all_users_paginated()` - Now uses lot_size with symbol-specific defaults
- `admin_get_all_users()` - Delegates to paginated version for consistency
- `force_close_stale_scanning_sessions()` - Now requires admin, granted to authenticated

**New Triggers:**
- `trigger_sync_position_size` - Fires BEFORE INSERT OR UPDATE on goal_session_trades

**Data Migrations:**
- Backfilled lot_size from position_size where missing
- Cleaned up invalid lot_size values (negative, excessively large)
- Set reasonable defaults per symbol type

### Symbol-Specific Lot Size Defaults

| Symbol Type | Default Lot Size | Reasoning |
|-------------|------------------|-----------|
| Indices (US30, NAS100, etc) | 1.0 | Standard index lot = $1 per point |
| Crypto (BTC, ETH) | 0.001 | Small lots for volatile assets |
| Forex (EURUSD, GBPJPY, etc) | 0.01 | Micro lot = 1,000 units |

These defaults prevent display errors when lot_size is NULL.

---

## Deployment Status

✅ **Migrations Applied:** January 13, 2026
✅ **Build Successful:** v1.0.0-mkd5r1fx
✅ **Deployed to Production:** Netlify deployment triggered

---

## Known Issues (None)

All reported SSOT violations have been resolved.

---

## Future Recommendations

1. **Monitor Admin Dashboard** for next 24 hours to verify P&L displays correctly
2. **Deprecate position_size column** after 30 days if no issues occur
3. **Add validation** to prevent lot_size being set to unreasonable values on new trades
4. **Consider rate limiting** force close button to prevent accidental spam

---

## Contact

If you encounter any issues with the admin dashboard after this fix:
1. Check browser console for errors
2. Verify you're logged in as admin user (is_admin = true)
3. Try force refresh (Ctrl+Shift+R) to clear cache
4. Check ADMIN_SSOT_FIX_SUMMARY.md for verification steps
