# MT5 Bridge Setup Guide for Pipnosis

This guide will help you set up the MT5 bridge for connecting your MetaTrader 5 terminal to Pipnosis.

## Quick Start

1. Make sure Python 3.8+ and MetaTrader 5 are installed
2. Install required Python packages:
   ```bash
   pip install MetaTrader5==5.0.45 websockets==12.0 asyncio-mqtt==0.16.1 python-dotenv==1.0.0
   ```
3. Start MetaTrader 5 and log in to your account
4. Run the MT5 bridge:
   ```bash
   python mt5_connector.py
   ```
5. The bridge will start on port 8765 by default

## Production Setup

For production use, you need to make the MT5 bridge accessible from the internet:

1. Start the bridge in production mode:
   ```bash
   python mt5_connector.py --host 0.0.0.0
   ```

2. Set up port forwarding on your router:
   - Forward external port 8765 to your computer's internal IP address, port 8765
   - Use the `get-local-ip` script to find your local IP address

3. Test your connection:
   - Use the `check-connection` script to verify your bridge is accessible
   - If the test fails, check your router's port forwarding settings

4. In the Pipnosis web app:
   - Go to MT5 Connection settings
   - Enter your public IP address or domain name
   - Use port 8765 (or the port shown in the bridge output)
   - Click "Test Connection" to verify

## Security Recommendations

1. **Use a dedicated computer** for running MT5 and the bridge
2. **Keep your computer updated** with the latest security patches
3. **Use a firewall** to restrict access to only necessary ports
4. **Consider using a VPN** for additional security
5. **Regularly backup** your MT5 configuration

## Troubleshooting

### Connection Issues

- **"Failed to connect to MT5 bridge"**: Make sure the bridge is running and port forwarding is set up correctly
- **"WebSocket connection failed"**: Check if your ISP blocks incoming connections
- **"MT5 not connected"**: Ensure MetaTrader 5 is running and logged in

### Trading Issues

- **"Automated trading is disabled"**: Enable automated trading in MT5 (Tools > Options > Expert Advisors)
- **"Failed to select symbol"**: Make sure the symbol is added to Market Watch in MT5
- **"Invalid stops"**: The stop loss or take profit is too close to the current price

## Command Reference

- **Start bridge (standard)**: `python mt5_connector.py`
- **Start bridge (production)**: `python mt5_connector.py --host 0.0.0.0`
- **Start bridge (custom port)**: `python mt5_connector.py --port 8766`
- **Edit credentials**: `python edit_credentials.py`

## Support

If you encounter any issues, please contact support@pipnosis.com or visit our documentation at https://docs.pipnosis.com/mt5-integration