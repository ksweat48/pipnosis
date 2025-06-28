#!/usr/bin/env python3
"""
Pipnosis MT5 Connector
Secure bridge between Pipnosis backend and MetaTrader 5
"""

import MetaTrader5 as mt5
import json
import time
import requests
import threading
from datetime import datetime
from typing import Dict, List, Optional, Any
import logging
import os
import sys
from dataclasses import dataclass, asdict
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse
from cryptography.fernet import Fernet
import base64

# Configure logging with UTF-8 encoding to handle Unicode characters
class UTF8StreamHandler(logging.StreamHandler):
    def __init__(self, stream=None):
        super().__init__(stream)
        if hasattr(self.stream, 'reconfigure'):
            try:
                self.stream.reconfigure(encoding='utf-8')
            except:
                pass

# Set up logging with proper encoding
log_handlers = [
    logging.FileHandler('mt5_connector.log', encoding='utf-8'),
    UTF8StreamHandler(sys.stdout)
]

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=log_handlers
)
logger = logging.getLogger(__name__)

@dataclass
class TradeRequest:
    symbol: str
    action: str  # 'buy' or 'sell'
    volume: float
    price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    comment: str = "Pipnosis AI Trade"
    magic: int = 12345

@dataclass
class TradeResult:
    success: bool
    ticket: Optional[int] = None
    price: Optional[float] = None
    message: str = ""
    error_code: Optional[int] = None

