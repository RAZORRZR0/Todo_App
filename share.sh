#!/bin/bash

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "Cloudflared not found. Installing via Homebrew..."
    
    # Check if Homebrew is installed
    if ! command -v brew &> /dev/null; then
        echo "Homebrew not found. Please install Homebrew first: https://brew.sh/"
        exit 1
    fi
    
    brew install cloudflared
else
    echo "Cloudflared is already installed."
fi

# Run the tunnel exposing port 3000
echo "Starting Cloudflare Tunnel for localhost:3000..."
cloudflared tunnel --url http://localhost:3000
