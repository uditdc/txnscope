#!/bin/bash
set -e

echo ""
echo "🚀 Setting up TxnScope development environment..."
echo ""

# Get the workspace directory
WORKSPACE_DIR="/workspaces/$(basename $(pwd))"
cd "$WORKSPACE_DIR"

# Install gateway dependencies
echo "📦 Installing TypeScript gateway dependencies..."
cd packages/gateway
npm install
cd "$WORKSPACE_DIR"

echo ""
echo "🦀 Verifying Rust installation..."
rustc --version
cargo --version

echo ""
echo "📗 Verifying Node.js installation..."
node --version
npm --version

echo ""
echo "🔴 Checking Redis connection..."
sleep 3
if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis is running"
else
    echo "⚠️  Redis not ready yet (this is normal, it may take a moment)"
fi

echo ""
echo "✅ Development environment ready!"
echo ""
echo "📝 Next steps:"
echo "  • Rust ingestor:     cd packages/ingestor && cargo run"
echo "  • TypeScript gateway: cd packages/gateway && npm run dev"
echo "  • Test Redis:         redis-cli ping"
echo ""
echo "🔧 Available tools:"
echo "  • cargo watch:        cargo install cargo-watch (already installed)"
echo "  • TypeScript watch:   npm run dev"
echo ""
