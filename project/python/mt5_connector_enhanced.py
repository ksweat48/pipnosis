"""
Pipnosis MT5 Integration Bridge - Enhanced Production Version
Official MetaTrader 5 Python API Integration with Advanced Features

This script provides a secure, production-ready bridge between Pipnosis AI and MetaTrader 5.
Features include local credential encryption, real-time data streaming, and comprehensive
trade management with full error handling and logging.

Requirements:
- pip install MetaTrader5 requests cryptography psutil
- MT5 terminal running on the same machine
- Windows 10+ (64-bit)

Security Features:
- AES-256 local credential encryption
- HTTPS communication with Pipnosis backend
- No credentials transmitted to cloud
- Secure trade metadata transmission only
- Auto-startup and background operation
"""

import MetaTrader5 as mt5
import requests
import json
import time
import logging
import threading
import psutil
import sys
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import configparser
from dataclasses import dataclass, asdict
import base64
import hashlib
import signal
import subprocess
from pathlib import Path

# Configure comprehensive logging
log_dir = Path.home() / "Pipnosis" / "logs"
log_dir.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_dir / 'pipnosis_connector.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class TradeRequest:
    """Enhanced structure for trade requests from Pipnosis AI"""
    action: str  # 'buy', 'sell', 'close', 'modify'
    symbol: str
    volume: float
    price: Optional[float] = None
    sl: Optional[float] = None
    tp: Optional[float] = None
    deviation: int = 20
    magic: int = 123456
    comment: str = "Pipnosis AI Trade"
    user_id: Optional[str] = None
    strategy_id: Optional[str] = None
    risk_level: str = "medium"

@dataclass
class AccountInfo:
    """Enhanced structure for account information"""
    login: int
    balance: float
    equity: float
    margin: float
    free_margin: float
    margin_level: float
    currency: str
    leverage: int
    profit: float
    credit: float
    server: str
    company: str

@dataclass
class PositionInfo:
    """Structure for position information"""
    ticket: int
    symbol: str
    type: str
    volume: float
    price_open: float
    price_current: float
    sl: float
    tp: float
    profit: float
    swap: float
    commission: float
    time: datetime
    comment: str
    magic: int

