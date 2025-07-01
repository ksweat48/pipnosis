#!/bin/bash

echo "Installing MT5 Bridge Dependencies..."
echo "==================================="

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python is not installed"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

# Check Python version
PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2)
echo "Found Python $PYTHON_VERSION"

# Install pip if not available
python3 -m ensurepip --upgrade

# Upgrade pip
python3 -m pip install --upgrade pip

echo
echo "Installing required packages..."
python3 -m pip install MetaTrader5==5.0.45 websockets==12.0 asyncio-mqtt==0.16.1 python-dotenv==1.0.0

echo
echo "Installation complete!"
echo
echo "To start the MT5 bridge, run:"
echo "python3 mt5_connector.py"
echo