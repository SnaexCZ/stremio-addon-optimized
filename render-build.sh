#!/usr/bin/env bash
# render-build.sh - Build script pro Render.com s Puppeteer support

set -o errexit

echo "🔧 Starting Render build for Puppeteer..."

# Install dependencies
npm install

# Ensure Chrome is properly installed
echo "🔍 Checking Chrome installation..."
which google-chrome-stable || echo "⚠️ Chrome not found in PATH"

# Test Chrome executable
/usr/bin/google-chrome-stable --version || echo "⚠️ Chrome test failed"

# Set cache directory for Puppeteer (pro jistotu)
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR

echo "✅ Render build completed"
