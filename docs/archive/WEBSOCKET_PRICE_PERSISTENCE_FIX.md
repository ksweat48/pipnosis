# WebSocket Price Persistence Fix

## Problem Identified

The `save-websocket-price` Netlify Function was throwing "supabaseUrl is required" errors despite:
- WebSocket feeds working correctly (Kraken connected with 491 symbols)
- Data flowing from browser to backend
- No relationship to forex market hours

## Root Cause

**Environment Variable Configuration Bug**

The function was incorrectly using `VITE_SUPABASE_URL`:
```typescript
const supabaseUrl = process.env.VITE_SUPABASE_URL!;
```

**Why this failed:**
- `VITE_` prefixed variables are build-time only (compiled into frontend bundle)
- Netlify Functions run at **runtime** and cannot access `VITE_` variables
- The variable was literally `undefined` at runtime, causing failures

## Solution Applied

### 1. Fixed Environment Variable Access
Updated `netlify/functions/save-websocket-price.ts`:
```typescript
// OLD (BROKEN)
const supabaseUrl = process.env.VITE_SUPABASE_URL!;

// NEW (FIXED)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('[SaveWSPrice] Missing required environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
```

**Changes made:**
- Try `SUPABASE_URL` first (runtime variable)
- Fallback to `VITE_SUPABASE_URL` for compatibility
- Add explicit validation with clear error messages
- Fail loudly if configuration is missing

### 2. Updated Environment Documentation

Added to `.env.example`:
```bash
# Supabase Project URL for Netlify Functions (runtime access)
# REQUIRED: Netlify Functions need non-VITE_ prefixed variables
# Set this to the SAME value as VITE_SUPABASE_URL in Netlify Dashboard
SUPABASE_URL=your_supabase_project_url
```

Updated deployment checklist:
```bash
# Supabase (Required):
# ✓ VITE_SUPABASE_URL (for frontend build)
# ✓ SUPABASE_URL (for Netlify Functions runtime - SAME value as VITE_SUPABASE_URL)
# ✓ VITE_SUPABASE_ANON_KEY
# ✓ SUPABASE_SERVICE_ROLE_KEY (critical for functions)
```

## Expected Results

After deployment completes (3-5 minutes):

1. **Errors Stop**: No more "supabaseUrl is required" errors in function logs
2. **Data Persists**: WebSocket prices save to `realtime_prices` table
3. **Performance Improves**: Charts get 30-100x more price ticks when browser is open
4. **Admin Dashboard**: Shows successful saves in WebSocket Price Feeds panel

## Deployment Status

- **Built**: ✅ Successfully (Jan 1, 2026)
- **Deployed**: ✅ Triggered via build hook
- **Status**: Deploying (check Netlify dashboard)

## Next Steps

1. **Wait for deployment** to complete (3-5 minutes)
2. **Verify in Netlify**: Check function logs for `save-websocket-price`
   - Should see no more errors
   - Should see successful 200 responses
3. **Test WebSocket flow**:
   - Open app with browser WebSocket enabled
   - Verify Kraken shows "Connected"
   - Check that prices are being saved to database
4. **Monitor Admin Dashboard**:
   - WebSocket Price Feeds panel should show active saves
   - "Last tick" timestamp should update frequently

## Why This Wasn't Caught Earlier

Other functions (like `hybrid-price-collector`) were working because they already used the correct pattern:
```typescript
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
```

This function was a newer addition that used the wrong pattern initially.

## Prevention

All Netlify Functions should:
1. Use `SUPABASE_URL` (not `VITE_SUPABASE_URL`) as primary
2. Include fallback for compatibility
3. Validate configuration on startup
4. Fail loudly with clear error messages

## Related Files

- `netlify/functions/save-websocket-price.ts` - Fixed function
- `.env.example` - Updated documentation
- `netlify/functions/hybrid-price-collector.ts` - Reference implementation
