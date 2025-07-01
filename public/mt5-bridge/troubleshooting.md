# MT5 Bridge Troubleshooting Guide

## Common Issues and Solutions

### 1. "No prices" Error (Error Code 10021)

**Symptoms:**
- Error message: "Order failed: 10021 - No prices"
- Trade execution fails despite connection being active

**Solutions:**
1. **Symbol Not Selected for Market Watch**
   - The symbol you're trying to trade may not be selected in MT5
   - Open MT5 terminal and add the symbol to Market Watch (right-click in Market Watch → Show All)
   - The bridge now attempts to select the symbol automatically

2. **Market Closed or No Liquidity**
   - This error often occurs when the market is closed for the symbol
   - Check if the forex market is open for the pair you're trading
   - Some brokers have limited trading hours for certain instruments

3. **Symbol Requires Initialization**
   - Some symbols need time to initialize price data
   - Try manually viewing the symbol chart in MT5 first
   - The bridge now implements automatic retries for this error

### 2. "Invalid stops" Error (Error Code 10016)

**Symptoms:**
- Error message: "Order failed: 10016 - Invalid stops"
- Trade execution fails despite connection being active

**Solutions:**
1. **Stop Loss/Take Profit Too Close to Current Price**
   - MetaTrader 5 requires a minimum distance between the current price and stop levels
   - This distance is defined by the broker and can vary by symbol
   - The bridge now automatically adjusts stop levels to valid values

2. **Check Symbol Properties**
   - Different symbols have different minimum stop level requirements
   - For major pairs, typically 5-10 pips minimum distance is required
   - For exotic pairs or during high volatility, this can be higher

3. **Verify in MT5 Terminal**
   - Open MT5 and try to place the same trade manually
   - MT5 will show the minimum allowed stop level distance
   - Use this as a reference for your automated trades

### 3. Bridge Not Connecting to MT5

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

### 4. WebSocket Connection Issues

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

### 5. Trade Execution Failures

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

### 6. Data Streaming Issues

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

### 7. Installation Issues

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

### Checking Symbol Stop Levels

Run this script to check minimum stop levels for a specific symbol:

```python
import MetaTrader5 as mt5

# Initialize MT5
if not mt5.initialize():
    print(f"MT5 initialization failed: {mt5.last_error()}")
    exit()

# Get symbol info
symbol = "EURUSD"  # Change to your symbol
symbol_info = mt5.symbol_info(symbol)

if symbol_info is None:
    print(f"Symbol {symbol} not found")
    mt5.shutdown()
    exit()

# Get current tick
tick = mt5.symbol_info_tick(symbol)

print(f"Symbol: {symbol}")
print(f"Point: {symbol_info.point}")
print(f"Digits: {symbol_info.digits}")
print(f"Trade stops level: {symbol_info.trade_stops_level} points")
print(f"Current bid: {tick.bid}")
print(f"Current ask: {tick.ask}")

# Calculate minimum stop levels
min_sl_distance = symbol_info.trade_stops_level * symbol_info.point
min_tp_distance = symbol_info.trade_stops_level * symbol_info.point

print(f"Minimum SL distance: {min_sl_distance}")
print(f"Minimum TP distance: {min_tp_distance}")

# For buy orders
print(f"Buy order - Minimum valid SL: {tick.bid - min_sl_distance}")
print(f"Buy order - Minimum valid TP: {tick.ask + min_tp_distance}")

# For sell orders
print(f"Sell order - Minimum valid SL: {tick.ask + min_sl_distance}")
print(f"Sell order - Minimum valid TP: {tick.bid - min_tp_distance}")

mt5.shutdown()
```

### Checking Symbol Trading Hours

Run this script to check if a symbol is currently tradable:

```python
import MetaTrader5 as mt5
from datetime import datetime

# Initialize MT5
if not mt5.initialize():
    print(f"MT5 initialization failed: {mt5.last_error()}")
    exit()

# Get symbol info
symbol = "EURUSD"  # Change to your symbol
symbol_info = mt5.symbol_info(symbol)

if symbol_info is None:
    print(f"Symbol {symbol} not found")
    mt5.shutdown()
    exit()

# Check if symbol is selected in Market Watch
if not symbol_info.visible:
    print(f"Symbol {symbol} is not visible in Market Watch, selecting...")
    if not mt5.symbol_select(symbol, True):
        print(f"Failed to select symbol {symbol}")
        mt5.shutdown()
        exit()
    else:
        print(f"Symbol {symbol} selected successfully")
        # Refresh symbol info
        symbol_info = mt5.symbol_info(symbol)

# Get current time
current_time = datetime.now()
server_time = mt5.symbol_info_tick(symbol).time
print(f"Current local time: {current_time}")
print(f"Server time: {datetime.fromtimestamp(server_time)}")

# Check if trading is allowed
print(f"Symbol: {symbol}")
print(f"Trade mode: {symbol_info.trade_mode}")  # 0=disabled, 1=long only, 2=short only, 3=full
print(f"Trading allowed: {'Yes' if symbol_info.trade_mode != 0 else 'No'}")
print(f"Session status: {'Open' if symbol_info.session_deals > 0 else 'Closed'}")

# Get current tick
tick = mt5.symbol_info_tick(symbol)
print(f"Current bid: {tick.bid}")
print(f"Current ask: {tick.ask}")
print(f"Last deal time: {datetime.fromtimestamp(tick.time)}")

mt5.shutdown()
```