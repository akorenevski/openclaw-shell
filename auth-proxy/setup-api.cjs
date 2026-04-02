// setup-api.cjs - Settings persistence for OpenClaw gateway setup
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const AUTH_PATH = '/data/.auth';
const CONFIG_PATH = '/data/.openclaw/openclaw.json';
const AUTH_PROFILES_PATH = '/data/.openclaw/agents/main/agent/auth-profiles.json';
const LEGACY_AUTH_PATH = '/data/.openclaw/agents/main/agent/auth.json';

// OpenAI Codex OAuth constants (same as @mariozechner/pi-ai uses)
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CODEX_SCOPE = 'openid profile email offline_access';

// In-memory store for pending OAuth flows (state → { verifier, createdAt })
const pendingCodexAuth = new Map();

// Read .auth file and parse to object
function readAuthFile() {
    try {
        const content = fs.readFileSync(AUTH_PATH, 'utf-8');
        const env = {};
        content.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                let value = match[2];
                // Remove surrounding quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                env[match[1]] = value;
            }
        });
        return env;
    } catch (e) {
        return {};
    }
}

// Write object to .auth file
// Uses single quotes to prevent bash variable expansion issues with special characters
function writeAuthFile(env) {
    const lines = Object.entries(env)
        .filter(([k, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => {
            // Escape single quotes: ' -> '\''
            const escaped = String(v).replace(/'/g, "'\\''");
            return `${k}='${escaped}'`;
        });
    fs.writeFileSync(AUTH_PATH, lines.join('\n') + '\n');
}

// Read OpenClaw config
function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (e) {
        return {};
    }
}

// Write OpenClaw config (merge with existing)
function writeConfig(updates) {
    const config = readConfig();
    const merged = deepMerge(config, updates);

    // Ensure directory exists
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

// Deep merge helper
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// Mask a value for display (show first 4 and last 4 chars)
function mask(val, showLast = 4) {
    if (!val) return null;
    if (val.length <= showLast + 4) return '****';
    return val.substring(0, 4) + '***...' + val.substring(val.length - showLast);
}

// Get effective value: check .auth file first, then process.env, then openclaw.json env section
function getEffectiveEnv(key) {
    const authEnv = readAuthFile();
    const config = readConfig();
    return authEnv[key] || process.env[key] || config?.env?.[key] || null;
}

// --- ChatGPT (Codex) OAuth helpers ---

// PKCE: generate code_verifier and code_challenge (S256)
async function generatePKCE() {
    const verifierBytes = crypto.randomBytes(32);
    const verifier = verifierBytes.toString('base64url');
    const challengeBuffer = crypto.createHash('sha256').update(verifier).digest();
    const challenge = challengeBuffer.toString('base64url');
    return { verifier, challenge };
}

// Decode JWT payload (no verification — just extract claims)
function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64').toString());
    } catch { return null; }
}

// Start a ChatGPT OAuth flow: generate PKCE + auth URL
async function startCodexAuth() {
    const { verifier, challenge } = await generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    // Store verifier for later exchange
    pendingCodexAuth.set(state, { verifier, createdAt: Date.now() });

    // Clean up stale entries (older than 10 minutes)
    for (const [s, v] of pendingCodexAuth) {
        if (Date.now() - v.createdAt > 10 * 60 * 1000) pendingCodexAuth.delete(s);
    }

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CODEX_CLIENT_ID,
        redirect_uri: CODEX_REDIRECT_URI,
        scope: CODEX_SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'pi'
    });

    return { authUrl: `${CODEX_AUTHORIZE_URL}?${params.toString()}`, state };
}

