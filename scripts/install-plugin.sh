#!/usr/bin/env bash
set -euo pipefail

# Install lsp-mcp-server as a Claude Code plugin
# Usage: bash scripts/install-plugin.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugin"

CLAUDE_DIR="$HOME/.claude"
MARKETPLACE_DIR="$CLAUDE_DIR/plugins/marketplaces/local"
CACHE_DIR="$CLAUDE_DIR/plugins/cache/local/lsp-mcp-server/0.1.0"
REGISTRY="$CLAUDE_DIR/plugins/installed_plugins.json"
KNOWN_MARKETPLACES="$CLAUDE_DIR/plugins/known_marketplaces.json"
SETTINGS="$CLAUDE_DIR/settings.json"

# Verify plugin exists
if [ ! -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ]; then
  echo "Error: plugin directory not found at $PLUGIN_DIR"
  exit 1
fi

echo "Installing lsp-mcp-server plugin..."

# 1. Create local marketplace with manifest
mkdir -p "$MARKETPLACE_DIR/.claude-plugin"
ln -sfn "$PLUGIN_DIR" "$MARKETPLACE_DIR/lsp-mcp-server"

cat > "$MARKETPLACE_DIR/.claude-plugin/marketplace.json" << JSON
{
  "\$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "local",
  "owner": { "name": "Local Plugins" },
  "plugins": [
    {
      "name": "lsp-mcp-server",
      "description": "Type-aware code navigation and fast file search via language servers",
      "category": "development",
      "source": "./lsp-mcp-server"
    }
  ]
}
JSON
echo "  Created local marketplace"

# 2. Symlink plugin into cache
mkdir -p "$(dirname "$CACHE_DIR")"
ln -sfn "$PLUGIN_DIR" "$CACHE_DIR"
echo "  Linked plugin to cache"

# 3. Register marketplace in known_marketplaces.json
if [ ! -f "$KNOWN_MARKETPLACES" ]; then
  echo '{}' > "$KNOWN_MARKETPLACES"
fi
python3 -c "
import json
from datetime import datetime, timezone
with open('$KNOWN_MARKETPLACES') as f:
    data = json.load(f)
data['local'] = {
    'source': {'source': 'directory', 'path': '$MARKETPLACE_DIR'},
    'installLocation': '$MARKETPLACE_DIR',
    'lastUpdated': datetime.now(timezone.utc).isoformat()
}
with open('$KNOWN_MARKETPLACES', 'w') as f:
    json.dump(data, f, indent=4)
"
echo "  Registered marketplace"

# 4. Register plugin in installed_plugins.json
if [ ! -f "$REGISTRY" ]; then
  echo '{"version": 2, "plugins": {}}' > "$REGISTRY"
fi
python3 -c "
import json
from datetime import datetime, timezone
with open('$REGISTRY') as f:
    data = json.load(f)
now = datetime.now(timezone.utc).isoformat()
data['plugins']['lsp-mcp-server@local'] = [{
    'scope': 'user',
    'installPath': '$CACHE_DIR',
    'version': '0.1.0',
    'installedAt': now,
    'lastUpdated': now,
    'gitCommitSha': ''
}]
with open('$REGISTRY', 'w') as f:
    json.dump(data, f, indent=4)
"
echo "  Registered plugin"

# 5. Enable in settings.json
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi
python3 -c "
import json
with open('$SETTINGS') as f:
    data = json.load(f)
data.setdefault('enabledPlugins', {})['lsp-mcp-server@local'] = True
with open('$SETTINGS', 'w') as f:
    json.dump(data, f, indent=2)
"
echo "  Enabled plugin"

echo ""
echo "Done! Restart Claude Code or run /reload-plugins to activate."
echo ""
echo "To uninstall: bash $SCRIPT_DIR/uninstall-plugin.sh"
