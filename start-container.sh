#!/bin/bash
set -e

# Performance: Node compile cache + disable self-respawn overhead
export NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
mkdir -p "$NODE_COMPILE_CACHE"
export OPENCLAW_NO_RESPAWN=1

# Ensure data directories exist (including browser profiles)
mkdir -p /data/.openclaw /data/workspace /data/workspace/skills /data/workspace/pages /data/workspace/app /data/.openclaw/browser

# Initialize git repo, SSH keys, and git config (idempotent)
# This enables git push to GitHub for automated backups
/app/git-init.sh

# Source platform env vars (Coolify writes to /data/.env, Railway uses actual env vars)
if [ -f "/data/.env" ]; then
    set -a && source /data/.env && set +a
fi

# Source auth credentials (takes precedence over platform defaults)
# Contains: PROXY_USER, PROXY_PASSWORD, AUTH_SECRET
if [ -f "/data/.auth" ]; then
    set -a && source /data/.auth && set +a
fi

# Set defaults for any missing env vars (needed for supervisord)
export PROXY_USER="${PROXY_USER:-admin}"
export PROXY_PASSWORD="${PROXY_PASSWORD:-admin}"
export AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -hex 32)}"

# v2026.4.1: trusted-proxy mode is mutually exclusive with token auth
# Do NOT set OPENCLAW_GATEWAY_TOKEN — gateway will reject it
unset OPENCLAW_GATEWAY_TOKEN 2>/dev/null || true

# Run one-time data migrations (tracked in /data/.openclaw/migrations-applied.json)
/app/run-migrations.sh

