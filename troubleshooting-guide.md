# MT5 Trading Issues Troubleshooting Guide

## Common Error: "Order send failed: No response from MT5"

This error occurs when the MT5 terminal doesn't respond to the order request. Here are the most common causes and solutions:

### 1. Symbol Not Selected in Market Watch

**Problem:** The symbol you're trying to trade (e.g., USDCAD) is not selected in the MT5 Market Watch.

**Solution:**
1. Open your MT5 terminal
2. Right-click in the Market Watch panel
3. Select "Show All" to display all available symbols
4. Find the symbol you want to trade (e.g., GBPUSD) and make sure it's checked
5. Alternatively, run the symbol selection fix script:
   ```
   python python/fix_mt5_symbol_selection.py
   ```

### 2. Unsupported Filling Mode

**Problem:** Your broker doesn't support the filling mode being used in the order.

**Solution:**
1. Run the filling mode fix script:
   ```
   python python/fix_mt5_filling_mode.py
   ```
2. This script will automatically detect and use the correct filling mode for your broker.

### 3. Automated Trading Disabled

**Problem:** Automated trading is disabled in your MT5 terminal.

**Solution:**
1. Open MT5
2. Go to Tools > Options > Expert Advisors
3. Make sure "Allow automated trading" is checked
4. Make sure "Allow WebRequest for listed URL" is checked
5. Restart MT5 and the bridge

### 4. Market Closed

**Problem:** The market for the symbol you're trying to trade is closed.

**Solution:**
1. Check if the market is open for the symbol you're trying to trade
2. Run the symbol checker to verify:
   ```
   python python/check_mt5_symbol.py GBPUSD
   ```
3. Try trading during market hours for that symbol

### 5. MT5 Terminal Not Responding

**Problem:** The MT5 terminal is frozen or not responding.

**Solution:**
1. Restart the MT5 terminal
2. Restart the MT5 bridge
3. If the issue persists, restart your computer

## Quick Fix Script

For convenience, you can run the `fix_mt5_trading_issues.bat` script which will:
1. Check the symbol configuration
2. Fix symbol selection issues
3. Fix filling mode issues

```
fix_mt5_trading_issues.bat
```

## Manual Verification

To manually verify that a symbol is properly configured for trading:

```
python python/check_mt5_symbol.py GBPUSD
```

This will check:
- If the symbol exists
- If it's selected in Market Watch
- If trading is allowed
- Current prices
- Stop levels
- Volume limits
- Filling modes

## Restart the Bridge

After applying any fixes, always restart the MT5 bridge:

```
python mt5_connector.py
```

## Still Having Issues?

If you're still experiencing issues after trying these solutions:

1. Check the MT5 bridge logs for specific error messages
2. Verify your MT5 account has sufficient balance and margin
3. Try a different symbol (e.g., EURUSD instead of GBPUSD)
4. Make sure your MT5 terminal is up to date
5. Check if your broker has any trading restrictions