# Monitoring & Health Checks

## What Exists

Three layers of monitoring, from infrastructure up to application:

### 1. Docker Health Check (infrastructure)

Defined in `Dockerfile`:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1
```

- Hits the auth-proxy `/health` endpoint every 30 seconds
- Container marked **unhealthy** after 3 consecutive failures (90 seconds)
- Docker reports status via `docker inspect --format='{{.State.Health.Status}}'`
- Used by `install-vps.sh` to confirm startup, and by Docker's restart policy

### 2. Service Health Endpoints (per-process)

Each supervised process exposes its own `/health`:

| Service | Port | Endpoint | Response |
|---------|------|----------|----------|
| auth-proxy | 8080 (external) | `/health` | `{ status: "ok", service: "auth-proxy" }` |
| pages-api | 8083 (internal) | `/health` | `{ status: "ok", service: "pages-api", routes: N }` |
| OpenClaw gateway | 8082 (internal) | `openclaw gateway health` | Gateway-level health |
| FileBrowser | 8081 (internal) | N/A | No health endpoint (supervised process only) |

The auth-proxy `/health` endpoint does **not** require authentication — it responds before the auth check. This is intentional: Docker and external monitors need unauthenticated access.

### 3. Claire's Heartbeat (application-level)

OpenClaw's built-in heartbeat system runs inside the agent:

- **Interval**: every 2 hours (configurable via `agents.defaults.heartbeat`)
- **Window**: 10:00–22:00 Sofia time
- **What it checks**: workspace state, memory, pending tasks, cron health
- **Checklist**: defined in `/data/workspace/HEARTBEAT.md`
- **Alerts**: posts to configured channels (Telegram, Discord) if issues found

This is an agent-level check — it verifies that Claire's operational state is healthy, not just that processes are running.

## What's NOT Monitored

- **No external uptime monitoring** — if the entire server goes down, nothing alerts. Consider adding an external ping service (UptimeRobot, Hetrix, etc.) pointing at `https://openclaw.s0l0m0n.com/health`.
- **No disk space alerts** — the `/data` volume can fill up (logs, session data, memory files). No automated cleanup or warning.
- **No certificate expiry alerts** — Caddy handles auto-renewal, but there's no alert if renewal fails.

## Supervisord Process Monitoring

All four services are managed by supervisord with automatic restart:

```
supervisorctl status          # Check all services
supervisorctl restart openclaw  # Restart a specific service
```

Config: `supervisord.conf` — each process has `autorestart=true`, `startretries=10`, and `stopasgroup=true`.

## Implementation

- **Docker health check**: `Dockerfile` line 161
- **Auth-proxy health**: `auth-proxy/index.cjs` line 241
- **Pages-api health**: `backend/server.cjs` line 250
- **Heartbeat config**: `start-container.sh` → `openclaw.json` agents.defaults section
- **Supervisord**: `supervisord.conf`
