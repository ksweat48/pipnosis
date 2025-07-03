@echo off
echo MT5 Filling Mode Fix
echo ===================
echo.
echo This utility will fix the "Unsupported filling mode" error (10030) by:
echo 1. Adding automatic filling mode detection to your MT5 connector
echo 2. Ensuring the correct filling mode is used for your broker
echo.
echo Make sure MetaTrader 5 is running and logged in before continuing.
echo.
pause

echo.
echo Patching MT5 connector with filling mode fix...
echo ============================================================
python python\fix_mt5_filling_mode.py

echo.
echo Fix complete! Please restart the MT5 bridge to apply the changes.
echo.
pause