# Install bundled skills (always update to latest version)
if [ -d "/app/skills" ]; then
    for skill_dir in /app/skills/*/; do
        skill_name=$(basename "$skill_dir")
        target_dir="/data/workspace/skills/$skill_name"
        cp -r "$skill_dir" "$target_dir"
    done
fi

# Configure OpenClaw gateway settings
# This section enforces Railway-specific infrastructure settings on EVERY boot
# Separates concerns: start-container.sh = infrastructure, setup-api.cjs = user data
CONFIG_FILE="/data/.openclaw/openclaw.json"
node -e "
    const fs = require('fs');

    // Load existing config or start with empty object
    let config = {};
    try {
        config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf-8'));
    } catch {}

    // ============================================================================
    // INFRASTRUCTURE SETTINGS (Railway-specific, always enforced)
    // These ensure the deployment works correctly and securely
    // ============================================================================

    // Network configuration - REQUIRED for Railway reverse proxy
    config.gateway = config.gateway || {};
    config.gateway.port = 8082;              // auth-proxy expects this port
    config.gateway.bind = 'loopback';        // CRITICAL: localhost only for security
    config.gateway.mode = 'local';           // Local deployment mode
    config.gateway.trustedProxies = ['127.0.0.1'];  // Required for loopback connections
    config.gateway.channelStaleEventThresholdMinutes = 90;  // Prevent Discord stale-socket restarts (default 30 is too aggressive for low-traffic bots)

    // Control UI - REQUIRED for web dashboard access
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.enabled = true;
    config.gateway.controlUi.basePath = '/dashboard';
    config.gateway.controlUi.allowInsecureAuth = true;  // Allow HTTP behind reverse proxy
    delete config.gateway.controlUi.dangerouslyDisableDeviceAuth;  // Not needed with auth mode 'none'

    // CORS allowed origins - preserve existing, or will be set by setup page
    // (same-origin connections work by default, this is only for cross-origin)

    // Gateway authentication - trusted-proxy mode
    // Auth-proxy handles all user authentication; gateway trusts x-forwarded-user header.
    // This mode also bypasses Control UI device pairing (which blocks dashboard access otherwise).
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.mode = 'trusted-proxy';
    config.gateway.auth.trustedProxy = config.gateway.auth.trustedProxy || {};
    config.gateway.auth.trustedProxy.userHeader = 'x-forwarded-user';
    // v2026.4.1: trusted-proxy and token auth are mutually exclusive — remove token
    delete config.gateway.auth.token;

    // Browser configuration - REQUIRED for Playwright/Chromium in Docker
    config.browser = config.browser || {};
    config.browser.executablePath = '/usr/bin/chromium';  // System Chromium installed via apt
    config.browser.noSandbox = true;        // REQUIRED in Docker (no user namespaces)
    config.browser.enabled = true;
    config.browser.headless = true;
    config.browser.defaultProfile = config.browser.defaultProfile || 'openclaw';

    // Agent configuration - REQUIRED for Railway
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};

    // Workspace path from Railway env var (defaults to /data/workspace)
    const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || '/data/workspace';
    config.agents.defaults.workspace = workspaceDir;

    // Agent sandbox MUST be off for browser to work
    config.agents.defaults.sandbox = config.agents.defaults.sandbox || {};
    config.agents.defaults.sandbox.mode = 'off';

    // Subagent concurrency (Railway resource allocation)
    config.agents.defaults.subagents = config.agents.defaults.subagents || {};
    config.agents.defaults.subagents.maxConcurrent = 2;

    // Disable model fallback — prevent Haiku cron jobs from silently escalating to Sonnet
    // When a model times out or fails, fail the run instead of retrying on a more expensive model
    config.agents.defaults.model = config.agents.defaults.model || {};
    if (typeof config.agents.defaults.model === 'string') {
        config.agents.defaults.model = { primary: config.agents.defaults.model, fallbacks: [] };
    } else {
        config.agents.defaults.model.fallbacks = [];
    }

    // Cron configuration - enable on first boot, preserve user choice on subsequent boots
    config.cron = config.cron || {};
    if (config.cron.enabled === undefined) {
        config.cron.enabled = true;
        config.cron.maxConcurrentRuns = 2;
    }

    // Exec tool - allow all commands without approval (secure container environment)
    config.tools = config.tools || {};
    config.tools.exec = config.tools.exec || {};
    config.tools.exec.security = 'full';
    config.tools.exec.ask = 'off';

    // Session reset policy - idle-based instead of daily (default resets at 4AM daily)
    // Sessions stay alive as long as they're active; compaction handles token limits
    config.session = config.session || {};
    config.session.reset = {
        mode: 'idle',
        idleMinutes: 43200  // 30 days of inactivity before reset
    };

    // ACP (Agent Control Protocol) - disabled by default, preserve if already enabled
    config.acp = config.acp || {};
    if (config.acp.enabled === undefined) {
        config.acp.enabled = false;
    }

    // ============================================================================
    // Let OpenClaw use runtime defaults for everything else:
    // - contextPruning, heartbeat, compaction, maxConcurrent, etc.
    // - commands, messages
    // setup-api.cjs will write user-specific settings when user completes setup
    // ============================================================================

    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
"

# Remove old FileBrowser database for clean --noauth start
rm -f /data/.openclaw/filebrowser.db 2>/dev/null || true

# Kill any leftover gateway process to prevent port-conflict restart storms
# (supervisord autorestart can race with a still-dying process)
if [ -f /tmp/openclaw-gateway.pid ]; then
    kill "$(cat /tmp/openclaw-gateway.pid)" 2>/dev/null || true
    rm -f /tmp/openclaw-gateway.pid
fi
# Also kill anything on port 8082 directly
fuser -k 8082/tcp 2>/dev/null || true

# Clean up stale Chromium lock files from previous container runs
# These persist on the volume and prevent Chromium from starting
rm -f /data/.openclaw/browser/*/user-data/SingletonLock \
      /data/.openclaw/browser/*/user-data/SingletonSocket \
      /data/.openclaw/browser/*/user-data/SingletonCookie 2>/dev/null || true

