# Pipnosis MT5 Bridge - Production Setup

This directory contains scripts and guides to help you set up the MT5 bridge for production use.

## Quick Start

1. Make sure Python 3.8+ and MetaTrader 5 are installed
2. Install required Python packages:
   ```bash
   pip install MetaTrader5==5.0.45 websockets==12.0 asyncio-mqtt==0.16.1 python-dotenv==1.0.0
   ```
3. Start MetaTrader 5 and log in to your account
4. Run the MT5 bridge in production mode:
   ```bash
   # Windows
   start-mt5-bridge.bat
   
   # macOS/Linux
   ./start-mt5-bridge.sh
   ```

## Setup Steps

### 1. Find Your Network Information

Run the `get-local-ip` script to find your local and public IP addresses:

```bash
# Windows
get-local-ip.bat

# macOS/Linux
./get-local-ip.sh
```

### 2. Set Up Port Forwarding

1. Access your router's admin page (typically http://192.168.1.1)
2. Navigate to Port Forwarding settings
3. Create a new rule:
   - External Port: 8765
   - Internal IP: Your local IP address
   - Internal Port: 8765
   - Protocol: TCP
4. Save the settings

### 3. Start the MT5 Bridge

Run the bridge in production mode:

```bash
# Windows
start-mt5-bridge.bat

# macOS/Linux
./start-mt5-bridge.sh
```

### 4. Test Your Connection

Run the connection test script to verify your bridge is accessible:

```bash
# Windows
check-connection.bat

# macOS/Linux
./check-connection.sh
```

### 5. Configure Pipnosis

1. Log in to your Pipnosis account
2. Go to MT5 Connection settings
3. Enter your public IP address as the Bridge Host
4. Use 8765 as the Bridge Port
5. Click "Test Connection" to verify
6. Save your settings

## Security Recommendations

1. **Use a dedicated computer** for running MT5 and the bridge
2. **Keep your computer updated** with the latest security patches
3. **Use a firewall** to restrict access to only necessary ports
4. **Consider using a VPN** for additional security
5. **Regularly backup** your MT5 configuration

## Troubleshooting

If you encounter any issues, please refer to the [MT5 Bridge Setup Guide](mt5-bridge-setup-guide.md) for detailed troubleshooting steps.

## Support

If you need assistance, please contact support@pipnosis.com or visit our documentation at https://docs.pipnosis.com/mt5-integration