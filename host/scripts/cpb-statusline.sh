#!/usr/bin/env bash
# Owner-Mac statusline wrapper — fan-out CC's statusline JSON to BOTH:
#   1) the buddy usage-bridge (extract rate_limits → ~/.claude/cpb-usage.json)
#   2) the existing claude-hud statusline (still renders the status bar)
#
# Friend's Windows has no claude-hud → it points statusLine straight at
# usage-bridge.mjs (bridge owns the bar). This wrapper is for the dev/owner Mac
# who already runs claude-hud and doesn't want it clobbered.
#
# settings.json:
#   { "statusLine": { "type": "command",
#       "command": "bash /ABS/PATH/host/scripts/cpb-statusline.sh" } }
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
input=$(cat)

# 1) buddy bridge — write cpb-usage.json (discard its one-line output)
printf '%s' "$input" | node "${SCRIPT_DIR}/../src/usage-bridge.mjs" >/dev/null 2>&1 || true

# 2) upstream claude-hud — render the actual status bar (best-effort).
#    Same plugin-dir discovery claude-hud's own command uses (newest version).
plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null \
  | awk -F/ '{ print $(NF-1) "\t" $0 }' \
  | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-)

if [[ -n "${plugin_dir}" && -f "${plugin_dir}dist/index.js" ]]; then
  exec node "${plugin_dir}dist/index.js" <<<"$input"
fi

# claude-hud not found → fall back to the bridge's own one-liner.
printf '%s' "$input" | node "${SCRIPT_DIR}/../src/usage-bridge.mjs"
