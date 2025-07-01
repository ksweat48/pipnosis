"""
Pipnosis MT5 Mock Connector
Simulates the MT5 connector for development and testing
"""

import json
import time
import logging
import asyncio
import websockets
import random
from datetime import datetime
from typing import Dict, List, Optional, Any
import threading

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('mock_mt5_bridge.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class MockMT5Connector:
    def __init__(self):
        self.connected = False
        self.websocket_clients = set()
        self.update_interval = 1.0  # Update every second
        self.running = False
        
        # Mock account data
        self.account_info = {
            "login": 12345678,
            "server": "Demo-Server",
            "name": "Demo Account",
            "company": "Demo Broker",
            "currency": "USD",
            "balance": 10000.0,
            "equity": 10000.0,
            "margin": 0.0,
            "free_margin": 10000.0,
            "margin_level": 0.0,
            "profit": 0.0,
            "credit": 0.0,
            "leverage": 100,
            "trade_allowed": True,
            "trade_expert": True,
            "last_update": datetime.now().isoformat()
        }
        
        # Mock positions
        self.positions = []
        
        # Mock symbol data
        self.symbols = {
            "EURUSD": {"bid": 1.1425, "ask": 1.1427, "point": 0.00001, "digits": 5},
            "GBPUSD": {"bid": 1.2735, "ask": 1.2738, "point": 0.00001, "digits": 5},
            "USDJPY": {"bid": 149.85, "ask": 149.88, "point": 0.001, "digits": 3},
            "USDCHF": {"bid": 0.8945, "ask": 0.8948, "point": 0.00001, "digits": 5},
            "AUDUSD": {"bid": 0.6785, "ask": 0.6788, "point": 0.00001, "digits": 5},
            "USDCAD": {"bid": 1.3625, "ask": 1.3628, "point": 0.00001, "digits": 5},
            "NZDUSD": {"bid": 0.6245, "ask": 0.6248, "point": 0.00001, "digits": 5},
            "EURJPY": {"bid": 171.25, "ask": 171.28, "point": 0.001, "digits": 3},
            "GBPJPY": {"bid": 190.85, "ask": 190.88, "point": 0.001, "digits": 3},
            "XAUUSD": {"bid": 2045.50, "ask": 2046.00, "point": 0.01, "digits": 2}
        }
        
        logger.info("Mock MT5 Connector initialized")
    
    def initialize_mt5(self) -> bool:
        """Simulate MT5 initialization"""
        logger.info("Initializing mock MT5 connection...")
        self.connected = True
        logger.info("✅ Mock MT5 connected successfully!")
        return True
    
    def get_account_info(self) -> Dict:
        """Get mock account information"""
        # Update equity with current P&L
        total_profit = sum(pos.get("profit", 0) for pos in self.positions)
        self.account_info["equity"] = self.account_info["balance"] + total_profit
        self.account_info["free_margin"] = self.account_info["equity"] - self.account_info["margin"]
        self.account_info["last_update"] = datetime.now().isoformat()
        
        return self.account_info
    
    def get_positions(self) -> List[Dict]:
        """Get mock positions"""
        # Update position prices and profits
        for pos in self.positions:
            symbol = pos["symbol"]
            if symbol in self.symbols:
                # Update current price
                if pos["type"] == "buy":
                    pos["current_price"] = self.symbols[symbol]["bid"]
                    # Calculate profit (simplified)
                    pos["profit"] = (pos["current_price"] - pos["open_price"]) * pos["volume"] * 100000
                else:  # sell
                    pos["current_price"] = self.symbols[symbol]["ask"]
                    # Calculate profit (simplified)
                    pos["profit"] = (pos["open_price"] - pos["current_price"]) * pos["volume"] * 100000
            
            # Update time
            pos["time_open"] = datetime.now().isoformat()
        
        return self.positions
    
    def get_symbol_info(self, symbol: str) -> Optional[Dict]:
        """Get mock symbol information"""
        if symbol not in self.symbols:
            return None
        
        # Add small random price movement
        is_jpy = "JPY" in symbol
        is_gold = symbol == "XAUUSD"
        
        point = self.symbols[symbol]["point"]
        movement = random.randint(-10, 10) * point
        
        self.symbols[symbol]["bid"] += movement
        self.symbols[symbol]["ask"] = self.symbols[symbol]["bid"] + (0.03 if is_gold else 0.0003 if is_jpy else 0.00003)
        
        return {
            "symbol": symbol,
            "bid": self.symbols[symbol]["bid"],
            "ask": self.symbols[symbol]["ask"],
            "spread": self.symbols[symbol]["ask"] - self.symbols[symbol]["bid"],
            "volume": random.randint(1, 100),
            "time": datetime.now().isoformat(),
            "digits": self.symbols[symbol]["digits"],
            "point": self.symbols[symbol]["point"],
            "trade_allowed": True
        }
    
    def place_order(self, symbol: str, order_type: str, volume: float, 
                   price: float = None, sl: float = None, tp: float = None, 
                   comment: str = "Pipnosis AI Trade") -> Dict:
        """Simulate placing a trading order"""
        logger.info(f"Placing mock order: {order_type} {volume} {symbol}")
        
        if symbol not in self.symbols:
            return {'success': False, 'error': f'Symbol {symbol} not found'}
        
        # Determine price
        if order_type.lower() == 'buy':
            price = price or self.symbols[symbol]["ask"]
        else:  # sell
            price = price or self.symbols[symbol]["bid"]
        
        # Generate a unique ticket number
        ticket = int(time.time() * 1000) % 1000000
        
        # Create a new position
        position = {
            "ticket": str(ticket),
            "symbol": symbol,
            "type": order_type.lower(),
            "volume": volume,
            "open_price": price,
            "current_price": price,
            "sl": sl or 0.0,
            "tp": tp or 0.0,
            "profit": 0.0,
            "swap": 0.0,
            "commission": -2.0,  # Small commission
            "comment": comment,
            "time_open": datetime.now().isoformat()
        }
        
        # Add to positions
        self.positions.append(position)
        
        # Update account margin (simplified calculation)
        self.account_info["margin"] += volume * 1000  # Simplified margin calculation
        
        logger.info(f"✅ Mock order placed successfully: {ticket}")
        return {
            'success': True,
            'ticket': ticket,
            'price': price,
            'volume': volume,
            'comment': comment
        }
    
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
        """Main loop to update and broadcast mock MT5 data"""
        logger.info("Starting mock data update loop...")
        
        while self.running:
            try:
                # Update symbol prices with small random movements
                for symbol in self.symbols:
                    is_jpy = "JPY" in symbol
                    is_gold = symbol == "XAUUSD"
                    
                    point = self.symbols[symbol]["point"]
                    movement = random.randint(-5, 5) * point
                    
                    self.symbols[symbol]["bid"] += movement
                    self.symbols[symbol]["ask"] = self.symbols[symbol]["bid"] + (0.03 if is_gold else 0.0003 if is_jpy else 0.00003)
                
                # Get fresh data
                account_info = self.get_account_info()
                positions = self.get_positions()
                
                # Prepare data for broadcast
                data = {
                    'type': 'account_update',
                    'timestamp': datetime.now().isoformat(),
                    'account': account_info,
                    'positions': positions,
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
        logger.info(f"New WebSocket client connected")
        self.websocket_clients.add(websocket)
        
        try:
            # Send initial data
            initial_data = {
                'type': 'initial_data',
                'timestamp': datetime.now().isoformat(),
                'account': self.get_account_info(),
                'positions': self.get_positions(),
                'connection_status': 'connected'
            }
            await websocket.send(json.dumps(initial_data))
            
            # Handle incoming messages
            async for message in websocket:
                try:
                    data = json.loads(message)
                    response = await self.handle_client_message(websocket, data)
                    if response:
                        await websocket.send(json.dumps(response))
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON from client: {message}")
                except Exception as e:
                    logger.error(f"Error handling client message: {e}")
                    
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
                    'connection_status': 'connected'
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
        """Start the WebSocket server"""
        logger.info(f"Starting WebSocket server on {host}:{port}")
        
        server = await websockets.serve(
            self.handle_websocket_client,
            host,
            port,
            ping_interval=30,
            ping_timeout=10
        )
        
        logger.info(f"WebSocket server started on ws://{host}:{port}")
        return server
    
    def start(self, host='localhost', port=8765):
        """Start the mock MT5 connector"""
        logger.info("Starting Pipnosis Mock MT5 Connector...")
        
        # Initialize mock MT5
        if not self.initialize_mt5():
            logger.error("Failed to initialize mock MT5 - exiting")
            return False
        
        self.running = True
        
        # Start the async event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # Start WebSocket server and data update loop
            server = loop.run_until_complete(self.start_websocket_server(host, port))
            update_task = loop.create_task(self.data_update_loop())
            
            logger.info("Pipnosis Mock MT5 Connector is running!")
            logger.info("WebSocket clients can connect to receive mock MT5 data")
            logger.info("Press Ctrl+C to stop")
            
            # Run forever
            loop.run_forever()
            
        except KeyboardInterrupt:
            logger.info("Shutting down...")
        except Exception as e:
            logger.error(f"Server error: {e}")
        finally:
            self.running = False
            loop.close()
            logger.info("MT5 Connector stopped")
    
    def stop(self):
        """Stop the connector"""
        self.running = False

if __name__ == "__main__":
    connector = MockMT5Connector()
    connector.start(host='localhost', port=8765)