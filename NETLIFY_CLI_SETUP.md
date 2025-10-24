# Netlify CLI Setup Guide

## Installation Complete ✓

The Netlify CLI has been successfully installed and is ready to use.

## Quick Start

### Using the Helper Script (Easiest)

```bash
./netlify-cli.sh [command]
```

Examples:
```bash
./netlify-cli.sh status
./netlify-cli.sh login
./netlify-cli.sh link
./netlify-cli.sh deploy
```

### Using Full Path

```bash
/tmp/.npm-global/bin/netlify [command]
```

## Authentication Required

Before you can use the CLI, you need to authenticate with Netlify.

### Option 1: Interactive Login (Opens Browser)

```bash
./netlify-cli.sh login
```

This will open a browser window where you can authorize the CLI.

### Option 2: Token-Based Login (Recommended for CI/CD)

1. Get your personal access token from: https://app.netlify.com/user/applications
2. Run:

```bash
./netlify-cli.sh login --token YOUR_ACCESS_TOKEN
```

## Linking Your Project

After authentication, link this project to your Netlify site:

### Option 1: Interactive (Choose from list)

```bash
./netlify-cli.sh link
```

### Option 2: Direct Link with Site ID

```bash
./netlify-cli.sh link --id YOUR_SITE_ID
```

### Option 3: Link with Site Name

```bash
./netlify-cli.sh link --name YOUR_SITE_NAME
```

## Common Commands

### Check Status
```bash
./netlify-cli.sh status
```

### Local Development
```bash
./netlify-cli.sh dev
```
This starts a local dev server with Netlify Functions support.

### Deploy to Production
```bash
./netlify-cli.sh deploy --prod
```

### Deploy for Preview
```bash
./netlify-cli.sh deploy
```

### Test Functions Locally
```bash
./netlify-cli.sh functions:list
./netlify-cli.sh functions:invoke function-name
```

### Environment Variables

#### List all environment variables
```bash
./netlify-cli.sh env:list
```

#### Set environment variable
```bash
./netlify-cli.sh env:set VARIABLE_NAME "value"
```

#### Get specific variable
```bash
./netlify-cli.sh env:get VARIABLE_NAME
```

#### Import from .env file
```bash
./netlify-cli.sh env:import .env
```

### Required Environment Variables

Set these in Netlify (either via Dashboard or CLI):

```bash
./netlify-cli.sh env:set VITE_SUPABASE_URL "your_value"
./netlify-cli.sh env:set VITE_SUPABASE_ANON_KEY "your_value"
./netlify-cli.sh env:set SUPABASE_SERVICE_ROLE_KEY "your_value"
./netlify-cli.sh env:set VITE_METAAPI_ACCOUNT_ID "your_value"
./netlify-cli.sh env:set VITE_METAAPI_REGION "new-york"
./netlify-cli.sh env:set METAAPI_ADMIN_TOKEN "your_value"
./netlify-cli.sh env:set ADMIN_REFRESH_KEY "your_value"
```

## Site Management

### Open Netlify Dashboard
```bash
./netlify-cli.sh open
```

### Open Admin Interface
```bash
./netlify-cli.sh open:admin
```

### Open Site URL
```bash
./netlify-cli.sh open:site
```

### View Logs
```bash
./netlify-cli.sh logs
```

### View Build Logs
```bash
./netlify-cli.sh logs:function function-name
```

## Build & Deploy

### Build Locally
```bash
./netlify-cli.sh build
```

### Deploy Production
```bash
./netlify-cli.sh deploy --prod --message "Production deployment"
```

### Deploy with Build
```bash
./netlify-cli.sh deploy --prod --build
```

## Quick Deploy Alternative

You can also deploy using the build hook (no authentication required):

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

## Troubleshooting

### Command Not Found

If you get "command not found", use the full path:
```bash
/tmp/.npm-global/bin/netlify [command]
```

Or use the helper script:
```bash
./netlify-cli.sh [command]
```

### Not Authenticated

Run the login command:
```bash
./netlify-cli.sh login
```

### Project Not Linked

Run the link command:
```bash
./netlify-cli.sh link
```

## Next Steps

1. **Authenticate**: Run `./netlify-cli.sh login`
2. **Link Project**: Run `./netlify-cli.sh link`
3. **Set Environment Variables**: Use `./netlify-cli.sh env:set` or the dashboard
4. **Test Locally**: Run `./netlify-cli.sh dev`
5. **Deploy**: Run `./netlify-cli.sh deploy --prod`

## Additional Resources

- Netlify CLI Documentation: https://docs.netlify.com/cli/get-started/
- Netlify Functions: https://docs.netlify.com/functions/overview/
- Environment Variables: https://docs.netlify.com/environment-variables/overview/
