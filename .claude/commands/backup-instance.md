---
description: "Back up an OpenClaw instance's full /data directory from a Coolify-managed server"
allowed-tools: Agent, Bash, Read, Glob
---

# Backup OpenClaw Instance

## Input
**$ARGUMENTS** — must contain the IP address of the target server.

If no IP address is provided, ask the user for one before proceeding.

## Execution

**IMPORTANT**: Delegate the entire backup procedure below to a sub-agent using the Agent tool. The sub-agent should execute all steps autonomously and return the result (domain, backup file name, size, and location).

## Procedure (for the sub-agent)

### Step 1: Connect and discover the OpenClaw container

SSH as root into the server at the given IP address. List running Docker containers and identify the OpenClaw application container (exclude `coolify-sentinel`, `coolify-proxy`, and any other Coolify infrastructure containers).

```bash
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new root@<IP> "docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'"
```

Extract the container name/ID for the OpenClaw instance.

### Step 2: Find the host data path

Inspect the container to find the bind mount that maps to `/data` inside the container:

```bash
ssh root@<IP> "docker inspect <CONTAINER> --format '{{json .Mounts}}'"
```

The host path will typically be `/data/coolify/applications/<app-id>/`.

### Step 3: Extract the domain from the OpenClaw config

Read the OpenClaw config file on the host at `<HOST_DATA_PATH>/.openclaw/openclaw.json`. Extract the domain from `gateway.controlUi.allowedOrigins[0]`, stripping the `https://` prefix.

```bash
ssh root@<IP> "cat <HOST_DATA_PATH>/.openclaw/openclaw.json"
```

If the config doesn't have `allowedOrigins`, fall back to using the IP address as the identifier.

### Step 4: Create and download the backup

Generate a timestamp and create a tarball of the **entire data directory** (everything inside the host data path that maps to `/data` in the container — this includes `.openclaw/`, `workspace/`, `.env`, `.auth`, and all other files):

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="<DOMAIN>-${TIMESTAMP}.tar.gz"

# Create tarball of the full /data contents on remote
ssh root@<IP> "cd <HOST_DATA_PATH> && tar czf /tmp/instance-backup.tar.gz ."

# Download to local .backups/
scp root@<IP>:/tmp/instance-backup.tar.gz "./.backups/${BACKUP_NAME}"

# Clean up remote temp file
ssh root@<IP> "rm /tmp/instance-backup.tar.gz"
```

### Step 5: Verify and report

Confirm the backup file exists locally and report:
- Domain identified
- Backup file name and size
- Location: `.backups/<DOMAIN>-<TIMESTAMP>.tar.gz`
