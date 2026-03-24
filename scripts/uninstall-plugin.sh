#!/usr/bin/env bash
set -euo pipefail

# Uninstall lsp-mcp-server Claude Code plugin
# Usage: bash scripts/uninstall-plugin.sh

CLAUDE_DIR="$HOME/.claude"
REGISTRY="$CLAUDE_DIR/plugins/installed_plugins.json"
SETTINGS="$CLAUDE_DIR/settings.json"
CACHE_DIR="$CLAUDE_DIR/plugins/cache/local/lsp-mcp-server"

echo "Uninstalling lsp-mcp-server plugin..."

# Remove from installed_plugins.json
if [ -f "$REGISTRY" ]; then
  python3 -c "
import json
with open('$REGISTRY') as f:
    data = json.load(f)
data['plugins'].pop('lsp-mcp-server@local', None)
with open('$REGISTRY', 'w') as f:
    json.dump(data, f, indent=4)
"
  echo "  Removed from plugin registry"
fi

# Remove from settings.json
if [ -f "$SETTINGS" ]; then
  python3 -c "
import json
with open('$SETTINGS') as f:
    data = json.load(f)
data.get('enabledPlugins', {}).pop('lsp-mcp-server@local', None)
with open('$SETTINGS', 'w') as f:
    json.dump(data, f, indent=2)
"
  echo "  Removed from settings"
fi

# Remove cache symlink
if [ -e "$CACHE_DIR" ]; then
  rm -rf "$CACHE_DIR"
  echo "  Removed cache"
fi

echo ""
echo "Done! Restart Claude Code to apply."
