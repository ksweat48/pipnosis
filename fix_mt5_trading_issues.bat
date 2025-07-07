@echo off
echo MT5 Trading Issues Fix
echo =====================
echo.
echo This script will fix common MT5 trading issues:
echo 1. Symbol selection errors
echo 2. Filling mode errors
echo 3. No response from MT5 errors
echo.
echo Make sure MetaTrader 5 is running and logged in before continuing.
echo.
pause

echo.
echo Step 1: Checking USDCAD symbol configuration...
python python\check_mt5_symbol.py USDCAD

echo.
echo Step 2: Fixing symbol selection...
python python\fix_mt5_symbol_selection.py

echo.
echo Step 3: Fixing filling mode...
python python\fix_mt5_filling_mode.py

echo.
echo Fix complete! Please restart the MT5 bridge to apply the changes.
echo.
pause