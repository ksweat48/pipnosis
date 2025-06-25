"""
Pipnosis MT5 Integration Bridge
Official MetaTrader 5 Python API Integration

This script handles the connection between Pipnosis AI and MetaTrader 5 terminal.
It provides secure authentication, real-time data retrieval, and trade execution.

Requirements:
- pip install MetaTrader5
- pip install requests
- pip install cryptography
- MT5 terminal running on the same machine

Security Features:
- Local credential encryption
- HTTPS communication with Pipnosis backend
- No credentials sent to cloud
- Trade metadata only transmission
"""

import MetaTrader5 as mt5
import requests
import json
import time
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from cryptography.fernet import Fernet
import os
import configparser
from dataclasses import dataclass

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('pipnosis_connector.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class TradeRequest:
    """Structure for trade requests from Pipnosis AI"""
    action: str  # 'buy', 'sell', 'close', 'modify'
    symbol: str
    volume: float
    price: Optional[float] = None
    sl: Optional[float] = None
    tp: Optional[float] = None
    deviation: int = 20
    magic: int = 123456
    comment: str = "Pipnosis AI Trade"

@dataclass
class AccountInfo:
    """Structure for account information"""
    login: int
    balance: float
    equity: float
    margin: float
    free_margin: float
    margin_level: float
    currency: str

class MT5Connector:
    """Main connector class for MT5 integration"""
    
    def __init__(self, config_file: str = "pipnosis_config.ini"):
        self.config_file = config_file
        self.encryption_key = self._get_or_create_key()
        self.cipher_suite = Fernet(self.encryption_key)
        self.is_connected = False
        self.account_info = None
        self.pipnosis_api_url = "https://api.pipnosis.com"  # Replace with actual API URL
        
    def _get_or_create_key(self) -> bytes:
        """Generate or retrieve encryption key for credentials"""
        key_file = "pipnosis.key"
        if os.path.exists(key_file):
            with open(key_file, 'rb') as f:
                return f.read()
        else:
            key = Fernet.generate_key()
            with open(key_file, 'wb') as f:
                f.write(key)
            return key
    
    def save_credentials(self, login: str, password: str, server: str) -> bool:
        """Securely save MT5 credentials locally"""
        try:
            config = configparser.ConfigParser()
            
            # Encrypt sensitive data
            encrypted_password = self.cipher_suite.encrypt(password.encode())
            
            config['MT5'] = {
                'login': login,
                'password': encrypted_password.decode(),
                'server': server,
                'last_updated': datetime.now().isoformat()
            }
            
            with open(self.config_file, 'w') as f:
                config.write(f)
            
            logger.info("Credentials saved successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save credentials: {e}")
            return False
    
    def load_credentials(self) -> Optional[Dict[str, str]]:
        """Load and decrypt MT5 credentials"""
        try:
            if not os.path.exists(self.config_file):
                return None
                
            config = configparser.ConfigParser()
            config.read(self.config_file)
            
            if 'MT5' not in config:
                return None
            
            # Decrypt password
            encrypted_password = config['MT5']['password'].encode()
            decrypted_password = self.cipher_suite.decrypt(encrypted_password).decode()
            
            return {
                'login': config['MT5']['login'],
                'password': decrypted_password,
                'server': config['MT5']['server']
            }
            
        except Exception as e:
            logger.error(f"Failed to load credentials: {e}")
            return None
    
    def connect_mt5(self, login: str = None, password: str = None, server: str = None) -> bool:
        """Connect to MT5 terminal"""
        try:
            # Use provided credentials or load from config
            if not all([login, password, server]):
                creds = self.load_credentials()
                if not creds:
                    logger.error("No credentials provided or found")
                    return False
                login, password, server = creds['login'], creds['password'], creds['server']
            
            # Initialize MT5 connection
            if not mt5.initialize():
                logger.error(f"MT5 initialize failed: {mt5.last_error()}")
                return False
            
            # Login to account
            if not mt5.login(int(login), password=password, server=server):
                logger.error(f"MT5 login failed: {mt5.last_error()}")
                mt5.shutdown()
                return False
            
            # Get account info
            account_info = mt5.account_info()
            if account_info is None:
                logger.error("Failed to get account info")
                mt5.shutdown()
                return False
            
            self.account_info = AccountInfo(
                login=account_info.login,
                balance=account_info.balance,
                equity=account_info.equity,
                margin=account_info.margin,
                free_margin=account_info.margin_free,
                margin_level=account_info.margin_level,
                currency=account_info.currency
            )
            
            self.is_connected = True
            logger.info(f"Successfully connected to MT5 account: {login}")
            return True
            
        except Exception as e:
            logger.error(f"MT5 connection failed: {e}")
            return False
    
    def disconnect_mt5(self):
        """Disconnect from MT5 terminal"""
        if self.is_connected:
            mt5.shutdown()
            self.is_connected = False
            logger.info("Disconnected from MT5")
    
    def get_market_data(self, symbol: str, timeframe: int = mt5.TIMEFRAME_H1, count: int = 100) -> Optional[List[Dict]]:
        """Retrieve market data for specified symbol"""
        if not self.is_connected:
            logger.error("Not connected to MT5")
            return None
        
        try:
            rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, count)
            if rates is None:
                logger.error(f"Failed to get rates for {symbol}")
                return None
            
            # Convert to list of dictionaries
            market_data = []
            for rate in rates:
                market_data.append({
                    'time': datetime.fromtimestamp(rate['time']).isoformat(),
                    'open': float(rate['open']),
                    'high': float(rate['high']),
                    'low': float(rate['low']),
                    'close': float(rate['close']),
                    'volume': int(rate['tick_volume'])
                })
            
            return market_data
            
        except Exception as e:
            logger.error(f"Failed to get market data: {e}")
            return None
    
    def get_current_price(self, symbol: str) -> Optional[Dict[str, float]]:
        """Get current bid/ask prices for symbol"""
        if not self.is_connected:
            return None
        
        try:
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                return None
            
            return {
                'bid': float(tick.bid),
                'ask': float(tick.ask),
                'time': datetime.fromtimestamp(tick.time).isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to get current price: {e}")
            return None
    
    def execute_trade(self, trade_request: TradeRequest) -> Dict[str, Any]:
        """Execute trade based on AI request"""
        if not self.is_connected:
            return {'success': False, 'error': 'Not connected to MT5'}
        
        try:
            # Prepare order request
            if trade_request.action == 'buy':
                order_type = mt5.ORDER_TYPE_BUY
                price = mt5.symbol_info_tick(trade_request.symbol).ask
            elif trade_request.action == 'sell':
                order_type = mt5.ORDER_TYPE_SELL
                price = mt5.symbol_info_tick(trade_request.symbol).bid
            else:
                return {'success': False, 'error': f'Unsupported action: {trade_request.action}'}
            
            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": trade_request.symbol,
                "volume": trade_request.volume,
                "type": order_type,
                "price": price,
                "sl": trade_request.sl,
                "tp": trade_request.tp,
                "deviation": trade_request.deviation,
                "magic": trade_request.magic,
                "comment": trade_request.comment,
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_IOC,
            }
            
            # Send order
            result = mt5.order_send(request)
            
            if result.retcode != mt5.TRADE_RETCODE_DONE:
                return {
                    'success': False,
                    'error': f'Order failed: {result.retcode}',
                    'comment': result.comment
                }
            
            # Log successful trade
            trade_info = {
                'success': True,
                'ticket': result.order,
                'volume': result.volume,
                'price': result.price,
                'symbol': trade_request.symbol,
                'action': trade_request.action,
                'time': datetime.now().isoformat()
            }
            
            logger.info(f"Trade executed successfully: {trade_info}")
            return trade_info
            
        except Exception as e:
            logger.error(f"Trade execution failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_open_positions(self) -> List[Dict[str, Any]]:
        """Get all open positions"""
        if not self.is_connected:
            return []
        
        try:
            positions = mt5.positions_get()
            if positions is None:
                return []
            
            position_list = []
            for pos in positions:
                position_list.append({
                    'ticket': pos.ticket,
                    'symbol': pos.symbol,
                    'type': 'buy' if pos.type == mt5.ORDER_TYPE_BUY else 'sell',
                    'volume': pos.volume,
                    'price_open': pos.price_open,
                    'price_current': pos.price_current,
                    'sl': pos.sl,
                    'tp': pos.tp,
                    'profit': pos.profit,
                    'time': datetime.fromtimestamp(pos.time).isoformat(),
                    'comment': pos.comment
                })
            
            return position_list
            
        except Exception as e:
            logger.error(f"Failed to get positions: {e}")
            return []
    
    def send_to_pipnosis(self, data: Dict[str, Any], endpoint: str) -> bool:
        """Send data to Pipnosis backend"""
        try:
            url = f"{self.pipnosis_api_url}/{endpoint}"
            headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer YOUR_API_KEY'  # Replace with actual API key
            }
            
            response = requests.post(url, json=data, headers=headers, timeout=10)
            
            if response.status_code == 200:
                logger.info(f"Data sent to Pipnosis successfully: {endpoint}")
                return True
            else:
                logger.error(f"Failed to send data to Pipnosis: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Error sending data to Pipnosis: {e}")
            return False
    
    def listen_for_commands(self):
        """Listen for commands from Pipnosis AI"""
        logger.info("Starting command listener...")
        
        while self.is_connected:
            try:
                # Poll for commands from Pipnosis API
                response = requests.get(
                    f"{self.pipnosis_api_url}/commands",
                    headers={'Authorization': 'Bearer YOUR_API_KEY'},
                    timeout=5
                )
                
                if response.status_code == 200:
                    commands = response.json()
                    
                    for command in commands:
                        if command['type'] == 'trade':
                            trade_request = TradeRequest(**command['data'])
                            result = self.execute_trade(trade_request)
                            
                            # Send result back to Pipnosis
                            self.send_to_pipnosis({
                                'command_id': command['id'],
                                'result': result
                            }, 'trade_results')
                
                # Send periodic updates
                self.send_account_update()
                
                time.sleep(5)  # Poll every 5 seconds
                
            except Exception as e:
                logger.error(f"Error in command listener: {e}")
                time.sleep(10)  # Wait longer on error
    
    def send_account_update(self):
        """Send account status update to Pipnosis"""
        if not self.is_connected:
            return
        
        try:
            # Get current account info
            account_info = mt5.account_info()
            positions = self.get_open_positions()
            
            update_data = {
                'account': {
                    'balance': account_info.balance,
                    'equity': account_info.equity,
                    'margin': account_info.margin,
                    'free_margin': account_info.margin_free,
                    'margin_level': account_info.margin_level
                },
                'positions': positions,
                'timestamp': datetime.now().isoformat()
            }
            
            self.send_to_pipnosis(update_data, 'account_updates')
            
        except Exception as e:
            logger.error(f"Failed to send account update: {e}")

def main():
    """Main function to run the MT5 connector"""
    connector = MT5Connector()
    
    # Try to connect using saved credentials
    if connector.connect_mt5():
        logger.info("MT5 Connector started successfully")
        
        try:
            # Start listening for commands
            connector.listen_for_commands()
        except KeyboardInterrupt:
            logger.info("Shutting down MT5 Connector...")
        finally:
            connector.disconnect_mt5()
    else:
        logger.error("Failed to connect to MT5. Please check your credentials.")

if __name__ == "__main__":
    main()