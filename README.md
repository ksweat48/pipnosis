# Pipnosis AI Trading Platform

A sophisticated AI-powered forex trading platform built with React, TypeScript, and Supabase. Features real-time market analysis, automated trading strategies, and advanced technical indicators.

## Features

- **Real-Time Market Analysis**: Live candlestick charts with multiple timeframes
- **AI Trading Engine**: Advanced AI-driven market predictions and trading signals
- **Auto Trading**: Automated trading with configurable risk management
- **Technical Indicators**: Comprehensive suite including EMA, RSI, MACD, Bollinger Bands, and custom indicators
- **Strategy Framework**: Multiple trading strategies including FX Flow Scalper
- **Risk Management**: Built-in risk validation and position management
- **Historical Analysis**: Backfill and analyze historical market data
- **MetaAPI Integration**: Connect to MT5 accounts for live trading

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **UI**: Tailwind CSS, Lucide Icons
- **Charts**: Lightweight Charts
- **Backend**: Supabase (PostgreSQL + Real-time subscriptions)
- **Trading API**: MetaAPI Cloud SDK
- **Deployment**: Netlify

## Project Structure

```
├── src/
│   ├── components/       # React components
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # Core utilities and helpers
│   ├── pages/           # Page components
│   ├── services/        # Business logic and API integrations
│   ├── strategies/      # Trading strategy implementations
│   └── types/           # TypeScript type definitions
├── supabase/
│   └── migrations/      # Database migrations
├── netlify/
│   └── functions/       # Serverless functions
├── docs/                # Documentation
│   ├── setup/          # Setup and configuration guides
│   ├── guides/         # User guides and how-tos
│   ├── implementations/ # Feature implementation docs
│   └── fixes/          # Bug fixes and troubleshooting
└── public/             # Static assets
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Supabase account
- MetaAPI account (for live trading)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables (see `.env.example`):
   ```bash
   cp .env.example .env
   ```

4. Configure your Supabase and MetaAPI credentials in `.env`

5. Run the development server:
   ```bash
   npm run dev
   ```

## Documentation

Comprehensive documentation is available in the `docs/` directory:

- **Setup Guides**: [docs/setup/](docs/setup/)
  - [Database Setup](docs/setup/DATABASE_SETUP.md)
  - [MetaAPI Setup](docs/setup/METAAPI_SETUP.md)
  - [Netlify Deployment](docs/setup/NETLIFY_CONFIGURATION_GUIDE.md)
  - [Production Database Setup](docs/setup/PRODUCTION_DATABASE_SETUP.md)

- **User Guides**: [docs/guides/](docs/guides/)
  - [Historical Candles Guide](docs/guides/HISTORICAL_CANDLES_GUIDE.md)
  - [AI Analysis Quick Start](docs/guides/AI_ANALYSIS_QUICK_START.md)
  - [Backfill Usage Guide](docs/guides/BACKFILL_USAGE_GUIDE.md)

- **Implementation Details**: [docs/implementations/](docs/implementations/)
  - [AI Trading Brain](docs/implementations/AI_TRADING_BRAIN_IMPLEMENTATION.md)
  - [FX Flow Scalper V2](docs/implementations/FX_FLOW_SCALPER_V2_IMPLEMENTATION.md)
  - [Auto Trading Enhancements](docs/implementations/AUTO_TRADING_ENHANCEMENTS_SUMMARY.md)

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Database Setup

The application uses Supabase for data persistence. Run the consolidated migration to set up the database schema:

1. Navigate to your Supabase project
2. Go to SQL Editor
3. Run the migration file: `CONSOLIDATED_MIGRATION.sql`

For detailed instructions, see [docs/setup/DATABASE_SETUP.md](docs/setup/DATABASE_SETUP.md)

## Environment Variables

Required environment variables:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_METAAPI_TOKEN=your_metaapi_token
VITE_METAAPI_ACCOUNT_ID=your_account_id
VITE_METAAPI_REGION=your_region
```

See `.env.example` for complete list.

## Security

- Never commit `.env` files with real credentials
- All sensitive operations require authentication
- Row Level Security (RLS) enabled on all database tables
- API keys are validated server-side via Netlify functions

## Trading Disclaimer

This software is for educational and informational purposes only. Trading forex carries a high level of risk and may not be suitable for all investors. Past performance is not indicative of future results. Always conduct your own research and consult with a licensed financial advisor before making trading decisions.

## License

Private and confidential. All rights reserved.

## Support

For issues and questions, please refer to the troubleshooting guides in [docs/fixes/](docs/fixes/).
