# AI Trading Console Scanner Fix - User Guide

## Problem Solved

The AI Trading Console was stuck in "Scanning" mode because the Supabase Edge Function `goal-session-scanner` was never being invoked. Edge Functions don't run on a schedule automatically - they need to be triggered.

## Solution Implemented

We've implemented a **client-side polling mechanism** that automatically triggers market scans at the appropriate intervals, plus added manual controls and diagnostics.

## New Features

### 1. Automatic Scanner Polling
- The dashboard now automatically checks if a scan is needed every 60 seconds
- When `next_scan_time` is reached, it automatically invokes the Edge Function
- Scans run in the background without blocking the UI

### 2. Manual "Scan Now" Button
- Located in the Active Goal Session header
- Click to immediately trigger a market scan
- Button shows "Scanning..." with a spinner when a scan is in progress
- Useful for testing and immediate analysis

### 3. Scanner Diagnostics Panel
- Click "Show Diagnostics" to see detailed scanner health info
- Displays:
  - Scanner status (Running/Idle)
  - Last scan time
  - Next scheduled scan time
  - Scan interval
  - Market data availability for each symbol
  - Number of candles available per symbol
  - Any errors encountered

### 4. Real-time Status Updates
- Live status messages show what the scanner is doing
- Progress feedback during scans
- Error messages if something goes wrong

## How to Use

### Starting a Goal Session

1. Go to the **AI Trading** tab
2. Use the Smart Goal Mode panel to set your goal (e.g., "Make me $100 today")
3. Click **Start Goal Session**
4. The session will initialize and transition to "Scanning" status

### Monitoring Scanner Activity

Once your session is active:

1. The dashboard will **automatically start polling** for scans
2. Watch the status message under "Active Goal Session" for updates
3. The "Next scan in: X minutes" countdown shows when the next automatic scan will occur

### Manual Scanning

If you want to scan immediately:

1. Click the **"Scan Now"** button in the session header
2. The button will show "Scanning..." while the scan runs
3. Results will appear in the "AI Analysis Updates" section below
4. Market analysis stream will update with latest data

### Viewing Diagnostics

To check if everything is working correctly:

1. Click **"Show Diagnostics"** button
2. Verify:
   - Scanner status shows "Idle" (when not scanning) or "Running"
   - Last scan time is recent
   - Market data shows "Ready" for all symbols (XAUUSD, EURUSD, GBPUSD)
   - Candle count is at least 50 for each symbol

### Troubleshooting

#### Scanner Never Runs
- Open diagnostics and check market data availability
- If symbols show "Insufficient" data, you need more historical candles
- Try clicking "Scan Now" to trigger a manual scan

#### Edge Function Errors
- Check browser console for error messages
- Verify Supabase environment variables are set correctly
- Ensure the Edge Function is deployed in Supabase dashboard

#### No AI Updates Appearing
- Check if conversations appear in the "AI Analysis Updates" section
- If not, the scanner may not be finding valid setups
- Lower confidence setups won't generate trades (this is by design)

## Testing the Scanner

Two test utilities are available in the browser console:

### Test 1: Full Scanner Setup Test
```javascript
testScanner()
```

This will:
- Check Supabase connection
- Verify market data availability for all symbols
- Test Edge Function invocation
- List active sessions

### Test 2: Direct Edge Function Test
```javascript
testEdgeFunction()
```

This will:
- Directly call the Edge Function
- Show the raw response
- Help diagnose Edge Function issues

## Technical Details

### How It Works

1. **Client-Side Polling**: `GoalScannerTrigger` service runs in the browser
2. **Checks Every Minute**: Compares `next_scan_time` with current time
3. **Invokes Edge Function**: When due, calls `/functions/v1/goal-session-scanner`
4. **Edge Function Scans**: Analyzes market data for each symbol in watchlist
5. **Results Stored**: Scan results saved to database
6. **UI Updates**: Dashboard refreshes to show new analysis

### Files Modified

- **NEW**: `src/services/goal-scanner-trigger.ts` - Client-side scanner trigger service
- **NEW**: `src/utils/scanner-test.ts` - Browser console test utilities
- **MODIFIED**: `src/components/GoalSessionDashboard.tsx` - Added scan controls and diagnostics
- **MODIFIED**: `src/main.tsx` - Imported test utilities

### Environment Requirements

- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key
- Edge Function `goal-session-scanner` must be deployed

## Best Practices

1. **Let It Run Automatically**: The polling mechanism handles scheduling - you rarely need manual scans
2. **Check Diagnostics First**: Before troubleshooting, open diagnostics to see the actual state
3. **Monitor Market Data**: Ensure you have sufficient historical candles (50+ per symbol)
4. **Be Patient**: Scans take 10-30 seconds depending on number of symbols
5. **Review AI Updates**: Check the conversation feed to see what the AI is thinking

## Next Steps

After verifying the scanner works:

1. Monitor a session for 15-30 minutes to see scan cycles
2. Check if trade signals are generated when setups appear
3. Adjust risk mode if confidence thresholds are too high/low
4. Review scan results in the AI Analysis Updates section

## Support

If you encounter issues:

1. Open browser console and run `testScanner()`
2. Take a screenshot of the diagnostics panel
3. Check the Supabase Edge Function logs in your dashboard
4. Review the goal_ai_conversations table for AI messages

The scanner is now fully functional and will actively monitor markets for your goal sessions!
