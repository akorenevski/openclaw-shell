# Core Skills: Pages & Pages-Backend

## What They Do

Two bundled skills that give OpenClaw agents the ability to create and serve web content:

- **`pages`** — Create publicly accessible web pages (HTML/CSS/JS) served at `https://{domain}/pages/`. Supports static sites, dashboards, forms, and any web content.
- **`pages-backend`** — Create dynamic API endpoints that pages can call. Supports Express-like routing with GET/POST/PUT/DELETE, hot-reloading, and workspace file I/O via a context object.

## Why

These skills are core to the platform — they enable agents to build interactive web applications with both frontend and backend components, served directly from the deployed instance.

## Architecture

- Skills are defined as `SKILL.md` files in `skills/pages/` and `skills/pages-backend/` in this repo
- On every container boot, `start-container.sh` copies them to `/data/workspace/skills/`
- Skills are always updated to the latest repo version on deployment
- Pages are served by the auth-proxy nginx config at `/pages/` (static) and `/pages-api/` (backend)
- Backend handlers live in `/data/workspace/pages-api/*.js` and hot-reload automatically

## Skill Lifecycle

### Adding a new core skill
1. Create `skills/<name>/SKILL.md` in this repo
2. Deploy — `start-container.sh` copies it to all instances

### Deprecating a skill
1. Remove the skill directory from `skills/` in this repo
2. Add the skill name to the `deprecated_skills` list in `start-container.sh`
3. Deploy — `start-container.sh` removes it from all instances

### Currently deprecated
- `pages-api` — Predecessor of `pages-backend` (renamed in commit `9b7aa33`)
- `public-pages` — Predecessor of `pages` (merged into broader skill)

## Implementation

- Skill definitions: `skills/pages/SKILL.md`, `skills/pages-backend/SKILL.md`
- Install/cleanup logic: `start-container.sh` (lines ~30-47)
- Nginx routing: `auth-proxy/index.cjs`
