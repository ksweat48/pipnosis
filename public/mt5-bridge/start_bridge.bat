@echo off
echo Starting Pipnosis MT5 Bridge...
echo ==============================

REM Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Python is not installed or not in PATH
    echo Please run install_dependencies.bat first
    pause
    exit /b 1
)

REM Check if MetaTrader5 module is installed
python -c "import MetaTrader5" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo MetaTrader5 module is not installed
    echo Please run install_dependencies.bat first
    pause
    exit /b 1
)

REM Check if MT5 terminal is running
tasklist /FI "IMAGENAME eq terminal64.exe" 2>NUL | find /I /N "terminal64.exe">NUL
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: MetaTrader 5 terminal does not appear to be running
    echo Please start MetaTrader 5 and log into your account
    echo.
    set /p continue=Continue anyway? (y/n): 
    if /I "%continue%" NEQ "y" exit /b 1
)

echo.
echo Starting MT5 bridge...
echo.
echo IMPORTANT: Make sure MetaTrader 5 is running and logged in
echo            Automated trading must be enabled in MT5 settings
echo            (Tools > Options > Expert Advisors > Allow automated trading)
echo.
echo Press Ctrl+C to stop the bridge
echo.

python mt5_connector.py

pause