#!/bin/bash
# Netlify CLI Helper Script
# Usage: ./netlify-cli.sh [command] [args...]
# Example: ./netlify-cli.sh status

/tmp/.npm-global/bin/netlify "$@"
