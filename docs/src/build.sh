#!/usr/bin/env bash
# `curl -fsSL https://cf-page.mdressler.dev/build.sh | bash` - Downloads and installs Deno, then runs a build script
set -euo pipefail

# Set install and cache directories to directory cloudflare caches 
export DENO_INSTALL=".cache/deno"
export DENO_DIR=".cache/deno_dir"
export DENO_BIN="$DENO_INSTALL/bin/deno"

# Install Deno if not present
if [ ! -x $DENO_BIN ]; then
  curl -fsSL https://deno.land/install.sh | sh -s -- -y --no-modify-path
fi

# Run build script
$DENO_BIN task build
