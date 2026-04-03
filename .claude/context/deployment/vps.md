# VPS Deployment (Hetzner, DigitalOcean, etc.)

## Quick Start

From your local machine (or any machine with SSH access to the server):

```bash
ssh root@your-server 'curl -fsSL https://raw.githubusercontent.com/akorenevski/openclaw-shell/main/install-vps.sh | bash'
```

Or with a domain pre-configured:

```bash
ssh root@your-server 'curl -fsSL https://raw.githubusercontent.com/akorenevski/openclaw-shell/main/install-vps.sh | bash -s -- --domain openclaw.example.com'
```

The script installs Docker, Caddy, clones the repo, builds the container, and provisions a TLS certificate. Takes ~5 minutes on a fresh server.

## Prerequisites

- **OS**: Ubuntu 22.04+ or Debian 12+
- **RAM**: 2GB minimum (4GB recommended for build step)
- **Ports**: 22 (SSH), 80 (HTTP redirect), 443 (HTTPS) — the script configures ufw automatically
- **DNS**: A record pointing your domain to the server's IP (or use nip.io for no-DNS setup)

## Domain Options

The install script offers three modes:

| Mode | How | Result |
|------|-----|--------|
| Custom domain | Enter `openclaw.example.com` | Auto HTTPS via Let's Encrypt |
| nip.io | Type `nip` at the prompt | `<ip>.nip.io` with valid HTTPS, no DNS needed |
| Skip HTTPS | Type `skip` at the prompt | Direct HTTP access on port 8080 |

## What Gets Installed

| Component | Location | Purpose |
|-----------|----------|---------|
| Docker | System package | Runs the OpenClaw Shell container |
| Caddy | System package | Reverse proxy with automatic HTTPS |
| openclaw-shell repo | `/opt/openclaw-shell` | Source code and Dockerfile |
| Data directory | `/data/openclaw` (configurable) | Persistent volume for OpenClaw state |
| Management CLI | `/usr/local/bin/openclaw` | Convenience commands |

## Management Commands

After installation, the `openclaw` command is available system-wide:

```bash
openclaw status     # Container health and status
openclaw logs       # Follow container logs
openclaw shell      # Interactive shell inside the container
openclaw update     # Git pull + rebuild + restart
openclaw restart    # Restart the container
openclaw stop       # Stop the container
openclaw start      # Start the container
openclaw backup     # Create a tarball of the data directory
openclaw domain X   # Change domain and re-provision TLS certificate
```

## Updating

```bash
openclaw update
```

This runs `git pull` in `/opt/openclaw-shell` and rebuilds the container. The data volume is untouched.

## Multiple Instances

To run multiple OpenClaw instances on the same server:

1. Clone the repo to a second directory (e.g., `/opt/openclaw-shell-2`)
2. Edit `docker-compose.vps.yml` — change `container_name` and host port (e.g., `8081:8080`)
3. Add a second entry to `/etc/caddy/Caddyfile`:
   ```
   second.example.com {
       reverse_proxy localhost:8081
   }
   ```
4. `systemctl restart caddy`
5. `docker compose -f docker-compose.vps.yml up -d --build`

## SSH Access for Remote Management

From your local machine or Claude Code:

```bash
# Run a command inside the container
ssh root@server 'docker exec openclaw-shell ls /data/workspace/skills/'

# View recent logs
ssh root@server 'openclaw logs --tail 50'

# Update to latest version
ssh root@server 'openclaw update'
```

## Data Persistence

All OpenClaw state lives in the data directory (`/data/openclaw` by default), mounted into the container as `/data`. This includes:
- `.openclaw/openclaw.json` — configuration and API keys
- `.auth` — authentication credentials
- `workspace/` — skills, pages, user data
- `.ssh/` — deploy keys for git backup

The data directory survives container rebuilds. For block storage (e.g., Hetzner Volumes), mount the volume at your data directory path before running the install script, or use `--data-dir /mnt/your-volume/openclaw`.

## Migrating To/From Other Platforms

The data volume format is identical across all deployment methods. To migrate:

1. Copy the data directory from the source (or use git backup)
2. Place it at the data directory path on the target
3. Start the container — `start-container.sh` handles config enforcement on boot

## Troubleshooting

- **Build OOM**: Ensure the server has at least 2GB RAM. The Dockerfile sets `NODE_OPTIONS="--max-old-space-size=3072"` during build.
- **Certificate not provisioning**: Verify DNS A record points to the server. Check `journalctl -u caddy` for ACME errors.
- **Port already in use**: Check `ss -tlnp | grep 8080` and stop conflicting services.
- **Container not starting**: Check `openclaw logs` and `docker inspect openclaw-shell`.