# Patch: trusted-proxy shared-secret fallback (upstream PR #17746 closed, superseded by PR #54536 — still open)
# When trusted-proxy auth fails (no x-forwarded-user), fall through to token/password auth
# instead of returning failure. This lets internal services (cron, agent backend) authenticate
# via OPENCLAW_GATEWAY_TOKEN while browser connections use trusted-proxy via auth-proxy.
# Idempotent — no-op if already patched or if the code pattern changes in a future version.
# NOTE: Scans ALL .js files because the auth dispatcher moves between files across versions
#   (e.g. auth-*.js in v2026.3.8, reply-*.js in v2026.3.12).
node -e "
    const fs = require('fs');
    const path = require('path');
    const distDir = '/app/dist';
    const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
    let patched = 0;
    for (const file of files) {
        const fp = path.join(distDir, file);
        let code = fs.readFileSync(fp, 'utf-8');

        // Skip files that don't contain the auth dispatcher
        if (!code.includes('trusted_proxy_user_missing')) continue;
        if (code.includes('/* pr17746-patched */')) { console.log('[patch] Already patched: ' + file); continue; }

        let changed = false;

        // Patch 1: Remove hard-return after trusted-proxy user check fails
        // (let execution fall through to shared-secret auth)
        const p1 = /if \(\"user\" in result\) return \{\s*ok: true,\s*method: \"trusted-proxy\",\s*user: result\.user\s*\};\s*return \{\s*ok: false,\s*reason: result\.reason\s*\};/;
        if (p1.test(code)) {
            code = code.replace(p1,
                'if (\"user\" in result) return { ok: true, method: \"trusted-proxy\", user: result.user }; /* pr17746-patched: fall through to token/password auth */'
            );
            changed = true;
        }

        // Patch 2: Token auth block checks auth.mode === 'token' — also allow when mode
        // is 'trusted-proxy' and a token is configured (shared-secret fallback)
        const p2 = 'if (auth.mode === \"token\")';
        if (code.includes(p2)) {
            code = code.replace(p2,
                'if (auth.mode === \"token\" || (auth.mode === \"trusted-proxy\" && auth.token))'
            );
            changed = true;
        }

        if (changed) {
            fs.writeFileSync(fp, code);
            patched++;
            console.log('[patch] Applied trusted-proxy fallback to ' + file);
        } else {
            console.log('[patch] WARNING: ' + file + ' contains auth logic but pattern not matched — code may have changed');
        }
    }
    if (patched === 0) console.log('[patch] No files needed patching (already patched or pattern changed)');
"

# Patch: loopback trusted-proxy client IP resolution
# When 127.0.0.1 is both the remote address AND a trusted proxy, resolveClientIp tries to
# extract the real client from forwarded headers. If none exist (direct localhost connection),
# it returns undefined — causing isLocalDirectRequest to return false. This breaks internal
# services (cron, CLI) that connect directly to the gateway without going through the auth-proxy.
# Fix: if the remote is a loopback trusted proxy with no forwarded-for header, return remote.
# Idempotent — no-op if already patched or if the code pattern changes.
node -e "
    const fs = require('fs');
    const path = require('path');
    const distDir = '/app/dist';
    const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
    let patched = 0;
    for (const file of files) {
        const fp = path.join(distDir, file);
        let code = fs.readFileSync(fp, 'utf-8');

        if (!code.includes('function resolveClientIp(params)')) continue;
        if (code.includes('/* loopback-trusted-proxy-patched */')) { console.log('[patch] Already patched (loopback): ' + file); continue; }

        // Pattern: when remote is a trusted proxy and forwardedIp is null,
        // return remote if it's a loopback address (direct local connection, not proxied)
        const target = 'if (forwardedIp) return forwardedIp;';
        if (code.includes(target)) {
            code = code.replace(target,
                'if (forwardedIp) return forwardedIp; /* loopback-trusted-proxy-patched */ if (!params.forwardedFor && (remote === \"127.0.0.1\" || remote === \"::1\")) return remote;'
            );
            fs.writeFileSync(fp, code);
            patched++;
            console.log('[patch] Applied loopback trusted-proxy fix to ' + file);
        } else {
            console.log('[patch] WARNING: ' + file + ' has resolveClientIp but pattern not matched');
        }
    }
    if (patched === 0) console.log('[patch] No files needed loopback patching (already patched or pattern changed)');
"

exec supervisord -c /app/supervisord.conf
