# OpenClaw Deployment Guide

Deploy your personal AI assistant in minutes. Supports Railway, Coolify, and other container platforms.

---

## Quick Start

### 1. Deploy

1. Deploy this repository to your container platform
2. **Add a volume** mounted at `/data` for persistent storage
3. Wait for deployment to complete

### 2. Complete Setup

Navigate to your service's public URL.

**Default Login:**
- Username: `admin`
- Password: `admin`

**CRITICAL:** Change the default password immediately on the Setup page. Anyone who discovers your URL can access your deployment with `admin/admin`.

---

## Pages

Your deployment provides these pages:

| Page | Path | Description |
|------|------|-------------|
| **Auth Gateway** | `/` | Login when unauthenticated, navigation hub when authenticated |
| **Setup** | `/setup` | Configure credentials and API keys |
| **Dashboard** | `/dashboard` | Native OpenClaw dashboard |
| **Files** | `/files/` | Browse and manage files in `/data` volume |
| **Public Pages** | `/pages/` | Publicly accessible content (no auth required) |
| **Private App** | `/app/` | Auth-protected pages and tools (login required) |

On a fresh install, you'll be redirected to the **Setup** page after login.

---

## Setup Page

Enter your credentials on the Setup page:

| Field | Description | How to Get |
|-------|-------------|------------|
| **Anthropic API Key** | Required for AI | Run `claude setup-token` or get from [console.anthropic.com](https://console.anthropic.com) |
| **Username** | New login username | Change from default `admin` |
| **Password** | New login password | Choose a strong password |
| **Telegram Bot Token** | Optional | Get from [@BotFather](https://t.me/BotFather) |
| **Telegram User ID** | Your Telegram user ID | Send `/start` to [@userinfobot](https://t.me/userinfobot) |
| **Deepgram API Key** | Voice messages | Get from [console.deepgram.com](https://console.deepgram.com) |
| **Brave Search API Key** | Web search | Get from [brave.com/search/api](https://brave.com/search/api) |

Click **Save Settings**, then **Go to Dashboard**.

---

## Telegram Setup

If you provided a Telegram Bot Token and User ID in the Setup page, the bot is ready to use. Send a message to your bot and it will respond.

---

## Features

### Public Pages

Create publicly accessible web content without authentication:
- Ask OpenClaw to create landing pages, forms, dashboards
- Files go to `/data/workspace/pages/`
- Access at `https://your-domain/pages/`

### Private App

Auth-protected pages for personal tools and dashboards:
- Files go to `/data/workspace/app/`
- Access at `https://your-domain/app/` (requires login)
- Backend API available at `/app-api/` (proxied to the same handler as `/pages-api/`, but with authentication context)

### Browser Automation

Headless Chromium is pre-installed for web scraping:
- Visit and analyze JavaScript-heavy pages
- Take screenshots
- Extract data from dynamic content

### File Browser

Access the `/data` volume via web at `/files/`:
- Browse, upload, download files
- Edit configuration directly

---

## GitHub Backup Setup

Set up automated git backups to preserve your configuration and workspace.

### Step 1: Create GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Create a new **private** repository (e.g., `openclaw-backup`)
3. **Do not** add README, .gitignore, or license
4. Copy the **SSH URL**: `git@github.com:YOUR_USERNAME/REPO_NAME.git`

### Step 2: Give Repository URL to Agent

Tell your agent:

```
You: Please set up GitHub backup for this deployment.
     Repository: git@github.com:YOUR_USERNAME/REPO_NAME.git

Agent: I'll set up GitHub backup. First, I need to generate SSH keys...
       [generates keys]
       Here's your public SSH key:

       ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... deploy-key

       Please add this as a deploy key to your GitHub repository.
```

### Step 3: Add Deploy Key to GitHub

1. Go to your repository → **Settings** → **Deploy keys**
2. Click **Add deploy key**
3. **Title**: `OpenClaw Deploy Key`
4. **Key**: Paste the public key the agent gave you
5. Check **"Allow write access"** (required for git push)
6. Click **Add key**

### Step 4: Confirm and Set Backup Schedule

Tell your agent the key is added:

```
You: I've added the deploy key to GitHub. Please make the first backup.
     I want backups to run daily at midnight.

Agent: Deploy key confirmed! Making initial commit and pushing to GitHub...
       [creates initial commit]
       Backup complete! Setting up daily automated backups...
```

**Backup Frequency Options**:
- `daily` - once every 24 hours (recommended)
- `hourly` - once every hour
- `weekly` - once every 7 days
- Custom: "every 6 hours", "twice a day", etc.

### What Gets Backed Up

**Included**:
- Workspace files (`/data/workspace/`)
- Agent configurations (sanitized)
- Skills
- Public pages
- Git-friendly config snapshots

**Excluded** (via `.gitignore`):
- Secrets (API keys, tokens)
- Credentials
- Browser profiles
- Session data
- Database files

---

## Railway Deployment

When deploying to Railway specifically:

### Volume Setup

Add a volume to your Railway service:
1. Right-click service → Add Volume
2. Mount Path: `/data`

### Public URL

After deployment, you need to expose the service publicly:
1. Go to your service → **Settings** → **Networking** → **Public Networking**
2. Click **Generate Domain**
3. Select port **8080**
4. Click **Generate Domain**

Without this, the instance is not accessible from the browser.

### Environment Variables

Set this in Railway dashboard (Settings → Variables):

```
RAILWAY_RUN_UID="0"
```

This is required for Railway volume permissions. No other environment variables are needed — everything else is configured via the Setup page or has defaults in the Dockerfile.

---

## Other Platforms (Coolify, etc.)

No environment variables are required. Just ensure your platform mounts a persistent volume at `/data`.

---

## Technical Reference

### File Locations

| Path | Description |
|------|-------------|
| `/data/.openclaw/` | OpenClaw configuration & state |
| `/data/.openclaw/openclaw.json` | Main config (API keys, gateway token, channels) |
| `/data/workspace/` | Agent workspace (skills, pages, files) |
| `/data/.auth` | Auth-proxy credentials (survives redeployments) |
| `/data/.env` | Platform-managed env vars |
