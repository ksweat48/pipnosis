# Production MT5 Setup Guide

## Overview

This guide explains how to set up the MT5 bridge for production use with pipnosis.com.

## Step 1: Configure Your MT5 Bridge

1. Download and install the MT5 bridge on your computer
2. Make sure MetaTrader 5 is installed and running
3. Configure your MT5 bridge to accept connections from the internet

## Step 2: Set Up Port Forwarding

1. Find your computer's local IP address
   - Windows: Open Command Prompt and type `ipconfig`
   - Mac: Open System Preferences > Network
   
2. Log in to your router's admin panel (typically http://192.168.1.1 or http://192.168.0.1)

3. Navigate to Port Forwarding settings

4. Create a new port forwarding rule:
   - External Port: 8765
   - Internal IP: Your computer's local IP address
   - Internal Port: 8765
   - Protocol: TCP

5. Save the settings

## Step 3: Find Your Public IP Address

1. Visit [whatismyip.com](https://www.whatismyip.com/) to find your public IP address
2. This is the IP address you'll use in the MT5 Connection settings on pipnosis.com

## Step 4: Start the MT5 Bridge

1. Start MetaTrader 5 and log in to your account
2. Run the MT5 bridge with the host parameter set to accept external connections:
   ```
   python mt5_connector.py --host 0.0.0.0
   ```

## Step 5: Connect from Pipnosis.com

1. Log in to your account on pipnosis.com
2. Click the MT5 button in the header
3. Enter your connection settings:
   - Bridge Host: Your public IP address
   - Bridge Port: 8765
   - MT5 Login: Your MT5 account number
   - MT5 Password: Your MT5 password
   - Broker Server: Your broker's server name
4. Click "Test Connection"

## Troubleshooting

### Connection Failed

If you see "Connection Failed" when testing the connection:

1. Make sure the MT5 bridge is running
2. Verify that port forwarding is set up correctly
3. Check if your ISP blocks incoming connections
4. Try using a different port (e.g., 8766) and update your port forwarding rules

### No Response from MT5

If you see "No response from MT5" when executing trades:

1. Make sure MetaTrader 5 is running and logged in
2. Verify that automated trading is enabled in MT5 (Tools > Options > Expert Advisors)
3. Check if the symbol you're trying to trade is available in your Market Watch

## Security Considerations

- The MT5 bridge does not encrypt traffic by default
- Consider using a VPN for additional security
- Only open port 8765 to the internet, not your entire computer
- Keep your MT5 bridge and MetaTrader 5 updated

## Support

If you encounter any issues, please contact support@pipnosis.com