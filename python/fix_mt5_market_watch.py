#!/usr/bin/env python3
"""
MT5 Market Watch Fixer

This script fixes the "Failed to select symbol" error by ensuring
all common trading symbols are properly added to the MT5 Market Watch.

Run this script before starting the MT5 bridge if you encounter symbol selection errors.
"""

import MetaTrader5 as mt5
import time
import logging
import sys
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('mt5_market_watch_fixer.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

def initialize_mt5():
    """Initialize connection to MT5 terminal"""
    try:
        logger.info("Initializing MT5 connection...")
        
        # Initialize MT5 connection
        if not mt5.initialize():
            error = mt5.last_error()
            logger.error(f"MT5 initialization failed: {error}")
            return False
        
        # Get account info
        account_info = mt5.account_info()
        if account_info is None:
            logger.error("Failed to get account info - MT5 not logged in?")
            mt5.shutdown()
            return False
        
        logger.info(f"✅ MT5 connected successfully!")
        logger.info(f"Account: {account_info.login}")
        logger.info(f"Server: {account_info.server}")
        logger.info(f"Balance: ${account_info.balance:,.2f}")
        
        return True
            
    except Exception as e:
        logger.error(f"MT5 initialization error: {e}")
        return False

def fix_market_watch():
    """Add common symbols to Market Watch"""
    common_symbols = [
        "EURUSD", "GBPUSD", "USDJPY", "USDCHF", 
        "AUDUSD", "USDCAD", "NZDUSD", "EURJPY", 
        "GBPJPY", "EURGBP", "XAUUSD"
    ]
    
    logger.info(f"Adding {len(common_symbols)} common symbols to Market Watch...")
    
    success_count = 0
    failed_symbols = []
    
    for symbol in common_symbols:
        try:
            # Get symbol info
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                logger.warning(f"Symbol {symbol} not found in this broker")
                failed_symbols.append(f"{symbol} (not found)")
                continue
            
            # Check if symbol is selected in Market Watch
            if not symbol_info.visible:
                logger.info(f"Adding {symbol} to Market Watch...")
                if not mt5.symbol_select(symbol, True):
                    logger.error(f"Failed to add {symbol} to Market Watch")
                    failed_symbols.append(f"{symbol} (selection failed)")
                    continue
                
                # Wait for symbol to be fully loaded
                time.sleep(0.5)
                
                # Verify selection was successful
                symbol_info = mt5.symbol_info(symbol)
                if symbol_info is None or not symbol_info.visible:
                    logger.error(f"Failed to verify {symbol} was added")
                    failed_symbols.append(f"{symbol} (verification failed)")
                    continue
                
                logger.info(f"✅ {symbol} added successfully")
            else:
                logger.info(f"✅ {symbol} is already in Market Watch")
            
            # Get current tick to verify data is available
            tick = mt5.symbol_info_tick(symbol)
            if tick is None or tick.bid == 0 or tick.ask == 0:
                logger.warning(f"No valid price data for {symbol}")
                failed_symbols.append(f"{symbol} (no price data)")
            else:
                logger.info(f"✅ {symbol} has valid price data: Bid={tick.bid}, Ask={tick.ask}")
                success_count += 1
                
        except Exception as e:
            logger.error(f"Error processing {symbol}: {e}")
            failed_symbols.append(f"{symbol} (error: {str(e)})")
    
    logger.info(f"Market Watch update complete. {success_count}/{len(common_symbols)} symbols ready for trading.")
    
    if failed_symbols:
        logger.warning("The following symbols could not be added:")
        for symbol in failed_symbols:
            logger.warning(f"  - {symbol}")
    
    return success_count, failed_symbols

def main():
    """Main function"""
    print("=" * 60)
    print("MT5 Market Watch Fixer")
    print("=" * 60)
    print("This utility fixes the 'Failed to select symbol' error by adding")
    print("common trading symbols to your MT5 Market Watch.")
    print("=" * 60)
    
    # Initialize MT5
    if not initialize_mt5():
        print("❌ Failed to initialize MT5 - exiting")
        print("Make sure MetaTrader 5 is running and logged in.")
        input("Press Enter to exit...")
        return
    
    try:
        # Fix Market Watch
        success_count, failed_symbols = fix_market_watch()
        
        if success_count > 0:
            print(f"\n✅ Success! {success_count} symbols are now ready for trading.")
            print("You can now start the MT5 bridge without symbol selection errors.")
            
            if failed_symbols:
                print("\n⚠️ Some symbols could not be added:")
                for symbol in failed_symbols:
                    print(f"  - {symbol}")
                print("\nThis may be because they are not available with your broker.")
        else:
            print("\n❌ Failed to add any symbols to Market Watch.")
            print("Please check your MT5 connection and try again.")
        
    finally:
        # Shutdown MT5
        mt5.shutdown()
        print("\nMT5 connection closed")
        print("=" * 60)
        input("Press Enter to exit...")

if __name__ == "__main__":
    main()