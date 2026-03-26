#!/bin/bash
set -e

# === SSH setup ===
# If deploy key exists on volume, configure SSH to use it
if [ -f /data/.ssh/deploy_key ]; then
    mkdir -p /root/.ssh
    cat > /root/.ssh/config << 'SSHEOF'
Host github.com
    IdentityFile /data/.ssh/deploy_key
    StrictHostKeyChecking accept-new
SSHEOF
    chmod 600 /root/.ssh/config
    echo "[data-init] SSH configured (deploy key found)"
else
    echo "[data-init] No deploy key at /data/.ssh/deploy_key — git push will not work"
    echo "[data-init] To enable git backup:"
    echo "  1. Talk to the agent and ask it to set up GitHub backup"
    echo "  2. The agent will generate SSH keys and give you the public key"
    echo "  3. Add the public key as a deploy key (with write access) to your GitHub repo"
fi

# === Git identity ===
git config --global user.email "bot@openclaw.local"
git config --global user.name "OpenClaw"

# === Git repo init ===
# If no git repo exists on volume, initialize one
if [ ! -d /data/.git ]; then
    echo "[data-init] No git repo found. Initializing..."
    cd /data
    git init
    git branch -m main

    # Create default .gitignore if it doesn't exist
    if [ ! -f /data/.gitignore ]; then
        cat > /data/.gitignore << 'GIEOF'
# OpenClaw secrets & state
.openclaw/openclaw.json
.openclaw/openclaw.json.bak*
.openclaw/.env
.openclaw/credentials/
.openclaw/agents/*/agent/auth-profiles.json
.openclaw/identity/
.openclaw/devices/
.openclaw/browser/
.openclaw/media/
.openclaw/delivery-queue/
.openclaw/subagents/
.openclaw/telegram/
.openclaw/agents/*/sessions/
.openclaw/filebrowser.db
.openclaw/update-check.json
.openclaw/canvas/

# SSH private key
.ssh/deploy_key
.ssh/known_hosts*

# Workspace temp
workspace/memory/booking-session.json
workspace/node_modules/
workspace/package-lock.json
workspace/*.jsonl

# OS
.DS_Store
Thumbs.db
GIEOF
        echo "[data-init] Created default .gitignore"
    fi

    echo "[data-init] Git repo initialized. Talk to the agent to set up GitHub remote and backup."
else
    echo "[data-init] Git repo already exists"
fi

echo "[data-init] Done"
