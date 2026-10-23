#!/usr/bin/env bash
# One-time setup on the operator's PC: the live checkout and the user units.
# Safe to re-run; it refreshes the units and restarts the app. Publishing the
# port (Tailscale Funnel) is a separate, manual step: see CLAUDE.md.
set -euo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
live="$HOME/pulso-live"
units="$HOME/.config/systemd/user"

git -C "$repo" fetch --quiet origin main
if [ ! -e "$live" ]; then
  git -C "$repo" worktree add --detach "$live" origin/main
fi
(cd "$live" && bun install --frozen-lockfile --production)

# Copied, not linked: a pull must not change a unit behind systemd's back.
mkdir -p "$units"
cp "$live"/deploy/pulso.service "$live"/deploy/pulso-update.service "$live"/deploy/pulso-update.timer "$units"/
systemctl --user daemon-reload
systemctl --user enable --now pulso-update.timer
systemctl --user enable pulso.service
systemctl --user restart pulso.service
