#!/bin/bash

echo "Starting Pipnosis Local Development Environment"
echo "=============================================="
echo

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python is not installed or not in PATH"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed or not in PATH"
    echo "Please install Node.js 18 or higher"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "Please update the .env file with your credentials"
fi

# Check if server/.env file exists
if [ ! -f server/.env ]; then
    echo "Creating server/.env file..."
    mkdir -p server
    cat > server/.env << EOL
# Backend Environment Variables
PORT=3001
NODE_ENV=development

# Supabase
SUPABASE_URL=https://elykntifkdaqiafnjosk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVseWtudGlma2RhcWlhZm5qb3NrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDY0ODIxNCwiZXhwIjoyMDY2MjI0MjE0fQ.lQvhBYkgGGkhPcFZHiJwH7p3GSkFDq2TXcj-8DqtNC8

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# MT5 Integration
MT5_BRIDGE_URL=http://localhost:8080
MT5_PYTHON_PATH=/path/to/python/mt5_connector.py
EOL
    echo "Created server/.env file"
fi

echo "Step 1: Starting MT5 Bridge..."
echo "-----------------------------"
echo
echo "Starting MT5 bridge in a new terminal..."

# Start MT5 bridge in a new terminal window (platform-specific)
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    osascript -e 'tell app "Terminal" to do script "cd \"'$PWD'\" && python3 mt5_connector.py"'
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v gnome-terminal &> /dev/null; then
        gnome-terminal -- bash -c "cd \"$PWD\" && python3 mt5_connector.py; exec bash"
    elif command -v xterm &> /dev/null; then
        xterm -e "cd \"$PWD\" && python3 mt5_connector.py; bash" &
    else
        echo "Could not find a suitable terminal emulator. Please start the MT5 bridge manually:"
        echo "python3 mt5_connector.py"
    fi
else
    echo "Unsupported operating system. Please start the MT5 bridge manually:"
    echo "python3 mt5_connector.py"
fi

echo
echo "Step 2: Starting Backend Server..."
echo "--------------------------------"
echo
echo "Starting backend server in a new terminal..."

# Start backend server in a new terminal window (platform-specific)
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    osascript -e 'tell app "Terminal" to do script "cd \"'$PWD'\" && cd server && npm run dev"'
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v gnome-terminal &> /dev/null; then
        gnome-terminal -- bash -c "cd \"$PWD/server\" && npm run dev; exec bash"
    elif command -v xterm &> /dev/null; then
        xterm -e "cd \"$PWD/server\" && npm run dev; bash" &
    else
        echo "Could not find a suitable terminal emulator. Please start the backend server manually:"
        echo "cd server && npm run dev"
    fi
else
    echo "Unsupported operating system. Please start the backend server manually:"
    echo "cd server && npm run dev"
fi

echo
echo "Step 3: Starting Frontend Development Server..."
echo "--------------------------------------------"
echo
echo "Starting Vite development server..."
echo
echo "NOTE: The frontend development server will open in this window."
echo "The MT5 bridge and backend server are running in separate windows."
echo
echo "Press Ctrl+C to stop the frontend development server when done."
echo

npm run dev