#!/usr/bin/env python3
"""
MT5 Symbol Format Fix

This script adds a function to the MT5 connector to automatically correct symbol formats
(e.g., converting "EUR/USD" to "EURUSD") before executing trades.
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
    """Patch the MT5 connector file to add symbol format correction"""
    print(f"Patching MT5 connector file: {file_path}")
    
    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already patched
    if "format_symbol" in content:
        print("✅ MT5 connector already has symbol format correction functionality")
        return True
    
    # Find the class definition
    class_match = re.search(r'class\s+MT5Connector[^:]*:', content)
    if not class_match:
        print("❌ Could not find MT5Connector class in the file")
        return False
    
    class_end = class_match.end()
    
    # Create the function to add
    format_symbol_function = """
    def format_symbol(self, symbol: str) -> str:
        \"\"\"Format symbol to MT5 standard (e.g., EUR/USD -> EURUSD)\"\"\"
        try:
            # Remove any slashes
            formatted = symbol.replace('/', '')
            
            # Remove any spaces
            formatted = formatted.replace(' ', '')
            
            # Convert to uppercase
            formatted = formatted.upper()
            
            logger.info(f"Symbol format conversion: {symbol} -> {formatted}")
            return formatted
            
        except Exception as e:
            logger.error(f"Error formatting symbol: {e}")
            return symbol  # Return original symbol if formatting fails
    """
    
    # Insert the function after the class definition
    new_content = content[:class_end] + "\n" + format_symbol_function + content[class_end:]
    
    # Now find all places where symbol is used in place_order or similar methods
    # Look for place_order method
    place_order_match = re.search(r'def\s+place_order\s*\(\s*self\s*,\s*symbol\s*:', new_content)
    if not place_order_match:
        print("❌ Could not find place_order method with symbol parameter")
        return False
    
    place_order_start = place_order_match.start()
    place_order_end = new_content.find('def', place_order_start + 1) if new_content.find('def', place_order_start + 1) != -1 else len(new_content)
    place_order_body = new_content[place_order_start:place_order_end]
    
    # Add symbol formatting at the beginning of the method
    format_line = "        symbol = self.format_symbol(symbol)  # Format symbol to MT5 standard\n"
    
    # Find the first line after the method definition with proper indentation
    method_def_end = place_order_body.find(':') + 1
    next_line_start = place_order_body.find('\n', method_def_end) + 1
    
    # Insert the format line after the first line with proper indentation
    modified_place_order = place_order_body[:next_line_start] + format_line + place_order_body[next_line_start:]
    
    # Replace the original method with the modified one
    new_content = new_content[:place_order_start] + modified_place_order + new_content[place_order_end:]
    
    # Backup the original file
    backup_path = file_path.with_suffix('.py.bak')
    with open(backup_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"✅ Original file backed up to: {backup_path}")
    
    # Write the patched file
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print("✅ MT5 connector patched successfully with symbol format correction")
    return True

def main():
    """Main function"""
    print("=" * 60)
    print("MT5 Symbol Format Fix")
    print("=" * 60)
    print("This utility patches the MT5 connector to automatically correct symbol formats")
    print("(e.g., converting 'EUR/USD' to 'EURUSD') before executing trades.")
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
    confirm = input("Patch this file to fix symbol format errors? (y/n): ").strip().lower()
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