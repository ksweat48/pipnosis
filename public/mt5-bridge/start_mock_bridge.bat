@echo off
echo Starting Pipnosis MOCK MT5 Bridge...
echo ==================================

REM Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Python is not installed or not in PATH
    echo Please run install_dependencies.bat first
    pause
    exit /b 1
)

REM Check if websockets module is installed
python -c "import websockets" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo websockets module is not installed
    echo Please run install_dependencies.bat first
    pause
    exit /b 1
)

echo.
echo Starting MOCK MT5 bridge...
echo.
echo This is a SIMULATION mode that doesn't require MetaTrader 5
echo It provides fake data for development and testing
echo.
echo Press Ctrl+C to stop the bridge
echo.

python mock_mt5_connector.py

pause