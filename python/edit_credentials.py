#!/usr/bin/env python3
"""
MT5 Credentials Editor Utility

This script allows you to update your MT5 credentials (login, password, server)
without having to manually edit the encrypted credentials file.
"""

import os
import sys
import json
import base64
from cryptography.fernet import Fernet
from pathlib import Path

def get_encryption_key():
    """Get or create the encryption key"""
    key_file = Path.home() / "Pipnosis" / "pipnosis.key"
    
    if key_file.exists():
        with open(key_file, 'rb') as f:
            return f.read()
    else:
        # Use a key derived from system info (in production, use proper key management)
        # This is the same method used in the main connector
        return base64.urlsafe_b64encode(b'pipnosis_mt5_key_32_chars_long!')

def load_credentials():
    """Load and decrypt MT5 credentials"""
    # Check for credentials in different possible locations
    possible_paths = [
        Path.home() / "Pipnosis" / "config.ini",
        Path("pipnosis_config.ini"),
        Path("python/pipnosis_config.ini"),
        Path("mt5-bridge/pipnosis_config.ini"),
        Path("python/mt5_credentials.enc"),
        Path("mt5-bridge/mt5_credentials.enc"),
        Path.home() / "Pipnosis" / "mt5_credentials.enc"
    ]
    
    credentials_file = None
    for path in possible_paths:
        if path.exists():
            credentials_file = path
            print(f"Found credentials at: {path}")
            break
    
    if not credentials_file:
        print("No credentials file found. Creating a new one.")
        return {
            'login': '',
            'password': '',
            'server': 'MetaQuotes-Demo',
            'last_updated': ''
        }
    
    try:
        # Get encryption key
        key = get_encryption_key()
        cipher_suite = Fernet(key)
        
        # Read and decrypt credentials
        if str(credentials_file).endswith('.enc'):
            # Direct encrypted file
            with open(credentials_file, 'rb') as f:
                encrypted_data = f.read()
                decrypted_data = cipher_suite.decrypt(encrypted_data)
                return json.loads(decrypted_data.decode())
        else:
            # Config file format
            import configparser
            config = configparser.ConfigParser()
            config.read(credentials_file)
            
            if 'MT5' not in config:
                print("No MT5 section found in config file.")
                return {
                    'login': '',
                    'password': '',
                    'server': 'MetaQuotes-Demo',
                    'last_updated': ''
                }
            
            # Decrypt password
            encrypted_password = config['MT5']['password'].encode()
            decrypted_password = cipher_suite.decrypt(encrypted_password).decode()
            
            return {
                'login': config['MT5']['login'],
                'password': decrypted_password,
                'server': config['MT5']['server'],
                'last_updated': config['MT5'].get('last_updated', '')
            }
    except Exception as e:
        print(f"Error loading credentials: {e}")
        return None

def save_credentials(credentials, output_path=None):
    """Save and encrypt MT5 credentials"""
    try:
        # Get encryption key
        key = get_encryption_key()
        cipher_suite = Fernet(key)
        
        # Determine output path
        if not output_path:
            # Try to save to the same location as the loaded credentials
            possible_paths = [
                Path.home() / "Pipnosis" / "config.ini",
                Path("pipnosis_config.ini"),
                Path("python/pipnosis_config.ini"),
                Path("mt5-bridge/pipnosis_config.ini")
            ]
            
            for path in possible_paths:
                if path.exists():
                    output_path = path
                    break
            
            # If no existing file found, create in home directory
            if not output_path:
                output_path = Path.home() / "Pipnosis" / "config.ini"
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Encrypt and save credentials
        if str(output_path).endswith('.enc'):
            # Direct encrypted file
            encrypted_data = cipher_suite.encrypt(json.dumps(credentials).encode())
            with open(output_path, 'wb') as f:
                f.write(encrypted_data)
        else:
            # Config file format
            import configparser
            from datetime import datetime
            
            config = configparser.ConfigParser()
            
            # Load existing config if it exists
            if os.path.exists(output_path):
                config.read(output_path)
            
            if 'MT5' not in config:
                config['MT5'] = {}
            
            # Encrypt password
            encrypted_password = cipher_suite.encrypt(credentials['password'].encode())
            
            config['MT5']['login'] = credentials['login']
            config['MT5']['password'] = encrypted_password.decode()
            config['MT5']['server'] = credentials['server']
            config['MT5']['last_updated'] = datetime.now().isoformat()
            
            with open(output_path, 'w') as f:
                config.write(f)
        
        print(f"Credentials saved successfully to {output_path}")
        return True
    except Exception as e:
        print(f"Error saving credentials: {e}")
        return False

def main():
    """Main function to edit MT5 credentials"""
    print("=" * 60)
    print("MT5 Credentials Editor")
    print("=" * 60)
    
    # Load current credentials
    current_creds = load_credentials()
    if current_creds is None:
        print("Failed to load credentials. Exiting.")
        return
    
    print("\nCurrent MT5 Credentials:")
    print(f"Login: {current_creds.get('login', 'Not set')}")
    print(f"Password: {'*' * len(current_creds.get('password', ''))} (hidden)")
    print(f"Server: {current_creds.get('server', 'Not set')}")
    print(f"Last Updated: {current_creds.get('last_updated', 'Unknown')}")
    
    print("\nEnter new credentials (leave blank to keep current value):")
    
    # Get new values
    new_login = input(f"New Login [{current_creds.get('login', '')}]: ").strip()
    new_password = input("New Password: ").strip()
    new_server = input(f"New Server [{current_creds.get('server', 'MetaQuotes-Demo')}]: ").strip()
    
    # Use current values if new ones are not provided
    if not new_login:
        new_login = current_creds.get('login', '')
    if not new_password:
        new_password = current_creds.get('password', '')
    if not new_server:
        new_server = current_creds.get('server', 'MetaQuotes-Demo')
    
    # Confirm changes
    print("\nNew MT5 Credentials:")
    print(f"Login: {new_login}")
    print(f"Password: {'*' * len(new_password)} (hidden)")
    print(f"Server: {new_server}")
    
    confirm = input("\nSave these credentials? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Changes cancelled.")
        return
    
    # Save new credentials
    new_creds = {
        'login': new_login,
        'password': new_password,
        'server': new_server
    }
    
    if save_credentials(new_creds):
        print("\nCredentials updated successfully!")
        print("Restart the MT5 bridge to apply the changes.")
    else:
        print("\nFailed to update credentials.")

if __name__ == "__main__":
    main()