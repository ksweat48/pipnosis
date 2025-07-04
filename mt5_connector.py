"""
Pipnosis MT5 Real-Time Data Connector - FIXED VERSION
Connects directly to MetaTrader 5 and streams live data via WebSocket
"""

import MetaTrader5 as mt5
import asyncio
import websockets
import json
import time
import logging
import socket
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
import threading
from dataclasses import dataclass, asdict

# Configure logging with UTF-8 encoding to fix emoji issues
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('mt5_bridge.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class AccountInfo:
    login: int
    server: str
    name: str
    company: str
    currency: str
    balance: float
    equity: float
    margin: float
    free_margin: float
    margin_level: float
    profit: float
    credit: float
    leverage: int
    trade_allowed: bool
    trade_expert: bool
    last_update: str

@dataclass
class Position:
    ticket: str
    symbol: str
    type: str  # 'buy' or 'sell'
    volume: float
    open_price: float
    current_price: float
    sl: float
    tp: float
    profit: float
    swap: float
    commission: float
    comment: str
    time_open: str

class MT5Connector:
    def __init__(self):
        self.connected = False
        self.account_info: Optional[AccountInfo] = None
        self.positions: List[Position] = []
        self.websocket_clients = set()
        self.update_interval = 1.0  # Update every second
        self.running = False
        self.last_order_time = 0  # Track last order time to prevent flooding
        
    def initialize_mt5(self) -> bool:
        """Initialize connection to MT5 terminal"""
        try:
            logger.info("Initializing MT5 connection...")
            
            # Initialize MT5 connection
            if not mt5.initialize():
                error_code, error_message = mt5.last_error()
                logger.error(f"MT5 initialization failed: {error_code} - {error_message}")
                return False
            
            # Get account info
            account_info = mt5.account_info()
            if account_info is None:
                error_code, error_message = mt5.last_error()
                logger.error(f"Failed to get account info - MT5 not logged in? Error: {error_code} - {error_message}")
                mt5.shutdown()
                return False
            
            # Check if trading is allowed
            if not account_info.trade_allowed:
                logger.warning("⚠️ Trading is not allowed on this account")
            
            # Check if automated trading is enabled
            if not account_info.trade_expert:
                logger.warning("⚠️ AUTOMATED TRADING IS DISABLED IN MT5! Enable it in Tools > Options > Expert Advisors > Allow automated trading")
            
            self.connected = True
            logger.info(f"✅ MT5 connected successfully!")
            logger.info(f"Account: {account_info.login}")
            logger.info(f"Server: {account_info.server}")
            logger.info(f"Balance: ${account_info.balance:,.2f}")
            logger.info(f"Equity: ${account_info.equity:,.2f}")
            logger.info(f"Automated trading: {'Enabled' if account_info.trade_expert else 'DISABLED'}")
            
            return True
            
        except Exception as e:
            logger.error(f"MT5 initialization error: {e}")
            return False
    
    def get_account_info(self) -> Optional[AccountInfo]:
        """Get current account information"""
        try:
            if not self.connected:
                return None
                
            account = mt5.account_info()
            if account is None:
                error_code, error_message = mt5.last_error()
                logger.error(f"Failed to get account info: {error_code} - {error_message}")
                return None
            
            return AccountInfo(
                login=account.login,
                server=account.server,
                name=account.name,
                company=account.company,
                currency=account.currency,
                balance=account.balance,
                equity=account.equity,
                margin=account.margin,
                free_margin=account.margin_free,
                margin_level=account.margin_level,
                profit=account.profit,
                credit=account.credit,
                leverage=account.leverage,
                trade_allowed=account.trade_allowed,
                trade_expert=account.trade_expert,
                last_update=datetime.now().isoformat()
            )
            
        except Exception as e:
            logger.error(f"Error getting account info: {e}")
            return None
    
    def get_positions(self) -> List[Position]:
        """Get all open positions - FIXED VERSION"""
        try:
            if not self.connected:
                return []
                
            positions = mt5.positions_get()
            if positions is None:
                error_code, error_message = mt5.last_error()
                logger.error(f"Failed to get positions: {error_code} - {error_message}")
                return []
            
            result = []
            for pos in positions:
                try:
                    # Get current price for the symbol
                    tick = mt5.symbol_info_tick(pos.symbol)
                    if tick is None:
                        logger.warning(f"Could not get tick data for {pos.symbol}")
                        continue
                        
                    current_price = tick.bid if pos.type == 0 else tick.ask  # 0 = buy, 1 = sell
                    
                    # CRITICAL FIX: Handle missing commission attribute safely
                    commission = 0.0
                    if hasattr(pos, 'commission'):
                        commission = pos.commission
                    else:
                        # Try to get commission from deals if available
                        try:
                            deals = mt5.history_deals_get(position=pos.ticket)
                            if deals and len(deals) > 0:
                                commission = sum(getattr(deal, 'commission', 0.0) for deal in deals)
                        except Exception as deal_error:
                            logger.warning(f"Could not get commission from deals: {deal_error}")
                            commission = 0.0
                    
                    position = Position(
                        ticket=str(pos.ticket),
                        symbol=pos.symbol,
                        type='buy' if pos.type == 0 else 'sell',
                        volume=pos.volume,
                        open_price=pos.price_open,
                        current_price=current_price,
                        sl=getattr(pos, 'sl', 0.0),
                        tp=getattr(pos, 'tp', 0.0),
                        profit=getattr(pos, 'profit', 0.0),
                        swap=getattr(pos, 'swap', 0.0),
                        commission=commission,
                        comment=getattr(pos, 'comment', ''),
                        time_open=datetime.fromtimestamp(getattr(pos, 'time', datetime.now().timestamp())).isoformat()
                    )
                    result.append(position)
                    
                except Exception as pos_error:
                    logger.error(f"Error processing position {pos.ticket}: {pos_error}")
                    continue
            
            logger.info(f"Successfully retrieved {len(result)} positions")
            return result
            
        except Exception as e:
            logger.error(f"Error getting positions: {e}")
            return []
    
    def format_symbol(self, symbol: str) -> str:
        """Format symbol to MT5 standard (e.g., EUR/USD -> EURUSD)"""
        try:
            # Remove any slashes
            formatted = symbol.replace('/', '')
            
            # Remove any spaces
            formatted = formatted.replace(' ', '')
            
            # Convert to uppercase
            formatted = formatted.upper()
            
            if formatted != symbol:
                logger.info(f"Symbol format conversion: {symbol} -> {formatted}")
            
            return formatted
            
        except Exception as e:
            logger.error(f"Error formatting symbol: {e}")
            return symbol  # Return original symbol if formatting fails
    
    def get_symbol_info(self, symbol: str) -> Optional[Dict]:
        """Get symbol information and current price"""
        try:
            if not self.connected:
                return None
            
            # Format symbol to MT5 standard
            symbol = self.format_symbol(symbol)
                
            # Get symbol info
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                error_code, error_message = mt5.last_error()
                logger.error(f"Symbol {symbol} not found: {error_code} - {error_message}")
                return None
            
            # Get current tick
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                error_code, error_message = mt5.last_error()
                logger.error(f"No tick data for {symbol}: {error_code} - {error_message}")
                return None
            
            return {
                'symbol': symbol,
                'bid': tick.bid,
                'ask': tick.ask,
                'spread': tick.ask - tick.bid,
                'volume': tick.volume,
                'time': datetime.fromtimestamp(tick.time).isoformat(),
                'digits': symbol_info.digits,
                'point': symbol_info.point,
                'trade_allowed': symbol_info.trade_mode != 0,
                'filling_mode': self.get_filling_mode(symbol)
            }
            
        except Exception as e:
            logger.error(f"Error getting symbol info for {symbol}: {e}")
            return None
    
    def ensure_symbol_selected(self, symbol: str) -> bool:
        """Ensure a symbol is selected in Market Watch"""
        try:
            logger.info(f"Checking if symbol {symbol} is selected in Market Watch...")
            
            # Format symbol to MT5 standard (e.g., EUR/USD -> EURUSD)
            symbol = self.format_symbol(symbol)
            
            # Get symbol info
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                error_code, error_message = mt5.last_error()
                logger.error(f"Symbol {symbol} not found: {error_code} - {error_message}")
                return False
            
            # Check if symbol is selected in Market Watch
            if not symbol_info.visible:
                logger.info(f"Symbol {symbol} is not visible in Market Watch, selecting...")
                if not mt5.symbol_select(symbol, True):
                    error_code, error_message = mt5.last_error()
                    logger.error(f"Failed to select symbol {symbol}: {error_code} - {error_message}")
                    return False
                
                # Wait for symbol to be fully loaded
                time.sleep(1)
                
                # Verify selection was successful
                symbol_info = mt5.symbol_info(symbol)
                if symbol_info is None or not symbol_info.visible:
                    logger.error(f"Failed to verify symbol {symbol} selection")
                    return False
                
                logger.info(f"✅ Symbol {symbol} selected successfully")
            else:
                logger.info(f"✅ Symbol {symbol} is already selected in Market Watch")
            
            # Get current tick to verify data is available
            tick = mt5.symbol_info_tick(symbol)
            if tick is None or tick.bid == 0 or tick.ask == 0:
                error_code, error_message = mt5.last_error()
                logger.error(f"No valid price data for {symbol}: {error_code} - {error_message}")
                return False
            
            logger.info(f"✅ Symbol {symbol} has valid price data: Bid={tick.bid}, Ask={tick.ask}")
            return True
            
        except Exception as e:
            logger.error(f"Error ensuring symbol selection: {e}")
            return False
    
    def get_filling_mode(self, symbol: str) -> int:
        """Get the appropriate filling mode for a symbol"""
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
    
    def place_order(self, symbol: str, order_type: str, volume: float, 
                   price: float = None, sl: float = None, tp: float = None, 
                   comment: str = "Pipnosis AI Trade") -> Dict:
        """Place a trading order with enhanced error handling and retries"""
        # Prevent order flooding - enforce minimum 1 second between orders
        current_time = time.time()
        if current_time - self.last_order_time < 1.0:
            time.sleep(1.0)  # Wait to prevent flooding
        
        self.last_order_time = time.time()
        
        # CRITICAL FIX: Ensure symbol is selected in Market Watch
        if not self.ensure_symbol_selected(symbol):
            return {'success': False, 'error': f'Failed to select symbol {symbol} in Market Watch'}
        
        # Format symbol to MT5 standard (e.g., EUR/USD -> EURUSD)
        symbol = self.format_symbol(symbol)
        
        # Check if MT5 is connected
        if not self.connected:
            return {'success': False, 'error': 'MT5 not connected'}
        
        # Check if automated trading is enabled
        account_info = mt5.account_info()
        if account_info and not account_info.trade_expert:
            logger.error("⚠️ AUTOMATED TRADING IS DISABLED IN MT5! Enable it in Tools > Options > Expert Advisors > Allow automated trading")
            return {'success': False, 'error': 'Automated trading is disabled in MT5. Enable it in Tools > Options > Expert Advisors > Allow automated trading'}
        
        # Verify symbol exists and has valid price data
        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            error_code, error_message = mt5.last_error()
            logger.error(f"Symbol {symbol} not found: {error_code} - {error_message}")
            return {'success': False, 'error': f'Symbol {symbol} not found'}
        
        # Check if symbol is tradable
        if symbol_info.trade_mode == 0:
            logger.error(f"Symbol {symbol} is not available for trading")
            return {'success': False, 'error': f'Symbol {symbol} is not available for trading'}
        
        # Get current tick data to verify prices are available
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or tick.bid == 0 or tick.ask == 0:
            error_code, error_message = mt5.last_error()
            logger.error(f"No valid price data for {symbol}: {error_code} - {error_message}")
            return {'success': False, 'error': f'No valid price data for {symbol}. Market may be closed.'}
        
        try:
            # Determine order type
            if order_type.lower() == 'buy':
                trade_type = mt5.ORDER_TYPE_BUY
                market_price = tick.ask
            elif order_type.lower() == 'sell':
                trade_type = mt5.ORDER_TYPE_SELL
                market_price = tick.bid
            else:
                return {'success': False, 'error': f'Invalid order type: {order_type}'}
            
            # CRITICAL FIX: Validate and adjust price if needed
            if price is None or abs(price - market_price) > 0.001:
                if price is not None:
                    logger.warning(f"⚠️ Adjusted price from {price} to market price {market_price}")
                price = market_price
            
            # Validate volume against symbol limits
            min_volume = symbol_info.volume_min
            max_volume = symbol_info.volume_max
            volume_step = symbol_info.volume_step
            
            if volume < min_volume:
                logger.warning(f"Volume {volume} is below minimum {min_volume}, adjusting")
                volume = min_volume
            elif volume > max_volume:
                logger.warning(f"Volume {volume} is above maximum {max_volume}, adjusting")
                volume = max_volume
            
            # Round volume to valid step
            volume = round(volume / volume_step) * volume_step
            
            # CRITICAL FIX: Validate stop loss and take profit levels
            if sl is not None or tp is not None:
                # Get symbol properties
                point = symbol_info.point
                digits = symbol_info.digits
                
                # Calculate minimum stop level in points
                stop_level = symbol_info.trade_stops_level
                
                # Convert stop level from points to price
                min_stop_distance = stop_level * point
                
                # Validate and adjust stop loss
                if sl is not None:
                    if order_type.lower() == 'buy':
                        # For buy orders, SL must be below current price
                        min_valid_sl = tick.bid - min_stop_distance
                        if sl > min_valid_sl:
                            logger.warning(f"Stop loss {sl} too close to current price {tick.bid}, adjusting to {min_valid_sl:.{digits}f}")
                            sl = min_valid_sl
                    else:  # sell order
                        # For sell orders, SL must be above current price
                        min_valid_sl = tick.ask + min_stop_distance
                        if sl < min_valid_sl:
                            logger.warning(f"Stop loss {sl} too close to current price {tick.ask}, adjusting to {min_valid_sl:.{digits}f}")
                            sl = min_valid_sl
                
                # Validate and adjust take profit
                if tp is not None:
                    if order_type.lower() == 'buy':
                        # For buy orders, TP must be above current price
                        min_valid_tp = tick.ask + min_stop_distance
                        if tp < min_valid_tp:
                            logger.warning(f"Take profit {tp} too close to current price {tick.ask}, adjusting to {min_valid_tp:.{digits}f}")
                            tp = min_valid_tp
                    else:  # sell order
                        # For sell orders, TP must be below current price
                        min_valid_tp = tick.bid - min_stop_distance
                        if tp > min_valid_tp:
                            logger.warning(f"Take profit {tp} too close to current price {tick.bid}, adjusting to {min_valid_tp:.{digits}f}")
                            tp = min_valid_tp
            
            # CRITICAL FIX: Get the appropriate filling mode for this symbol
            filling_mode = self.get_filling_mode(symbol)
            logger.info(f"Using filling mode: {filling_mode} for symbol {symbol}")
            
            # Prepare the request
            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": symbol,
                "volume": volume,
                "type": trade_type,
                "price": price,
                "deviation": 20,
                "magic": 234000,
                "comment": comment,
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": filling_mode,
            }
            
            # Add SL and TP if provided
            if sl is not None:
                request["sl"] = sl
            if tp is not None:
                request["tp"] = tp
            
            logger.info(f"Sending order request: {request}")
            
            # Send order with retry logic
            max_retries = 3
            retry_delay = 1.0  # seconds
            
            for attempt in range(max_retries):
                # CRITICAL FIX: Ensure symbol is selected and has valid prices
                if not mt5.symbol_select(symbol, True):
                    error_code, error_message = mt5.last_error()
                    logger.error(f"Failed to select symbol {symbol} for trading: {error_code} - {error_message}")
                    return {'success': False, 'error': f'Failed to select symbol {symbol} for trading'}
                
                # Check if we have valid price data
                tick = mt5.symbol_info_tick(symbol)
                if tick is None or tick.bid == 0 or tick.ask == 0:
                    error_code, error_message = mt5.last_error()
                    logger.error(f"No valid price data for {symbol} (attempt {attempt+1}/{max_retries}): {error_code} - {error_message}")
                    if attempt < max_retries - 1:
                        logger.info(f"Waiting {retry_delay}s before retry...")
                        time.sleep(retry_delay)
                        retry_delay *= 2  # Exponential backoff
                        continue
                    return {'success': False, 'error': f'No price data available for {symbol}. Market may be closed.'}
                
                # Update price based on latest tick
                if order_type.lower() == 'buy':
                    request["price"] = tick.ask
                else:
                    request["price"] = tick.bid
                
                # Send the order
                result = mt5.order_send(request)
                
                if result is None:
                    error_code, error_message = mt5.last_error()
                    logger.error(f"Order send failed: No response from MT5 (attempt {attempt+1}/{max_retries}). Error: {error_code} - {error_message}")
                    
                    # Check for specific error conditions
                    if error_code == 10021:  # No prices
                        logger.error("No prices error detected - this usually means the symbol is not properly selected in Market Watch")
                        # Try to force select the symbol again
                        mt5.symbol_select(symbol, True)
                        time.sleep(1)  # Wait for symbol to be fully loaded
                    elif error_code == 10030:  # Unsupported filling mode
                        logger.error("Unsupported filling mode error detected - trying different filling mode")
                        # Try a different filling mode
                        if request["type_filling"] == mt5.ORDER_FILLING_FOK:
                            request["type_filling"] = mt5.ORDER_FILLING_IOC
                        elif request["type_filling"] == mt5.ORDER_FILLING_IOC:
                            request["type_filling"] = mt5.ORDER_FILLING_RETURN
                        else:
                            request["type_filling"] = mt5.ORDER_FILLING_FOK
                    
                    if attempt < max_retries - 1:
                        time.sleep(retry_delay)
                        retry_delay *= 2  # Exponential backoff
                        continue
                    
                    return {'success': False, 'error': f'Order send failed: No response from MT5. Error: {error_code} - {error_message}'}
                
                if result.retcode != mt5.TRADE_RETCODE_DONE:
                    error_msg = f"Order failed: {result.retcode} - {result.comment}"
                    logger.error(f"Order error (attempt {attempt+1}/{max_retries}): {error_msg}")
                    
                    # Check for specific error codes that might be resolved by retrying
                    if result.retcode == 10030:  # Unsupported filling mode
                        logger.error("Unsupported filling mode error detected - trying different filling mode")
                        # Try a different filling mode
                        if request["type_filling"] == mt5.ORDER_FILLING_FOK:
                            request["type_filling"] = mt5.ORDER_FILLING_IOC
                        elif request["type_filling"] == mt5.ORDER_FILLING_IOC:
                            request["type_filling"] = mt5.ORDER_FILLING_RETURN
                        else:
                            request["type_filling"] = mt5.ORDER_FILLING_FOK
                        
                        if attempt < max_retries - 1:
                            logger.info(f"Retrying order with different filling mode in {retry_delay} seconds...")
                            time.sleep(retry_delay)
                            retry_delay *= 2  # Exponential backoff
                            continue
                    elif result.retcode in [10004, 10006, 10008, 10009, 10010, 10011, 10012, 10013, 10014, 10018, 10021]:
                        if attempt < max_retries - 1:
                            logger.info(f"Retrying order in {retry_delay} seconds...")
                            time.sleep(retry_delay)
                            retry_delay *= 2  # Exponential backoff
                            continue
                    
                    return {'success': False, 'error': error_msg, 'retcode': result.retcode}
                
                # Success!
                success_msg = f"Order placed successfully: {result.order}, Price {result.price}, Volume {result.volume}"
                logger.info(success_msg)
                
                return {
                    'success': True,
                    'ticket': result.order,
                    'price': result.price,
                    'volume': result.volume,
                    'comment': result.comment
                }
            
            # If we get here, all retries failed
            error_code, error_message = mt5.last_error()
            return {'success': False, 'error': f'Order failed after multiple attempts. Last error: {error_code} - {error_message}'}
            
        except Exception as e:
            error_msg = f"Error placing order: {e}"
            logger.error(f"Order exception: {error_msg}")
            return {'success': False, 'error': error_msg}
    
    async def broadcast_data(self, data: Dict):
        """Broadcast data to all connected WebSocket clients"""
        if not self.websocket_clients:
            return
            
        message = json.dumps(data)
        disconnected_clients = set()
        
        for client in self.websocket_clients:
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                disconnected_clients.add(client)
            except Exception as e:
                logger.error(f"Error broadcasting to client: {e}")
                disconnected_clients.add(client)
        
        # Remove disconnected clients
        self.websocket_clients -= disconnected_clients
    
    async def data_update_loop(self):
        """Main loop to update and broadcast MT5 data"""
        logger.info("Starting data update loop...")
        
        while self.running:
            try:
                if not self.connected:
                    await asyncio.sleep(self.update_interval)
                    continue
                
                # Get fresh data
                account_info = self.get_account_info()
                positions = self.get_positions()
                
                if account_info:
                    self.account_info = account_info
                    self.positions = positions
                    
                    # Prepare data for broadcast
                    data = {
                        'type': 'account_update',
                        'timestamp': datetime.now().isoformat(),
                        'account': asdict(account_info),
                        'positions': [asdict(pos) for pos in positions],
                        'connection_status': 'connected'
                    }
                    
                    # Broadcast to all clients
                    await self.broadcast_data(data)
                
                await asyncio.sleep(self.update_interval)
                
            except Exception as e:
                logger.error(f"Error in data update loop: {e}")
                await asyncio.sleep(self.update_interval)
    
    async def handle_websocket_client(self, websocket, path):
        """Handle new WebSocket client connection"""
        logger.info(f"🔌 New WebSocket client connected from {websocket.remote_address}")
        self.websocket_clients.add(websocket)
        
        try:
            # Send initial data
            if self.account_info:
                initial_data = {
                    'type': 'initial_data',
                    'timestamp': datetime.now().isoformat(),
                    'account': asdict(self.account_info),
                    'positions': [asdict(pos) for pos in self.positions],
                    'connection_status': 'connected' if self.connected else 'disconnected'
                }
                await websocket.send(json.dumps(initial_data))
            
            # Handle incoming messages
            async for message in websocket:
                try:
                    logger.info(f"📨 Received message: {message}")
                    data = json.loads(message)
                    response = await self.handle_client_message(websocket, data)
                    if response:
                        await websocket.send(json.dumps(response))
                        logger.info(f"✅ Sent response: {response['type']}")
                    else:
                        await websocket.send(json.dumps({"type": "ack", "message": "Message received"}))
                        logger.info("✅ Sent acknowledgment")
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON from client: {message}")
                    await websocket.send(json.dumps({"type": "error", "error": "Invalid JSON"}))
                except Exception as e:
                    logger.error(f"Error handling client message: {e}")
                    await websocket.send(json.dumps({"type": "error", "error": str(e)}))
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info("WebSocket client disconnected")
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            self.websocket_clients.discard(websocket)
    
    async def handle_client_message(self, websocket, data: Dict):
        """Handle messages from WebSocket clients"""
        try:
            message_type = data.get('type')
            request_id = data.get('requestId', 'unknown')
            
            if message_type == 'place_order':
                # Handle trade execution request
                symbol = data.get('symbol')
                order_type = data.get('order_type')
                volume = data.get('volume')
                price = data.get('price')
                sl = data.get('sl')
                tp = data.get('tp')
                comment = data.get('comment', 'Pipnosis AI Trade')
                
                logger.info(f"Received order request: {order_type} {volume} {symbol} SL:{sl} TP:{tp}")
                
                result = self.place_order(symbol, order_type, volume, price=price, sl=sl, tp=tp, comment=comment)
                
                response = {
                    'type': 'order_response',
                    'requestId': request_id,
                    'timestamp': datetime.now().isoformat(),
                    'result': result
                }
                
                logger.info(f"Order result: {result}")
                return response
                
            elif message_type == 'get_symbol_info':
                # Handle symbol info request
                symbol = data.get('symbol')
                symbol_info = self.get_symbol_info(symbol)
                
                response = {
                    'type': 'symbol_info',
                    'requestId': request_id,
                    'timestamp': datetime.now().isoformat(),
                    'symbol': symbol,
                    'data': symbol_info
                }
                
                return response
                
            elif message_type == 'ping':
                # Handle ping request
                response = {
                    'type': 'pong',
                    'requestId': request_id,
                    'timestamp': datetime.now().isoformat(),
                    'connection_status': 'connected' if self.connected else 'disconnected'
                }
                
                return response
                
            return None  # No specific response needed
                
        except Exception as e:
            logger.error(f"Error handling client message: {e}")
            # Send error response
            return {
                'type': 'error',
                'requestId': data.get('requestId', 'unknown'),
                'timestamp': datetime.now().isoformat(),
                'error': str(e)
            }
    
    async def start_websocket_server(self, host='localhost', port=8765):
        """Start the WebSocket server with port fallback"""
        # Try the specified port first, then fall back to alternatives if needed
        ports_to_try = [port, 8766, 8767, 8768, 8769, 8770]
        server = None
        
        for current_port in ports_to_try:
            try:
                logger.info(f"Starting WebSocket server on {host}:{current_port}")
                server = await websockets.serve(
                    self.handle_websocket_client,
                    host,
                    current_port,
                    ping_interval=30,
                    ping_timeout=10
                )
                logger.info(f"WebSocket server started on ws://{host}:{current_port}")
                
                # Store the successful port in a file for clients to discover
                with open('mt5_bridge_port.txt', 'w') as f:
                    f.write(str(current_port))
                
                return server, current_port
            except socket.error as e:
                logger.warning(f"Port {current_port} is already in use, trying next port: {e}")
                continue
            except Exception as e:
                logger.error(f"Error starting WebSocket server on port {current_port}: {e}")
                continue
        
        # If we get here, all ports failed
        logger.error("Failed to start WebSocket server on any port")
        return None, None
    
    def start(self, host='localhost', port=8765):
        """Start the MT5 connector"""
        logger.info("Starting Pipnosis MT5 Connector...")
        
        # Initialize MT5
        if not self.initialize_mt5():
            logger.error("Failed to initialize MT5 - exiting")
            return False
        
        self.running = True
        
        # Start the async event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # Start WebSocket server and data update loop
            server_result, actual_port = loop.run_until_complete(self.start_websocket_server(host, port))
            
            if server_result is None:
                logger.error("Failed to start WebSocket server - exiting")
                self.running = False
                if self.connected:
                    mt5.shutdown()
                    self.connected = False
                return False
            
            update_task = loop.create_task(self.data_update_loop())
            
            logger.info("Pipnosis MT5 Connector is running!")
            logger.info(f"WebSocket clients can connect to receive live MT5 data on port {actual_port}")
            logger.info("Press Ctrl+C to stop")
            
            # Run forever
            loop.run_forever()
            
        except KeyboardInterrupt:
            logger.info("Shutting down...")
        except Exception as e:
            logger.error(f"Server error: {e}")
        finally:
            self.running = False
            if self.connected:
                mt5.shutdown()
            loop.close()
            logger.info("MT5 Connector stopped")
    
    def stop(self):
        """Stop the connector"""
        self.running = False
        if self.connected:
            mt5.shutdown()
            self.connected = False

if __name__ == "__main__":
    connector = MT5Connector()
    connector.start(host='localhost', port=8765)