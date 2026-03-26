# Project Data Sync — Local ↔ Cloud Workspace Synchronization

## Purpose

Enable local editing, testing, and development of OpenClaw workspace files (skills, agent config, identity files, tools definitions) using Claude Code and local IDE tooling, then synchronize changes to the live cloud instance via Git.

## Architecture

```
GitHub (your backup repo)          ← central exchange point
       ↑ push/pull                  ↑ push/pull
       |                            |
Local clone                     Cloud instance (/data)
project-data/                   Container on your platform
       ↑
       | bind mount (docker-compose.local.yml)
       |
Local Docker container (/data)
```

### Components

1. **GitHub backup repo** — Mirrors the full `/data` directory from the cloud instance. The bot auto-commits its own changes from the instance. Acts as the single source of truth for syncing between local and remote.

2. **`project-data/`** (local Git clone, gitignored) — Cloned directly into the project from the repo URL in `.env` (`PROJECT_DATA_REPO`). All git operations (pull, push, conflict resolution) happen here. Setup: `source .env && git clone "$PROJECT_DATA_REPO" project-data`

3. **Docker bind mount** — `docker-compose.local.yml` mounts `./project-data` as `/data` inside the container. The container sees the full directory contents, identical to the cloud instance.

## Directory Structure (what's in /data)

```
project-data/                         # = /data on instance
├── .openclaw/                        # OpenClaw internal state & config
│   ├── openclaw.json                 # Main config (API keys, gateway, channels) — gitignored
│   ├── openclaw.sanitized.json       # Template without secrets — committed
│   ├── agents/                       # Agent definitions & state
│   ├── browser/                      # Chromium user data — gitignored
│   ├── credentials/                  # Auth credentials — gitignored
│   ├── cron/                         # Scheduled tasks
│   ├── devices/                      # Device pairing data — gitignored
│   ├── identity/                     # Instance identity — gitignored
│   ├── logs/                         # Runtime logs
│   ├── memory/                       # Agent memory store
│   └── ...
├── workspace/                        # Agent workspace (primary editing target)
│   ├── AGENTS.md                     # Agent behavior definitions
│   ├── SOUL.md                       # Agent personality/identity
│   ├── TOOLS.md                      # Tool definitions
│   ├── USER.md                       # User profile for agent
│   ├── IDENTITY.md                   # Identity specification
│   ├── HEARTBEAT.md                  # Heartbeat/cron behavior
│   ├── MEMORY.md                     # Memory index
│   ├── skills/                       # Custom skills
│   ├── memory/                       # Workspace-level memory
│   ├── pages/                        # Generated pages
│   └── app/                          # Application files
├── .auth                             # Auth proxy credentials
├── .env                              # Platform environment variables
└── .gitignore                        # Excludes secrets & transient state
```

## Sensitive Files Strategy

The backup repo has its own `.gitignore` that excludes:
- `openclaw.json` (contains API keys, tokens, channel config)
- `credentials/`, `identity/`, `devices/` (auth state)
- `browser/` (Chromium profiles — too large, not portable)
- `sessions/`, `delivery-queue/`, `subagents/` (transient runtime state)

For local Docker testing, `openclaw.json` must exist in `.openclaw/` — it is obtained by downloading a backup archive from the cloud instance and extracting it manually. It is never committed.

## Workflow

### Editing workspace files locally
1. `cd project-data && git pull` (get latest from cloud)
2. Edit files in `project-data/workspace/` using IDE + Claude Code
3. Test locally: `docker compose -f docker-compose.local.yml up --build`
4. When satisfied: `cd project-data && git add -A && git commit && git push`
5. On the cloud instance: `git pull` (or the bot pulls automatically)

### Receiving changes from the cloud instance
1. The bot auto-commits and pushes changes to GitHub
2. Locally: `cd project-data && git pull`
3. Changes are immediately visible in the project tree

### Conflict resolution
Conflicts should be rare — local edits focus on workspace definition files (AGENTS.md, SOUL.md, skills/), while the bot primarily writes to memory, logs, and runtime state. Standard git merge handles any overlaps.

## Design Decisions

### Why a separate Git repo (not a subdirectory)?
- The `/data` backup repo has its own commit history driven by the cloud instance bot
- Different commit cadence and authors (bot vs human)
- Avoids polluting the shell repo history with workspace file churn
- Clean separation: openclaw-shell = infrastructure/deployment, backup repo = runtime data

### Why a direct clone (not a git submodule)?
- No submodule version pinning headaches
- The data repo changes frequently and independently
- Submodules would require explicit updates in the parent repo on every change
- Direct clone is machine-agnostic — works on any checkout

### Why bind mount instead of named Docker volume?
- Named volumes are opaque — can't easily browse or edit contents
- Bind mount gives direct filesystem access for IDE editing
- Changes are immediately reflected inside the container (no rebuild needed)
- Git-controlled state means full version history and rollback capability

### Why mount all of /data (not just workspace)?
- Full parity with the cloud instance for accurate local testing
- Some OpenClaw behaviors depend on `.openclaw/` config (cron, agent settings, memory)
- The gitignore already handles what should/shouldn't be committed
- Simplifies Docker config — one mount point instead of multiple