// Complete a ChatGPT OAuth flow: exchange code for tokens, write credentials
async function completeCodexAuth(callbackUrl) {
    // Parse the callback URL to extract code + state
    let code, state;
    try {
        const url = new URL(callbackUrl);
        code = url.searchParams.get('code');
        state = url.searchParams.get('state');
    } catch {
        // Maybe user pasted just the query string or code
        if (callbackUrl.includes('code=')) {
            const params = new URLSearchParams(callbackUrl.includes('?') ? callbackUrl.split('?')[1] : callbackUrl);
            code = params.get('code');
            state = params.get('state');
        } else {
            throw new Error('Could not parse callback URL');
        }
    }

    if (!code) throw new Error('Missing authorization code in callback URL');
    if (!state) throw new Error('Missing state in callback URL');

    // Look up the stored verifier
    const pending = pendingCodexAuth.get(state);
    if (!pending) throw new Error('Unknown or expired OAuth state. Please start the sign-in again.');
    pendingCodexAuth.delete(state);

    // Exchange code for tokens at OpenAI token endpoint
    const response = await fetch(CODEX_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CODEX_CLIENT_ID,
            code,
            code_verifier: pending.verifier,
            redirect_uri: CODEX_REDIRECT_URI
        })
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    if (!data.access_token || !data.refresh_token) {
        throw new Error('Token response missing access_token or refresh_token');
    }

    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const expiresAt = Date.now() + (data.expires_in || 86400) * 1000;

    // Extract account info from JWT
    const payload = decodeJwtPayload(accessToken);
    const authClaim = payload?.['https://api.openai.com/auth'] || {};
    const profileClaim = payload?.['https://api.openai.com/profile'] || {};
    const accountId = authClaim.chatgpt_account_id || null;
    const email = profileClaim.email || null;
    const planType = authClaim.chatgpt_plan_type || null;

    if (!accountId) throw new Error('Failed to extract accountId from access token');

    // Write to auth-profiles.json (OpenClaw's primary auth store)
    const profileId = `openai-codex:${email || 'default'}`;
    const authProfilesDir = path.dirname(AUTH_PROFILES_PATH);
    if (!fs.existsSync(authProfilesDir)) fs.mkdirSync(authProfilesDir, { recursive: true });

    let authStore;
    try { authStore = JSON.parse(fs.readFileSync(AUTH_PROFILES_PATH, 'utf-8')); } catch { authStore = { version: 1, profiles: {} }; }

    // Remove any existing openai-codex profiles (previous user's auth)
    for (const key of Object.keys(authStore.profiles || {})) {
        if (authStore.profiles[key]?.provider === 'openai-codex') {
            delete authStore.profiles[key];
        }
    }

    authStore.profiles[profileId] = {
        type: 'oauth',
        provider: 'openai-codex',
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
        accountId
    };
    fs.writeFileSync(AUTH_PROFILES_PATH, JSON.stringify(authStore, null, 2));

    // Write to legacy auth.json (OpenClaw also reads this)
    let legacyAuth;
    try { legacyAuth = JSON.parse(fs.readFileSync(LEGACY_AUTH_PATH, 'utf-8')); } catch { legacyAuth = {}; }
    legacyAuth['openai-codex'] = {
        type: 'oauth',
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt
    };
    fs.writeFileSync(LEGACY_AUTH_PATH, JSON.stringify(legacyAuth, null, 2));

    // Update openclaw.json with auth profile declaration + model
    // Remove stale openai-codex profiles from a previous user's auth
    // (deepMerge only adds/updates keys, never removes them)
    // Only targets openai-codex provider entries — other providers are untouched
    const existingConfig = readConfig();
    if (existingConfig.auth?.profiles) {
        for (const key of Object.keys(existingConfig.auth.profiles)) {
            if (existingConfig.auth.profiles[key]?.provider === 'openai-codex') {
                delete existingConfig.auth.profiles[key];
            }
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));
    }

    writeConfig({
        auth: {
            profiles: {
                [profileId]: {
                    provider: 'openai-codex',
                    mode: 'oauth'
                }
            }
        },
        agents: {
            defaults: {
                model: {
                    primary: 'openai-codex/gpt-5.3-codex'
                }
            }
        }
    });

    // Restart gateway so it picks up the new tokens from disk.
    // Without this, OpenClaw keeps stale (already-consumed) refresh tokens in memory,
    // causing "refresh_token_reused" errors on next token refresh.
    await restartGateway();

    return { success: true, profileId, email, planType, accountId };
}