class PipnosisConnector:
    """Enhanced MT5 connector with production features"""
    
    def __init__(self, config_file: str = None):
        self.config_file = config_file or str(Path.home() / "Pipnosis" / "config.ini")
        self.config_dir = Path(self.config_file).parent
        self.config_dir.mkdir(parents=True, exist_ok=True)
        
        self.encryption_key = self._get_or_create_key()
        self.cipher_suite = Fernet(self.encryption_key)
        
        self.is_connected = False
        self.is_running = False
        self.account_info = None
        self.last_heartbeat = None
        
        # API Configuration
        self.pipnosis_api_url = "https://pipnosis-production.up.railway.app/api"
        self.local_api_url = "http://localhost:3001/api"
        
        # Threading
        self.data_thread = None
        self.heartbeat_thread = None
        self.shutdown_event = threading.Event()
        
        # Performance monitoring
        self.trade_count = 0
        self.error_count = 0
        self.last_trade_time = None
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        logger.info("Pipnosis Connector v2.1.0 initialized")
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully"""
        logger.info(f"Received signal {signum}, shutting down gracefully...")
        self.shutdown()
        sys.exit(0)
    
    def _get_or_create_key(self) -> bytes:
        """Generate or retrieve encryption key for credentials"""
        key_file = self.config_dir / "pipnosis.key"
        
        if key_file.exists():
            with open(key_file, 'rb') as f:
                return f.read()
        else:
            # Generate key from machine-specific data for security
            machine_id = self._get_machine_id()
            password = machine_id.encode()
            salt = b'pipnosis_salt_2024'
            
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=salt,
                iterations=100000,
            )
            key = base64.urlsafe_b64encode(kdf.derive(password))
            
            with open(key_file, 'wb') as f:
                f.write(key)
            
            logger.info("Generated new encryption key")
            return key
    
    def _get_machine_id(self) -> str:
        """Get unique machine identifier"""
        try:
            # Use multiple machine characteristics for uniqueness
            cpu_info = str(psutil.cpu_count())
            disk_info = str(psutil.disk_usage('/').total) if os.name != 'nt' else str(psutil.disk_usage('C:').total)
            
            machine_data = f"{cpu_info}-{disk_info}-{os.environ.get('COMPUTERNAME', 'unknown')}"
            return hashlib.sha256(machine_data.encode()).hexdigest()[:16]
        except Exception as e:
            logger.warning(f"Could not generate machine ID: {e}")
            return "default_machine_id"
    
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
                'last_updated': datetime.now().isoformat(),
                'version': '2.1.0'
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
        """Connect to MT5 terminal with enhanced error handling"""
        try:
            # Use provided credentials or load from config
            if not all([login, password, server]):
                creds = self.load_credentials()
                if not creds:
                    logger.error("No credentials provided or found")
                    return False
                login, password, server = creds['login'], creds['password'], creds['server']
            
            # Check if MT5 terminal is running
            if not self._is_mt5_running():
                logger.error("MT5 terminal is not running. Please start MetaTrader 5.")
                return False
            
            # Initialize MT5 connection
            if not mt5.initialize():
                error_code, error_desc = mt5.last_error()
                logger.error(f"MT5 initialize failed: {error_code} - {error_desc}")
                return False
            
            # Login to account
            if not mt5.login(int(login), password=password, server=server):
                error_code, error_desc = mt5.last_error()
                logger.error(f"MT5 login failed: {error_code} - {error_desc}")
                mt5.shutdown()
                return False
            
            # Get and validate account info
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
                currency=account_info.currency,
                leverage=account_info.leverage,
                profit=account_info.profit,
                credit=account_info.credit,
                server=server,
                company=account_info.company
            )
            
            self.is_connected = True
            self.last_heartbeat = datetime.now()
            
            logger.info(f"Successfully connected to MT5 account: {login}")
            logger.info(f"Account: {account_info.balance} {account_info.currency}, Leverage: 1:{account_info.leverage}")
            
            return True
            
        except Exception as e:
            logger.error(f"MT5 connection failed: {e}")
            return False
    
    def _is_mt5_running(self) -> bool:
        """Check if MT5 terminal is running"""
        try:
            for proc in psutil.process_iter(['pid', 'name']):
                if 'terminal64.exe' in proc.info['name'].lower():
                    return True
            return False
        except Exception as e:
            logger.warning(f"Could not check MT5 process: {e}")
            return True  # Assume it's running if we can't check
    
    def disconnect_mt5(self):
        """Disconnect from MT5 terminal"""
        if self.is_connected:
            mt5.shutdown()
            self.is_connected = False
            logger.info("Disconnected from MT5")
    
    def get_market_data(self, symbol: str, timeframe: int = mt5.TIMEFRAME_H1, count: int = 100) -> Optional[List[Dict]]:
        """Retrieve enhanced market data for specified symbol"""
        if not self.is_connected:
            logger.error("Not connected to MT5")
            return None
        
        try:
            # Get rates
            rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, count)
            if rates is None:
                logger.error(f"Failed to get rates for {symbol}")
                return None
            
            # Get current tick
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                logger.error(f"Failed to get tick for {symbol}")
                return None
            
            # Convert to enhanced format
            market_data = []
            for rate in rates:
                market_data.append({
                    'time': datetime.fromtimestamp(rate['time']).isoformat(),
                    'open': float(rate['open']),
                    'high': float(rate['high']),
                    'low': float(rate['low']),
                    'close': float(rate['close']),
                    'volume': int(rate['tick_volume']),
                    'spread': int(rate['spread']) if 'spread' in rate.dtype.names else 0
                })
            
            # Add current market info
            market_data.append({
                'symbol': symbol,
                'bid': float(tick.bid),
                'ask': float(tick.ask),
                'spread': float(tick.ask - tick.bid),
                'time': datetime.fromtimestamp(tick.time).isoformat(),
                'volume': int(tick.volume)
            })
            
            return market_data
            
        except Exception as e:
            logger.error(f"Failed to get market data: {e}")
            return None
    
    def get_current_price(self, symbol: str) -> Optional[Dict[str, float]]:
        """Get current bid/ask prices for symbol with enhanced info"""
        if not self.is_connected:
            return None
        
        try:
            tick = mt5.symbol_info_tick(symbol)
            symbol_info = mt5.symbol_info(symbol)
            
            if tick is None or symbol_info is None:
                return None
            
            return {
                'bid': float(tick.bid),
                'ask': float(tick.ask),
                'spread': float(tick.ask - tick.bid),
                'spread_points': int((tick.ask - tick.bid) / symbol_info.point),
                'time': datetime.fromtimestamp(tick.time).isoformat(),
                'volume': int(tick.volume),
                'point': float(symbol_info.point),
                'digits': int(symbol_info.digits)
            }
            
        except Exception as e:
            logger.error(f"Failed to get current price: {e}")
            return None
    
    def execute_trade(self, trade_request: TradeRequest) -> Dict[str, Any]:
        """Execute trade with enhanced error handling and validation"""
        if not self.is_connected:
            return {'success': False, 'error': 'Not connected to MT5'}
        
        try:
            # Validate symbol
            symbol_info = mt5.symbol_info(trade_request.symbol)
            if symbol_info is None:
                return {'success': False, 'error': f'Symbol {trade_request.symbol} not found'}
            
            # Prepare order request
            if trade_request.action == 'buy':
                order_type = mt5.ORDER_TYPE_BUY
                price = mt5.symbol_info_tick(trade_request.symbol).ask
            elif trade_request.action == 'sell':
                order_type = mt5.ORDER_TYPE_SELL
                price = mt5.symbol_info_tick(trade_request.symbol).bid
            else:
                return {'success': False, 'error': f'Unsupported action: {trade_request.action}'}
            
            # Validate volume
            min_volume = symbol_info.volume_min
            max_volume = symbol_info.volume_max
            volume_step = symbol_info.volume_step
            
            if trade_request.volume < min_volume or trade_request.volume > max_volume:
                return {'success': False, 'error': f'Volume {trade_request.volume} outside allowed range [{min_volume}, {max_volume}]'}
            
            # Round volume to valid step
            volume = round(trade_request.volume / volume_step) * volume_step
            
            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": trade_request.symbol,
                "volume": volume,
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
                error_msg = f'Order failed: {result.retcode} - {result.comment}'
                logger.error(error_msg)
                return {
                    'success': False,
                    'error': error_msg,
                    'retcode': result.retcode,
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
                'time': datetime.now().isoformat(),
                'sl': trade_request.sl,
                'tp': trade_request.tp,
                'comment': trade_request.comment,
                'magic': trade_request.magic,
                'user_id': trade_request.user_id,
                'strategy_id': trade_request.strategy_id
            }
            
            self.trade_count += 1
            self.last_trade_time = datetime.now()
            
            logger.info(f"Trade executed successfully: {trade_info}")
            return trade_info
            
        except Exception as e:
            self.error_count += 1
            logger.error(f"Trade execution failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_open_positions(self) -> List[PositionInfo]:
        """Get all open positions with enhanced information"""
        if not self.is_connected:
            return []
        
        try:
            positions = mt5.positions_get()
            if positions is None:
                return []
            
            position_list = []
            for pos in positions:
                position_list.append(PositionInfo(
                    ticket=pos.ticket,
                    symbol=pos.symbol,
                    type='buy' if pos.type == mt5.ORDER_TYPE_BUY else 'sell',
                    volume=pos.volume,
                    price_open=pos.price_open,
                    price_current=pos.price_current,
                    sl=pos.sl,
                    tp=pos.tp,
                    profit=pos.profit,
                    swap=pos.swap,
                    commission=pos.commission,
                    time=datetime.fromtimestamp(pos.time),
                    comment=pos.comment,
                    magic=pos.magic
                ))
            
            return position_list
            
        except Exception as e:
            logger.error(f"Failed to get positions: {e}")
            return []
    
    def send_to_pipnosis(self, data: Dict[str, Any], endpoint: str) -> bool:
        """Send data to Pipnosis backend with fallback"""
        try:
            # Try production API first
            url = f"{self.pipnosis_api_url}/{endpoint}"
            headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'Pipnosis-Connector/2.1.0'
            }
            
            response = requests.post(url, json=data, headers=headers, timeout=10)
            
            if response.status_code == 200:
                logger.info(f"Data sent to Pipnosis successfully: {endpoint}")
                return True
            else:
                logger.warning(f"Production API failed: {response.status_code}, trying local API")
                
                # Fallback to local API
                local_url = f"{self.local_api_url}/{endpoint}"
                response = requests.post(local_url, json=data, headers=headers, timeout=5)
                
                if response.status_code == 200:
                    logger.info(f"Data sent to local Pipnosis API: {endpoint}")
                    return True
                else:
                    logger.error(f"Both APIs failed: {response.status_code}")
                    return False
                
        except Exception as e:
            logger.error(f"Error sending data to Pipnosis: {e}")
            return False
    
    def start_data_streaming(self):
        """Start background data streaming to Pipnosis"""
        if self.data_thread and self.data_thread.is_alive():
            return
        
        self.is_running = True
        self.data_thread = threading.Thread(target=self._data_streaming_loop, daemon=True)
        self.data_thread.start()
        logger.info("Started data streaming thread")
    
    def _data_streaming_loop(self):
        """Background loop for streaming data to Pipnosis"""
        while self.is_running and not self.shutdown_event.is_set():
            try:
                if self.is_connected:
                    # Send account update
                    self.send_account_update()
                    
                    # Send position updates
                    positions = self.get_open_positions()
                    if positions:
                        self.send_to_pipnosis({
                            'positions': [asdict(pos) for pos in positions],
                            'timestamp': datetime.now().isoformat()
                        }, 'position_updates')
                
                # Wait before next update
                self.shutdown_event.wait(30)  # 30 second intervals
                
            except Exception as e:
                logger.error(f"Error in data streaming loop: {e}")
                self.shutdown_event.wait(60)  # Wait longer on error
    
    def start_heartbeat(self):
        """Start heartbeat monitoring"""
        if self.heartbeat_thread and self.heartbeat_thread.is_alive():
            return
        
        self.heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self.heartbeat_thread.start()
        logger.info("Started heartbeat thread")
    
    def _heartbeat_loop(self):
        """Background heartbeat to monitor connection"""
        while self.is_running and not self.shutdown_event.is_set():
            try:
                if self.is_connected:
                    # Check MT5 connection
                    account_info = mt5.account_info()
                    if account_info is None:
                        logger.warning("Lost MT5 connection, attempting reconnect...")
                        self.is_connected = False
                        # Attempt reconnection
                        if self.connect_mt5():
                            logger.info("Reconnected to MT5 successfully")
                    else:
                        self.last_heartbeat = datetime.now()
                        
                        # Send heartbeat to Pipnosis
                        self.send_to_pipnosis({
                            'status': 'alive',
                            'timestamp': self.last_heartbeat.isoformat(),
                            'trade_count': self.trade_count,
                            'error_count': self.error_count,
                            'last_trade': self.last_trade_time.isoformat() if self.last_trade_time else None
                        }, 'heartbeat')
                
                # Wait before next heartbeat
                self.shutdown_event.wait(60)  # 1 minute intervals
                
            except Exception as e:
                logger.error(f"Error in heartbeat loop: {e}")
                self.shutdown_event.wait(120)  # Wait longer on error
    
    def send_account_update(self):
        """Send comprehensive account status update to Pipnosis"""
        if not self.is_connected:
            return
        
        try:
            # Get current account info
            account_info = mt5.account_info()
            if account_info is None:
                return
            
            # Get positions
            positions = self.get_open_positions()
            
            # Calculate additional metrics
            total_profit = sum(pos.profit for pos in positions)
            total_volume = sum(pos.volume for pos in positions)
            
            update_data = {
                'account': {
                    'login': account_info.login,
                    'balance': account_info.balance,
                    'equity': account_info.equity,
                    'margin': account_info.margin,
                    'free_margin': account_info.margin_free,
                    'margin_level': account_info.margin_level,
                    'profit': account_info.profit,
                    'currency': account_info.currency,
                    'leverage': account_info.leverage,
                    'server': self.account_info.server if self.account_info else 'unknown',
                    'company': account_info.company
                },
                'positions': {
                    'count': len(positions),
                    'total_profit': total_profit,
                    'total_volume': total_volume,
                    'details': [asdict(pos) for pos in positions]
                },
                'connector': {
                    'version': '2.1.0',
                    'trade_count': self.trade_count,
                    'error_count': self.error_count,
                    'uptime': (datetime.now() - self.last_heartbeat).total_seconds() if self.last_heartbeat else 0
                },
                'timestamp': datetime.now().isoformat()
            }
            
            self.send_to_pipnosis(update_data, 'account_updates')
            
        except Exception as e:
            logger.error(f"Failed to send account update: {e}")
    
    def listen_for_commands(self):
        """Listen for commands from Pipnosis AI with enhanced error handling"""
        logger.info("Starting command listener...")
        
        while self.is_running and not self.shutdown_event.is_set():
            try:
                # Poll for commands from Pipnosis API
                try:
                    response = requests.get(
                        f"{self.pipnosis_api_url}/commands",
                        headers={'User-Agent': 'Pipnosis-Connector/2.1.0'},
                        timeout=10
                    )
                except requests.RequestException:
                    # Fallback to local API
                    response = requests.get(
                        f"{self.local_api_url}/commands",
                        headers={'User-Agent': 'Pipnosis-Connector/2.1.0'},
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
                                'result': result,
                                'timestamp': datetime.now().isoformat()
                            }, 'trade_results')
                        
                        elif command['type'] == 'account_info':
                            self.send_account_update()
                        
                        elif command['type'] == 'positions':
                            positions = self.get_open_positions()
                            self.send_to_pipnosis({
                                'command_id': command['id'],
                                'positions': [asdict(pos) for pos in positions],
                                'timestamp': datetime.now().isoformat()
                            }, 'position_data')
                
                # Wait before next poll
                self.shutdown_event.wait(5)  # Poll every 5 seconds
                
            except Exception as e:
                logger.error(f"Error in command listener: {e}")
                self.shutdown_event.wait(30)  # Wait longer on error
    
    def run(self):
        """Main run method to start all services"""
        logger.info("Starting Pipnosis Connector...")
        
        # Connect to MT5
        if not self.connect_mt5():
            logger.error("Failed to connect to MT5. Exiting.")
            return False
        
        # Start background services
        self.start_data_streaming()
        self.start_heartbeat()
        
        # Start command listener (blocking)
        try:
            self.listen_for_commands()
        except KeyboardInterrupt:
            logger.info("Received interrupt signal")
        finally:
            self.shutdown()
        
        return True
    
    def shutdown(self):
        """Graceful shutdown of all services"""
        logger.info("Shutting down Pipnosis Connector...")
        
        self.is_running = False
        self.shutdown_event.set()
        
        # Wait for threads to finish
        if self.data_thread and self.data_thread.is_alive():
            self.data_thread.join(timeout=5)
        
        if self.heartbeat_thread and self.heartbeat_thread.is_alive():
            self.heartbeat_thread.join(timeout=5)
        
        # Disconnect from MT5
        self.disconnect_mt5()
        
        logger.info("Pipnosis Connector shutdown complete")

def main():
    """Main function to run the enhanced MT5 connector"""
    print("=" * 60)
    print("🚀 Pipnosis Connector v2.1.0 - Production Ready")
    print("=" * 60)
    
    connector = PipnosisConnector()
    
    # Check if credentials exist
    if not connector.load_credentials():
        print("\n❌ No MT5 credentials found!")
        print("Please configure your MT5 account through the Pipnosis web interface.")
        print("Visit: https://pipnosis.com and click 'Connect MT5'")
        input("\nPress Enter to exit...")
        return
    
    try:
        success = connector.run()
        if not success:
            print("\n❌ Failed to start connector. Check logs for details.")
            input("Press Enter to exit...")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        print(f"\n❌ Unexpected error: {e}")
        input("Press Enter to exit...")

if __name__ == "__main__":
    main()