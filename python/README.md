# Pipnosis MT5 Connector

A secure Python bridge that connects Pipnosis AI with MetaTrader 5 for automated forex trading.

## Features

- **Secure Authentication**: Local credential encryption, no cloud transmission
- **Real-time Data**: Live OHLCV data retrieval and market analysis
- **Trade Execution**: Automated buy/sell orders with SL/TP management
- **Account Monitoring**: Real-time balance, equity, and position tracking
- **AI Integration**: Seamless communication with Pipnosis backend
- **Auto-startup**: Runs automatically on Windows startup

## Installation

### Method 1: Download Installer (Recommended)
1. Download `PipnosisConnectorSetup.exe` from the Pipnosis dashboard
2. Run the installer as Administrator
3. Follow the setup wizard (default settings recommended)
4. The connector will start automatically after installation

### Method 2: Manual Installation
1. Ensure Python 3.8+ is installed
2. Install requirements:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the connector:
   ```bash
   python mt5_connector.py
   ```

## Configuration

### First-time Setup
1. Open the Pipnosis web interface
2. Click the "Connect MT5" button in the header
3. Enter your MT5 credentials:
   - Login (account number)
   - Password
   - Broker server name
   - Account type (Demo/Live)
4. Download and install the Pipnosis Connector
5. Test the connection

### Supported Brokers
- MetaQuotes Demo
- IC Markets
- FTMO
- Pepperstone
- XM
- Custom servers

## Security

### Local Security
- All credentials encrypted using Fernet (AES 128)
- Encryption keys stored locally only
- No sensitive data transmitted to cloud
- Secure HTTPS communication

### Data Transmission
- Only trade metadata sent to Pipnosis
- Account balance and equity (no credentials)
- Trade execution results
- Position status updates

## Usage

### Automatic Operation
Once connected, the connector:
1. Listens for AI trade commands
2. Executes orders via MT5 API
3. Sends trade results back to Pipnosis
4. Provides real-time account updates
5. Logs all activities for transparency

### Manual Control
- View logs: `pipnosis_connector.log`
- Stop connector: Close the application
- Restart: Launch from Start Menu or Desktop

## API Integration

### Trade Execution Flow
```
Pipnosis AI → REST API → Python Connector → MT5 Terminal → Broker
```

### Supported Order Types
- Market Buy/Sell orders
- Stop Loss management
- Take Profit management
- Position modifications
- Partial closures
- Trailing stops

### Data Synchronization
- Real-time price feeds
- Account balance updates
- Position status changes
- Trade execution confirmations
- AI decision logging

## Troubleshooting

### Common Issues

**Connection Failed**
- Ensure MT5 terminal is running
- Check credentials are correct
- Verify broker server name
- Check internet connection

**Trade Execution Failed**
- Verify sufficient margin
- Check symbol availability
- Ensure market is open
- Review MT5 terminal logs

**Connector Not Starting**
- Run as Administrator
- Check Windows Firewall settings
- Verify Python installation
- Review error logs

### Log Files
- Main log: `pipnosis_connector.log`
- Error details: Check Windows Event Viewer
- MT5 logs: Available in MT5 terminal

## Support

For technical support:
- Email: support@pipnosis.com
- Documentation: https://docs.pipnosis.com
- Discord: https://discord.gg/pipnosis

## Version History

### v2.1.0 (Current)
- Enhanced security with local encryption
- Improved error handling and logging
- Auto-startup functionality
- Better broker compatibility
- Real-time AI decision sync

### v2.0.0
- Complete rewrite with official MT5 API
- Secure credential management
- REST API integration
- Windows installer support

### v1.0.0
- Initial release
- Basic MT5 connection
- Simple trade execution