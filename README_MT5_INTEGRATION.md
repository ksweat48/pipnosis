# Pipnosis MT5 Integration Guide for Production

This guide explains how to set up the MT5 bridge for production use, allowing Pipnosis to place live trades via MetaTrader 5 from the production server at pipnosis.com.

## Overview

The Pipnosis MT5 integration works as follows:

1. The MT5 bridge runs on your local machine where MetaTrader 5 is installed
2. The bridge creates a WebSocket server that listens for commands
3. The Pipnosis web application connects to this WebSocket server to execute trades
4. Your MT5 credentials are stored locally and never transmitted to the cloud

## Setup Instructions

### Step 1: Install the MT5 Bridge

1. Download and install the MT5 bridge on your local machine:
   ```bash
   # Clone the repository or download the files
   git clone https://github.com/pipnosis/mt5-bridge.git
   cd mt5-bridge
   
   # Install dependencies
   pip install -r requirements.txt
   ```

2. Make sure MetaTrader 5 is installed and running on your machine

### Step 2: Configure the MT5 Bridge

1. Run the credentials setup script:
   ```bash
   python edit_credentials.py
   ```

2. Enter your MT5 account details:
   - Login (account number)
   - Password
   - Server name (e.g., "MetaQuotes-Demo", "ICMarkets-Live01")

3. The credentials will be encrypted and stored locally

### Step 3: Start the MT5 Bridge

1. Start the bridge:
   ```bash
   python mt5_connector.py
   ```

2. The bridge will start a WebSocket server on port 8765 (or fallback to another port if 8765 is in use)
3. You should see a message like: "WebSocket server started on ws://0.0.0.0:8765"

### Step 4: Configure Your Router/Firewall (For Production Use)

For the production Pipnosis website to connect to your local MT5 bridge:

1. Set up port forwarding on your router to forward port 8765 to your local machine
2. Configure your firewall to allow incoming connections on port 8765
3. Consider using a dynamic DNS service if your IP address changes frequently

### Step 5: Connect Pipnosis to Your MT5 Bridge

1. Log in to your Pipnosis account at pipnosis.com
2. Go to Settings > MT5 Connection
3. Enter your local machine's public IP address or hostname
4. Click "Connect" to establish the connection

## Security Considerations

- The MT5 bridge uses WebSocket Secure (WSS) for encrypted communication
- Your MT5 credentials are encrypted and stored only on your local machine
- The bridge only accepts connections from pipnosis.com
- Consider using a VPN for additional security

## Troubleshooting

### Connection Issues

If Pipnosis cannot connect to your MT5 bridge:

1. Verify the MT5 bridge is running (`python mt5_connector.py`)
2. Check your router's port forwarding configuration
3. Ensure your firewall allows incoming connections on port 8765
4. Verify MetaTrader 5 is running and logged in
5. Check the MT5 bridge logs for any errors

### Trading Issues

If trades are not executing properly:

1. Ensure automated trading is enabled in MetaTrader 5 (Tools > Options > Expert Advisors)
2. Check if your account has sufficient margin
3. Verify the symbol is available for trading
4. Check the MT5 bridge logs for any error messages

## Advanced Configuration

For advanced users, you can modify the following settings:

- Change the WebSocket port in `mt5_connector.py`
- Configure SSL/TLS for secure WebSocket connections
- Set up authentication for the WebSocket server
- Implement IP whitelisting for additional security

## Support

If you encounter any issues, please contact support@pipnosis.com or visit our documentation at https://docs.pipnosis.com/mt5-integration