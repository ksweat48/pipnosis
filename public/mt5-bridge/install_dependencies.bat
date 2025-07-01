@echo off
echo Installing MT5 Bridge Dependencies...
echo ===================================

REM Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Python is not installed or not in PATH
    echo Please install Python 3.8 or higher from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)

REM Check Python version
for /f "tokens=2" %%I in ('python --version 2^>^&1') do set PYTHON_VERSION=%%I
echo Found Python %PYTHON_VERSION%

REM Install pip if not available
python -m ensurepip --upgrade

REM Upgrade pip
python -m pip install --upgrade pip

echo.
echo Installing required packages...
python -m pip install MetaTrader5==5.0.45 websockets==12.0 asyncio-mqtt==0.16.1 python-dotenv==1.0.0

echo.
echo Installation complete!
echo.
echo To start the MT5 bridge, run:
echo python mt5_connector.py
echo.
pause