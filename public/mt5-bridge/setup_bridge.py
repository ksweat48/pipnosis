"""
Pipnosis MT5 Bridge Setup Script
This script helps set up and test the MT5 bridge connection
"""

import os
import sys
import subprocess
import platform
import time
import socket
import requests
import json
from pathlib import Path

def print_header(text):
    """Print a formatted header"""
    print("\n" + "=" * 60)
    print(f"  {text}")
    print("=" * 60)

def print_step(step, text):
    """Print a step with number"""
    print(f"\n[{step}] {text}")

def print_success(text):
    """Print a success message"""
    print(f"✅ {text}")

def print_error(text):
    """Print an error message"""
    print(f"❌ {text}")

def print_warning(text):
    """Print a warning message"""
    print(f"⚠️ {text}")

def check_python_version():
    """Check if Python version is compatible"""
    print_step(1, "Checking Python version...")
    
    version = platform.python_version()
    version_tuple = tuple(map(int, version.split('.')))
    
    if version_tuple >= (3, 8):
        print_success(f"Python {version} detected (compatible)")
        return True
    else:
        print_error(f"Python {version} detected. Version 3.8 or higher is required.")
        print("Please install a newer version of Python from https://www.python.org/downloads/")
        return False

def check_mt5_terminal():
    """Check if MT5 terminal is installed and running"""
    print_step(2, "Checking MetaTrader 5 terminal...")
    
    if platform.system() != "Windows":
        print_error("MetaTrader 5 is only supported on Windows")
        return False
    
    # Check if MT5 process is running
    try:
        import psutil
        mt5_running = False
        for proc in psutil.process_iter(['name']):
            if proc.info['name'] and 'terminal64.exe' in proc.info['name'].lower():
                mt5_running = True
                break
        
        if mt5_running:
            print_success("MetaTrader 5 terminal is running")
            return True
        else:
            print_error("MetaTrader 5 terminal is not running")
            print("Please start MetaTrader 5 and log into your account")
            return False
    except ImportError:
        # If psutil is not available, we can't check if MT5 is running
        print_warning("Could not check if MetaTrader 5 is running (psutil not installed)")
        print("Please ensure MetaTrader 5 is running and you're logged into your account")
        return True

def install_dependencies():
    """Install required Python packages"""
    print_step(3, "Installing required dependencies...")
    
    dependencies = [
        "MetaTrader5==5.0.45",
        "websockets==12.0",
        "asyncio-mqtt==0.16.1",
        "python-dotenv==1.0.0",
        "psutil"
    ]
    
    try:
        for dep in dependencies:
            print(f"Installing {dep}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", dep])
        
        print_success("All dependencies installed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print_error(f"Failed to install dependencies: {e}")
        return False

def check_port_availability(port):
    """Check if the specified port is available"""
    print_step(4, f"Checking if port {port} is available...")
    
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("localhost", port))
            print_success(f"Port {port} is available")
            return True
    except socket.error:
        print_error(f"Port {port} is already in use")
        print("The bridge will try alternative ports automatically")
        return False

def test_mt5_connection():
    """Test connection to MT5 using the Python API"""
    print_step(5, "Testing connection to MetaTrader 5...")
    
    try:
        import MetaTrader5 as mt5
        
        if not mt5.initialize():
            print_error(f"Failed to initialize MT5: {mt5.last_error()}")
            return False
        
        account_info = mt5.account_info()
        if account_info is None:
            print_error("Failed to get account info. Make sure you're logged into MT5.")
            mt5.shutdown()
            return False
        
        print_success(f"Successfully connected to MT5 account: {account_info.login}")
        print(f"Server: {account_info.server}")
        print(f"Balance: ${account_info.balance:,.2f}")
        print(f"Automated trading: {'Enabled' if account_info.trade_expert else 'DISABLED'}")
        
        if not account_info.trade_expert:
            print_warning("Automated trading is disabled in MT5!")
            print("Please enable it in Tools > Options > Expert Advisors > Allow automated trading")
        
        mt5.shutdown()
        return True
    except Exception as e:
        print_error(f"Error testing MT5 connection: {e}")
        return False

