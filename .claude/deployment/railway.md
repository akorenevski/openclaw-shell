# Railway Deployment

## Platform-Specific Configuration

### Required Environment Variables

Set in the Railway dashboard:

| Variable | Value | Why |
|----------|-------|-----|
| `RAILWAY_RUN_UID` | `0` | Container must run as root for Chromium, supervisord, and file permissions |

All other configuration (state dir, workspace dir) has defaults in the Dockerfile.

### Volume Mount

Railway provides a persistent volume mounted at `/data`. This stores all OpenClaw state, workspace files, credentials, and browser profiles across deployments.

### Build & Deploy

Railway auto-deploys on git push to the configured branch. Uses the Dockerfile for building.

### Networking

- Railway provides automatic HTTPS with SSL termination
- The container exposes port 8080 (nginx)
- Railway's proxy forwards traffic to the container's exposed port
- `RAILWAY_PUBLIC_DOMAIN` env var is available at runtime for CORS configuration

### Known Issues

- **Build OOM on small instances**: Railway instances with limited memory may OOM during `pnpm build`. The Dockerfile sets `NODE_OPTIONS="--max-old-space-size=3072"` in the builder stage to mitigate this.
- **Playwright download timeout**: Chromium is installed via apt (not `npx playwright install`) to avoid build timeouts. See `.claude/features/browser-headless.md`.

## Migrating Away from Railway

When migrating to another platform:
1. Download the full `/data` directory from the Railway instance (or use your backup repo)
2. Critical files not in git: `.openclaw/openclaw.json` (API keys), `.auth` (credentials), `.openclaw/credentials/`, `.openclaw/devices/`
3. Deploy the same Docker image on the new platform with a volume at `/data`
