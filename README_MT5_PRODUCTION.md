# Pipnosis MT5 Bridge - Production Setup Guide

This guide explains how to set up the MT5 bridge for production use, allowing Pipnosis to place live trades via MetaTrader 5 from the production server at pipnosis.com.

## Overview

The Pipnosis MT5 integration works as follows:

1. The MT5 bridge runs on your local machine where MetaTrader 5 is installed
2. The bridge creates a WebSocket server that listens for commands
3. The Pipnosis web application connects to this WebSocket server to execute trades
4. Your MT5 credentials are stored locally and never transmitted to the cloud

## Production Setup Instructions

### Step 1: Install the MT5 Bridge

1. Make sure Python 3.8+ is installed on your computer
2. Install the required Python packages:
   ```bash
   pip install MetaTrader5==5.0.45 websockets==12.0 asyncio-mqtt==0.16.1 python-dotenv==1.0.0
   ```
3. Download the MT5 bridge files from the Pipnosis dashboard or GitHub repository

### Step 2: Configure Your MT5 Credentials

1. Run the credentials editor:
   ```bash
   python edit_credentials.py
   ```
2. Enter your MT5 account details:
   - Login (account number)
   - Password
   - Server name (e.g., "MetaQuotes-Demo", "ICMarkets-Live01")
3. The credentials will be encrypted and stored locally on your machine

### Step 3: Set Up Port Forwarding

For the Pipnosis website to connect to your local MT5 bridge:

1. Find your router's admin page (typically http://192.168.1.1 or http://192.168.0.1)
2. Log in with your router credentials
3. Navigate to the port forwarding section (may be under "Advanced Settings" or "NAT/Gaming")
4. Add a new port forwarding rule:
   - External Port: 8765 (or your chosen port)
   - Internal IP: Your computer's local IP address
   - Internal Port: 8765 (or your chosen port)
   - Protocol: TCP
5. Save the settings

### Step 4: Get Your Public IP Address

1. Visit https://whatismyip.com or search "what is my IP" on Google
2. Note your public IP address
3. Consider setting up a dynamic DNS service if your IP changes frequently

### Step 5: Start the MT5 Bridge

1. Make sure MetaTrader 5 is running and logged into your account
2. Start the MT5 bridge:
   ```bash
   python mt5_connector.py
   ```
3. The bridge will start and show a message like:
   ```
   WebSocket server started on ws://0.0.0.0:8765
   ```
4. Keep this window open while trading

### Step 6: Connect Pipnosis to Your MT5 Bridge

1. Log in to your Pipnosis account at pipnosis.com
2. Go to the MT5 Connection settings
3. Enter your connection details:
   - Bridge Host: Your public IP address or domain name
   - Bridge Port: 8765 (or your chosen port)
   - Use Secure Connection: Disable unless you've set up SSL/TLS
4. Click "Test Connection" to verify the connection
5. Click "Save" to store your settings

## Security Considerations

### Basic Security

- The MT5 bridge only accepts connections from authorized sources
- Your MT5 credentials are encrypted and stored only on your local machine
- The bridge never transmits your credentials to the cloud

### Advanced Security (Optional)

For enhanced security, consider:

1. **Setting up SSL/TLS**:
   - Obtain an SSL certificate for your domain
   - Set up a reverse proxy (like Nginx) to handle SSL termination
   - Configure the bridge to use secure WebSockets (WSS)

2. **Using a VPN**:
   - Set up a VPN server on your network
   - Connect to your VPN from Pipnosis servers
   - Keep the MT5 bridge behind your VPN

3. **IP Whitelisting**:
   - Configure your firewall to only allow connections from Pipnosis IP addresses
   - Contact Pipnosis support for the current IP address list

## Troubleshooting

### Connection Issues

If Pipnosis cannot connect to your MT5 bridge:

1. Verify the MT5 bridge is running (`python mt5_connector.py`)
2. Check your router's port forwarding configuration
3. Ensure your firewall allows incoming connections on port 8765
4. Verify your public IP address hasn't changed
5. Check if your ISP blocks incoming connections (some residential ISPs do)
6. Try restarting your router and computer

### Trading Issues

If trades are not executing properly:

1. Ensure automated trading is enabled in MetaTrader 5:
   - Open MT5
   - Go to Tools > Options > Expert Advisors
   - Check "Allow automated trading"
   - Check "Allow WebRequest for listed URL"
   - Add your Pipnosis URL to the allowed URLs list
2. Check if your account has sufficient margin
3. Verify the symbol is available for trading
4. Check the MT5 bridge logs for any error messages

## Keeping the Bridge Running

For 24/7 operation:

1. **Windows Task Scheduler**:
   - Create a task to start the bridge on system startup
   - Set it to restart if it fails

2. **Auto-restart Script**:
   - Create a simple monitoring script that restarts the bridge if it crashes
   - Schedule it to run every few minutes

3. **Dedicated Computer**:
   - Consider using a dedicated computer or virtual machine for running MT5 and the bridge
   - This ensures trading operations don't interfere with your daily computer use

## Support

If you encounter any issues with the MT5 bridge setup, please contact support@pipnosis.com or visit our documentation at https://docs.pipnosis.com/mt5-integration