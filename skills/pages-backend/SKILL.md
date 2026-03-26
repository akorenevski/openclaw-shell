---
name: pages_backend
description: Create backend API endpoints for pages - handle form submissions, data storage, and server-side logic. Endpoints serve both public (/pages-api/) and private (/app-api/) pages.
metadata: {"openclaw": {"always": true}}
---

# Pages Backend

You can create backend API endpoints that pages call for dynamic functionality — forms, data persistence, toggles, real-time updates, and any server-side logic.

## How it works

1. Create JavaScript handler files in `/data/workspace/pages-api/`
2. Each file exports a function that registers routes using an Express-like API
3. The same handlers serve two URL paths with different security:
   - `/pages-api/` — public access (reads open, writes require same-origin)
   - `/app-api/` — private access (login required, `req.user` provided)
4. Routes hot-reload automatically when files change — no restart needed

## Security model

| Path | Who can access | GET | POST/PUT/PATCH/DELETE | `req.user` |
|------|---------------|-----|----------------------|------------|
| `/pages-api/*` | anyone | open | same-origin only | `null` |
| `/app-api/*` | logged-in users | allowed | allowed | `"username"` |

- The auth-proxy enforces these rules before requests reach the backend
- Trusted headers (`x-pages-verified`, `x-authenticated-user`) are injected by the auth-proxy and cannot be spoofed by clients
- Both paths route to the same handlers — use `req.user` to branch behavior

## Handler file format

Each `.js` or `.cjs` file in `/data/workspace/pages-api/` exports a setup function:

```javascript
// /data/workspace/pages-api/my-feature.js
module.exports = function(app, ctx) {
    app.get('/items', (req, res) => {
        const data = ctx.readJSON('pages/items.json') || [];
        res.json(data);
    });

    app.post('/items', (req, res) => {
        const items = ctx.readJSON('pages/items.json') || [];
        items.push(req.body);
        ctx.writeJSON('pages/items.json', items);
        res.json({ ok: true, count: items.length });
    });

    app.delete('/items/:id', (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Login required' });
        let items = ctx.readJSON('pages/items.json') || [];
        items = items.filter(i => i.id !== req.params.id);
        ctx.writeJSON('pages/items.json', items);
        res.json({ ok: true });
    });
};
```

## Request object (req)

- `req.method` — HTTP method (GET, POST, etc.)
- `req.pathname` — URL path (without `/pages-api` or `/app-api` prefix)
- `req.query` — Query string parameters as object
- `req.params` — URL path parameters (from `:param` patterns)
- `req.body` — Parsed request body (JSON or form-encoded)
- `req.headers` — HTTP headers
- `req.user` — Authenticated username (string) or `null` if public request

## Response object (res)

- `res.json(data)` — Send JSON response
- `res.send(data)` — Send text or auto-detect JSON
- `res.html(data)` — Send HTML response
- `res.status(code)` — Set status code (chainable: `res.status(404).json(...)`)
- `res.setHeader(name, value)` — Set response header
- `res.end(data)` — End response with raw data

## Context object (ctx)

The second argument provides workspace helpers:

- `ctx.readJSON(path)` — Read and parse JSON file (path relative to `/data/workspace/`)
- `ctx.writeJSON(path, data)` — Write JSON file (creates parent directories)
- `ctx.readFile(path)` — Read text file from workspace
- `ctx.writeFile(path, content)` — Write text file to workspace
- `ctx.workspaceDir` — Absolute path to workspace root (`/data/workspace`)
- `ctx.dataDir` — Absolute path to pages data directory

## Route patterns

```javascript
app.get('/items', handler)           // exact match
app.get('/items/:id', handler)       // path parameter → req.params.id
app.get('/items/:id/comments', handler)  // multiple segments
app.all('/webhook', handler)         // matches any HTTP method
```

## Guidelines

1. **Create the handler directory first** if it doesn't exist:
   ```bash
   mkdir -p /data/workspace/pages-api
   ```

2. **One file per feature** — keep related endpoints together (e.g., `tasks.js` has all task CRUD)

3. **Store data in workspace** — use `ctx.readJSON()` / `ctx.writeJSON()` for persistence

4. **Use `req.user` for auth checks** — `null` means public request, string means logged-in user

5. **Hot reload** — save the file and changes take effect within 1 second

6. **Error handling** — unhandled errors automatically return 500 with the error message

## Example: Task manager with public summary

Handler (`/data/workspace/pages-api/tasks.js`):
```javascript
module.exports = function(app, ctx) {
    // Public: anyone can see task stats
    app.get('/tasks/summary', (req, res) => {
        const tasks = ctx.readJSON('app/tasks/data.json') || [];
        res.json({ total: tasks.length, done: tasks.filter(t => t.done).length });
    });

    // Private: full task list (requires login via /app-api/)
    app.get('/tasks', (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Login required' });
        res.json(ctx.readJSON('app/tasks/data.json') || []);
    });

    // Private: toggle task status
    app.post('/tasks/toggle', (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Login required' });
        const tasks = ctx.readJSON('app/tasks/data.json') || [];
        const task = tasks.find(t => t.id === req.body.id);
        if (task) {
            task.done = !task.done;
            ctx.writeJSON('app/tasks/data.json', tasks);
        }
        res.json({ ok: true, tasks });
    });
};
```

Public page (`/data/workspace/pages/stats.html`) calls `/pages-api/tasks/summary`.
Private page (`/data/workspace/app/tasks/index.html`) calls `/app-api/tasks`.
