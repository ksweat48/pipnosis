@echo off
echo Starting Pipnosis Local Development Environment
echo ==============================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Python is not installed or not in PATH
    echo Please install Python 3.8 or higher
    pause
    exit /b 1
)

REM Check if Node.js is installed
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Node.js is not installed or not in PATH
    echo Please install Node.js 18 or higher
    pause
    exit /b 1
)

echo Step 1: Starting MT5 Bridge...
echo ------------------------------
echo.
echo Starting MT5 bridge in a new window...
start cmd /k "python mt5_connector.py"

echo.
echo Step 2: Starting Development Server...
echo ------------------------------------
echo.
echo Starting Vite development server...
echo.
echo NOTE: The development server will open in this window.
echo The MT5 bridge is running in a separate window.
echo.
echo Press Ctrl+C to stop the development server when done.
echo.
pause
npm run dev