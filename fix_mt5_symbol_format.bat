@echo off
echo MT5 Symbol Format Fix
echo ===================
echo.
echo This utility will fix the "Failed to select symbol" error by:
echo 1. Adding automatic symbol format correction to your MT5 connector
echo 2. Converting symbols like "EUR/USD" to "EURUSD" format
echo.
echo Make sure MetaTrader 5 is running and logged in before continuing.
echo.
pause

echo.
echo Patching MT5 connector with symbol format fix...
echo ============================================================
python python\fix_mt5_symbol_format.py

echo.
echo Fix complete! Please restart the MT5 bridge to apply the changes.
echo.
pause