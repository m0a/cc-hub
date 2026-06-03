#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "🏗️  Building CC Hub..."

# Build frontend
echo "📦 Building frontend..."
cd frontend
bun run build
cd ..

# Generate embedded static assets
echo "📄 Generating embedded assets..."
bun run scripts/generate-static-assets.ts

# Build backend binary with embedded assets
echo "🔧 Building backend binary (with embedded assets)..."
cd backend
# `cchub tui` のため ink/react を同梱する。ink は DEV 時のみ react-devtools-core を
# 動的ロードするが、--compile はバンドル時に解決を要求するため react-devtools-core を
# 依存に入れてある（tui/package.json）。通常実行（DEV 未設定）では読み込まれない。
bun build src/index.ts --compile --outfile ../dist/cchub
cd ..

# Clean up generated file
rm -f backend/src/static-assets.ts

echo ""
echo "✅ Build complete!"
echo ""
echo "To run:"
echo "  ./dist/cchub"
echo ""
echo "Files:"
ls -lh dist/
