# ChatGPT OAuth Provider

## What It Does

Adds ChatGPT subscription (OpenAI Codex OAuth) as a third inference provider option in the auth-proxy setup UI, alongside Anthropic and OpenAI API key providers.

## Why

Users with ChatGPT subscriptions can use their existing OpenAI account for inference without a separate API key, using the same OAuth PKCE flow that OpenClaw's CLI uses internally.

## OAuth Flow

1. User clicks "Sign in with ChatGPT" on the setup page
2. Backend generates PKCE (code_verifier + code_challenge) and authorization URL
3. Browser opens OpenAI auth page in new tab
4. After authentication, browser redirects to `http://localhost:1455/auth/callback?code=...&state=...`
5. Since nothing runs on localhost:1455, user copies the full URL from the address bar
6. User pastes URL into the setup page input field
7. Backend exchanges code for tokens (access_token JWT + refresh_token)
8. Tokens are stored in OpenClaw's expected format

## Token Storage

Three files are written to match OpenClaw's internal format:
- `/data/.openclaw/agents/main/agent/auth-profiles.json` — Primary token store
- `/data/.openclaw/agents/main/agent/auth.json` — Legacy token store
- `/data/.openclaw/openclaw.json` — Auth profile declaration + model config

## OAuth Constants

Uses OpenAI Codex CLI's public client registration:
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- Redirect URI: `http://localhost:1455/auth/callback` (hardcoded by OpenAI, cannot change)
- Scopes: `openid profile email offline_access`

## Redirect URI Limitation

The redirect URI is registered by OpenAI and cannot be changed. For remote/VPS deployments, the paste-back flow is the only option. The web UI makes this smoother than the CLI paste approach.

## Implementation

- Backend OAuth logic: `auth-proxy/setup-api.cjs` — `startCodexAuth()`, `completeCodexAuth()`, `generatePKCE()`, `decodeJwtPayload()`
- API routes: `auth-proxy/index.cjs` — `POST /api/setup/codex-auth/start`, `POST /api/setup/codex-auth/complete`
- Frontend UI: `auth-proxy/setup.html` — provider toggle, OAuth flow UI

## How It Was Built

Reverse-engineered from OpenClaw's internal `@mariozechner/pi-ai` OAuth implementation and the `openclaw onboard --auth-choice openai-codex` flow. See `.claude/history/changelog.md` for details.