// Check ChatGPT OAuth status from auth-profiles.json
function getCodexAuthStatus() {
    try {
        const store = JSON.parse(fs.readFileSync(AUTH_PROFILES_PATH, 'utf-8'));
        const entry = Object.entries(store.profiles || {}).find(([, v]) => v.provider === 'openai-codex');
        if (!entry) return { status: 'none' };

        const [profileId, cred] = entry;
        const expired = cred.expires && cred.expires < Date.now();
        const payload = decodeJwtPayload(cred.access);
        const profileClaim = payload?.['https://api.openai.com/profile'] || {};
        const authClaim = payload?.['https://api.openai.com/auth'] || {};

        return {
            status: expired ? 'expired' : 'connected',
            profileId,
            email: profileClaim.email || null,
            planType: authClaim.chatgpt_plan_type || null
        };
    } catch {
        return { status: 'none' };
    }
}

// Get setup status - checks correct storage locations
function getSetupStatus() {
    const config = readConfig();

    // Auth-proxy credentials from /data/.auth
    const hasProxyUser = !!getEffectiveEnv('PROXY_USER');
    const hasProxyPassword = !!getEffectiveEnv('PROXY_PASSWORD');

    // OpenClaw API keys from openclaw.json env section
    const hasAnthropicKey = !!config?.env?.ANTHROPIC_API_KEY;
    const hasOpenaiKey = !!config?.env?.OPENAI_API_KEY;
    const hasTelegramToken = !!config?.env?.TELEGRAM_BOT_TOKEN;
    const hasDeepgramKey = !!config?.env?.DEEPGRAM_API_KEY;
    const hasBraveKey = !!config?.env?.BRAVE_API_KEY;

    // ChatGPT (Codex) OAuth
    const codexAuth = getCodexAuthStatus();
    const hasCodexAuth = codexAuth.status === 'connected';

    // Gateway token from gateway.auth.token
    const hasGatewayToken = !!config?.gateway?.auth?.token;

    return {
        complete: (hasAnthropicKey || hasOpenaiKey || hasCodexAuth) && hasProxyUser && hasProxyPassword,
        fields: {
            anthropicApiKey: hasAnthropicKey,
            openaiApiKey: hasOpenaiKey,
            codexAuth: hasCodexAuth,
            proxyUser: hasProxyUser,
            proxyPassword: hasProxyPassword,
            gatewayToken: hasGatewayToken,
            telegramBotToken: hasTelegramToken,
            telegramUserId: !!config?.channels?.telegram?.allowFrom?.length,
            deepgramApiKey: hasDeepgramKey,
            braveSearchApiKey: hasBraveKey
        }
    };
}

// Get current settings (masked for display)
// Reads from correct storage locations:
// - PROXY_USER, PROXY_PASSWORD from /data/.auth
// - API keys from openclaw.json env section
// - Gateway token from openclaw.json gateway.auth.token
function getSettings() {
    const config = readConfig();

    // Auth-proxy credentials (from /data/.auth)
    const proxyUser = getEffectiveEnv('PROXY_USER');
    const proxyPassword = getEffectiveEnv('PROXY_PASSWORD');

    // OpenClaw API keys (from openclaw.json env section)
    const anthropicKey = config?.env?.ANTHROPIC_API_KEY || null;
    const openaiKey = config?.env?.OPENAI_API_KEY || null;
    const telegramToken = config?.env?.TELEGRAM_BOT_TOKEN || null;
    const deepgramKey = config?.env?.DEEPGRAM_API_KEY || null;
    const braveKey = config?.env?.BRAVE_API_KEY || null;

    // Detect current inference provider from model config
    const primaryModel = config?.agents?.defaults?.model?.primary || '';
    let inferenceProvider = 'anthropic';
    if (primaryModel.startsWith('openai-codex/')) inferenceProvider = 'chatgpt';
    else if (primaryModel.startsWith('openai/')) inferenceProvider = 'openai';

    // ChatGPT (Codex) OAuth status
    const codexAuth = getCodexAuthStatus();

    // Gateway token (from openclaw.json gateway.auth.token)
    const gatewayToken = config?.gateway?.auth?.token || null;

    return {
        inferenceProvider,
        anthropicApiKey: mask(anthropicKey),
        openaiApiKey: mask(openaiKey),
        codexAuthStatus: codexAuth.status,
        codexAuthEmail: codexAuth.email || null,
        codexAuthPlan: codexAuth.planType || null,
        proxyUser: proxyUser || null,
        proxyPassword: proxyPassword ? '********' : null,
        gatewayToken: gatewayToken || null, // Full value - user needs to copy
        telegramBotToken: mask(telegramToken),
        telegramUserId: config?.channels?.telegram?.allowFrom?.[0] || null,
        deepgramApiKey: mask(deepgramKey),
        braveSearchApiKey: mask(braveKey)
    };
}

