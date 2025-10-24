#!/bin/bash

# Netlify Environment Variables Setup Script
# This script sets up all required environment variables for live MetaAPI integration

echo "🔧 Setting up Netlify Environment Variables..."
echo ""

# Check if netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo "❌ Netlify CLI not found. Installing..."
    npm install -g netlify-cli
fi

# Login to Netlify
echo "🔑 Logging into Netlify..."
netlify login

# Link to site
echo "🔗 Linking to Netlify site..."
netlify link

echo ""
echo "📝 Setting environment variables..."
echo ""

# Load from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "❌ .env file not found. Please ensure .env exists with required variables."
    exit 1
fi

# Set MetaAPI variables
echo "Setting METAAPI_ADMIN_TOKEN..."
netlify env:set METAAPI_ADMIN_TOKEN "$METAAPI_ADMIN_TOKEN"

echo "Setting METAAPI_ACCOUNT_ID..."
netlify env:set METAAPI_ACCOUNT_ID "$VITE_METAAPI_ACCOUNT_ID"
netlify env:set VITE_METAAPI_ACCOUNT_ID "$VITE_METAAPI_ACCOUNT_ID"

echo "Setting METAAPI_REGION..."
netlify env:set METAAPI_REGION "$VITE_METAAPI_REGION"
netlify env:set VITE_METAAPI_REGION "$VITE_METAAPI_REGION"

# Set Supabase variables
echo "Setting SUPABASE_URL..."
netlify env:set SUPABASE_URL "$VITE_SUPABASE_URL"
netlify env:set VITE_SUPABASE_URL "$VITE_SUPABASE_URL"

echo "Setting SUPABASE_SERVICE_ROLE_KEY..."
netlify env:set SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
netlify env:set SUPABASE_SERVICE_ROLE "$SUPABASE_SERVICE_ROLE_KEY"

echo "Setting VITE_SUPABASE_ANON_KEY..."
netlify env:set VITE_SUPABASE_ANON_KEY "$VITE_SUPABASE_ANON_KEY"

echo ""
echo "✅ All environment variables have been set!"
echo ""
echo "🚀 Triggering new deployment..."
echo ""

# Trigger deployment using the build hook
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca

echo ""
echo "✅ Deployment triggered!"
echo ""
echo "Next steps:"
echo "1. Wait for deployment to complete (check Netlify dashboard)"
echo "2. Visit your site at https://pipnosis.com"
echo "3. Check browser console for: '✅ Live MetaAPI connection established'"
echo "4. Verify real-time data is streaming"
echo ""
