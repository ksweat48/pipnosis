#!/bin/bash

echo "Pipnosis MT5 Bridge - Connection Test"
echo "=================================="
echo
echo "This script tests if your MT5 bridge is accessible from the internet."
echo

PORT=8765
if [ ! -z "$1" ]; then
    PORT=$1
fi

echo "Testing connection to your MT5 bridge on port $PORT..."
echo

# Get public IP
echo "Fetching your public IP address..."
PUBLIC_IP=$(curl -s https://api.ipify.org || echo "Could not determine public IP")

echo "Your public IP: $PUBLIC_IP"
echo

echo "Testing local connection (localhost:$PORT)..."
nc -zv localhost $PORT 2>&1 || echo "FAILED: Could not connect locally"

echo
echo "Testing connection via public IP ($PUBLIC_IP:$PORT)..."
nc -zv $PUBLIC_IP $PORT 2>&1 || echo "FAILED: Could not connect via public IP"

echo
echo "If the public IP test failed but the local test succeeded:"
echo "1. Your router may not support hairpinning/NAT loopback"
echo "2. Your ISP might be blocking incoming connections"
echo "3. Your port forwarding might not be set up correctly"
echo
echo "Try testing from a different network (e.g., mobile data)"
echo "or use an online port checking service."
echo

read -p "Press Enter to continue..."