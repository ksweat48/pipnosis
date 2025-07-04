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
            
            # Try to initialize MetaTrader 5
            if not mt5.initialize():
                error = mt5.last_error()
                logger.error(f"❌ MT5 initialization failed: {error}")
                return False

            # Get account info
            account_info = mt5.account_info()
            if account_info is None:
                logger.error("❌ Failed to get account info — MT5 not logged in?")
                mt5.shutdown()
                return False

            self.account_info = account_info
            self.connected = True
            logger.info(f"✅ Connected to MT5 account {account_info.login}, balance: {account_info.balance}")
            
            # Check if trading is allowed
            if not account_info.trade_allowed:
                logger.warning("⚠️ Trading is not allowed on this account")
                
            # Check if automated trading is enabled
            if not account_info.trade_expert:
                logger.warning("⚠️ AUTOMATED TRADING IS DISABLED IN MT5! Enable it in Tools > Options > Expert Advisors > Allow automated trading")
            
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
                logger.error("Failed to get account info")
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
    
    def get_symbol_info(self, symbol: str) -> Optional[Dict]:
        """Get symbol information and current price"""
        try:
            if not self.connected:
                return None
                
            # Get symbol info
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info is None:
                return None
            
            # Get current tick
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
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
                'trade_allowed': symbol_info.trade_mode != 0
            }
            
        except Exception as e:
            logger.error(f"Error getting symbol info for {symbol}: {e}")
            return None
    
    def place_order(self, symbol: str, order_type: str, volume: float, 
                   price: float = None, sl: float = None, tp: float = None, 
                   comment: str = "Pipnosis AI Trade") -> Dict:
        """Place a trading order with enhanced error handling and retries"""
        # Prevent order flooding - enforce minimum 1 second between orders
        current_time = time.time()
        if current_time - self.last_order_time < 1.0:
            time.sleep(1.0)  # Wait to prevent flooding
        
        self.last_order_time = time.time()
        
        # Check if MT5 is connected
        if not self.connected:
            return {'success': False, 'error': 'MT5 not connected'}
        
        # Check if automated trading is enabled
        account_info = mt5.account_info()
        if account_info and not account_info.trade_expert:
            logger.error("⚠️ AUTOMATED TRADING IS DISABLED IN MT5! Enable it in Tools > Options > Expert Advisors > Allow automated trading")
            return {'success': False, 'error': 'Automated trading is disabled in MT5. Enable it in Tools > Options > Expert Advisors > Allow automated trading'}
        
        # CRITICAL FIX: Ensure symbol is selected in Market Watch
        if not mt5.symbol_select(symbol, True):
            logger.error(f"Failed to select symbol {symbol} in Market Watch")
            return {'success': False, 'error': f'Failed to select symbol {symbol} in Market Watch'}
        
        # Verify symbol exists and has valid price data
        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            logger.error(f"Symbol {symbol} not found")
            return {'success': False, 'error': f'Symbol {symbol} not found'}
        
        # Check if symbol is tradable
        if symbol_info.trade_mode == 0:
            logger.error(f"Symbol {symbol} is not available for trading")
            return {'success': False, 'error': f'Symbol {symbol} is not available for trading'}
        
        # Get current tick data to verify prices are available
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or tick.bid == 0 or tick.ask == 0:
            logger.error(f"No valid price data for {symbol}")
            return {'success': False, 'error': f'No valid price data for {symbol}. Market may be closed.'}
        
        try:
            # Determine order type
            if order_type.lower() == 'buy':
                trade_type = mt5.ORDER_TYPE_BUY
                if price is None:
                    tick = mt5.symbol_info_tick(symbol)
                    if tick is None:
                        logger.error(f"Failed to get tick data for {symbol}")
                        return {'success': False, 'error': f'No price data available for {symbol}'}
                    price = tick.ask
            elif order_type.lower() == 'sell':
                trade_type = mt5.ORDER_TYPE_SELL
                if price is None:
                    tick = mt5.symbol_info_tick(symbol)
                    if tick is None:
                        logger.error(f"Failed to get tick data for {symbol}")
                        return {'success': False, 'error': f'No price data available for {symbol}'}
                    price = tick.bid
            else:
                return {'success': False, 'error': f'Invalid order type: {order_type}'}
            
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
                
                # Get current price
                tick = mt5.symbol_info_tick(symbol)
                if tick is None:
                    logger.error(f"Failed to get tick data for {symbol}")
                    return {'success': False, 'error': f'No price data available for {symbol}'}
                
                current_bid = tick.bid
                current_ask = tick.ask
                
                # Calculate minimum stop level in points
                stop_level = symbol_info.trade_stops_level
                
                # Convert stop level from points to price
                min_stop_distance = stop_level * point
                
                # Validate and adjust stop loss
                if sl is not None:
                    if order_type.lower() == 'buy':
                        # For buy orders, SL must be below current price
                        min_valid_sl = current_bid - min_stop_distance
                        if sl > min_valid_sl:
                            logger.warning(f"Stop loss {sl} too close to current price {current_bid}, adjusting to {min_valid_sl:.{digits}f}")
                            sl = min_valid_sl
                    else:  # sell order
                        # For sell orders, SL must be above current price
                        min_valid_sl = current_ask + min_stop_distance
                        if sl < min_valid_sl:
                            logger.warning(f"Stop loss {sl} too close to current price {current_ask}, adjusting to {min_valid_sl:.{digits}f}")
                            sl = min_valid_sl
                
                # Validate and adjust take profit
                if tp is not None:
                    if order_type.lower() == 'buy':
                        # For buy orders, TP must be above current price
                        min_valid_tp = current_ask + min_stop_distance
                        if tp < min_valid_tp:
                            logger.warning(f"Take profit {tp} too close to current price {current_ask}, adjusting to {min_valid_tp:.{digits}f}")
                            tp = min_valid_tp
                    else:  # sell order
                        # For sell orders, TP must be below current price
                        min_valid_tp = current_bid - min_stop_distance
                        if tp > min_valid_tp:
                            logger.warning(f"Take profit {tp} too close to current price {current_bid}, adjusting to {min_valid_tp:.{digits}f}")
                            tp = min_valid_tp
            
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
                "type_filling": mt5.ORDER_FILLING_IOC,
            }
            
            # Add SL and TP if provided
            if sl is not None:
                request["sl"] = sl
            if tp is not None:
                request["tp"] = tp
            
            logger.info(f"Sending order request: {request}")
            
            # Send the order with retry logic
            max_retries = 3
            retry_delay = 1.0  # seconds
            
            for attempt in range(max_retries):
                # CRITICAL FIX: Ensure symbol is selected and has valid prices
                if not mt5.symbol_select(symbol, True):
                    logger.error(f"Failed to select symbol {symbol} for trading")
                    return {'success': False, 'error': f'Failed to select symbol {symbol} for trading'}
                
                # Check if we have valid price data
                tick = mt5.symbol_info_tick(symbol)
                if tick is None or tick.bid == 0 or tick.ask == 0:
                    logger.error(f"No valid price data for {symbol} (attempt {attempt+1}/{max_retries})")
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
                    logger.error(f"Order send failed: No response from MT5 (attempt {attempt+1}/{max_retries})")
                    if attempt < max_retries - 1:
                        time.sleep(retry_delay)
                        retry_delay *= 2  # Exponential backoff
                        continue
                    return {'success': False, 'error': 'Order send failed: No response from MT5'}
                
                if result.retcode != mt5.TRADE_RETCODE_DONE:
                    error_msg = f"Order failed: {result.retcode} - {result.comment}"
                    logger.error(f"Order error (attempt {attempt+1}/{max_retries}): {error_msg}")
                    
                    # Check for specific error codes that might be resolved by retrying
                    if result.retcode in [10004, 10006, 10008, 10009, 10010, 10011, 10012, 10013, 10014, 10018, 10021]:
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
            return {'success': False, 'error': 'Order failed after multiple attempts'}
            
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