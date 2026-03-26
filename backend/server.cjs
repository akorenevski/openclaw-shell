/**
 * Pages API Server - Dynamic workspace endpoints for interactive pages
 *
 * Loads user-defined route handlers from /data/workspace/pages-api/
 * and serves them on port 8083 (localhost only).
 *
 * Handler files export a function that receives an Express-like router:
 *
 *   module.exports = function(app) {
 *     app.get('/movies', (req, res) => { ... });
 *     app.post('/movies/toggle', (req, res) => { ... });
 *   };
 *
 * Security model:
 * - Auth-proxy injects trusted headers before proxying here
 * - x-pages-verified: 'true' = request came from same-origin page
 * - x-authenticated-user: '<username>' = request came via /app-api/ (logged in)
 * - Mutating requests (POST/PUT/PATCH/DELETE) require x-pages-verified
 * - req.user is set from x-authenticated-user (null for public requests)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PAGES_API_PORT || 8083;
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || '/data/workspace';
const HANDLERS_DIR = path.join(WORKSPACE_DIR, 'pages-api');

// Route registry
let routes = {};

// ---- Minimal router ----

function createRouter() {
    const registered = [];

    function addRoute(method, routePath, handler) {
        // Convert Express-style path params (:id) to regex
        const keys = [];
        const pattern = routePath
            .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
                keys.push(key);
                return '([^/]+)';
            })
            .replace(/\*/g, '(.*)');
        registered.push({
            method: method.toUpperCase(),
            regex: new RegExp('^' + pattern + '$'),
            keys,
            handler
        });
    }

    return {
        get: (p, h) => addRoute('GET', p, h),
        post: (p, h) => addRoute('POST', p, h),
        put: (p, h) => addRoute('PUT', p, h),
        patch: (p, h) => addRoute('PATCH', p, h),
        delete: (p, h) => addRoute('DELETE', p, h),
        all: (p, h) => {
            for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
                addRoute(m, p, h);
            }
        },
        _routes: registered
    };
}

// ---- Request/Response helpers ----

function parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 10 * 1024 * 1024) { // 10MB limit
                body = '';
                req.destroy();
                resolve({});
            }
        });
        req.on('end', () => {
            try {
                const ct = req.headers['content-type'] || '';
                if (ct.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else if (ct.includes('application/x-www-form-urlencoded')) {
                    resolve(Object.fromEntries(new URLSearchParams(body)));
                } else {
                    resolve(body || {});
                }
            } catch {
                resolve({});
            }
        });
    });
}

function enhanceResponse(res) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
    };
    res.send = (data) => {
        if (typeof data === 'object') {
            res.json(data);
        } else {
            res.setHeader('Content-Type', 'text/plain');
            res.end(String(data));
        }
    };
    res.html = (data) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(data);
    };
    return res;
}

// ---- Handler loading ----

function loadHandlers() {
    const newRoutes = [];

    if (!fs.existsSync(HANDLERS_DIR)) {
        console.log('[pages-api] No handlers directory yet:', HANDLERS_DIR);
        routes = newRoutes;
        return;
    }

    const files = fs.readdirSync(HANDLERS_DIR).filter(f => f.endsWith('.js') || f.endsWith('.cjs'));
    let loaded = 0;

    for (const file of files) {
        const filePath = path.join(HANDLERS_DIR, file);
        try {
            // Clear require cache for hot reload
            delete require.cache[require.resolve(filePath)];

            const handlerModule = require(filePath);
            const setupFn = typeof handlerModule === 'function' ? handlerModule : handlerModule.default;

            if (typeof setupFn !== 'function') {
                console.warn(`[pages-api] ${file}: module must export a function, skipping`);
                continue;
            }

            const router = createRouter();
            setupFn(router, {
                workspaceDir: WORKSPACE_DIR,
                dataDir: path.join(WORKSPACE_DIR, 'pages'),
                readJSON: (filePath) => {
                    const fullPath = path.join(WORKSPACE_DIR, filePath);
                    try { return JSON.parse(fs.readFileSync(fullPath, 'utf-8')); }
                    catch { return null; }
                },
                writeJSON: (filePath, data) => {
                    const fullPath = path.join(WORKSPACE_DIR, filePath);
                    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
                },
                readFile: (filePath) => {
                    const fullPath = path.join(WORKSPACE_DIR, filePath);
                    try { return fs.readFileSync(fullPath, 'utf-8'); }
                    catch { return null; }
                },
                writeFile: (filePath, content) => {
                    const fullPath = path.join(WORKSPACE_DIR, filePath);
                    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, content);
                }
            });

            newRoutes.push(...router._routes);
            loaded++;
        } catch (err) {
            console.error(`[pages-api] Error loading ${file}:`, err.message);
        }
    }

    routes = newRoutes;
    console.log(`[pages-api] Loaded ${loaded} handler file(s), ${routes.length} route(s)`);
}

