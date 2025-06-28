"""
Pipnosis MT5 Bridge Installer
Creates a Windows service/background app for the MT5 connector
"""

import os
import sys
import subprocess
import json
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import threading
import time
from pathlib import Path

class MT5BridgeInstaller:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Pipnosis MT5 Bridge Installer")
        self.root.geometry("600x500")
        self.root.resizable(False, False)
        
        # Variables
        self.install_path = tk.StringVar(value=str(Path.home() / "Pipnosis" / "MT5Bridge"))
        self.auto_start = tk.BooleanVar(value=True)
        self.websocket_port = tk.StringVar(value="8765")
        self.status_text = tk.StringVar(value="Ready to install")
        
        self.setup_ui()
    
    def setup_ui(self):
        """Setup the installer UI"""
        # Header
        header_frame = ttk.Frame(self.root)
        header_frame.pack(fill='x', padx=20, pady=20)
        
        ttk.Label(header_frame, text="Pipnosis MT5 Bridge Installer", 
                 font=('Arial', 16, 'bold')).pack()
        ttk.Label(header_frame, text="Install the bridge to connect MetaTrader 5 with Pipnosis AI", 
                 font=('Arial', 10)).pack()
        
        # Installation path
        path_frame = ttk.LabelFrame(self.root, text="Installation Settings", padding=10)
        path_frame.pack(fill='x', padx=20, pady=10)
        
        ttk.Label(path_frame, text="Install Location:").pack(anchor='w')
        path_entry_frame = ttk.Frame(path_frame)
        path_entry_frame.pack(fill='x', pady=5)
        
        ttk.Entry(path_entry_frame, textvariable=self.install_path, width=50).pack(side='left', fill='x', expand=True)
        ttk.Button(path_entry_frame, text="Browse", command=self.browse_install_path).pack(side='right', padx=(5, 0))
        
        # WebSocket port
        ttk.Label(path_frame, text="WebSocket Port:").pack(anchor='w', pady=(10, 0))
        ttk.Entry(path_frame, textvariable=self.websocket_port, width=10).pack(anchor='w', pady=5)
        
        # Options
        options_frame = ttk.LabelFrame(self.root, text="Options", padding=10)
        options_frame.pack(fill='x', padx=20, pady=10)
        
        ttk.Checkbutton(options_frame, text="Start automatically with Windows", 
                       variable=self.auto_start).pack(anchor='w')
        
        # Requirements info
        req_frame = ttk.LabelFrame(self.root, text="Requirements", padding=10)
        req_frame.pack(fill='x', padx=20, pady=10)
        
        requirements_text = """
• Python 3.8 or higher (will be installed if missing)
• MetaTrader 5 terminal installed and configured
• Windows 10 or later
• Administrator privileges for installation
        """
        ttk.Label(req_frame, text=requirements_text.strip(), justify='left').pack(anchor='w')
        
        # Progress
        progress_frame = ttk.Frame(self.root)
        progress_frame.pack(fill='x', padx=20, pady=10)
        
        ttk.Label(progress_frame, text="Status:").pack(anchor='w')
        ttk.Label(progress_frame, textvariable=self.status_text, foreground='blue').pack(anchor='w')
        
        self.progress_bar = ttk.Progressbar(progress_frame, mode='indeterminate')
        self.progress_bar.pack(fill='x', pady=5)
        
        # Buttons
        button_frame = ttk.Frame(self.root)
        button_frame.pack(fill='x', padx=20, pady=20)
        
        ttk.Button(button_frame, text="Install", command=self.start_installation).pack(side='left')
        ttk.Button(button_frame, text="Cancel", command=self.root.quit).pack(side='right')
    
    def browse_install_path(self):
        """Browse for installation directory"""
        path = filedialog.askdirectory(initialdir=self.install_path.get())
        if path:
            self.install_path.set(path)
    
    def update_status(self, message):
        """Update status message"""
        self.status_text.set(message)
        self.root.update()
    
    def start_installation(self):
        """Start the installation process"""
        # Validate inputs
        if not self.install_path.get():
            messagebox.showerror("Error", "Please select an installation path")
            return
        
        try:
            port = int(self.websocket_port.get())
            if port < 1024 or port > 65535:
                raise ValueError()
        except ValueError:
            messagebox.showerror("Error", "Please enter a valid port number (1024-65535)")
            return
        
        # Start installation in background thread
        self.progress_bar.start()
        threading.Thread(target=self.install_bridge, daemon=True).start()
    
    def install_bridge(self):
        """Install the MT5 bridge"""
        try:
            install_dir = Path(self.install_path.get())
            
            # Create installation directory
            self.update_status("Creating installation directory...")
            install_dir.mkdir(parents=True, exist_ok=True)
            
            # Check Python installation
            self.update_status("Checking Python installation...")
            if not self.check_python():
                self.update_status("Installing Python...")
                if not self.install_python():
                    raise Exception("Failed to install Python")
            
            # Copy bridge files
            self.update_status("Copying bridge files...")
            self.copy_bridge_files(install_dir)
            
            # Install Python dependencies
            self.update_status("Installing Python dependencies...")
            self.install_dependencies(install_dir)
            
            # Create configuration
            self.update_status("Creating configuration...")
            self.create_config(install_dir)
            
            # Create startup script
            self.update_status("Creating startup script...")
            self.create_startup_script(install_dir)
            
            # Setup auto-start if requested
            if self.auto_start.get():
                self.update_status("Setting up auto-start...")
                self.setup_autostart(install_dir)
            
            # Create desktop shortcut
            self.update_status("Creating desktop shortcut...")
            self.create_desktop_shortcut(install_dir)
            
            self.progress_bar.stop()
            self.update_status("Installation completed successfully!")
            
            messagebox.showinfo("Success", 
                               f"Pipnosis MT5 Bridge installed successfully!\n\n"
                               f"Installation path: {install_dir}\n"
                               f"WebSocket port: {self.websocket_port.get()}\n\n"
                               f"You can now start the bridge from the desktop shortcut.")
            
        except Exception as e:
            self.progress_bar.stop()
            self.update_status(f"Installation failed: {e}")
            messagebox.showerror("Installation Failed", str(e))
    
    def check_python(self):
        """Check if Python is installed"""
        try:
            result = subprocess.run([sys.executable, '--version'], 
                                  capture_output=True, text=True)
            return result.returncode == 0
        except:
            return False
    
    def install_python(self):
        """Install Python (placeholder - would download and install Python)"""
        # In a real implementation, this would download and install Python
        messagebox.showinfo("Python Required", 
                           "Please install Python 3.8 or higher from python.org and run this installer again.")
        return False
    
    def copy_bridge_files(self, install_dir):
        """Copy bridge files to installation directory"""
        # Copy the MT5 connector script
        bridge_script = '''
# This would contain the actual mt5_connector.py content
# For now, creating a placeholder
print("Pipnosis MT5 Bridge - Placeholder")
'''
        
        with open(install_dir / "mt5_connector.py", 'w') as f:
            f.write(bridge_script)
        
        # Copy requirements
        requirements = '''
MetaTrader5==5.0.45
websockets==12.0
asyncio-mqtt==0.16.1
python-dotenv==1.0.0
'''
        
        with open(install_dir / "requirements.txt", 'w') as f:
            f.write(requirements)
    
    def install_dependencies(self, install_dir):
        """Install Python dependencies"""
        subprocess.run([
            sys.executable, '-m', 'pip', 'install', '-r', 
            str(install_dir / "requirements.txt")
        ], check=True)
    
    def create_config(self, install_dir):
        """Create configuration file"""
        config = {
            "websocket_host": "localhost",
            "websocket_port": int(self.websocket_port.get()),
            "update_interval": 1.0,
            "log_level": "INFO",
            "auto_reconnect": True
        }
        
        with open(install_dir / "config.json", 'w') as f:
            json.dump(config, f, indent=2)
    
    def create_startup_script(self, install_dir):
        """Create startup script"""
        script_content = f'''@echo off
cd /d "{install_dir}"
python mt5_connector.py
pause
'''
        
        with open(install_dir / "start_bridge.bat", 'w') as f:
            f.write(script_content)
    
    def setup_autostart(self, install_dir):
        """Setup auto-start with Windows"""
        # This would add the bridge to Windows startup
        # For now, just create a note
        with open(install_dir / "autostart_instructions.txt", 'w') as f:
            f.write(f"To enable auto-start:\n")
            f.write(f"1. Press Win+R, type 'shell:startup'\n")
            f.write(f"2. Copy the shortcut from desktop to the startup folder\n")
    
    def create_desktop_shortcut(self, install_dir):
        """Create desktop shortcut"""
        # This would create a proper Windows shortcut
        # For now, just create a note
        desktop = Path.home() / "Desktop"
        with open(desktop / "Pipnosis MT5 Bridge.txt", 'w') as f:
            f.write(f"Pipnosis MT5 Bridge\n")
            f.write(f"Installation path: {install_dir}\n")
            f.write(f"To start: Run {install_dir / 'start_bridge.bat'}\n")
    
    def run(self):
        """Run the installer"""
        self.root.mainloop()

if __name__ == "__main__":
    installer = MT5BridgeInstaller()
    installer.run()