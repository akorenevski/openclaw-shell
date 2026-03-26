const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const net = require('net');
const setupApi = require('./setup-api.cjs');

// Config from env
const PORT = process.env.AUTH_PROXY_PORT || 8080;
const OPENCLAW_PORT = process.env.OPENCLAW_PORT || 8082;
const FILEBROWSER_PORT = process.env.FILEBROWSER_PORT || 8081;
const PAGES_API_PORT = process.env.PAGES_API_PORT || 8083;

// Authenticated username from the current request's session token
// Used to inject x-forwarded-user header for trusted-proxy auth

// Dynamic credential functions (read current env so changes take effect immediately)
function getUsername() { return process.env.PROXY_USER || 'admin'; }
function getPassword() { return process.env.PROXY_PASSWORD || 'admin'; }
function getSecret() { return process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex'); }

const COOKIE_NAME = 'openclaw_auth';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

// Simple token generation/verification
function generateToken(username) {
    const payload = JSON.stringify({ username, exp: Date.now() + COOKIE_MAX_AGE * 1000 });
    const signature = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
    return Buffer.from(payload).toString('base64') + '.' + signature;
}

function verifyToken(token) {
    if (!token) return null;
    try {
        const [payloadB64, signature] = token.split('.');
        const payload = Buffer.from(payloadB64, 'base64').toString();
        const expectedSig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
        if (signature !== expectedSig) return null;
        const data = JSON.parse(payload);
        if (data.exp < Date.now()) return null;
        return data;
    } catch {
        return null;
    }
}

function parseCookies(cookieHeader) {
    const cookies = {};
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const idx = cookie.indexOf('=');
            if (idx > 0) {
                const name = cookie.substring(0, idx).trim();
                const value = cookie.substring(idx + 1).trim();
                cookies[name] = value;
            }
        });
    }
    return cookies;
}

function parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                if (req.headers['content-type']?.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else {
                    // URL encoded
                    const params = new URLSearchParams(body);
                    resolve(Object.fromEntries(params));
                }
            } catch {
                resolve({});
            }
        });
    });
}

// Check if request Origin matches the Host (same-origin verification for CSRF protection)
function isOriginVerified(req) {
    const origin = req.headers.origin;
    if (!origin) return false;
    try {
        const originHost = new URL(origin).host.replace(/:\d+$/, '');
        const requestHost = (req.headers.host || '').replace(/:\d+$/, '');
        return originHost === requestHost;
    } catch {
        return false;
    }
}

// Proxy HTTP request to backend
// authenticatedUser: if set, injects x-forwarded-user header for trusted-proxy auth
// extraHeaders: trusted headers injected by auth-proxy (e.g., x-pages-verified, x-authenticated-user)
function proxyRequest(req, res, targetPort, stripPrefix = '', authenticatedUser = null, extraHeaders = null) {
    let targetPath = req.url;
    if (stripPrefix && targetPath.startsWith(stripPrefix)) {
        targetPath = targetPath.slice(stripPrefix.length) || '/';
    }
    const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };

    // Always strip trusted headers to prevent external injection
    delete headers['x-pages-verified'];
    delete headers['x-authenticated-user'];

    // For OpenClaw trusted-proxy: inject user identity and clean up external headers
    if (authenticatedUser) {
        headers['x-forwarded-user'] = authenticatedUser;
        delete headers['x-forwarded-for'];
        delete headers['x-forwarded-proto'];
        delete headers['x-forwarded-host'];
        delete headers['x-real-ip'];
        delete headers['cf-connecting-ip'];
        delete headers['true-client-ip'];
    }

    // Inject trusted headers from auth-proxy
    if (extraHeaders) {
        Object.assign(headers, extraHeaders);
    }

    const options = {
        hostname: '127.0.0.1',
        port: targetPort,
        path: targetPath,
        method: req.method,
        headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('Proxy error:', err.message);
        res.writeHead(502);
        res.end('Bad Gateway');
    });

    req.pipe(proxyReq);
}