class MT5Connector:
    def __init__(self):
        self.connected = False
        self.account_info = None
        self.positions = {}
        self.running = False
        
        # Load configuration
        self.bridge_port = int(os.getenv('MT5_BRIDGE_PORT', '8080'))
        self.magic_number = int(os.getenv('DEFAULT_MAGIC_NUMBER', '12345'))
        self.max_slippage = int(os.getenv('MAX_SLIPPAGE', '20'))
        
        # Load encrypted credentials
        self.credentials = self.load_credentials()
        
        logger.info(f"MT5 Connector initialized on port {self.bridge_port}")
        
    def load_credentials(self) -> Dict[str, str]:
        """Load and decrypt MT5 credentials or fall back to .env variables"""
        try:
            # Try to load from encrypted file first
            if os.path.exists('mt5_credentials.enc'):
                with open('mt5_credentials.enc', 'rb') as f:
                    encrypted_data = f.read()
                
                # Use a key derived from system info (in production, use proper key management)
                key = base64.urlsafe_b64encode(b'pipnosis_mt5_key_32_chars_long!')
                fernet = Fernet(key)
                
                decrypted_data = fernet.decrypt(encrypted_data)
                credentials = json.loads(decrypted_data.decode())
                
                logger.info("SUCCESS: Loaded encrypted MT5 credentials")
                return credentials
                
        except Exception as e:
            logger.warning(f"Could not load encrypted credentials: {e}")
        
        # Fall back to environment variables
        credentials = {
            'login': os.getenv('MT5_LOGIN', ''),
            'password': os.getenv('MT5_PASSWORD', ''),
            'server': os.getenv('MT5_SERVER', 'MetaQuotes-Demo')
        }
        
        if credentials['login'] and credentials['password']:
            logger.info("SUCCESS: Loaded MT5 credentials from environment")
        else:
            logger.warning("WARNING: No MT5 credentials found - will use demo mode")
            
        return credentials
    
    def save_encrypted_credentials(self, login: str, password: str, server: str):
        """Save encrypted MT5 credentials"""
        try:
            credentials = {
                'login': login,
                'password': password,
                'server': server
            }
            
            # Use a key derived from system info (in production, use proper key management)
            key = base64.urlsafe_b64encode(b'pipnosis_mt5_key_32_chars_long!')
            fernet = Fernet(key)
            
            encrypted_data = fernet.encrypt(json.dumps(credentials).encode())
            
            with open('mt5_credentials.enc', 'wb') as f:
                f.write(encrypted_data)
                
            logger.info("SUCCESS: MT5 credentials encrypted and saved")
            self.credentials = credentials
            
        except Exception as e:
            logger.error(f"Failed to save encrypted credentials: {e}")
    
    def initialize(self) -> bool:
        """Initialize MT5 connection"""
        try:
            logger.info("INIT: Attempting to initialize MT5 connection...")
            
            if not mt5.initialize():
                error_info = mt5.last_error()
                logger.error(f"MT5 initialization failed: {error_info}")
                logger.error("Make sure MetaTrader 5 is running and logged into an account")
                return False
            
            # Try to login if credentials are available
            if self.credentials.get('login') and self.credentials.get('password'):
                login_result = mt5.login(
                    login=int(self.credentials['login']),
                    password=self.credentials['password'],
                    server=self.credentials['server']
                )
                
                if not login_result:
                    logger.warning("Failed to login with provided credentials, using current MT5 session")
                else:
                    logger.info(f"SUCCESS: Logged into MT5 account: {self.credentials['login']}")
            
            self.connected = True
            self.account_info = mt5.account_info()
            
            if self.account_info is None:
                logger.error("Failed to get account info - make sure you're logged into MT5")
                return False
                
            logger.info(f"SUCCESS: Connected to MT5 account: {self.account_info.login}")
            logger.info(f"BALANCE: Account balance: {self.account_info.balance} {self.account_info.currency}")
            logger.info(f"SERVER: Server: {self.account_info.server}")
            logger.info(f"BROKER: Broker: {self.account_info.company}")
            
            return True
            
        except Exception as e:
            logger.error(f"MT5 initialization error: {e}")
            logger.error("Troubleshooting steps:")
            logger.error("1. Make sure MetaTrader 5 is installed and running")
            logger.error("2. Log into your trading account in MT5")
            logger.error("3. Enable 'Allow automated trading' in MT5 settings")
            logger.error("4. Make sure MT5 is not in 'Safe Mode'")
            return False
    
    def shutdown(self):
        """Shutdown MT5 connection"""
        if self.connected:
            mt5.shutdown()
            self.connected = False
            logger.info("MT5 connection closed")
    
    def get_account_info(self) -> Dict[str, Any]:
        """Get current account information"""
        if not self.connected:
            return {"error": "MT5 not connected", "demo": True}
        
        try:
            account = mt5.account_info()
            if account is None:
                return {"error": "Failed to get account info", "demo": True}
            
            return {
                "login": account.login,
                "balance": account.balance,
                "equity": account.equity,
                "margin": account.margin,
                "free_margin": account.margin_free,
                "margin_level": account.margin_level,
                "currency": account.currency,
                "leverage": account.leverage,
                "server": account.server,
                "company": account.company,
                "name": account.name,
                "connected": True,
                "demo": False,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Error getting account info: {e}")
            return {"error": str(e), "demo": True}
    
    def get_symbol_info(self, symbol: str) -> Dict[str, Any]:
        """Get symbol information"""
        try:
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                return {"error": f"Symbol {symbol} not found"}
            
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                return {"error": f"No tick data for {symbol}"}
            
            return {
                "symbol": symbol,
                "bid": tick.bid,
                "ask": tick.ask,
                "spread": tick.ask - tick.bid,
                "digits": symbol_info.digits,
                "point": symbol_info.point,
                "min_lot": symbol_info.volume_min,
                "max_lot": symbol_info.volume_max,
                "lot_step": symbol_info.volume_step,
                "contract_size": symbol_info.trade_contract_size
            }
        except Exception as e:
            logger.error(f"Error getting symbol info for {symbol}: {e}")
            return {"error": str(e)}
    
    def execute_trade(self, trade_request: TradeRequest) -> TradeResult:
        """Execute a trade on MT5"""
        if not self.connected:
            return TradeResult(False, message="MT5 not connected - using demo mode")
        
        try:
            logger.info(f"TRADE: Executing trade: {trade_request.action.upper()} {trade_request.volume} {trade_request.symbol}")
            
            # Get symbol info
            symbol_info = mt5.symbol_info(trade_request.symbol)
            if symbol_info is None:
                return TradeResult(False, message=f"Symbol {trade_request.symbol} not found")
            
            # Get current price
            tick = mt5.symbol_info_tick(trade_request.symbol)
            if tick is None:
                return TradeResult(False, message=f"No price data for {trade_request.symbol}")
            
            # Determine order type and price
            if trade_request.action.lower() == 'buy':
                order_type = mt5.ORDER_TYPE_BUY
                price = trade_request.price or tick.ask
            else:
                order_type = mt5.ORDER_TYPE_SELL
                price = trade_request.price or tick.bid
            
            # Prepare the trade request
            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": trade_request.symbol,
                "volume": trade_request.volume,
                "type": order_type,
                "price": price,
                "deviation": self.max_slippage,
                "magic": trade_request.magic or self.magic_number,
                "comment": trade_request.comment,
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_IOC,
            }
            
            # Add stop loss and take profit if provided
            if trade_request.stop_loss:
                request["sl"] = trade_request.stop_loss
            if trade_request.take_profit:
                request["tp"] = trade_request.take_profit
            
            logger.info(f"REQUEST: Sending trade request to MT5: {request}")
            
            # Send the trade request
            result = mt5.order_send(request)
            
            if result is None:
                return TradeResult(False, message="Order send failed - no response from MT5")
            
            if result.retcode != mt5.TRADE_RETCODE_DONE:
                error_msg = f"Trade failed: {result.retcode} - {result.comment}"
                logger.error(error_msg)
                return TradeResult(False, message=error_msg, error_code=result.retcode)
            
            success_msg = f"SUCCESS: Trade executed successfully: Ticket {result.order}, Price {result.price}"
            logger.info(success_msg)
            
            return TradeResult(
                success=True,
                ticket=result.order,
                price=result.price,
                message=f"Trade executed: {trade_request.action.upper()} {trade_request.volume} {trade_request.symbol} at {result.price}"
            )
            
        except Exception as e:
            error_msg = f"Trade execution error: {e}"
            logger.error(error_msg)
            return TradeResult(False, message=error_msg)
    
    def get_positions(self) -> List[Dict[str, Any]]:
        """Get all open positions"""
        if not self.connected:
            return []
        
        try:
            positions = mt5.positions_get()
            if positions is None:
                return []
            
            position_list = []
            for pos in positions:
                position_data = {
                    "ticket": pos.ticket,
                    "symbol": pos.symbol,
                    "type": "buy" if pos.type == mt5.POSITION_TYPE_BUY else "sell",
                    "volume": pos.volume,
                    "price_open": pos.price_open,
                    "price_current": pos.price_current,
                    "stop_loss": pos.sl,
                    "take_profit": pos.tp,
                    "profit": pos.profit,
                    "swap": pos.swap,
                    "comment": pos.comment,
                    "time": pos.time,
                    "magic": pos.magic
                }
                position_list.append(position_data)
            
            return position_list
            
        except Exception as e:
            logger.error(f"Error getting positions: {e}")
            return []
    
    def close_position(self, ticket: int) -> TradeResult:
        """Close a position by ticket"""
        if not self.connected:
            return TradeResult(False, message="MT5 not connected")
        
        try:
            logger.info(f"CLOSE: Closing position: {ticket}")
            
            # Get position info
            position = mt5.positions_get(ticket=ticket)
            if not position:
                return TradeResult(False, message=f"Position {ticket} not found")
            
            pos = position[0]
            
            # Determine close order type
            if pos.type == mt5.POSITION_TYPE_BUY:
                order_type = mt5.ORDER_TYPE_SELL
                price = mt5.symbol_info_tick(pos.symbol).bid
            else:
                order_type = mt5.ORDER_TYPE_BUY
                price = mt5.symbol_info_tick(pos.symbol).ask
            
            # Prepare close request
            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": pos.symbol,
                "volume": pos.volume,
                "type": order_type,
                "position": ticket,
                "price": price,
                "deviation": self.max_slippage,
                "magic": pos.magic,
                "comment": f"Close position {ticket}",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_IOC,
            }
            
            # Send close request
            result = mt5.order_send(request)
            
            if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
                error_msg = f"Failed to close position {ticket}: {result.comment if result else 'Unknown error'}"
                return TradeResult(False, message=error_msg)
            
            logger.info(f"SUCCESS: Position {ticket} closed successfully at {result.price}")
            return TradeResult(True, message=f"Position {ticket} closed at {result.price}")
            
        except Exception as e:
            error_msg = f"Error closing position {ticket}: {e}"
            logger.error(error_msg)
            return TradeResult(False, message=error_msg)