// Save settings
// origin parameter: the origin URL of the request (e.g., 'https://example.com')
function saveSettings(settings, origin = null) {
    // Read existing auth credentials from .auth file
    const auth = readAuthFile();

    // Update auth credentials from form
    if (settings.proxyUser) {
        auth.PROXY_USER = settings.proxyUser;
    }
    if (settings.proxyPassword) {
        auth.PROXY_PASSWORD = settings.proxyPassword;
    }

    // Preserve or generate auth secret
    if (!auth.AUTH_SECRET) {
        auth.AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
    }

    // Write auth file (PROXY_USER, PROXY_PASSWORD, AUTH_SECRET only)
    writeAuthFile(auth);

    // Update process.env so changes take effect immediately
    for (const [key, value] of Object.entries(auth)) {
        process.env[key] = value;
    }

    // Read existing config to preserve values
    const existingConfig = readConfig();

    // Build env section for openclaw.json (OpenClaw-specific API keys only)
    // Preserve existing values, update with new ones from settings
    const envConfig = existingConfig.env || {};
    if (settings.anthropicApiKey) envConfig.ANTHROPIC_API_KEY = settings.anthropicApiKey;
    if (settings.openaiApiKey) envConfig.OPENAI_API_KEY = settings.openaiApiKey;
    if (settings.telegramBotToken) envConfig.TELEGRAM_BOT_TOKEN = settings.telegramBotToken;
    if (settings.deepgramApiKey) envConfig.DEEPGRAM_API_KEY = settings.deepgramApiKey;
    if (settings.braveSearchApiKey) envConfig.BRAVE_API_KEY = settings.braveSearchApiKey;

    // Preserve or generate gateway token
    const gatewayToken = existingConfig?.gateway?.auth?.token ||
        process.env.OPENCLAW_GATEWAY_TOKEN ||
        crypto.randomBytes(32).toString('base64url');

    // Build OpenClaw config updates - ONLY user data, NOT infrastructure
    // Infrastructure settings (port, bind, workspace, etc.) are managed by start-container.sh
    const configUpdates = {
        env: envConfig,
        gateway: {
            // Preserve or set gateway token (auth mode is managed by start-container.sh)
            auth: {
                token: gatewayToken
            },
            // Set CORS allowed origins from request origin (platform-agnostic)
            controlUi: origin ? {
                allowedOrigins: [origin]
            } : {}
        }
    };

    // Set inference provider model routing
    const provider = settings.inferenceProvider || 'anthropic';
    const modelMap = {
        anthropic: 'anthropic/claude-sonnet-4-6',
        openai: 'openai/gpt-5.2',
        chatgpt: 'openai-codex/gpt-5.3-codex'
    };
    configUpdates.agents = configUpdates.agents || {};
    configUpdates.agents.defaults = configUpdates.agents.defaults || {};
    configUpdates.agents.defaults.model = {
        primary: modelMap[provider] || modelMap.anthropic
    };

    // For ChatGPT provider, set up auth profile in config (tokens are in auth-profiles.json)
    if (provider === 'chatgpt') {
        const codexAuth = getCodexAuthStatus();
        if (codexAuth.profileId) {
            configUpdates.auth = {
                profiles: {
                    [codexAuth.profileId]: {
                        provider: 'openai-codex',
                        mode: 'oauth'
                    }
                }
            };
        }
    }

    // Add Telegram config if bot token provided
    if (envConfig.TELEGRAM_BOT_TOKEN) {
        const telegramUserId = settings.telegramUserId || existingConfig?.channels?.telegram?.allowFrom?.[0];
        configUpdates.channels = configUpdates.channels || {};
        configUpdates.channels.telegram = {
            botToken: envConfig.TELEGRAM_BOT_TOKEN,
            dmPolicy: 'pairing',
            groupPolicy: 'allowlist',
            chunkMode: 'length',
            streamMode: 'partial',
            actions: { sendMessage: true }
        };

        if (telegramUserId) {
            configUpdates.channels.telegram.allowFrom = [telegramUserId];
            configUpdates.channels.telegram.groupAllowFrom = [telegramUserId];
        }

        configUpdates.plugins = { entries: { telegram: { enabled: true } } };
    }

    // Add Brave search config if API key provided
    if (envConfig.BRAVE_API_KEY) {
        configUpdates.tools = configUpdates.tools || {};
        configUpdates.tools.web = {
            search: {
                provider: 'brave',
                apiKey: envConfig.BRAVE_API_KEY
            }
        };
    }

    // Add Deepgram config if API key provided
    if (envConfig.DEEPGRAM_API_KEY) {
        configUpdates.tools = configUpdates.tools || {};
        configUpdates.tools.media = {
            audio: {
                enabled: true,
                providerOptions: {
                    deepgram: {
                        smart_format: true,
                        detectLanguage: true,
                        punctuate: true
                    }
                },
                models: [{
                    provider: 'deepgram',
                    model: 'nova-3',
                    deepgram: { detectLanguage: true }
                }]
            }
        };
    }

    // Sync Anthropic API key to models.providers if that section exists
    // (setup page writes to env.ANTHROPIC_API_KEY, but gateway may read from models.providers.anthropic.apiKey)
    if (settings.anthropicApiKey) {
        const existingProviders = existingConfig?.models?.providers?.anthropic;
        if (existingProviders) {
            configUpdates.models = configUpdates.models || {};
            configUpdates.models.providers = configUpdates.models.providers || {};
            configUpdates.models.providers.anthropic = configUpdates.models.providers.anthropic || {};
            configUpdates.models.providers.anthropic.apiKey = settings.anthropicApiKey;
        }
    }

    // Sync OpenAI API key to models.providers if that section exists
    if (settings.openaiApiKey) {
        const existingProviders = existingConfig?.models?.providers?.openai;
        if (existingProviders) {
            configUpdates.models = configUpdates.models || {};
            configUpdates.models.providers = configUpdates.models.providers || {};
            configUpdates.models.providers.openai = configUpdates.models.providers.openai || {};
            configUpdates.models.providers.openai.apiKey = settings.openaiApiKey;
        }
    }

    // Write config (gateway hot-reloads openclaw.json automatically)
    writeConfig(configUpdates);

    return {
        success: true,
        gatewayToken: gatewayToken
    };
}

// Regenerate gateway token
function regenerateGatewayToken() {
    const newToken = crypto.randomBytes(32).toString('base64url');

    // Update process.env
    process.env.OPENCLAW_GATEWAY_TOKEN = newToken;

    // Update config file (preserve existing auth mode — don't clobber trusted-proxy)
    const config = readConfig();
    config.gateway = config.gateway || {};
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = newToken;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    return { gatewayToken: newToken };
}

// Force restart the OpenClaw gateway via supervisord
function restartGateway() {
    return new Promise((resolve) => {
        execFile('supervisorctl', ['restart', 'openclaw'], (err) => {
            if (err) {
                console.error('Failed to restart gateway:', err.message);
                resolve({ success: false, error: err.message });
            } else {
                console.log('Gateway restarted manually');
                resolve({ success: true });
            }
        });
    });
}

module.exports = {
    getSetupStatus,
    getSettings,
    saveSettings,
    regenerateGatewayToken,
    restartGateway,
    startCodexAuth,
    completeCodexAuth
};
