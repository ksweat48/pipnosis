#!/usr/bin/env python3
"""
MT5 Symbol Selection Fix

This script adds a function to automatically select symbols in Market Watch
before executing trades, fixing the "Failed to select symbol" error.
"""

import os
import sys
import re
from pathlib import Path

def find_mt5_connector_file():
    """Find the MT5 connector file"""
    possible_paths = [
        Path("mt5_connector.py"),
        Path("python/mt5_connector.py"),
        Path("mt5-bridge/mt5_connector.py"),
        Path.home() / "Pipnosis" / "mt5_connector.py"
    ]
    
    for path in possible_paths:
        if path.exists():
            return path
    
    return None

def add_symbol_selection_function(file_path):
    """Add the symbol selection function to the MT5 connector file"""
    print(f"Adding symbol selection function to: {file_path}")
    
    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already patched
    if "ensure_symbol_selected" in content:
        print("✅ MT5 connector already has symbol selection functionality")
        return True
    
    # Create the function to add
    symbol_selection_function = """
    def ensure_symbol_selected(self, symbol: str) -> bool:
        \"\"\"Ensure a symbol is selected in Market Watch\"\"\"
        try:
            logger.info(f"Ensuring symbol {symbol} is selected in Market Watch...")
            
            # Get symbol info
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                logger.error(f"Symbol {symbol} not found")
                return False
            
            # Check if symbol is selected in Market Watch
            if not symbol_info.visible:
                logger.info(f"Symbol {symbol} is not visible in Market Watch, selecting...")
                
                # Try to select the symbol with retry logic
                for attempt in range(3):
                    if mt5.symbol_select(symbol, True):
                        break
                    
                    error_code, error_message = mt5.last_error()
                    logger.warning(f"Failed to select symbol {symbol} (attempt {attempt+1}/3): {error_code} - {error_message}")
                    time.sleep(0.5)  # Wait before retry
                else:
                    # All attempts failed
                    logger.error(f"Failed to select symbol {symbol} after multiple attempts")
                    return False
                
                # Wait for symbol to be fully loaded
                time.sleep(1)
                
                # Verify selection was successful
                symbol_info = mt5.symbol_info(symbol)
                if symbol_info is None or not symbol_info.visible:
                    logger.error(f"Failed to verify symbol {symbol} selection")
                    return False
                
                logger.info(f"✅ Symbol {symbol} selected successfully")
            else:
                logger.info(f"✅ Symbol {symbol} is already selected in Market Watch")
            
            # Get current tick to verify data is available
            tick = mt5.symbol_info_tick(symbol)
            if tick is None or tick.bid == 0 or tick.ask == 0:
                logger.error(f"No valid price data for {symbol}")
                return False
            
            logger.info(f"✅ Symbol {symbol} has valid price data: Bid={tick.bid}, Ask={tick.ask}")
            return True
            
        except Exception as e:
            logger.error(f"Error ensuring symbol selection: {e}")
            return False
    """
    
    # Find the class definition
    class_match = re.search(r'class\s+MT5Connector[^:]*:', content)
    if not class_match:
        print("❌ Could not find MT5Connector class in the file")
        return False
    
    class_end = class_match.end()
    
    # Insert the function after the class definition
    new_content = content[:class_end] + "\n" + symbol_selection_function + content[class_end:]
    
    # Now find all methods that execute trades and add symbol selection
    # Common method names that might execute trades
    trade_methods = [
        "place_order", 
        "execute_trade", 
        "send_order", 
        "create_order",
        "order_send"
    ]
    
    # Look for these methods and add symbol selection code
    for method in trade_methods:
        method_pattern = rf'def\s+{method}\s*\([^)]*\)\s*:'
        method_match = re.search(method_pattern, new_content)
        
        if method_match:
            print(f"Found trade method: {method}")
            method_start = method_match.end()
            
            # Find the first line of the method body with proper indentation
            lines = new_content[method_start:].split('\n')
            first_line = lines[0]
            indentation = len(first_line) - len(first_line.lstrip())
            
            # Create the symbol selection code to insert
            symbol_selection_code = '\n' + ' ' * indentation + '# CRITICAL FIX: Ensure symbol is selected in Market Watch\n'
            symbol_selection_code += ' ' * indentation + 'if not self.ensure_symbol_selected(symbol):\n'
            symbol_selection_code += ' ' * indentation + '    return {\'success\': False, \'error\': f\'Failed to select symbol {symbol} in Market Watch\'}\n\n'
            
            # Insert the symbol selection code
            new_content = new_content[:method_start] + symbol_selection_code + new_content[method_start:]
            print(f"✅ Added symbol selection to {method} method")
    
    # Backup the original file
    backup_path = file_path.with_suffix('.py.bak')
    with open(backup_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"✅ Original file backed up to: {backup_path}")
    
    # Write the patched file
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print("✅ MT5 connector patched successfully with symbol selection functionality")
    return True

def main():
    """Main function"""
    print("=" * 60)
    print("MT5 Symbol Selection Fix")
    print("=" * 60)
    print("This utility adds automatic symbol selection to your MT5 connector")
    print("to fix the 'Failed to select symbol' error.")
    print("=" * 60)
    
    # Find MT5 connector file
    connector_file = find_mt5_connector_file()
    if not connector_file:
        print("❌ Could not find MT5 connector file")
        print("Please run this script from the same directory as mt5_connector.py")
        input("Press Enter to exit...")
        return
    
    # Confirm patch
    print(f"Found MT5 connector file: {connector_file}")
    confirm = input("Add symbol selection functionality to fix errors? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Operation cancelled.")
        return
    
    # Add symbol selection function
    if add_symbol_selection_function(connector_file):
        print("\n✅ MT5 connector updated successfully!")
        print("🔄 Please restart the MT5 bridge to apply the changes.")
    else:
        print("\n❌ Failed to update MT5 connector.")
    
    input("Press Enter to exit...")

if __name__ == "__main__":
    main()