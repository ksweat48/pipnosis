#!/bin/bash

echo "Installing MT5 Bridge Dependencies"
echo "================================"
echo

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python is not installed"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

echo "Installing MetaTrader5 Python package..."
pip3 install MetaTrader5==5.0.45

echo "Installing websockets package..."
pip3 install websockets==12.0

echo "Installing other required packages..."
pip3 install asyncio-mqtt==0.16.1 python-dotenv==1.0.0

echo
echo "Installation complete!"
echo
echo "You can now run the MT5 bridge with:"
echo "python3 mt5_connector.py"
echo