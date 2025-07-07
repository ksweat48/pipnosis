# Pipnosis Local Development Guide

This guide will help you set up and run the Pipnosis AI Trading System locally for development.

## Prerequisites

- **Python 3.8+** - For the MT5 bridge
- **Node.js 18+** - For the React frontend
- **MetaTrader 5** - Installed and running with an active account
- **Git** - For version control (optional)

## Step 1: Install Dependencies

### Python Dependencies

```bash
# Install Python dependencies for the MT5 bridge
pip install -r python/requirements.txt
```

### Node.js Dependencies

```bash
# Install Node.js dependencies for the frontend
npm install
```

## Step 2: Configure Environment

1. Create a `.env` file in the project root by copying `.env.example`:

```bash
cp .env.example .env
```

2. Update the `.env` file with your Supabase and OpenAI credentials:

```
# Frontend Environment Variables
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_OPENAI_API_KEY=your_openai_api_key_here
VITE_PIPNOSIS_API_URL=http://localhost:3001/api
VITE_MT5_BRIDGE_URL=http://localhost:8080
VITE_DEV_MODE=true

# Backend Environment Variables
PORT=3001
NODE_ENV=development

# Supabase (Backend)
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here
```

## Step 3: Start the MT5 Bridge

The MT5 bridge connects your MetaTrader 5 terminal to the Pipnosis application.

1. Make sure MetaTrader 5 is running and logged into an account
2. Open a terminal/command prompt
3. Run the bridge:

```bash
# Windows
python mt5_connector.py

# macOS/Linux
python3 mt5_connector.py
```

You should see output indicating the bridge is running and listening on port 8765.

## Step 4: Start the Development Server

1. Open a new terminal/command prompt (keep the bridge running in the first one)
2. Run the development server:

```bash
# Start just the frontend
npm run dev

# OR start both frontend and backend
npm run dev:full
```

## Step 5: Access the Application

1. Open your browser and navigate to: http://localhost:5173/
2. You should see the Pipnosis application running
3. Check the MT5 connection status in the header - it should turn green if connected properly

## Troubleshooting

### MT5 Bridge Issues

- **"Failed to initialize MT5"**: Make sure MetaTrader 5 is running and logged in
- **"Automated trading is disabled"**: Enable automated trading in MT5 (Tools > Options > Expert Advisors)
- **"Failed to select symbol"**: Run `python python/fix_mt5_symbol_selection.py` to fix
- **"Invalid comment argument"**: Run `node fix-mt5-comment-length.js` to fix the comment length issue

### Development Server Issues

- **"Cannot find module"**: Run `npm install` to ensure all dependencies are installed
- **"Port already in use"**: Kill the process using the port or change the port in `.env`
- **"Failed to connect to backend"**: Make sure the backend server is running (`npm run server`)

### Database Issues

- **"Supabase not configured"**: Check your `.env` file for correct Supabase credentials
- **"Table does not exist"**: Run the database migration in your Supabase dashboard

## Running with Helper Scripts

For convenience, you can use the provided helper scripts:

### Windows

```bash
# Run both MT5 bridge and development server
run-local-dev.bat
```

### macOS/Linux

```bash
# Make the script executable
chmod +x run-local-dev.sh

# Run both MT5 bridge and development server
./run-local-dev.sh
```

## Common Commands

```bash
# Start frontend development server
npm run dev

# Start backend server
npm run server

# Start both frontend and backend
npm run dev:full

# Build for production
npm run build

# Preview production build
npm run preview

# Run linter
npm run lint
```

## Project Structure

- `/src` - Frontend React application
- `/server` - Backend Express server
- `/python` - MT5 bridge and utilities
- `/public` - Static assets
- `/supabase` - Supabase migrations and configuration