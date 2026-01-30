#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "🏗️  Building CC Hub..."

# Build frontend
echo "📦 Building frontend..."
cd frontend
bun run build
cd ..

# Build backend binary
echo "🔧 Building backend binary..."
cd backend
bun build src/index.ts --compile --outfile ../dist/cchub
cd ..

# Copy frontend dist to output
echo "📁 Copying static files..."
mkdir -p dist/static
cp -r frontend/dist/* dist/static/

echo ""
echo "✅ Build complete!"
echo ""
echo "To run:"
echo "  cd dist && STATIC_ROOT=./static ./cchub"
echo ""
echo "Files:"
ls -lh dist/