def start_bridge():
    """Start the MT5 bridge"""
    print_step(6, "Starting MT5 bridge...")
    
    bridge_path = Path(__file__).parent / "mt5_connector.py"
    
    if not bridge_path.exists():
        print_error(f"Bridge file not found at {bridge_path}")
        return False
    
    print(f"Starting bridge from: {bridge_path}")
    print("The bridge will run in a new window. Please do not close it.")
    print("Press Ctrl+C in that window to stop the bridge.")
    
    try:
        if platform.system() == "Windows":
            # On Windows, start in a new window
            subprocess.Popen([sys.executable, str(bridge_path)], creationflags=subprocess.CREATE_NEW_CONSOLE)
        else:
            # On other platforms, start in the background
            subprocess.Popen([sys.executable, str(bridge_path)])
        
        print_success("Bridge started successfully")
        print("Please wait a few seconds for it to initialize...")
        time.sleep(3)
        return True
    except Exception as e:
        print_error(f"Failed to start bridge: {e}")
        return False

def test_websocket_server(port=8765):
    """Test if the WebSocket server is running"""
    print_step(7, "Testing WebSocket server...")
    
    # First check if the bridge created a port file
    port_file = Path(__file__).parent / "mt5_bridge_port.txt"
    if port_file.exists():
        try:
            with open(port_file, 'r') as f:
                port = int(f.read().strip())
                print(f"Found bridge running on port {port} from port file")
        except Exception as e:
            print_warning(f"Could not read port from file: {e}")
    
    # Try to connect to the WebSocket server
    try:
        import websockets
        import asyncio
        
        async def test_connection():
            try:
                uri = f"ws://localhost:{port}"
                print(f"Connecting to {uri}...")
                
                async with websockets.connect(uri, timeout=5) as websocket:
                    print_success("Connected to WebSocket server")
                    
                    # Send a ping message
                    await websocket.send(json.dumps({"type": "ping"}))
                    print("Sent ping message, waiting for response...")
                    
                    # Wait for response
                    response = await asyncio.wait_for(websocket.recv(), timeout=5)
                    response_data = json.loads(response)
                    
                    if response_data.get("type") == "pong":
                        print_success("Received pong response from server")
                        return True
                    else:
                        print_warning(f"Received unexpected response: {response_data}")
                        return False
            except Exception as e:
                print_error(f"WebSocket connection failed: {e}")
                return False
        
        result = asyncio.run(test_connection())
        return result
    except ImportError:
        print_warning("Could not test WebSocket connection (websockets not installed)")
        return True
    except Exception as e:
        print_error(f"Error testing WebSocket server: {e}")
        return False

def main():
    """Main setup function"""
    print_header("Pipnosis MT5 Bridge Setup")
    
    # Check Python version
    if not check_python_version():
        return
    
    # Check MT5 terminal
    if not check_mt5_terminal():
        return
    
    # Install dependencies
    if not install_dependencies():
        return
    
    # Check port availability
    check_port_availability(8765)
    
    # Test MT5 connection
    if not test_mt5_connection():
        return
    
    # Start bridge
    if not start_bridge():
        return
    
    # Test WebSocket server
    if not test_websocket_server():
        print_warning("Could not connect to WebSocket server")
        print("The bridge may still be starting up. Please check the bridge window for errors.")
        print("If the bridge is not running, please start it manually with:")
        print(f"    python {Path(__file__).parent / 'mt5_connector.py'}")
    
    print_header("Setup Complete")
    print("The MT5 bridge should now be running and ready to connect to Pipnosis.")
    print("If you encounter any issues, please check the log file at mt5_bridge.log")
    print("\nTo connect from Pipnosis:")
    print("1. Open the Pipnosis web app")
    print("2. Click the MT5 button in the header")
    print("3. Follow the connection steps in the modal")
    print("\nPress Enter to exit this setup script...")
    input()

if __name__ == "__main__":
    main()