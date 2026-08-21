#!/usr/bin/env bash
set -euo pipefail

# Build standalone binaries for all supported platforms.
# Output: dist/forkhub-{platform} + SHA256SUMS

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TARGETS=(
  "bun-linux-x64"
  "bun-linux-arm64"
  "bun-darwin-x64"
  "bun-darwin-arm64"
)

rm -rf dist
mkdir -p dist

for target in "${TARGETS[@]}"; do
  outfile="dist/forkhub-${target#bun-}"
  echo "→ Building $target → $outfile"
  bun build --compile --target="$target" --minify --outfile="$outfile" ./src/cli.ts
done

echo ""
echo "→ Computing SHA256SUMS"
(cd dist && shasum -a 256 forkhub-* > SHA256SUMS)
cat dist/SHA256SUMS

echo ""
echo "✓ Built v$VERSION"
