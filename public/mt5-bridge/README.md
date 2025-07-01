# Pipnosis MT5 Bridge - Deployment Guide

This guide will help you set up and run the MT5 bridge that connects your MetaTrader 5 terminal with Pipnosis AI.

## Quick Start

### Windows Setup
1. Make sure MetaTrader 5 is installed and running
2. Run the `install_dependencies.bat` script to install required Python packages
3. Start the bridge with `python mt5_connector.py`

### macOS/Linux Setup
1. Make sure MetaTrader 5 is installed and running (via Wine or on a Windows VM)
2. Run the `install_dependencies.sh` script to install required Python packages
3. Start the bridge with `python3 mt5_connector.py`

## Troubleshooting

If you encounter any issues:
1. Check the `troubleshooting.md` file for common problems and solutions
2. Run `check_symbol.py` to verify your trading symbols are properly configured
3. Ensure MetaTrader 5 is running and logged into an account
4. Verify that automated trading is enabled in MT5 (Tools > Options > Expert Advisors)

## Connection Status

When the bridge is running successfully, you'll see:
- "MT5 connected successfully" in the console
- "WebSocket server started" message with the port number
- Your account information displayed (login, balance, etc.)

The Pipnosis web app will automatically connect to the bridge when it's running.

## Common Issues

### "No module named 'MetaTrader5'"
This means the MetaTrader5 Python package is not installed. Run the appropriate installation script for your platform.

### "Failed to initialize MT5"
Make sure MetaTrader 5 is running and logged into an account. The bridge cannot connect to a closed MT5 terminal.

### "Automated trading is disabled"
Go to Tools > Options > Expert Advisors in MT5 and check "Allow automated trading".

### "No prices" Error
This usually means the symbol is not properly selected in Market Watch or the market is closed. Use the `check_symbol.py` script to diagnose the issue.