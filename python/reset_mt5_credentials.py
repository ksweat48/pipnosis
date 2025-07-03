#!/usr/bin/env python3
"""
MT5 Credentials Reset Tool

This script allows you to completely reset your MT5 credentials
and create a new configuration file with new login details.
"""

import os
import sys
import json
import base64
import configparser
from datetime import datetime
from pathlib import Path
from cryptography.fernet import Fernet

def get_encryption_key():
    """Get or create the encryption key"""
    key_file = Path.home() / "Pipnosis" / "pipnosis.key"
    
    if key_file.exists():
        with open(key_file, 'rb') as f:
            return f.read()
    else:
        # Use a key derived from system info (in production, use proper key management)
        # This is the same method used in the main connector
        key = base64.urlsafe_b64encode(b'pipnosis_mt5_key_32_chars_long!')
        
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(key_file), exist_ok=True)
        
        # Save key
        with open(key_file, 'wb') as f:
            f.write(key)
        
        return key

def reset_credentials(login, password, server="MetaQuotes-Demo"):
    """Reset MT5 credentials and create a new config file"""
    try:
        # Get encryption key
        key = get_encryption_key()
        cipher_suite = Fernet(key)
        
        # Encrypt password
        encrypted_password = cipher_suite.encrypt(password.encode())
        
        # Create config
        config = configparser.ConfigParser()
        config['MT5'] = {
            'login': login,
            'password': encrypted_password.decode(),
            'server': server,
            'last_updated': datetime.now().isoformat(),
            'version': '2.1.0'
        }
        
        # Determine output path
        config_dir = Path.home() / "Pipnosis"
        os.makedirs(config_dir, exist_ok=True)
        output_path = config_dir / "config.ini"
        
        # Save config
        with open(output_path, 'w') as f:
            config.write(f)
        
        print(f"✅ MT5 credentials reset successfully!")
        print(f"📁 Configuration saved to: {output_path}")
        print(f"🔑 Login: {login}")
        print(f"🌐 Server: {server}")
        
        return True
    except Exception as e:
        print(f"❌ Error resetting credentials: {e}")
        return False

def main():
    """Main function"""
    print("=" * 60)
    print("MT5 Credentials Reset Tool")
    print("=" * 60)
    print("\nThis tool will reset your MT5 credentials and create a new configuration file.")
    print("Your existing credentials will be overwritten.")
    print("\nEnter your new MT5 credentials:")
    
    login = input("MT5 Login (Account Number): ").strip()
    password = input("MT5 Password: ").strip()
    server = input("MT5 Server [MetaQuotes-Demo]: ").strip() or "MetaQuotes-Demo"
    
    if not login or not password:
        print("\n❌ Login and password cannot be empty.")
        return
    
    print("\nNew MT5 Credentials:")
    print(f"Login: {login}")
    print(f"Password: {'*' * len(password)}")
    print(f"Server: {server}")
    
    confirm = input("\nReset credentials with these values? (y/n): ").strip().lower()
    if confirm != 'y':
        print("\nOperation cancelled.")
        return
    
    if reset_credentials(login, password, server):
        print("\n✅ MT5 credentials have been reset successfully!")
        print("🔄 Please restart the MT5 bridge to apply the changes.")
    else:
        print("\n❌ Failed to reset credentials.")

if __name__ == "__main__":
    main()