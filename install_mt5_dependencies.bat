@echo off
echo Installing MT5 Bridge Dependencies
echo ================================
echo.
echo This script will install the required Python packages for the MT5 bridge.
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Python is not installed or not in PATH
    echo Please install Python 3.8 or higher
    pause
    exit /b 1
)

echo Installing MetaTrader5 Python package...
pip install MetaTrader5==5.0.45

echo Installing websockets package...
pip install websockets==12.0

echo Installing other required packages...
pip install asyncio-mqtt==0.16.1 python-dotenv==1.0.0

echo.
echo Installation complete!
echo.
echo You can now run the MT5 bridge with:
echo python mt5_connector.py
echo.
pause