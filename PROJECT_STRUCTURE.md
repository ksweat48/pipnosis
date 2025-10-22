# Project Structure Guide

This document explains the organization of the Pipnosis AI Trading Platform codebase and provides guidelines for maintaining a clean, scalable project structure.

## Directory Overview

```
pipnosis-ai-trading/
├── src/                          # Source code
│   ├── components/              # React components (UI)
│   ├── hooks/                   # Custom React hooks
│   ├── lib/                     # Core utilities and libraries
│   ├── pages/                   # Page-level components
│   ├── services/                # Business logic and integrations
│   ├── strategies/              # Trading strategy implementations
│   ├── types/                   # TypeScript type definitions
│   └── utils/                   # Utility functions
├── supabase/                    # Database related files
│   ├── migrations/              # Database migration files
│   └── scripts/                 # Database utility scripts
├── netlify/                     # Netlify serverless functions
│   └── functions/               # Edge functions for API routes
├── docs/                        # Project documentation
│   ├── setup/                   # Setup and configuration
│   ├── guides/                  # User guides
│   ├── implementations/         # Technical implementation docs
│   └── fixes/                   # Bug fixes and troubleshooting
├── public/                      # Static assets
├── scripts/                     # Build and utility scripts
└── [config files]               # Root configuration files
```

## Source Code (`src/`)

### Components (`src/components/`)

React UI components organized by functionality. Guidelines:

- Keep components focused and single-purpose
- Use functional components with hooks
- Place component-specific styles inline with Tailwind
- Name files with PascalCase matching the component name

Key components:
- `TradingDashboard.tsx` - Main trading interface
- `MarketChart.tsx` - Candlestick chart visualization
- `AITradingConsole.tsx` - AI trading controls
- `AutoTradingPanel.tsx` - Automated trading interface

### Hooks (`src/hooks/`)

Custom React hooks for shared stateful logic:

- `useAuth.ts` - Authentication state management
- `useAPI.ts` - API interaction patterns
- `useAITrading.ts` - AI trading operations
- `useAutoTradingStatus.ts` - Auto trading state

### Libraries (`src/lib/`)

Core utilities and shared functionality:

- `supabase.ts` - Supabase client configuration
- `indicators.ts` - Technical indicator calculations
- `aiMarketEngine.ts` - AI analysis engine
- `initialization-manager.ts` - App initialization

### Services (`src/services/`)

Business logic and external integrations:

- `metaapi.ts` - MetaAPI integration
- `ai-trading-engine.ts` - AI trading logic
- `market-data.ts` - Market data fetching
- `auto-trading-scanner.ts` - Automated scanning
- `fetchHistoricalCandles.ts` - Historical data

### Strategies (`src/strategies/`)

Trading strategy implementations organized by type:

```
strategies/
├── core/                        # Core strategy engines
│   ├── fxFlowScalperV2.ts
│   ├── shadowTradingEngine.ts
│   └── riskManagement.ts
├── indicators/                  # Custom indicators
│   ├── halfTrend.ts
│   ├── stochasticRSI.ts
│   └── linearRegression.ts
├── validators/                  # Strategy validators
│   ├── phase1Validator.ts
│   ├── phase2Validator.ts
│   └── phase3Validator.ts
├── services/                    # Strategy services
└── types/                       # Strategy type definitions
```

### Pages (`src/pages/`)

Top-level page components for routing:

- `AuthPage.tsx` - Login/signup
- `AdminDashboard.tsx` - Admin interface
- `ResetPasswordPage.tsx` - Password recovery

### Types (`src/types/`)

TypeScript type definitions and interfaces:

- `ai-analysis.ts` - AI analysis types
- Keep types close to their usage when possible
- Use types/ for shared cross-cutting types

## Database (`supabase/`)

### Migrations (`supabase/migrations/`)

Database schema changes. Follow these rules:

- One migration per logical change
- Use timestamp naming: `YYYYMMDD_HHMMSS_description.sql`
- Always include detailed comments explaining changes
- Never modify existing migrations (create new ones)
- Test migrations on dev before production

See [docs/setup/HOW_TO_APPLY_MIGRATION.md](docs/setup/HOW_TO_APPLY_MIGRATION.md) for details.