// Proxy WebSocket upgrade to backend
// authenticatedUser: if set, injects x-forwarded-user header for trusted-proxy auth
function proxyWebSocket(req, socket, head, targetPort, stripPrefix = '', authenticatedUser = null) {
    let targetPath = req.url;
    if (stripPrefix && targetPath.startsWith(stripPrefix)) {
        targetPath = targetPath.slice(stripPrefix.length) || '/';
    }

    const proxySocket = net.connect(targetPort, '127.0.0.1', () => {
        const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };

        // For OpenClaw trusted-proxy: inject user identity and clean up external headers
        if (authenticatedUser) {
            headers['x-forwarded-user'] = authenticatedUser;
            delete headers['x-forwarded-for'];
            delete headers['x-forwarded-proto'];
            delete headers['x-forwarded-host'];
            delete headers['x-real-ip'];
            delete headers['cf-connecting-ip'];
            delete headers['true-client-ip'];
        }

        let request = `${req.method} ${targetPath} HTTP/1.1\r\n`;
        for (const [key, value] of Object.entries(headers)) {
            request += `${key}: ${value}\r\n`;
        }
        request += '\r\n';

        proxySocket.write(request);
        if (head.length > 0) {
            proxySocket.write(head);
        }

        // Pipe bidirectionally
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
    });

    proxySocket.on('error', (err) => {
        console.error('WebSocket proxy error:', err.message);
        socket.end();
    });

    socket.on('error', (err) => {
        console.error('Client socket error:', err.message);
        proxySocket.end();
    });
}

// Serve static files from a directory (used for both /pages/ and /app/)
function serveStaticFile(res, baseDir, urlPathname, prefix) {
    const safePath = path.normalize(urlPathname.replace(prefix, '')).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(baseDir, safePath || 'index.html');

    // If directory, try index.html
    let resolvedPath = filePath;
    try {
        if (fs.statSync(filePath).isDirectory()) {
            resolvedPath = path.join(filePath, 'index.html');
        }
    } catch {}

    const extMap = {
        '.html': 'text/html; charset=utf-8', '.css': 'text/css',
        '.js': 'application/javascript', '.json': 'application/json',
        '.png': 'image/png', '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml', '.gif': 'image/gif', '.ico': 'image/x-icon',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp'
    };
    const ext = path.extname(resolvedPath);
    const contentType = extMap[ext] || 'application/octet-stream';

    try {
        const data = fs.readFileSync(resolvedPath);
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(data);
    } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not Found');
    }
}

