# Local Development Deployment

## Quick Start

```bash
docker compose -f docker-compose.local.yml up --build
# Open http://localhost:8081
# Login: admin / admin
```

## Commands

| Action | Command |
|--------|---------|
| Build and run | `docker compose -f docker-compose.local.yml up --build` |
| Run without rebuild | `docker compose -f docker-compose.local.yml up` |
| Run detached | `docker compose -f docker-compose.local.yml up -d` |
| View logs | `docker compose -f docker-compose.local.yml logs -f` |
| Enter container | `docker compose -f docker-compose.local.yml exec openclaw bash` |
| Stop | `docker compose -f docker-compose.local.yml down` |
| Stop + delete data | `docker compose -f docker-compose.local.yml down -v` |
| Rebuild no cache | `docker compose -f docker-compose.local.yml build --no-cache` |

## Data Mount

The local instance mounts `./project-data` as `/data` inside the container. You can either:
- Create an empty `project-data/` directory for a fresh start
- Clone your instance's backup repo into `project-data/` (see `project-data-sync.md`)

If `project-data/` doesn't exist, Docker Compose falls back to a named volume (`openclaw-local-data`).

## Differences from Remote Deployments

| | Local | Remote |
|---|---|---|
| URL | `http://localhost:8081` | `https://<domain>` |
| HTTPS | No | Yes (platform handles TLS) |
| Volume | Bind mount or Docker volume | Platform persistent volume |
| Env vars | From `docker-compose.local.yml` | From platform dashboard |
| Build trigger | Manual | Automatic on git push |

## What's Identical

The Dockerfile, Chromium install, `start-container.sh`, `supervisord.conf`, and `/data` structure are exactly the same. If it works locally, it works remotely.

## When to Test Locally

- Dockerfile changes
- `start-container.sh` or `supervisord.conf` changes
- New apt packages
- Auth-proxy changes

Can skip local testing for: minor skill edits, documentation, dependency version bumps.

## Troubleshooting

- **Port 8081 in use**: Change the host port mapping in `docker-compose.local.yml`
- **Build OOM**: Increase Docker Desktop memory to 4GB+, or use `NODE_OPTIONS="--max-old-space-size=3072"` (already set in Dockerfile)
- **Chromium errors**: Check container logs for browser-related errors

## Backup / Restore Volume

```bash
# Backup
docker run --rm -v openclaw-local-data:/data -v $(pwd):/backup alpine tar czf /backup/openclaw-backup.tar.gz /data

# Restore
docker run --rm -v openclaw-local-data:/data -v $(pwd):/backup alpine tar xzf /backup/openclaw-backup.tar.gz
```
