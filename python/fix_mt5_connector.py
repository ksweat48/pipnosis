#!/usr/bin/env python3
"""
MT5 Connector Symbol Fix

This script adds a function to the MT5 connector to automatically select symbols
in Market Watch before executing trades, fixing the "Failed to select symbol" error.
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

def patch_connector_file(file_path):
    """Patch the MT5 connector file to add symbol selection functionality"""
    print(f"Patching MT5 connector file: {file_path}")
    
    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already patched
    if "ensure_symbol_selected" in content:
        print("✅ MT5 connector already has symbol selection functionality")
        return True
    
    # Find the place_order method
    place_order_match = re.search(r'def place_order\([^)]*\):[^\n]*\n', content)
    if not place_order_match:
        print("❌ Could not find place_order method in MT5 connector")
        return False
    
    place_order_start = place_order_match.start()
    
    # Add ensure_symbol_selected method before place_order
    ensure_symbol_method = """
    def ensure_symbol_selected(self, symbol: str) -> bool:
        \"\"\"Ensure a symbol is selected in Market Watch\"\"\"
        try:
            logger.info(f"Checking if symbol {symbol} is selected in Market Watch...")
            
            # Get symbol info
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                logger.error(f"Symbol {symbol} not found")
                return False
            
            # Check if symbol is selected in Market Watch
            if not symbol_info.visible:
                logger.info(f"Symbol {symbol} is not visible in Market Watch, selecting...")
                if not mt5.symbol_select(symbol, True):
                    logger.error(f"Failed to select symbol {symbol}")
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
    
    # Insert the method before place_order
    new_content = content[:place_order_start] + ensure_symbol_method + content[place_order_start:]
    
    # Now modify the place_order method to call ensure_symbol_selected
    place_order_body_match = re.search(r'def place_order\([^)]*\):[^\n]*\n', new_content)
    if not place_order_body_match:
        print("❌ Could not find place_order method in patched content")
        return False
    
    place_order_body_start = place_order_body_match.end()
    
    # Find the first line of the method body with proper indentation
    lines = new_content[place_order_body_start:].split('\n')
    first_line = lines[0]
    indentation = len(first_line) - len(first_line.lstrip())
    
    # Create the symbol selection code to insert
    symbol_selection_code = ' ' * indentation + '# CRITICAL FIX: Ensure symbol is selected in Market Watch\n'
    symbol_selection_code += ' ' * indentation + 'if not self.ensure_symbol_selected(symbol):\n'
    symbol_selection_code += ' ' * indentation + '    return {\'success\': False, \'error\': f\'Failed to select symbol {symbol} in Market Watch\'}\n\n'
    
    # Insert the symbol selection code
    new_content = new_content[:place_order_body_start] + '\n' + symbol_selection_code + new_content[place_order_body_start:]
    
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
    print("MT5 Connector Symbol Fix")
    print("=" * 60)
    print("This utility patches the MT5 connector to automatically select symbols")
    print("in Market Watch before executing trades, fixing the 'Failed to select symbol' error.")
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
    confirm = input("Patch this file to fix symbol selection errors? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Operation cancelled.")
        return
    
    # Patch the file
    if patch_connector_file(connector_file):
        print("\n✅ MT5 connector patched successfully!")
        print("🔄 Please restart the MT5 bridge to apply the changes.")
    else:
        print("\n❌ Failed to patch MT5 connector.")
    
    input("Press Enter to exit...")

if __name__ == "__main__":
    main()