class MT5Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, connector=None, **kwargs):
        self.connector = connector
        super().__init__(*args, **kwargs)
    
    def log_message(self, format, *args):
        # Suppress default HTTP server logging
        pass
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_POST(self):
        if self.path == '/execute_trade':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                trade_data = json.loads(post_data.decode('utf-8'))
                
                trade_request = TradeRequest(**trade_data)
                result = self.connector.execute_trade(trade_request)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(asdict(result)).encode())
                
            except Exception as e:
                logger.error(f"Execute trade error: {e}")
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = {"success": False, "message": str(e)}
                self.wfile.write(json.dumps(error_response).encode())
        
        elif self.path == '/close_position':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))
                
                result = self.connector.close_position(data['ticket'])
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(asdict(result)).encode())
                
            except Exception as e:
                logger.error(f"Close position error: {e}")
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = {"success": False, "message": str(e)}
                self.wfile.write(json.dumps(error_response).encode())
        
        elif self.path == '/save_credentials':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                cred_data = json.loads(post_data.decode('utf-8'))
                
                self.connector.save_encrypted_credentials(
                    cred_data['login'],
                    cred_data['password'],
                    cred_data['server']
                )
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {"success": True, "message": "Credentials saved securely"}
                self.wfile.write(json.dumps(response).encode())
                
            except Exception as e:
                logger.error(f"Save credentials error: {e}")
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = {"success": False, "message": str(e)}
                self.wfile.write(json.dumps(error_response).encode())
    
    def do_GET(self):
        if self.path == '/account_info':
            account_info = self.connector.get_account_info()
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(account_info).encode())
        
        elif self.path == '/positions':
            positions = self.connector.get_positions()
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(positions).encode())
        
        elif self.path == '/health':
            health_status = {
                "status": "online" if self.connector.connected else "offline",
                "connected": self.connector.connected,
                "timestamp": datetime.now().isoformat(),
                "account": self.connector.account_info.login if self.connector.account_info else None,
                "server": self.connector.account_info.server if self.connector.account_info else None,
                "version": "2.0.0"
            }
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(health_status).encode())
        
        else:
            self.send_response(404)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not found"}).encode())