## Serverless Functions (`netlify/functions/`)

Netlify Edge Functions for backend operations:

- `analyze-market.ts` - Market analysis endpoint
- `refresh-candles.ts` - Data refresh operations
- `get-metaapi-token.js` - Secure token management
- `scheduled-refresh.ts` - Scheduled tasks

Functions provide:
- Secure API key handling
- Server-side processing
- Scheduled operations
- Webhook endpoints

## Documentation (`docs/`)

Organized documentation by purpose:

### Setup (`docs/setup/`)
Initial configuration and deployment guides:
- Database setup
- API configuration
- Deployment procedures

### Guides (`docs/guides/`)
User-facing documentation:
- How-to guides
- Feature usage
- Best practices

### Implementations (`docs/implementations/`)
Technical implementation details:
- Feature architecture
- Algorithm explanations
- Integration guides

### Fixes (`docs/fixes/`)
Troubleshooting and bug fixes:
- Common issues
- Resolution steps
- Testing procedures

## Configuration Files

Root-level configuration:

- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `vite.config.ts` - Vite build configuration
- `tailwind.config.js` - Tailwind CSS setup
- `eslint.config.js` - Linting rules
- `netlify.toml` - Netlify deployment config
- `.env.example` - Environment variable template

## File Naming Conventions

- **Components**: PascalCase (`TradingDashboard.tsx`)
- **Hooks**: camelCase with `use` prefix (`useAuth.ts`)
- **Services**: kebab-case (`market-data.ts`)
- **Types**: kebab-case (`ai-analysis.ts`)
- **Constants**: UPPER_SNAKE_CASE
- **Utilities**: camelCase (`formatPrice.ts`)

## Code Organization Best Practices

### Single Responsibility Principle
Each file should have one clear purpose. If a file grows beyond 300 lines, consider splitting it.

### Separation of Concerns
- **Components**: UI and user interaction only
- **Hooks**: Stateful logic without UI
- **Services**: Business logic and external APIs
- **Lib**: Pure utilities and helpers

### Import Organization
Order imports as:
1. External libraries (React, etc.)
2. Internal absolute imports
3. Relative imports
4. Types
5. Styles

### Avoid Circular Dependencies
If two modules need each other, create a third module they both depend on.

## Adding New Features

When adding a new feature:

1. **Plan the structure** - Determine which directories are affected
2. **Create types first** - Define interfaces in `src/types/`
3. **Implement services** - Add business logic in `src/services/`
4. **Create hooks** - Extract stateful logic to `src/hooks/`
5. **Build UI** - Create components in `src/components/`
6. **Add pages** - Create routes in `src/pages/` if needed
7. **Document** - Add guides in `docs/` if user-facing

## What NOT to Do

- ❌ Don't add executable files (.exe, .msi, etc.)
- ❌ Don't commit `.env` files with real credentials
- ❌ Don't put business logic in components
- ❌ Don't create files larger than 500 lines
- ❌ Don't add markdown docs to root directory
- ❌ Don't modify migrations after they're applied
- ❌ Don't skip RLS policies on database tables

## Maintenance

### Regular Cleanup Tasks
- Review and consolidate duplicate utilities
- Remove unused imports and dead code
- Update documentation when features change
- Organize growing directories into subdirectories
- Keep dependencies up to date

### Code Review Checklist
- Follows naming conventions
- Proper file location
- No sensitive data exposed
- Includes error handling
- Has appropriate type definitions
- Updates related documentation

## Getting Help

- Check existing code for patterns
- Review [docs/guides/](docs/guides/) for best practices
- See [docs/fixes/](docs/fixes/) for common issues
- Follow TypeScript errors - they help maintain structure

## Version Control

Files to always `.gitignore`:
- `.env` (except `.env.example`)
- `node_modules/`
- `dist/` and build outputs
- IDE-specific files
- OS-specific files (`.DS_Store`)
- Executable installers

Files to always commit:
- Source code (`src/`)
- Configuration files
- `.env.example` (no secrets)
- Documentation
- Database migrations

---

Maintaining this structure ensures the codebase remains navigable, maintainable, and scalable as the project grows.
