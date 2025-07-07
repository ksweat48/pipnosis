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
echo "Step 2: Starting Development Server..."
echo "------------------------------------"
echo
echo "Starting Vite development server..."
echo
echo "NOTE: The development server will open in this window."
echo "The MT5 bridge is running in a separate window."
echo
echo "Press Ctrl+C to stop the development server when done."
echo

npm run dev