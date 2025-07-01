#!/bin/bash

echo "Starting Pipnosis MOCK MT5 Bridge..."
echo "=================================="

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python is not installed"
    echo "Please run install_dependencies.sh first"
    exit 1
fi

# Check if websockets module is installed
if ! python3 -c "import websockets" &> /dev/null; then
    echo "websockets module is not installed"
    echo "Please run install_dependencies.sh first"
    exit 1
fi

echo
echo "Starting MOCK MT5 bridge..."
echo
echo "This is a SIMULATION mode that doesn't require MetaTrader 5"
echo "It provides fake data for development and testing"
echo
echo "Press Ctrl+C to stop the bridge"
echo

python3 mock_mt5_connector.py