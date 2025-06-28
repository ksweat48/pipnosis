# Pipnosis MT5 Bridge - Manual Installation

## Quick Setup Guide

### Prerequisites
- Python 3.8 or higher
- MetaTrader 5 terminal installed and logged in
- pip (Python package installer)

### Installation Steps

1. **Create Bridge Directory**
   ```bash
   mkdir C:\Pipnosis\MT5Bridge
   cd C:\Pipnosis\MT5Bridge
   ```

2. **Download Files**
   - Download `mt5_connector.py` and `requirements.txt` from this directory
   - Place them in your bridge directory

3. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Start the Bridge**
   ```bash
   python mt5_connector.py
   ```

### Expected Output
When the bridge starts successfully, you should see:
```
✅ MT5 connected successfully!
📊 Account: [Your Account Number]
🏦 Server: [Your Server]
💰 Balance: $[Your Balance]
✅ WebSocket server started on ws://localhost:8765
✅ Pipnosis MT5 Connector is running!
```

### Troubleshooting

**"MT5 initialization failed"**
- Ensure MetaTrader 5 is running and logged in
- Check that your account allows API access

**"Failed to get account info"**
- Make sure you're logged into MT5
- Verify your account is active

**"Module not found" errors**
- Run `pip install -r requirements.txt` again
- Ensure you're using the correct Python environment

### Connection from Pipnosis
1. Open Pipnosis web application
2. Click the MT5 button (should turn green when bridge is running)
3. Follow the connection wizard
4. Your live MT5 data will appear in the dashboard

### Security Notes
- The bridge runs locally on your computer
- No data is sent to external servers
- WebSocket connection is localhost-only
- Your MT5 credentials never leave your computer