# Authentication Gateway

## What It Does

Wraps the OpenClaw gateway with a Node.js HTTP proxy that handles user authentication. Provides a web-based setup page for initial configuration and credential management.

## Why

OpenClaw's built-in auth (device pairing, token auth) isn't designed for remote web access behind a reverse proxy. The auth gateway provides simple username/password authentication and a user-friendly setup flow for API keys and service configuration.

## Architecture

```
Internet → Node.js HTTP proxy (:8080) → [basic auth] → OpenClaw gateway (:8082, loopback only)
                                       → /setup → setup.html (static)
                                       → /api/setup/* → setup-api.cjs (utility module)
                                       → /files/* → FileBrowser (:8081)
```

- **Node.js HTTP proxy** (`index.cjs`) handles basic auth, routing, and serves static assets. TLS termination is handled by the deployment platform.
- **OpenClaw gateway** binds to loopback only — never directly exposed
- **Auth mode**: `trusted-proxy` — the proxy sets `x-forwarded-user` header, gateway trusts it. Internal services (cron, agent backend) authenticate via `OPENCLAW_GATEWAY_TOKEN` as fallback (requires a runtime patch in `start-container.sh` until upstream PR #17746 merges).

## Credential Storage

- `/data/.auth` — `PROXY_USER`, `PROXY_PASSWORD`, `AUTH_SECRET`. Survives platform redeployments (platform may overwrite `/data/.env` but not `.auth`).
- Defaults: `admin` / `admin` if not set. User changes credentials via the setup page.

## Setup Page

The setup page (`/setup`) allows configuring:
- Auth credentials (username/password)
- AI provider selection (Anthropic, OpenAI, ChatGPT OAuth)
- API keys (Anthropic, Brave, Deepgram)
- Telegram bot integration
- Domain/CORS settings

## Implementation

- HTTP proxy: `auth-proxy/index.cjs`
- Setup UI: `auth-proxy/setup.html`
- Setup API utilities: `auth-proxy/setup-api.cjs`
- Login page: `auth-proxy/login.html`
- Gateway auth enforcement: `start-container.sh` (trusted-proxy config + patch)
- Process management: `supervisord.conf`
