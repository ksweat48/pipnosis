# Backtest System - Quick Reference Guide

## Overview

The AI Training backtest system has been enhanced with robust error handling, batch operations, and data validation to ensure reliable performance.

## How to Run a Backtest

1. Navigate to `/admin/ai-training` (admin access required)
2. Fill in the backtest configuration:
   - **Session Name**: Descriptive name for this backtest
   - **Symbols**: Select one or more currency pairs (EURUSD, XAUUSD, etc.)
   - **Date Range**: Start and end dates for historical analysis
   - **Risk Mode**: Low, Medium, or High
   - **GPT-4 Reasoning**: Enable for AI-assisted trade decisions
   - **Confidence Threshold**: Minimum confidence level (0-100)
3. Click "Run Backtest"
4. Monitor progress in the console and UI

## What Happens During a Backtest

1. **Pre-flight Validation**: System checks if sufficient data exists
2. **Session Creation**: Creates a new `backtest_sessions` record
3. **Historical Analysis**: Processes candles one by one, generating signals
4. **Trade Simulation**: Executes qualifying trades and tracks P&L
5. **Results Storage**: Saves all trades and opportunities in batches
6. **Capability Scoring**: Calculates overall AI performance score

## Console Output Guide

### Normal Operation

```
[Backtesting] Session: My Test Backtest
[Backtesting] Period: 2025-11-07 to 2025-11-07
[Backtesting] Symbols: EURUSD
[Backtesting] ✅ Pre-flight check PASSED
[Backtesting] Processing candle 1/100 at 2025-11-07T00:00:00.000Z
[Backtesting] Session status updated to: running
[Backtesting] Saving results: 5 trades, 2 missed opportunities
[Backtesting] Inserting 5 trades in batches...
[Backtesting] Inserted trades 1-5 of 5
[Backtesting] ✅ All results saved successfully
[Backtesting] Session status updated to: completed
```

### Success Indicators
- ✅ Pre-flight check PASSED
- ✅ All results saved successfully
- ✅ Session status updated to: completed

### Error Scenarios

**Insufficient Data**
```
[Backtesting] Pre-flight check FAILED:
  ⚠️ Only 10 M5 candles for EURUSD (Flow V2 needs 500+)
```
**Solution**: Use a longer date range or ensure data backfill is complete

**Database Error**
```
[DB Error] UPDATE on backtest_sessions failed:
  Database column not found. Schema may be outdated.
```
**Solution**: Check that all migrations are applied to the database

## Database Tables

### backtest_sessions
Main backtest record with summary statistics
- `id`: Session UUID
- `session_name`: User-provided name
- `status`: pending, running, completed, failed, cancelled
- `total_trades`, `win_rate`, `profit_factor`: Results summary

### backtest_trades
Individual trade records from the backtest
- `session_id`: Links to backtest_sessions
- `entry_time`, `exit_time`: Trade timestamps
- `pnl`, `outcome`: Trade results

### missed_opportunities
Signals that were skipped
- `session_id`: Links to backtest_sessions
- `skip_reason`: Why this signal wasn't taken
- `was_quality_trade`: Would it have been profitable?

### ai_capability_scores
Overall AI performance metrics
- `overall_capability_percent`: Target is 75%+
- `capability_grade`: excellent, good, fair, poor

## Common Issues and Solutions

### Issue: "400 Bad Request" Error
**Status**: ✅ FIXED (as of Nov 8, 2025)
**Solution**: Automatic data sanitization now prevents this error

### Issue: Backtest Takes Too Long
**Possible Causes**:
- Very large date range (60+ days)
- Multiple symbols
- GPT-4 reasoning enabled (slower but more accurate)

**Solutions**:
- Start with shorter date ranges (7-14 days)
- Test one symbol at a time
- Disable GPT-4 for faster preliminary tests

### Issue: No Trades Generated
**Possible Causes**:
- Insufficient historical data
- Confidence threshold too high
- Market conditions didn't meet strategy criteria

**Check**:
1. Run diagnostics before backtest starts
2. Review console for "Signal generated" messages
3. Check `missed_opportunities` table for skipped signals

### Issue: Results Not Saving
**Check**:
1. Console for detailed error messages
2. Verify you have admin access
3. Check database connection

## Performance Optimization

### Batch Operations
The system automatically batches database inserts:
- 50 trades per batch
- 50 opportunities per batch
- Reduces database calls by 10-20x

### Data Validation
All data is automatically validated before database operations:
- Invalid numeric values are filtered
- Date objects are converted to ISO strings
- Non-existent columns are removed

### Error Recovery
Progress updates continue even if individual updates fail, ensuring the backtest completes.

## Best Practices

1. **Start Small**: Test with 7-14 days before running longer backtests
2. **One Symbol First**: Verify system works with one symbol before testing multiple
3. **Monitor Console**: Keep developer console open to catch issues early
4. **Review Results**: Check both successful trades and missed opportunities
5. **Compare Sessions**: Run multiple configurations to find optimal settings

## Capability Score Interpretation

- **75%+ (Excellent)**: AI is ready for live trading consideration
- **60-74% (Good)**: AI shows promise, needs refinement
- **45-59% (Fair)**: Requires significant parameter tuning
- **Below 45% (Poor)**: Strategy or data issues need addressing

## Getting Help

If you encounter persistent issues:

1. Check console for detailed error messages
2. Review `BACKTEST_FIX_SUMMARY.md` for technical details
3. Verify all database migrations are applied
4. Ensure you have admin privileges
5. Check that historical data exists for your date range

## Recent Changes (Nov 8, 2025)

✅ Fixed 400 Bad Request error on session completion
✅ Added batch operations for 10-20x performance improvement
✅ Implemented comprehensive data validation
✅ Enhanced error messages for better debugging
✅ Added progress logging for transparency

---

**Version**: 2.0
**Last Updated**: November 8, 2025
**Build Status**: ✅ Production Ready
