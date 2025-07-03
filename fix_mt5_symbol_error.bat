@echo off
echo MT5 Symbol Selection Fix
echo =======================
echo.
echo This utility will fix the "Failed to select symbol" error by:
echo 1. Adding common trading symbols to your MT5 Market Watch
echo 2. Patching the MT5 connector to automatically select symbols
echo.
echo Make sure MetaTrader 5 is running and logged in before continuing.
echo.
pause

echo.
echo Step 1: Adding symbols to Market Watch...
python python/fix_mt5_market_watch.py

echo.
echo Step 2: Patching MT5 connector...
python python/fix_mt5_connector.py

echo.
echo Fix complete! Please restart the MT5 bridge to apply the changes.
echo.
pause