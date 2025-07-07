@echo off
echo MT5 Connection Fix Utility
echo =========================
echo.
echo This utility will help fix common MT5 connection issues.
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
    echo Installing MetaTrader5 module...
    pip install MetaTrader5==5.0.45
    if %ERRORLEVEL% NEQ 0 (
        echo Failed to install MetaTrader5 module
        echo Please run: pip install MetaTrader5==5.0.45
        pause
        exit /b 1
    )
    echo MetaTrader5 module installed successfully
)

echo.
echo Step 1: Checking MT5 terminal...
tasklist /FI "IMAGENAME eq terminal64.exe" 2>NUL | find /I /N "terminal64.exe">NUL
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: MetaTrader 5 terminal does not appear to be running
    echo Please start MetaTrader 5 and log into your account
    echo.
    set /p continue=Continue anyway? (y/n): 
    if /I "%continue%" NEQ "y" exit /b 1
)

echo.
echo Step 2: Checking connection to MT5 bridge at 97.180.94.170:8765...
echo This will attempt to connect to your MT5 bridge
echo.

echo Testing connection...
python -c "import socket; s=socket.socket(); s.settimeout(5); result=s.connect_ex(('97.180.94.170', 8765)); print('Connection successful' if result==0 else 'Connection failed'); s.close()"

echo.
echo Step 3: Fixing common MT5 issues...
echo.
echo 1. Running symbol selection fix...
python python\fix_mt5_symbol_selection.py

echo.
echo 2. Running filling mode fix...
python python\fix_mt5_filling_mode.py

echo.
echo 3. Checking USDCAD symbol...
python python\check_mt5_symbol.py USDCAD

echo.
echo Fix complete! Please restart the MT5 bridge to apply the changes.
echo.
echo Troubleshooting tips:
echo 1. Make sure MetaTrader 5 is running and logged in
echo 2. Ensure automated trading is enabled in MT5 (Tools ^> Options ^> Expert Advisors)
echo 3. Check that your firewall allows connections to/from port 8765
echo 4. Verify that the MT5 bridge is running on the computer with IP 97.180.94.170
echo 5. Try restarting both MT5 and the bridge
echo.
pause