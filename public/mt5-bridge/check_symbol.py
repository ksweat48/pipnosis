"""
MT5 Symbol Checker - Troubleshooting Tool
This script checks if a symbol is properly configured and available for trading
"""

import MetaTrader5 as mt5
from datetime import datetime
import time

def check_symbol(symbol="EURUSD"):
    """Check if a symbol is properly configured and available for trading"""
    print(f"Checking symbol: {symbol}")
    print("=" * 50)
    
    # Initialize MT5
    if not mt5.initialize():
        print(f"❌ MT5 initialization failed: {mt5.last_error()}")
        return False
    
    try:
        # Check if symbol exists
        print(f"1. Checking if symbol {symbol} exists...")
        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            print(f"❌ Symbol {symbol} not found")
            return False
        
        print(f"✅ Symbol {symbol} exists")
        
        # Check if symbol is selected in Market Watch
        print(f"2. Checking if symbol is selected in Market Watch...")
        if not symbol_info.visible:
            print(f"⚠️ Symbol {symbol} is not visible in Market Watch, selecting...")
            if not mt5.symbol_select(symbol, True):
                print(f"❌ Failed to select symbol {symbol}")
                return False
            print(f"✅ Symbol {symbol} selected successfully")
            # Wait for symbol to be fully loaded
            time.sleep(1)
            # Refresh symbol info
            symbol_info = mt5.symbol_info(symbol)
        else:
            print(f"✅ Symbol {symbol} is already selected in Market Watch")
        
        # Check if trading is allowed
        print(f"3. Checking if trading is allowed for {symbol}...")
        if symbol_info.trade_mode == 0:
            print(f"❌ Trading is disabled for {symbol}")
            return False
        elif symbol_info.trade_mode == 1:
            print(f"⚠️ Only long positions are allowed for {symbol}")
        elif symbol_info.trade_mode == 2:
            print(f"⚠️ Only short positions are allowed for {symbol}")
        else:
            print(f"✅ Full trading is allowed for {symbol}")
        
        # Check current prices
        print(f"4. Checking current prices for {symbol}...")
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            print(f"❌ Failed to get tick data for {symbol}")
            return False
        
        if tick.bid == 0 or tick.ask == 0:
            print(f"❌ Invalid prices for {symbol}: Bid={tick.bid}, Ask={tick.ask}")
            print("   This is likely why you're getting 'No prices' errors")
            print("   Possible causes:")
            print("   - Market is closed")
            print("   - Symbol requires initialization time")
            print("   - Broker doesn't provide data for this symbol")
            return False
        
        print(f"✅ Valid prices for {symbol}: Bid={tick.bid}, Ask={tick.ask}")
        
        # Check stop levels
        print(f"5. Checking stop levels for {symbol}...")
        stop_level = symbol_info.trade_stops_level
        point = symbol_info.point
        min_stop_distance = stop_level * point
        
        print(f"   Minimum stop level: {stop_level} points")
        print(f"   Point value: {point}")
        print(f"   Minimum stop distance: {min_stop_distance}")
        
        # Calculate valid stop loss and take profit levels
        print(f"6. Valid stop loss and take profit levels:")
        print(f"   For BUY orders:")
        print(f"   - Minimum valid SL: {tick.bid - min_stop_distance}")
        print(f"   - Minimum valid TP: {tick.ask + min_stop_distance}")
        print(f"   For SELL orders:")
        print(f"   - Minimum valid SL: {tick.ask + min_stop_distance}")
        print(f"   - Minimum valid TP: {tick.bid - min_stop_distance}")
        
        # Check trading hours
        print(f"7. Checking trading hours...")
        current_time = datetime.now()
        server_time = datetime.fromtimestamp(tick.time)
        print(f"   Current local time: {current_time}")
        print(f"   Server time: {server_time}")
        
        # Check session info if available
        if hasattr(symbol_info, 'session_deals'):
            print(f"   Session deals: {symbol_info.session_deals}")
            print(f"   Session buy orders: {symbol_info.session_buy_orders}")
            print(f"   Session sell orders: {symbol_info.session_sell_orders}")
        
        # Check volume limits
        print(f"8. Volume limits:")
        print(f"   Minimum volume: {symbol_info.volume_min}")
        print(f"   Maximum volume: {symbol_info.volume_max}")
        print(f"   Volume step: {symbol_info.volume_step}")
        
        # Summary
        print("\nSUMMARY:")
        print(f"Symbol: {symbol}")
        print(f"Trade mode: {symbol_info.trade_mode} (0=disabled, 1=long only, 2=short only, 3=full)")
        print(f"Current bid: {tick.bid}")
        print(f"Current ask: {tick.ask}")
        print(f"Spread: {tick.ask - tick.bid}")
        print(f"Stop level: {stop_level} points ({min_stop_distance} price units)")
        
        return True
    
    except Exception as e:
        print(f"❌ Error checking symbol: {e}")
        return False
    
    finally:
        # Shutdown MT5
        mt5.shutdown()

if __name__ == "__main__":
    # Check default symbol (EURUSD)
    check_symbol()
    
    # Uncomment to check other symbols
    # check_symbol("GBPUSD")
    # check_symbol("USDJPY")
    # check_symbol("XAUUSD")