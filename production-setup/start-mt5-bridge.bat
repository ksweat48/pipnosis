@echo off
echo Pipnosis MT5 Bridge - Production Mode
echo ===================================
echo.
echo This script starts the MT5 bridge in production mode,
echo binding to all network interfaces to accept external connections.
echo.
echo IMPORTANT: Make sure you have set up port forwarding on your router
echo           to allow external connections to reach this bridge.
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Python is not installed or not in PATH
    echo Please install Python 3.8 or higher
    pause
    exit /b 1
)

REM Check if MetaTrader5 module is installed
python -c "import MetaTrader5" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo MetaTrader5 module is not installed
    echo Please run: pip install MetaTrader5==5.0.45 websockets==12.0
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
echo Starting MT5 bridge in PRODUCTION mode...
echo.
echo IMPORTANT: Make sure MetaTrader 5 is running and logged in
echo            Automated trading must be enabled in MT5 settings
echo            (Tools > Options > Expert Advisors > Allow automated trading)
echo.
echo The bridge will accept connections from any IP address.
echo Press Ctrl+C to stop the bridge.
echo.

REM Start the bridge with explicit host parameter to bind to all interfaces
python ../python/mt5_connector.py --host 0.0.0.0

pause