# OpenClaw Shell — Self-Hosted AI Deployment System

## What This Is

A ready-to-deploy Docker image for self-hosting [OpenClaw](https://github.com/openclaw/openclaw) with an auth proxy (nginx + basic auth), headless browser, file browser, and skill management. One container, zero configuration.

## Documentation Language Policy

**ALL project documentation MUST be written in English.** This includes `.md` files, code comments, commit messages, and branch names.

---

## Project Architecture

### Key Directories

```
openclaw-shell/
├── .env.example              # Environment variables template
├── skills/                   # Core skills, deployed to all instances
│   ├── pages/
│   └── pages-backend/
├── auth-proxy/               # Nginx auth wrapper (index.cjs, setup-api.cjs, setup.html)
├── start-container.sh        # Startup orchestrator — THE source of truth for config
├── git-init.sh               # Git + SSH setup for automated backups
├── Dockerfile                # Build definition
├── docker-compose.local.yml  # Local development
└── supervisord.conf          # Process manager config
```

### Configuration Layers

All infrastructure config is enforced by `start-container.sh` on every boot. Do NOT duplicate config values in documentation — read the source.

| What | Where | Managed by |
|------|-------|------------|
| Infrastructure (gateway, browser, agents) | `start-container.sh` → writes `openclaw.json` | This repo |
| User features (channels, tools, API keys) | `setup-api.cjs` → writes `openclaw.json` | Setup page |
| Auth credentials | `/data/.auth` (survives redeployments) | User / setup page |
| Platform env vars | `/data/.env` (may be overwritten by platform) | Platform (Coolify / Railway) |
| Deploy key + git config | `/data/.ssh/` + `git-init.sh` | This repo |

### Startup Sequence

1. `start-container.sh` creates data directories
2. `git-init.sh` sets up SSH keys and git repo in `/data`
3. Sources `/data/.env` (platform vars), then `/data/.auth` (credentials, takes precedence)
4. Removes deprecated skills, installs/updates bundled skills from `skills/`
5. Enforces infrastructure settings in `openclaw.json`
6. Applies runtime patches (e.g., trusted-proxy auth fallback)
7. Starts supervisord (nginx + OpenClaw gateway + FileBrowser)

---

## Deployment

Deployment is platform-agnostic. Platform-specific instructions live in separate files:

- **Local development**: `.claude/deployment/local.md`
- **Railway**: `.claude/deployment/railway.md`
- **Coolify**: `.claude/deployment/coolify.md`

### General workflow

1. Make changes locally (code, skills, Dockerfile)
2. Test with `docker compose -f docker-compose.local.yml up --build`
3. Push to your deployment platform

---

## Features

Feature documentation lives in `.claude/features/`. Each file describes intent and architecture, with pointers to implementation — not duplicated config.

- `auth-gateway.md` — Authentication proxy and setup page
- `browser-headless.md` — Headless Chromium for agent browser tasks
- `chatgpt-oauth.md` — ChatGPT/Codex OAuth provider integration
- `skills-pages.md` — Pages and pages-backend core skills
- `project-data-sync.md` — Local/cloud workspace synchronization via Git

---

## OpenClaw Documentation

OpenClaw documentation questions are handled by the **OpenClaw agent** (`.claude/agents/openclaw.md`). The agent self-validates that docs are present at `.docs/openclaw/` and match the Dockerfile-pinned version before answering. Delegate all doc lookups to this agent.

---

## Contributing

### Local Development

```bash
docker compose -f docker-compose.local.yml up --build
# Open http://localhost:8081
# Login: admin / admin
```

See `.claude/deployment/local.md` for details.

### Maintaining This File

1. **Keep it lean** — Loaded into every Claude Code session. Every line should earn its place.
2. **Describe what IS, not what HAPPENED** — Present tense, instructional tone.
3. **Never duplicate implementation** — Point to the source file instead.
4. **Platform-agnostic only** — Platform-specific details go in `.claude/deployment/<platform>.md`.
5. **Features reference, don't explain** — One-line descriptions, link to `.claude/features/<name>.md`.

---

## TODO / Future Improvements

- [ ] **Versioned migrations system** — Instance-level changes are currently inline in `start-container.sh`. Future: versioned migrations tracked per instance via `/data/.openclaw/migrations-applied.json`.
- [ ] Document FileBrowser setup as a feature
- [ ] Add monitoring/health check details
