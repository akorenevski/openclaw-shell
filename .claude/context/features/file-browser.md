# File Browser

## What It Does

Provides a web-based file manager for the `/data` volume inside the container. Users can browse, upload, download, edit, and delete files through a GUI accessible at `/files`.

## Why

The `/data` volume contains Claire's workspace, config, memory, and skills. Without FileBrowser, the only way to inspect or modify these files is via SSH + CLI. FileBrowser gives a visual interface for non-technical access.

## Architecture

```
Browser → /files → auth-proxy (verifies login) → FileBrowser (port 8081)
                                                    ↓
                                                  /data (container volume)
```

- **FileBrowser** runs as a supervised process on port 8081 (loopback only)
- **Auth proxy** gates access — no separate FileBrowser login (runs with `--noauth`)
- **Database** stored at `/data/.openclaw/filebrowser.db`, deleted on every boot for clean state
- **Base URL** is `/files` — all FileBrowser routes are prefixed

## Access

Click "Browse Files" on the setup page, or navigate to `/files` after login.

## Implementation

- **Process config**: `supervisord.conf` — `[program:filebrowser]`
- **Proxy route**: `auth-proxy/index.cjs` — `/files` prefix proxied to port 8081
- **DB cleanup**: `start-container.sh` — removes old database on boot
- **Git ignore**: `git-init.sh` — excludes `filebrowser.db` from workspace sync
