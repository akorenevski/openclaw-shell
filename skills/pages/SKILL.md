---
name: pages
description: Create web pages - public (anyone can view) or private (login required). Covers file locations, URL routing, and how pages connect to backend APIs.
metadata: {"openclaw": {"always": true}}
---

# Pages

You can create two types of web pages: **public** (accessible to anyone) and **private** (requires login).

---

## Public pages

Public pages are visible to anyone with the URL. No login required.

### Where they live

Files go in `/data/workspace/pages/`. The directory structure maps directly to URLs:

```
/data/workspace/pages/
├── index.html              → /pages/
├── about.html              → /pages/about.html
├── portfolio/
│   ├── index.html          → /pages/portfolio/
│   ├── styles.css          → /pages/portfolio/styles.css
│   └── script.js           → /pages/portfolio/script.js
└── css/
    └── shared.css          → /pages/css/shared.css
```

### How they are served

The auth-proxy serves files directly from `/data/workspace/pages/` at the `/pages/` URL path. No authentication is applied — requests pass straight through to the static file server.

### When to create public pages

- Landing pages and marketing content
- Portfolios and showcases
- Public dashboards and data visualizations
- Contact forms and lead capture
- Widgets and embeddable components
- Any content meant for anonymous visitors

### Connecting to the backend

Public pages call `/pages-api/` endpoints using `fetch()`:

```html
<script>
// GET requests - open to anyone
const data = await fetch('/pages-api/items').then(r => r.json());

// POST/PUT/DELETE - allowed only from same-origin pages (automatic)
await fetch('/pages-api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New item' })
});
</script>
```

- **GET** requests are open to all
- **POST/PUT/PATCH/DELETE** requests only work from pages on the same domain (Origin header verification)
- `req.user` is `null` in handlers called via `/pages-api/`

---

## Private pages

Private pages require login. Only authenticated users can access them.

### Where they live

Files go in `/data/workspace/app/`. Same directory-to-URL mapping:

```
/data/workspace/app/
├── index.html              → /app/
├── tasks/
│   ├── index.html          → /app/tasks/
│   └── styles.css          → /app/tasks/styles.css
└── settings/
    └── index.html          → /app/settings/
```

### How they are served

The auth-proxy checks the user's login cookie before serving files from `/data/workspace/app/` at the `/app/` URL path. Unauthenticated users are redirected to the login page.

### When to create private pages

- Personal dashboards and task managers
- Admin panels and settings pages
- Content that displays user-specific data
- Pages that modify sensitive data
- Anything that should not be publicly accessible

### Connecting to the backend

Private pages call `/app-api/` endpoints using `fetch()`:

```html
<script>
// All requests are authenticated - req.user is set automatically
const tasks = await fetch('/app-api/tasks').then(r => r.json());

// Writes always allowed (user is authenticated)
await fetch('/app-api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New task' })
});

// Delete - handler can trust req.user
await fetch('/app-api/tasks/123', { method: 'DELETE' });
</script>
```

- **All methods** are allowed (user is already authenticated)
- `req.user` contains the authenticated username (string)
- `/app-api/` routes to the same backend handlers as `/pages-api/` — use `req.user` to distinguish

---

## Guidelines

1. **Create directories first** if they don't exist:
   ```bash
   mkdir -p /data/workspace/pages   # public pages
   mkdir -p /data/workspace/app     # private pages
   ```

2. **Use relative paths** for CSS/JS assets within pages

3. **Single-file approach** works well for simple pages — inline CSS and JS in the HTML

4. **For complex pages**, organize in subdirectories:
   - `/data/workspace/pages/project-name/index.html`
   - `/data/workspace/pages/project-name/styles.css`
   - `/data/workspace/pages/project-name/script.js`

5. **Supported file types**: HTML, CSS, JS, JSON, images (PNG, JPG, GIF, SVG, WebP, ICO), fonts (WOFF, WOFF2, TTF), video (MP4, WebM)

6. **Choose the right type**:
   - Public content for anonymous visitors → `/data/workspace/pages/`
   - Authenticated content for logged-in users → `/data/workspace/app/`

7. **Backend endpoints** are defined using the **pages-backend** skill — see that skill for handler format, request/response API, and data persistence
