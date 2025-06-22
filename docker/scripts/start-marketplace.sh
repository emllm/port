#!/bin/sh
set -e

# PWA Marketplace startup script

echo "Starting PWA Marketplace..."
echo "Node version: $(node --version)"
echo "Environment: $NODE_ENV"
echo "Port: $PORT"
echo "Storage path: $STORAGE_PATH"

# Ensure storage directories exist
mkdir -p "$STORAGE_PATH"/{apps,data,cache,logs}

# Set proper permissions
chmod 755 "$STORAGE_PATH"
chmod 755 "$STORAGE_PATH"/{apps,data,cache,logs}

# Initialize configuration if not exists
    echo "Creating default configuration..."
    cat > "$CONFIG_PATH/marketplace-config.json" << 'EOF'
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "cors": {
      "enabled": true,
      "origins": ["*"]
    }
  },
  "storage": {
    "appsPath": "./storage/apps",
    "dataPath": "./storage/data",
    "cachePath": "./storage/cache"
  },
  "github": {
    "apiUrl": "https://api.github.com",
    "timeout": 10000,
    "rateLimitBuffer": 100
  },
  "security": {
    "sandbox": {
      "enabled": true,
      "isolateApps": true
    },
    "permissions": {
      "requireExplicitGrant": true,
      "auditLog": true
    }
  },
  "features": {
    "autoUpdate": true,
    "telemetry": false,
    "crashReporting": false
  }
}
EOF
fi

# Wait for dependencies (MCP Bridge, Resource Controller)
echo "Waiting for MCP Bridge..."
while ! curl -sf http://mcp-bridge:3001/health > /dev/null 2>&1; do
    echo "MCP Bridge not ready, waiting..."
    sleep 2
done

echo "Waiting for Resource Controller..."
while ! curl -sf http://resource-controller:3002/health > /dev/null 2>&1; do
    echo "Resource Controller not ready, waiting..."
    sleep 2
done

echo "Dependencies ready, starting marketplace..."

# Start the application
exec node server/index.js

    