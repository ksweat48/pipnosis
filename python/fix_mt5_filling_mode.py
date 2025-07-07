#!/usr/bin/env python3
"""
MT5 Filling Mode Fix

This script patches your MT5 connector to handle the "Unsupported filling mode" error
by automatically detecting and using the correct filling mode supported by your broker.
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

def patch_filling_mode(file_path):
    """Patch the MT5 connector to handle different filling modes"""
    print(f"Patching filling mode in: {file_path}")
    
    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already patched
    if "get_filling_mode" in content:
        print("✅ MT5 connector already has filling mode handling")
        return True
    
    # Create the function to add
    filling_mode_function = """
    def get_filling_mode(self, symbol: str) -> int:
        \"\"\"Get the appropriate filling mode for a symbol\"\"\"
        try:
            # Get the symbol info
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                logger.error(f"Symbol {symbol} not found")
                return mt5.ORDER_FILLING_RETURN  # Default to RETURN as most compatible
            
            # Check the trade_fill_flags property to determine supported filling modes
            if hasattr(symbol_info, 'trade_fill_flags'):
                logger.info(f"Symbol {symbol} has trade_fill_flags: {symbol_info.trade_fill_flags}")
                
                # Check supported filling modes based on flags
                # 1 = FOK, 2 = IOC, 4 = RETURN
                if symbol_info.trade_fill_flags & 1:
                    logger.info(f"Symbol {symbol} supports FOK filling mode")
                    return mt5.ORDER_FILLING_FOK
                elif symbol_info.trade_fill_flags & 2:
                    logger.info(f"Symbol {symbol} supports IOC filling mode")
                    return mt5.ORDER_FILLING_IOC
                elif symbol_info.trade_fill_flags & 4:
                    logger.info(f"Symbol {symbol} supports RETURN filling mode")
                    return mt5.ORDER_FILLING_RETURN
                else:
                    logger.info(f"Symbol {symbol} has no supported filling modes in flags, using RETURN as fallback")
                    return mt5.ORDER_FILLING_RETURN  # Most commonly supported
            else:
                # Fallback to checking filling_mode property
                if hasattr(symbol_info, 'filling_mode'):
                    logger.info(f"Symbol {symbol} has filling_mode: {symbol_info.filling_mode}")
                    
                    if symbol_info.filling_mode & mt5.SYMBOL_FILLING_FOK:
                        logger.info(f"Symbol {symbol} supports FOK filling mode")
                        return mt5.ORDER_FILLING_FOK
                    elif symbol_info.filling_mode & mt5.SYMBOL_FILLING_IOC:
                        logger.info(f"Symbol {symbol} supports IOC filling mode")
                        return mt5.ORDER_FILLING_IOC
                    else:
                        logger.info(f"Symbol {symbol} has no supported filling modes, using RETURN as fallback")
                        return mt5.ORDER_FILLING_RETURN
                else:
                    # If no specific modes are indicated, try to determine from the execution mode
                    if hasattr(symbol_info, 'execution_mode'):
                        if symbol_info.execution_mode == mt5.SYMBOL_TRADE_EXECUTION_MARKET:
                            logger.info(f"Symbol {symbol} uses MARKET execution, using RETURN filling")
                            return mt5.ORDER_FILLING_RETURN
                        elif symbol_info.execution_mode == mt5.SYMBOL_TRADE_EXECUTION_EXCHANGE:
                            logger.info(f"Symbol {symbol} uses EXCHANGE execution, using RETURN filling")
                            return mt5.ORDER_FILLING_RETURN
                        elif symbol_info.execution_mode == mt5.SYMBOL_TRADE_EXECUTION_INSTANT:
                            logger.info(f"Symbol {symbol} uses INSTANT execution, using IOC filling")
                            return mt5.ORDER_FILLING_IOC
                        else:
                            logger.info(f"Symbol {symbol} has unknown execution mode, using RETURN filling")
                            return mt5.ORDER_FILLING_RETURN
                    else:
                        logger.info(f"Symbol {symbol} has no filling mode info, using RETURN filling")
                        return mt5.ORDER_FILLING_RETURN  # Most commonly supported
            
        except Exception as e:
            logger.error(f"Error determining filling mode: {e}")
            return mt5.ORDER_FILLING_RETURN  # Default to RETURN as fallback
    """
    
    # Find the class definition
    class_match = re.search(r'class\s+MT5Connector[^:]*:', content)
    if not class_match:
        print("❌ Could not find MT5Connector class in the file")
        return False
    
    class_end = class_match.end()
    
    # Insert the function after the class definition
    new_content = content[:class_end] + "\n" + filling_mode_function + content[class_end:]
    
    # Now find all places where ORDER_FILLING_IOC is used and replace with the function call
    # This pattern looks for "type_filling": mt5.ORDER_FILLING_IOC, or similar
    filling_pattern = r'(["\'])type_filling\1\s*:\s*mt5\.ORDER_FILLING_IOC'
    
    # Replace with dynamic filling mode
    new_content = re.sub(filling_pattern, r'\1type_filling\1: self.get_filling_mode(symbol)', new_content)
    
    # Backup the original file
    backup_path = file_path.with_suffix('.py.bak2')
    with open(backup_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"✅ Original file backed up to: {backup_path}")
    
    # Write the patched file
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print("✅ MT5 connector patched successfully with dynamic filling mode")
    return True

def main():
    """Main function"""
    print("=" * 60)
    print("MT5 Filling Mode Fix")
    print("=" * 60)
    print("This utility fixes the 'Unsupported filling mode' error (10030)")
    print("by automatically detecting the correct filling mode for your broker.")
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
    confirm = input("Patch the file to fix filling mode errors? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Operation cancelled.")
        return
    
    # Patch the file
    if patch_filling_mode(connector_file):
        print("\n✅ MT5 connector updated successfully!")
        print("🔄 Please restart the MT5 bridge to apply the changes.")
    else:
        print("\n❌ Failed to update MT5 connector.")
    
    input("Press Enter to exit...")

if __name__ == "__main__":
    main()