// Load HTML pages
const loginPageHTML = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf-8');
const landingPageHTML = fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf-8');
const setupPageHTML = fs.readFileSync(path.join(__dirname, 'setup.html'), 'utf-8');

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cookies = parseCookies(req.headers.cookie);
    const token = verifyToken(cookies[COOKIE_NAME]);

    // Health check - respond directly
    if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', service: 'auth-proxy' }));
    }

    // Login page
    if (url.pathname === '/login') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(loginPageHTML);
        }

        if (req.method === 'POST') {
            const body = await parseBody(req);
            const redirect = url.searchParams.get('redirect') || '/';

            if (body.username === getUsername() && body.password === getPassword()) {
                const authToken = generateToken(body.username);
                res.writeHead(302, {
                    'Set-Cookie': `${COOKIE_NAME}=${authToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`,
                    'Location': redirect
                });
                return res.end();
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(loginPageHTML.replace('<!--ERROR-->', '<p class="error">Invalid credentials</p>'));
            }
        }
    }

    // Logout
    if (url.pathname === '/logout') {
        res.writeHead(302, {
            'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`,
            'Location': '/login'
        });
        return res.end();
    }

    // Static pages - public, no auth required
    if (url.pathname === '/pages' || url.pathname.startsWith('/pages/')) {
        return serveStaticFile(res, '/data/workspace/pages', url.pathname, '/pages');
    }

    // Pages API - public, origin-verified for write protection
    // Auth-proxy injects x-pages-verified header when Origin matches Host
    if (url.pathname === '/pages-api' || url.pathname.startsWith('/pages-api/')) {
        const extraHeaders = {};
        if (isOriginVerified(req)) {
            extraHeaders['x-pages-verified'] = 'true';
        }
        return proxyRequest(req, res, PAGES_API_PORT, '', null, extraHeaders);
    }

    // Setup status API - public endpoint (needed to check if setup complete)
    if (url.pathname === '/api/setup/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(setupApi.getSetupStatus()));
    }

    // Check auth for all other routes
    if (!token) {
        const redirect = encodeURIComponent(url.pathname + url.search);
        res.writeHead(302, { 'Location': `/login?redirect=${redirect}` });
        return res.end();
    }

    // ---- All routes below require authentication ----

    // Private pages - auth required, served from /data/workspace/app/
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
        return serveStaticFile(res, '/data/workspace/app', url.pathname, '/app');
    }

    // Private API - auth required, proxied to pages-api with authenticated user
    // Rewrite /app-api/* to /pages-api/* so the same handlers serve both
    if (url.pathname === '/app-api' || url.pathname.startsWith('/app-api/')) {
        const extraHeaders = {
            'x-pages-verified': 'true',
            'x-authenticated-user': token.username
        };
        // Rewrite URL path: /app-api/foo → /pages-api/foo (same handlers)
        const rewrittenUrl = req.url.replace(/^\/app-api/, '/pages-api');
        const originalUrl = req.url;
        req.url = rewrittenUrl;
        const result = proxyRequest(req, res, PAGES_API_PORT, '', null, extraHeaders);
        req.url = originalUrl;
        return result;
    }

    // Setup/Settings page
    if (url.pathname === '/setup') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(setupPageHTML);
    }

    // Setup API - get current settings (protected)
    if (url.pathname === '/api/setup/settings' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(setupApi.getSettings()));
    }

    // Setup API - save settings (protected)
    if (url.pathname === '/api/setup/settings' && req.method === 'POST') {
        const body = await parseBody(req);
        // Extract origin from request for CORS allowedOrigins
        const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : null);
        const result = setupApi.saveSettings(body, origin);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
    }

    // Setup API - regenerate gateway token (protected)
    if (url.pathname === '/api/setup/regenerate-gateway-token' && req.method === 'POST') {
        const result = setupApi.regenerateGatewayToken();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
    }

    // Setup API - force restart gateway (protected)
    if (url.pathname === '/api/setup/restart-gateway' && req.method === 'POST') {
        const result = await setupApi.restartGateway();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
    }

    // ChatGPT OAuth - start auth flow (protected)
    if (url.pathname === '/api/setup/codex-auth/start' && req.method === 'POST') {
        try {
            const result = await setupApi.startCodexAuth();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // ChatGPT OAuth - complete auth flow (protected)
    if (url.pathname === '/api/setup/codex-auth/complete' && req.method === 'POST') {
        const body = await parseBody(req);
        try {
            const result = await setupApi.completeCodexAuth(body.callbackUrl);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    // Landing page - redirect to setup if not complete
    if (url.pathname === '/') {
        const status = setupApi.getSetupStatus();
        if (!status.complete) {
            res.writeHead(302, { 'Location': '/setup' });
            return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(landingPageHTML);
    }

    // File browser - proxy to FileBrowser (keeps /files prefix)
    if (url.pathname === '/files' || url.pathname.startsWith('/files/')) {
        return proxyRequest(req, res, FILEBROWSER_PORT);
    }

    // Dashboard - proxy to OpenClaw with authenticated user identity
    // trusted-proxy auth: gateway trusts x-forwarded-user from 127.0.0.1
    if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')) {
        return proxyRequest(req, res, OPENCLAW_PORT, '', token.username);
    }

    // Default: redirect to landing
    res.writeHead(302, { 'Location': '/' });
    res.end();
});

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cookies = parseCookies(req.headers.cookie);
    const token = verifyToken(cookies[COOKIE_NAME]);

    // Check auth for WebSocket
    if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    // Dashboard WebSocket - proxy to OpenClaw with authenticated user identity
    if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')) {
        return proxyWebSocket(req, socket, head, OPENCLAW_PORT, '/dashboard', token.username);
    }

    // File browser WebSocket (if needed)
    if (url.pathname === '/files' || url.pathname.startsWith('/files/')) {
        return proxyWebSocket(req, socket, head, FILEBROWSER_PORT);
    }

    // Root WebSocket - also proxy to OpenClaw with authenticated user identity
    if (url.pathname === '/' || url.pathname === '') {
        return proxyWebSocket(req, socket, head, OPENCLAW_PORT, '', token.username);
    }

    // Unknown WebSocket path
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Auth proxy listening on http://0.0.0.0:${PORT}`);
});
