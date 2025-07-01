#!/bin/bash

echo "Starting Pipnosis MT5 Bridge..."
echo "=============================="

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python is not installed"
    echo "Please run install_dependencies.sh first"
    exit 1
fi

# Check if MetaTrader5 module is installed
if ! python3 -c "import MetaTrader5" &> /dev/null; then
    echo "MetaTrader5 module is not installed"
    echo "Please run install_dependencies.sh first"
    exit 1
fi

echo
echo "Starting MT5 bridge..."
echo
echo "IMPORTANT: Make sure MetaTrader 5 is running and logged in"
echo "            Automated trading must be enabled in MT5 settings"
echo "            (Tools > Options > Expert Advisors > Allow automated trading)"
echo
echo "Press Ctrl+C to stop the bridge"
echo

python3 mt5_connector.py