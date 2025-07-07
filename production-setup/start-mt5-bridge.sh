#!/bin/bash

echo "Pipnosis MT5 Bridge - Production Mode"
echo "==================================="
echo
echo "This script starts the MT5 bridge in production mode,"
echo "binding to all network interfaces to accept external connections."
echo
echo "IMPORTANT: Make sure you have set up port forwarding on your router"
echo "           to allow external connections to reach this bridge."
echo

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python is not installed"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

# Check if MetaTrader5 module is installed
if ! python3 -c "import MetaTrader5" &> /dev/null; then
    echo "MetaTrader5 module is not installed"
    echo "Please run: pip install MetaTrader5==5.0.45 websockets==12.0"
    exit 1
fi

echo
echo "Starting MT5 bridge in PRODUCTION mode..."
echo
echo "IMPORTANT: Make sure MetaTrader 5 is running and logged in"
echo "            Automated trading must be enabled in MT5 settings"
echo "            (Tools > Options > Expert Advisors > Allow automated trading)"
echo
echo "The bridge will accept connections from any IP address."
echo "Press Ctrl+C to stop the bridge."
echo

# Start the bridge with explicit host parameter to bind to all interfaces
python3 ../python/mt5_connector.py --host 0.0.0.0