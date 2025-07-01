# MT5 Bridge Troubleshooting Guide

## Common Issues and Solutions

### 1. Bridge Not Connecting to MT5

**Symptoms:**
- "MT5 initialization failed" error
- "Failed to get account info" error
- Bridge shows "Not Connected" status

**Solutions:**
1. **Ensure MT5 is running and logged in**
   - Open MetaTrader 5 and verify you're logged into an account
   - Check the account status in the MT5 terminal

2. **Check MT5 settings**
   - Go to Tools > Options > Expert Advisors tab
   - Ensure "Allow automated trading" is checked
   - Ensure "Allow DLL imports" is checked
   - Ensure "Disable algorithmic trading via external Python API" is NOT checked

3. **Restart MT5 and the bridge**
   - Close MetaTrader 5 completely
   - Close the bridge (Ctrl+C in the terminal)
   - Restart MetaTrader 5 and log in
   - Restart the bridge with `python mt5_connector.py`

4. **Check Python installation**
   - Verify Python 3.8 or higher is installed: `python --version`
   - Reinstall the MetaTrader5 package: `pip install --force-reinstall MetaTrader5==5.0.45`

### 2. WebSocket Connection Issues

**Symptoms:**
- "WebSocket connection failed" error
- Bridge shows "WebSocket server started" but clients can't connect
- Constant reconnection attempts

**Solutions:**
1. **Check port availability**
   - The bridge tries ports 8765-8770
   - Check if another application is using these ports
   - Try manually specifying a different port: `python mt5_connector.py --port 8780`

2. **Check firewall settings**
   - Ensure your firewall allows Python and WebSocket connections
   - Temporarily disable firewall to test if it's the cause

3. **Check WebSocket URL**
   - The correct WebSocket URL should be `ws://localhost:8765` (or the port shown in the bridge logs)
   - Check the `mt5_bridge_port.txt` file for the actual port being used

4. **Restart the bridge with verbose logging**
   - Edit `mt5_connector.py` and change logging level to DEBUG
   - Restart the bridge and check for detailed error messages

### 3. Trade Execution Failures

**Symptoms:**
- "Order failed" errors
- Trades not appearing in MT5
- "Automated trading disabled" errors

**Solutions:**
1. **Check MT5 automated trading settings**
   - Go to Tools > Options > Expert Advisors tab
   - Ensure "Allow automated trading" is checked
   - Restart MT5 after changing settings

2. **Check WebRequest settings (if using MQL scripts)**
   - Go to Tools > Options > Expert Advisors tab
   - Check "Allow WebRequest for listed URL:"
   - Add the following URLs:
     ```
     https://elykntifkdaqiafnjosk.supabase.co
     https://api.openai.com
     http://localhost:3001
     https://pipnosis-production.up.railway.app
     ```

3. **Check account trading permissions**
   - Ensure your MT5 account allows trading
   - Check if your account is in read-only mode
   - Verify you have sufficient margin for the trade

4. **Check symbol properties**
   - Ensure the symbol is available for trading
   - Check trading hours for the symbol
   - Verify minimum/maximum lot sizes

### 4. Data Streaming Issues

**Symptoms:**
- No account data showing in Pipnosis
- Positions not updating
- "Live Data" indicator not showing

**Solutions:**
1. **Check WebSocket connection**
   - Verify the WebSocket connection is established
   - Check browser console for WebSocket errors
   - Try refreshing the page

2. **Restart the bridge**
   - Stop the bridge (Ctrl+C)
   - Start it again with `python mt5_connector.py`
   - Check the logs for any errors

3. **Check data update interval**
   - The default update interval is 1 second
   - You can adjust this in the bridge code if needed

### 5. Installation Issues

**Symptoms:**
- "Module not found" errors
- "DLL load failed" errors
- Python crashes when importing MetaTrader5

**Solutions:**
1. **Reinstall dependencies**
   ```bash
   pip uninstall -y MetaTrader5 websockets asyncio-mqtt python-dotenv
   pip install MetaTrader5==5.0.45 websockets==12.0 asyncio-mqtt==0.16.1 python-dotenv==1.0.0
   ```

2. **Check Python architecture**
   - MT5 requires 64-bit Python on Windows
   - Check with `python -c "import platform; print(platform.architecture()[0])"`
   - Should output "64bit"

3. **Check Visual C++ Redistributable**
   - MT5 Python API requires Visual C++ Redistributable
   - Download and install from Microsoft's website

## Advanced Debugging

### Checking MT5 API Connection

Run this test script to verify MT5 API functionality:

```python
import MetaTrader5 as mt5

# Initialize MT5
if not mt5.initialize():
    print(f"MT5 initialization failed: {mt5.last_error()}")
else:
    # Get account info
    account_info = mt5.account_info()
    if account_info is None:
        print("Failed to get account info")
    else:
        print(f"Connected to account: {account_info.login}")
        print(f"Balance: {account_info.balance}")
        print(f"Automated trading: {'Enabled' if account_info.trade_expert else 'DISABLED'}")
    
    # Shutdown MT5
    mt5.shutdown()
```

### Testing WebSocket Server

Run this test script to verify WebSocket server functionality:

```python
import asyncio
import websockets
import json

async def test_websocket():
    try:
        uri = "ws://localhost:8765"
        async with websockets.connect(uri) as websocket:
            print("Connected to WebSocket server")
            
            # Send ping message
            await websocket.send(json.dumps({"type": "ping"}))
            print("Sent ping message")
            
            # Wait for response
            response = await websocket.recv()
            print(f"Received: {response}")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(test_websocket())
```