// ---- File watcher for hot reload ----

let reloadTimer = null;

function watchHandlers() {
    if (!fs.existsSync(HANDLERS_DIR)) {
        // Watch parent dir for creation of pages-api/
        const parentDir = path.dirname(HANDLERS_DIR);
        if (fs.existsSync(parentDir)) {
            const parentWatcher = fs.watch(parentDir, (eventType, filename) => {
                if (filename === 'pages-api') {
                    parentWatcher.close();
                    loadHandlers();
                    watchHandlers();
                }
            });
        }
        return;
    }

    try {
        fs.watch(HANDLERS_DIR, { recursive: true }, (eventType, filename) => {
            if (!filename) return;
            // Debounce reloads
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                console.log(`[pages-api] Change detected (${filename}), reloading handlers...`);
                loadHandlers();
            }, 300);
        });
        console.log('[pages-api] Watching for handler changes:', HANDLERS_DIR);
    } catch (err) {
        console.warn('[pages-api] Could not watch handlers dir:', err.message);
    }
}

// ---- HTTP Server ----

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method.toUpperCase();

    // Strip /pages-api prefix (auth-proxy forwards with prefix)
    let pathname = url.pathname;
    if (pathname.startsWith('/pages-api')) {
        pathname = pathname.slice('/pages-api'.length) || '/';
    }

    // No CORS wildcard - same-origin only (auth-proxy is on the same origin)
    // Browsers will block cross-origin requests without explicit CORS headers
    if (method === 'OPTIONS') {
        // Allow preflight from same origin (browser sends OPTIONS before POST)
        res.writeHead(204, {
            'Access-Control-Allow-Origin': req.headers.origin || '',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        });
        return res.end();
    }

    // Health check (internal, no origin check needed)
    if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            status: 'ok',
            service: 'pages-api',
            routes: routes.length
        }));
    }

    // Route listing (internal debugging)
    if (pathname === '/_routes' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            routes: routes.map(r => ({
                method: r.method,
                pattern: r.regex.source
            }))
        }));
    }

    // Security: enforce origin verification on mutating requests
    // Auth-proxy sets x-pages-verified: 'true' when Origin matches Host
    // or when request comes via /app-api/ (authenticated)
    const isVerified = req.headers['x-pages-verified'] === 'true';
    if (MUTATING_METHODS.has(method) && !isVerified) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            error: 'Forbidden',
            message: 'Write requests must originate from the same site'
        }));
    }

    // Reload handlers on demand (requires verified origin)
    if (pathname === '/_reload' && method === 'POST') {
        loadHandlers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ reloaded: true, routes: routes.length }));
    }

    enhanceResponse(res);

    // Set req.user from authenticated user header (null for public requests)
    req.user = req.headers['x-authenticated-user'] || null;

    // Parse body for non-GET requests
    if (method !== 'GET' && method !== 'HEAD') {
        req.body = await parseBody(req);
    } else {
        req.body = {};
    }

    // Add query params
    req.query = Object.fromEntries(url.searchParams);
    req.pathname = pathname;

    for (const route of routes) {
        if (route.method !== method) continue;
        const match = pathname.match(route.regex);
        if (!match) continue;

        // Extract params
        req.params = {};
        route.keys.forEach((key, i) => {
            req.params[key] = match[i + 1];
        });

        try {
            await route.handler(req, res);
        } catch (err) {
            console.error(`[pages-api] Handler error [${method} ${pathname}]:`, err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
            }
        }
        return;
    }

    // No route matched
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
});

// Start
loadHandlers();
watchHandlers();

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[pages-api] Server listening on http://127.0.0.1:${PORT}`);
});
