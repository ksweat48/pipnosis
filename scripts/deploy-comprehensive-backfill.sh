#!/bin/bash

# Deploy Comprehensive Backfill Edge Function
# This script deploys the comprehensive-backfill function to Supabase

echo "🚀 Deploying Comprehensive Backfill Edge Function"
echo "================================================"
echo ""

# Check if Supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. This edge function must be deployed via the Supabase dashboard."
    echo ""
    echo "📋 Manual Deployment Steps:"
    echo ""
    echo "1. Go to your Supabase Dashboard"
    echo "2. Navigate to Edge Functions"
    echo "3. Click 'New Function'"
    echo "4. Name it: comprehensive-backfill"
    echo "5. Copy the contents of: supabase/functions/comprehensive-backfill/index.ts"
    echo "6. Paste into the editor and deploy"
    echo ""
    echo "📁 Function Location:"
    echo "   $(pwd)/supabase/functions/comprehensive-backfill/index.ts"
    echo ""
    exit 1
fi

# If we have CLI, deploy
echo "📦 Deploying function..."
cd "$(dirname "$0")/.."

supabase functions deploy comprehensive-backfill

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "🎯 Function URL:"
    echo "   https://your-project.supabase.co/functions/v1/comprehensive-backfill"
    echo ""
    echo "📝 Test with:"
    echo "   node scripts/run-comprehensive-backfill.js"
    echo ""
else
    echo ""
    echo "❌ Deployment failed. Please check the error messages above."
    echo ""
    exit 1
fi
