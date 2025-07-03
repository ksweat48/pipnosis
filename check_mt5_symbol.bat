@echo off
echo MT5 Symbol Checker
echo =================
echo.
echo This utility checks if a symbol is properly configured and available for trading.
echo It will help diagnose "Failed to select symbol" errors.
echo.

set SYMBOL=EURUSD
if not "%~1"=="" set SYMBOL=%~1

echo Checking symbol: %SYMBOL%
echo.
python python/check_symbol.py %SYMBOL%

echo.
echo Check complete!
echo.
pause