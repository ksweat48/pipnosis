# MT5 Connection Guide

This guide will help you connect your MetaTrader 5 terminal to Pipnosis AI.

## Step 1: Install Required Dependencies

First, make sure you have the required Python packages installed:

```bash
# Run the installer script
install_mt5_dependencies.bat  # Windows
./install_mt5_dependencies.sh  # macOS/Linux
```

## Step 2: Start MetaTrader 5

1. Open your MetaTrader 5 terminal
2. Log in to your account
3. Make sure automated trading is enabled:
   - Go to Tools > Options > Expert Advisors
   - Check "Allow automated trading"
   - Click OK

## Step 3: Start the MT5 Bridge

```bash
# Start the bridge
python mt5_connector.py
```

You should see output indicating that the bridge is running and connected to your MT5 terminal.

## Step 4: Configure Pipnosis Connection Settings

1. In the Pipnosis web app, click the MT5 button in the header
2. Enter your connection settings:
   - Bridge Host: `localhost` (or your computer's IP address if connecting from another device)
   - Bridge Port: `8765` (default)
   - MT5 Login: Your MT5 account number
   - MT5 Password: Your MT5 password
   - Broker Server: Your broker's server name (e.g., `MetaQuotes-Demo`)
3. Click "Test Connection"

## Step 5: Verify Connection

If the connection is successful, you'll see:
- "MT5 Connected" in the header
- Your account balance and equity will be displayed
- Open positions will be shown in the MT5 Dashboard

## Troubleshooting

### "No module named 'MetaTrader5'"

Run the installer script to install the required Python packages:

```bash
install_mt5_dependencies.bat  # Windows
./install_mt5_dependencies.sh  # macOS/Linux
```

### "Failed to connect to MT5 bridge"

1. Make sure the MT5 bridge is running (`python mt5_connector.py`)
2. Check that MetaTrader 5 is open and logged in
3. Verify that the Bridge Host and Port are correct
4. Run the connection fix utility:

```bash
fix_mt5_connection.bat
```

### "Order send failed: No response from MT5"

1. Make sure automated trading is enabled in MT5
2. Check that the symbol you're trying to trade is available
3. Run the trading issues fix utility:

```bash
fix_mt5_trading_issues.bat
```

### "Symbol not found" or "Failed to select symbol"

Run the symbol selection fix:

```bash
python python/fix_mt5_symbol_selection.py
```

### "Unsupported filling mode"

Run the filling mode fix:

```bash
python python/fix_mt5_filling_mode.py
```

## Advanced Configuration

### Connecting from Another Device

If you want to connect to the MT5 bridge from another device on your network:

1. Start the bridge with the host parameter:
   ```bash
   python mt5_connector.py --host 0.0.0.0
   ```

2. Find your computer's IP address:
   ```bash
   ipconfig  # Windows
   ifconfig  # macOS/Linux
   ```

3. Use your computer's IP address as the Bridge Host in Pipnosis

### Port Forwarding for Remote Access

To access your MT5 bridge from outside your network:

1. Set up port forwarding on your router for port 8765
2. Use your public IP address as the Bridge Host in Pipnosis
3. Consider using a dynamic DNS service if your public IP changes frequently

## Security Considerations

- The MT5 bridge does not encrypt traffic by default
- Your MT5 credentials are stored locally and encrypted
- Consider using a VPN for additional security when connecting remotely