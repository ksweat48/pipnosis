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

REM Check if .env file exists
if not exist .env (
    echo Creating .env file from .env.example...
    copy .env.example .env
    echo Please update the .env file with your credentials
)

REM Check if server/.env file exists
if not exist server\.env (
    echo Creating server/.env file...
    if not exist server mkdir server
    (
        echo # Backend Environment Variables
        echo PORT=3001
        echo NODE_ENV=development
        echo.
        echo # Supabase
        echo SUPABASE_URL=https://elykntifkdaqiafnjosk.supabase.co
        echo SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVseWtudGlma2RhcWlhZm5qb3NrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDY0ODIxNCwiZXhwIjoyMDY2MjI0MjE0fQ.lQvhBYkgGGkhPcFZHiJwH7p3GSkFDq2TXcj-8DqtNC8
        echo.
        echo # OpenAI
        echo OPENAI_API_KEY=your_openai_api_key_here
        echo.
        echo # MT5 Integration
        echo MT5_BRIDGE_URL=http://localhost:8080
        echo MT5_PYTHON_PATH=/path/to/python/mt5_connector.py
    ) > server\.env
    echo Created server/.env file
)

echo Step 1: Starting MT5 Bridge...
echo -----------------------------
echo.
echo Starting MT5 bridge in a new window...
start cmd /k "python mt5_connector.py"

echo.
echo Step 2: Starting Backend Server...
echo --------------------------------
echo.
echo Starting backend server in a new window...
start cmd /k "cd server && npm run dev"

echo.
echo Step 3: Starting Frontend Development Server...
echo --------------------------------------------
echo.
echo Starting Vite development server...
echo.
echo NOTE: The frontend development server will open in this window.
echo The MT5 bridge and backend server are running in separate windows.
echo.
echo Press Ctrl+C to stop the frontend development server when done.
echo.
pause

npm run dev