def main():
    """Main function to run the MT5 connector"""
    logger.info("STARTUP: Starting Pipnosis MT5 Connector Service")
    logger.info("=" * 50)
    
    # Initialize connector
    connector = MT5Connector()
    
    if not connector.initialize():
        logger.error("ERROR: Failed to initialize MT5 connector")
        logger.error("")
        logger.error("Troubleshooting checklist:")
        logger.error("1. MetaTrader 5 is installed")
        logger.error("2. MT5 is running (not just installed)")
        logger.error("3. You are logged into a trading account")
        logger.error("4. 'Allow automated trading' is enabled in MT5 settings")
        logger.error("5. MT5 is not in 'Safe Mode'")
        logger.error("")
        logger.error("To enable automated trading:")
        logger.error("   Tools -> Options -> Expert Advisors -> Allow automated trading")
        logger.warning("")
        logger.warning("WARNING: Continuing in demo mode - no real trades will be executed")
    
    try:
        # Create HTTP server with connector reference
        def handler(*args, **kwargs):
            MT5Handler(*args, connector=connector, **kwargs)
        
        server = HTTPServer(('localhost', connector.bridge_port), handler)
        logger.info(f"SERVER: MT5 Connector HTTP server started on http://localhost:{connector.bridge_port}")
        logger.info("Available endpoints:")
        logger.info(f"   GET  http://localhost:{connector.bridge_port}/health")
        logger.info(f"   GET  http://localhost:{connector.bridge_port}/account_info")
        logger.info(f"   GET  http://localhost:{connector.bridge_port}/positions")
        logger.info(f"   POST http://localhost:{connector.bridge_port}/execute_trade")
        logger.info(f"   POST http://localhost:{connector.bridge_port}/close_position")
        logger.info(f"   POST http://localhost:{connector.bridge_port}/save_credentials")
        
        if connector.connected:
            logger.info("")
            logger.info("SUCCESS: MT5 Connector is ready for live trading!")
        else:
            logger.info("")
            logger.info("WARNING: MT5 Connector running in demo mode")
            
        logger.info("NEXT: Start your Node.js backend server to complete the integration")
        logger.info("")
        
        server.serve_forever()
        
    except KeyboardInterrupt:
        logger.info("")
        logger.info("SHUTDOWN: Shutting down MT5 connector...")
    except Exception as e:
        logger.error(f"ERROR: Server error: {e}")
    finally:
        connector.shutdown()
        logger.info("STOPPED: MT5 Connector stopped")

if __name__ == "__main__":
    main()