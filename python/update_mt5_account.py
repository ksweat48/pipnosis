#!/usr/bin/env python3
"""
MT5 Account Updater - Simple GUI Tool

This script provides a graphical interface to update your MT5 account credentials.
It handles the encryption and storage of credentials in the same way as the main connector.
"""

import os
import sys
import json
import base64
import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime
from pathlib import Path
from cryptography.fernet import Fernet

class MT5CredentialsEditor:
    def __init__(self, root):
        self.root = root
        self.root.title("MT5 Account Credentials Editor")
        self.root.geometry("500x400")
        self.root.resizable(True, True)
        
        # Set up styles
        self.setup_styles()
        
        # Create main frame
        main_frame = ttk.Frame(root, padding=20)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Title
        title_label = ttk.Label(main_frame, text="MT5 Account Credentials", style="Title.TLabel")
        title_label.pack(pady=(0, 20))
        
        # Current credentials frame
        current_frame = ttk.LabelFrame(main_frame, text="Current Credentials", padding=10)
        current_frame.pack(fill=tk.X, pady=(0, 20))
        
        # Load current credentials
        self.current_creds = self.load_credentials()
        
        # Current credentials display
        self.current_login_var = tk.StringVar(value=self.current_creds.get('login', 'Not set'))
        self.current_password_var = tk.StringVar(value='*' * len(self.current_creds.get('password', '')))
        self.current_server_var = tk.StringVar(value=self.current_creds.get('server', 'Not set'))
        
        # Current credentials grid
        ttk.Label(current_frame, text="Login:").grid(row=0, column=0, sticky=tk.W, pady=2)
        ttk.Label(current_frame, text="Password:").grid(row=1, column=0, sticky=tk.W, pady=2)
        ttk.Label(current_frame, text="Server:").grid(row=2, column=0, sticky=tk.W, pady=2)
        
        ttk.Label(current_frame, textvariable=self.current_login_var).grid(row=0, column=1, sticky=tk.W, pady=2)
        ttk.Label(current_frame, textvariable=self.current_password_var).grid(row=1, column=1, sticky=tk.W, pady=2)
        ttk.Label(current_frame, textvariable=self.current_server_var).grid(row=2, column=1, sticky=tk.W, pady=2)
        
        # New credentials frame
        new_frame = ttk.LabelFrame(main_frame, text="New Credentials", padding=10)
        new_frame.pack(fill=tk.X, pady=(0, 20))
        
        # New credentials input
        self.new_login_var = tk.StringVar(value=self.current_creds.get('login', ''))
        self.new_password_var = tk.StringVar()
        self.new_server_var = tk.StringVar(value=self.current_creds.get('server', 'MetaQuotes-Demo'))
        
        # New credentials grid
        ttk.Label(new_frame, text="Login:").grid(row=0, column=0, sticky=tk.W, pady=5)
        ttk.Label(new_frame, text="Password:").grid(row=1, column=0, sticky=tk.W, pady=5)
        ttk.Label(new_frame, text="Server:").grid(row=2, column=0, sticky=tk.W, pady=5)
        
        ttk.Entry(new_frame, textvariable=self.new_login_var, width=30).grid(row=0, column=1, sticky=tk.W, pady=5)
        password_entry = ttk.Entry(new_frame, textvariable=self.new_password_var, width=30, show="*")
        password_entry.grid(row=1, column=1, sticky=tk.W, pady=5)
        ttk.Entry(new_frame, textvariable=self.new_server_var, width=30).grid(row=2, column=1, sticky=tk.W, pady=5)
        
        # Server presets
        server_frame = ttk.Frame(new_frame)
        server_frame.grid(row=3, column=0, columnspan=2, sticky=tk.W, pady=5)
        
        ttk.Label(server_frame, text="Common Servers:").pack(side=tk.LEFT, padx=(0, 5))
        
        servers = ["MetaQuotes-Demo", "ICMarkets-Demo", "ICMarkets-Live01", "FTMO-Demo", "FTMO-Server", 
                  "Pepperstone-Demo", "Pepperstone-Live", "XM-Demo", "XM-Real"]
        
        for server in servers[:3]:  # Show first 3 servers
            btn = ttk.Button(server_frame, text=server, style="Server.TButton",
                            command=lambda s=server: self.new_server_var.set(s))
            btn.pack(side=tk.LEFT, padx=2)
        
        # More servers dropdown
        self.more_servers_var = tk.StringVar()
        more_servers = ttk.Combobox(server_frame, textvariable=self.more_servers_var, values=servers[3:], width=15)
        more_servers.pack(side=tk.LEFT, padx=(5, 0))
        more_servers.bind("<<ComboboxSelected>>", self.on_server_selected)
        
        # Show password checkbox
        self.show_password_var = tk.BooleanVar(value=False)
        show_password_check = ttk.Checkbutton(new_frame, text="Show password", 
                                             variable=self.show_password_var,
                                             command=lambda: self.toggle_password_visibility(password_entry))
        show_password_check.grid(row=1, column=2, padx=5, pady=5, sticky=tk.W)
        
        # Buttons
        button_frame = ttk.Frame(main_frame)
        button_frame.pack(fill=tk.X, pady=(10, 0))
        
        ttk.Button(button_frame, text="Save Changes", style="Primary.TButton", 
                  command=self.save_changes).pack(side=tk.RIGHT, padx=5)
        ttk.Button(button_frame, text="Cancel", style="Secondary.TButton", 
                  command=self.root.destroy).pack(side=tk.RIGHT, padx=5)
        
        # Status message
        self.status_var = tk.StringVar()
        status_label = ttk.Label(main_frame, textvariable=self.status_var, style="Status.TLabel")
        status_label.pack(fill=tk.X, pady=(20, 0))
        
        # Center window
        self.center_window()
    
    def setup_styles(self):
        """Set up custom styles for the UI"""
        style = ttk.Style()
        
        # Title style
        style.configure("Title.TLabel", font=("Arial", 16, "bold"))
        
        # Button styles
        style.configure("Primary.TButton", font=("Arial", 10))
        style.configure("Secondary.TButton", font=("Arial", 10))
        style.configure("Server.TButton", font=("Arial", 8))
        
        # Status style
        style.configure("Status.TLabel", font=("Arial", 10), foreground="blue")
    
    def center_window(self):
        """Center the window on the screen"""
        self.root.update_idletasks()
        width = self.root.winfo_width()
        height = self.root.winfo_height()
        x = (self.root.winfo_screenwidth() // 2) - (width // 2)
        y = (self.root.winfo_screenheight() // 2) - (height // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")
    
    def toggle_password_visibility(self, password_entry):
        """Toggle password visibility"""
        if self.show_password_var.get():
            password_entry.config(show="")
        else:
            password_entry.config(show="*")
    
    def on_server_selected(self, event):
        """Handle server selection from dropdown"""
        selected = self.more_servers_var.get()
        if selected:
            self.new_server_var.set(selected)
    
    def get_encryption_key(self):
        """Get or create the encryption key"""
        key_file = Path.home() / "Pipnosis" / "pipnosis.key"
        
        if key_file.exists():
            with open(key_file, 'rb') as f:
                return f.read()
        else:
            # Use a key derived from system info (in production, use proper key management)
            # This is the same method used in the main connector
            return base64.urlsafe_b64encode(b'pipnosis_mt5_key_32_chars_long!')
    
    def load_credentials(self):
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
                self.status_var.set(f"Found credentials at: {path}")
                break
        
        if not credentials_file:
            self.status_var.set("No credentials file found. Creating a new one.")
            return {
                'login': '',
                'password': '',
                'server': 'MetaQuotes-Demo',
                'last_updated': ''
            }
        
        try:
            # Get encryption key
            key = self.get_encryption_key()
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
                    self.status_var.set("No MT5 section found in config file.")
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
            self.status_var.set(f"Error loading credentials: {e}")
            messagebox.showerror("Error", f"Failed to load credentials: {e}")
            return {
                'login': '',
                'password': '',
                'server': 'MetaQuotes-Demo',
                'last_updated': ''
            }
    
    def save_changes(self):
        """Save the new credentials"""
        # Get new values
        new_login = self.new_login_var.get().strip()
        new_password = self.new_password_var.get().strip()
        new_server = self.new_server_var.get().strip()
        
        # Validate inputs
        if not new_login:
            messagebox.showerror("Error", "Login cannot be empty")
            return
        
        if not new_password and not self.current_creds.get('password'):
            messagebox.showerror("Error", "Password cannot be empty")
            return
        
        if not new_server:
            new_server = "MetaQuotes-Demo"
        
        # Use current password if new one is not provided
        if not new_password:
            new_password = self.current_creds.get('password', '')
        
        # Confirm changes
        confirm_msg = f"Update MT5 credentials?\n\nLogin: {new_login}\nServer: {new_server}"
        if not messagebox.askyesno("Confirm", confirm_msg):
            return
        
        # Save new credentials
        new_creds = {
            'login': new_login,
            'password': new_password,
            'server': new_server
        }
        
        if self.save_credentials(new_creds):
            self.status_var.set("Credentials updated successfully!")
            messagebox.showinfo("Success", "MT5 credentials updated successfully!\n\nPlease restart the MT5 bridge to apply the changes.")
            
            # Update current credentials display
            self.current_login_var.set(new_login)
            self.current_password_var.set('*' * len(new_password))
            self.current_server_var.set(new_server)
            
            # Clear password field
            self.new_password_var.set('')
        else:
            self.status_var.set("Failed to update credentials.")
    
    def save_credentials(self, credentials, output_path=None):
        """Save and encrypt MT5 credentials"""
        try:
            # Get encryption key
            key = self.get_encryption_key()
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
            
            self.status_var.set(f"Credentials saved successfully to {output_path}")
            return True
        except Exception as e:
            self.status_var.set(f"Error saving credentials: {e}")
            messagebox.showerror("Error", f"Failed to save credentials: {e}")
            return False

def main():
    root = tk.Tk()
    app = MT5CredentialsEditor(root)
    root.mainloop()

if __name__ == "__main__":
    main()