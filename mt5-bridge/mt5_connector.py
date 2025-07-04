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