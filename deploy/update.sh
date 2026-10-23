#!/usr/bin/env bash
# Moves the live checkout to origin/main and restarts the app when main moved.
# Wrapped in a function so bash has parsed it all before the checkout below
# can replace this very file.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."
  git fetch --quiet origin main
  local target
  target=$(git rev-parse origin/main)
  if [ "$(git rev-parse HEAD)" = "$target" ]; then
    return 0
  fi
  git checkout --quiet --detach "$target"
  bun install --frozen-lockfile --production
  systemctl --user restart pulso.service
  echo "deployed $target"
}

main "$@"
