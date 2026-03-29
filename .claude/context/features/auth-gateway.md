# Authentication Gateway

## What It Does

Wraps the OpenClaw gateway with a Node.js reverse proxy that handles user authentication via form-based login. Provides a web-based setup page for initial configuration and credential management.

## Why

OpenClaw's built-in auth (device pairing, token auth) isn't designed for remote web access behind a reverse proxy. The auth gateway provides username/password authentication with a login form, cookie-based sessions, and a user-friendly setup flow for API keys and service configuration.

## Architecture

```
Internet → Node.js HTTP proxy (:8080) → [form login + cookie session] → OpenClaw gateway (:8082, loopback only)
                                       → /setup → setup.html (static)
                                       → /api/setup/* → setup-api.cjs (utility module)
                                       → /files/* → FileBrowser (:8081)
                                       → /pages/* → static file serving (public, no auth)
                                       → /pages-api/* → pages-api server (:8083, public)
                                       → /app/* → static file serving (auth required)
                                       → /app-api/* → pages-api server (:8083, auth required, rewritten to /pages-api/*)
```

- **Node.js HTTP proxy** (`index.cjs`) handles form-based login, cookie sessions, routing, and serves static assets. TLS termination is handled by the deployment platform.
- **OpenClaw gateway** binds to loopback only — never directly exposed.
- There is **no nginx** in this project. The Node.js proxy handles all routing directly.

## Authentication Approach: Trusted Proxy + Token Fallback

The gateway runs in `trusted-proxy` auth mode. This is a two-layer approach:

### Layer 1: Trusted Proxy (browser connections)
The auth-proxy authenticates users via form login, then sets the `x-forwarded-user` header on proxied requests. The gateway trusts this header from `127.0.0.1` (the only trusted proxy).

### Layer 2: Token Fallback (internal services)
Internal services like cron and the agent backend connect directly to the gateway on loopback without going through the auth-proxy. They authenticate using `OPENCLAW_GATEWAY_TOKEN`. This requires runtime patches because upstream OpenClaw does not natively fall through from trusted-proxy to token auth.

### Why this approach
OpenClaw's device pairing auth blocks dashboard access when running behind a reverse proxy. Trusted-proxy mode bypasses device pairing entirely while keeping the gateway secured. The token fallback ensures internal services still work without needing to inject proxy headers.

## Runtime Patches

Two patches are applied by `start-container.sh` on every boot. Both are idempotent and version-resilient (scan all `.js` files in `/app/dist` because the auth dispatcher moves between files across OpenClaw versions).

### Patch 1: Trusted-proxy shared-secret fallback
- **What**: When trusted-proxy auth fails (no `x-forwarded-user` header), fall through to token/password auth instead of returning failure.
- **Why**: Internal services (cron, agent backend) connect directly to the gateway without going through the auth-proxy, so they have no `x-forwarded-user` header. Without this patch, those connections are rejected.
- **Upstream**: PR #17746 (closed), superseded by PR #54536 (still open as of 2026-03-29).

### Patch 2: Loopback trusted-proxy client IP resolution
- **What**: When `127.0.0.1` is both the remote address and a trusted proxy, and no `x-forwarded-for` header exists, return the remote address instead of `undefined`.
- **Why**: Without this fix, `resolveClientIp` returns `undefined` for direct localhost connections, causing `isLocalDirectRequest` to return `false`. This breaks cron and CLI commands that connect directly to the gateway.
- **Upstream**: No PR filed yet — tightly coupled to the trusted-proxy fallback logic.

Both patches can be removed once the upstream PRs are merged and the Dockerfile pins to a version that includes them.

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
- Landing/navigation page: `auth-proxy/landing.html`
- Gateway auth enforcement: `start-container.sh` (trusted-proxy config + patches)
- Process management: `supervisord.conf`
