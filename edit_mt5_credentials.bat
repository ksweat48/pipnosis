@echo off
echo MT5 Credentials Editor (Command Line)
echo ==================================
echo.
echo This utility allows you to update your MT5 account credentials via command line.
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Python is not installed or not in PATH
    echo Please install Python 3.8 or higher
    pause
    exit /b 1
)

REM Check if the script exists
if not exist "python\edit_credentials.py" (
    echo Could not find the edit script at python\edit_credentials.py
    echo Please make sure you're running this from the project root directory
    pause
    exit /b 1
)

echo Starting MT5 Credentials Editor...
echo.
python python\edit_credentials.py

echo.
echo If you updated your credentials, please restart the MT5 bridge to apply the changes.
echo.
pause