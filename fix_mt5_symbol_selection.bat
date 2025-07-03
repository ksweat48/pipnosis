@echo off
echo MT5 Symbol Selection Fix
echo =======================
echo.
echo This utility will fix the "Failed to select symbol" error by:
echo 1. Adding automatic symbol selection to your MT5 connector
echo 2. Ensuring symbols are properly selected before trading
echo.
echo Make sure MetaTrader 5 is running and logged in before continuing.
echo.
pause

echo.
echo Adding symbol selection functionality...
echo ============================================================
python python\fix_mt5_symbol_selection.py

echo.
echo Fix complete! Please restart the MT5 bridge to apply the changes.
echo.
pause